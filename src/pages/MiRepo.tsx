import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ScanLine, Loader2, Store, Check, Undo2, Camera, CameraOff, ChevronRight, AlertTriangle,
  Play, Pause, Flag, Timer,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { normalizaCodigo } from '@/lib/loginEmpleado'
import { compararUbicaciones, ubicacionesDeArticulos } from '@/lib/mapeo'

type EstadoM = 'pendiente' | 'hecho' | 'faltante'

interface Lote {
  id: string
  nombre: string
  motivo: string | null
  created_at: string
}

interface Asignacion {
  lote_id: string
  local: string
}

interface Item {
  id: string
  lote_id: string
  orden: number
  local: string
  material: string | null
  codigo: string | null
  articulo: string | null
  color: string | null
  talle: string | null
  cantidad: number
  escaneadas: number
  estado: EstadoM
  hecho_at: string | null
  hecho_por: string | null
}

/** Lo que devuelven escanear_codigo() / deshacer_escaneo() (sql/empleados_piso_seguridad_1.sql). */
interface FilaEscaneo {
  item_id: string
  item_escaneadas: number
  item_cantidad: number
  item_estado: EstadoM
  item_codigo: string | null
}

/** Último escaneo confirmado, para poder deshacerlo. */
interface UltimoEscaneo {
  id: string
  codigo: string
}

const COLUMNAS_ITEM =
  'id,lote_id,orden,local,material,codigo,articulo,color,talle,cantidad,escaneadas,estado,hecho_at,hecho_por'

function mismaLocal(a: string, b: string): boolean {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()
}

function claveDe(a: Asignacion): string {
  return `${a.lote_id}|${String(a.local ?? '').trim().toUpperCase()}`
}

/** Sesión de trabajo de un repo (sql/piso_tiempos.sql): Iniciar -> Pausar/Reanudar -> Finalizar */
type EstadoSesion = 'en_curso' | 'pausada' | 'finalizada'
interface FilaSesion {
  sesion_id: string
  estado: EstadoSesion
  segundos: number
  unidades: number
  pendientes_fin: number | null
}
/** Sesión en pantalla: `segundos` al momento `marca` (reloj local), para el cronómetro. */
interface Sesion {
  id: string
  estado: EstadoSesion
  segundos: number
  marca: number
}

function aSesion(f: FilaSesion): Sesion {
  return { id: f.sesion_id, estado: f.estado, segundos: f.segundos, marca: Date.now() }
}

function fmtReloj(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** Talle numérico con "T" (T38); de letra tal cual (M, L, U) */
function fmtTalle(talle: string | null): string | null {
  if (!talle) return null
  return /^\d/.test(talle) ? `T${talle}` : talle
}

/** "ZH000200 · color 02 · XL" para los mensajes de escaneo */
function etiquetaDe(i: Item | undefined): string | null {
  if (!i) return null
  return [i.codigo, i.color ? `color ${i.color}` : null, fmtTalle(i.talle)].filter(Boolean).join(' · ')
}

function filaDe<T>(data: unknown): T | null {
  return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null
}

export default function MiRepo() {
  const { perfil, soloPiso } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [empleadoNombre, setEmpleadoNombre] = useState<string | null>(null)
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [lotes, setLotes] = useState<Record<string, Lote>>({})
  const [items, setItems] = useState<Item[]>([])
  // Ubicaciones del Mapeo depósito por artículo (código en mayúsculas -> PB-A1, …)
  const [ubicaciones, setUbicaciones] = useState<Map<string, string[]>>(new Map())
  // Copia para leer los ítems dentro de callbacks sin re-crearlos en cada escaneo
  const itemsRef = useRef<Item[]>([])
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const [sel, setSel] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [deshacer, setDeshacer] = useState<UltimoEscaneo | null>(null)
  // Escaneos en viaje: se cuentan (no se bloquea), así un lector rápido no pierde lecturas
  const [enViaje, setEnViaje] = useState(0)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [camara, setCamara] = useState(false)

  // Tiempo de trabajo del repo abierto
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [cargandoSesion, setCargandoSesion] = useState(false)
  const [accionSesion, setAccionSesion] = useState(false)
  const [confirmarFin, setConfirmarFin] = useState(false)
  const [resumen, setResumen] = useState<string | null>(null)
  // Repos que YA finalicé (no se vuelven a mostrar) y los que tengo abiertos (en curso / pausa)
  const [finalizados, setFinalizados] = useState<Set<string>>(new Set())
  const [abiertos, setAbiertos] = useState<Record<string, EstadoSesion>>({})
  const [, setTick] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)

  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco tiene que volver siempre.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  /* ------------------------------------------------------------------ */
  /*  Carga: legajo -> empleado -> mis (lote, local) -> sus ítems        */
  /* ------------------------------------------------------------------ */
  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    setAviso(null)

    const legajo = String(perfil?.legajo ?? '').trim()
    if (!legajo) {
      setAviso('Tu cuenta no tiene legajo cargado. Pedile al administrador que lo asigne en Usuarios.')
      setCargando(false)
      return
    }

    try {
      const { data: emp, error: eEmp } = await supabase
        .from('empleados_basico')
        .select('id,nombre')
        .eq('legajo', legajo)
        .limit(1)
      if (eEmp) throw new Error(eEmp.message)
      const fila = ((emp as Array<{ id: string; nombre: string | null }> | null) ?? [])[0]
      if (!fila) {
        setAviso(`No encontré el legajo ${legajo} en la nómina. Pedile al administrador que lo revise.`)
        setCargando(false)
        return
      }
      setEmpleadoNombre(fila.nombre ?? perfil?.nombre ?? null)

      const { data: resp, error: eResp } = await supabase
        .from('mayorista_responsables')
        .select('lote_id,local')
        .eq('empleado_id', fila.id)
      if (eResp) throw new Error(eResp.message)

      const misAsignaciones = ((resp as Asignacion[]) ?? [])
        .filter((a) => a.lote_id && a.local)
        .sort((a, b) => String(a.local).localeCompare(String(b.local), 'es'))
      setAsignaciones(misAsignaciones)

      const loteIds = Array.from(new Set(misAsignaciones.map((a) => a.lote_id)))
      if (loteIds.length === 0) {
        setLotes({})
        setItems([])
        setCargando(false)
        return
      }

      const rl = await supabase.from('mayorista_lotes').select('id,nombre,motivo,created_at').in('id', loteIds)
      if (rl.error) throw new Error(rl.error.message)
      const mapa: Record<string, Lote> = {}
      for (const l of (rl.data as Lote[] | null) ?? []) mapa[l.id] = l
      setLotes(mapa)

      // Mis sesiones de trabajo en esos lotes: las finalizadas no se vuelven a mostrar
      if (perfil?.id) {
        const rs = await supabase
          .from('repo_sesiones')
          .select('lote_id,local,estado')
          .eq('usuario_id', perfil.id)
          .in('lote_id', loteIds)
        if (!rs.error) {
          const fin = new Set<string>()
          const ab: Record<string, EstadoSesion> = {}
          for (const s of (rs.data as Array<Asignacion & { estado: EstadoSesion }> | null) ?? []) {
            if (s.estado === 'finalizada') fin.add(claveDe(s))
            else ab[claveDe(s)] = s.estado
          }
          setFinalizados(fin)
          setAbiertos(ab)
        }
      }

      const PAGE = 1000
      const todos: Item[] = []
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase
          .from('mayorista_items')
          .select(COLUMNAS_ITEM)
          .in('lote_id', loteIds)
          .order('lote_id', { ascending: true })
          .order('orden', { ascending: true })
          .range(desde, desde + PAGE - 1)
        if (error) throw new Error(error.message)
        const chunk = (data as Item[]) ?? []
        todos.push(...chunk)
        if (chunk.length < PAGE) break
      }

      // Defensa extra: aunque la RLS no esté activa, acá solo quedan MIS locales.
      const permitidas = new Set(misAsignaciones.map(claveDe))
      const mios = todos.filter((i) => permitidas.has(claveDe(i)))
      setItems(mios)
      setCargando(false)
      enfocar()
      // Ubicaciones del mapeo: no frenan la carga; si fallan, la lista queda en su orden de siempre
      ubicacionesDeArticulos(mios.map((i) => i.codigo ?? ''))
        .then(setUbicaciones)
        .catch(() => { /* sin mapeo: sin ubicaciones */ })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar tus repos.')
      setCargando(false)
    }
  }, [perfil?.id, perfil?.legajo, perfil?.nombre, enfocar])

  useEffect(() => { void cargar() }, [cargar])

  /* ------------------------------------------------------------------ */
  /*  Derivados                                                          */
  /* ------------------------------------------------------------------ */
  const asignacionSel = useMemo(
    () => asignaciones.find((a) => claveDe(a) === sel) ?? null,
    [asignaciones, sel],
  )

  const itemsDe = useCallback(
    (a: Asignacion) => items.filter((i) => i.lote_id === a.lote_id && mismaLocal(i.local, a.local)),
    [items],
  )

  /** Unidades todavía no escaneadas de esa asignación (los faltantes no cuentan). */
  const progreso = useCallback(
    (a: Asignacion) => {
      let total = 0
      let listas = 0
      for (const i of itemsDe(a)) {
        if (i.estado === 'faltante') continue
        // "hecho" cuenta completo aunque el contador no coincida (ítems marcados a mano)
        const hechas = i.estado === 'hecho' ? i.cantidad : Math.min(i.escaneadas, i.cantidad)
        total += i.cantidad
        listas += hechas
      }
      return { total, listas, pendientes: total - listas }
    },
    [itemsDe],
  )

  // Momento de la última lectura de cada ítem (en esta pantalla): los escaneados recientes van arriba
  const [ultimoEscaneo, setUltimoEscaneo] = useState<Record<string, number>>({})

  /** Artículos ya completos del repo abierto (cuadro "Escaneados"), lo último arriba. */
  const escaneadosDeSel = useMemo(() => {
    if (!asignacionSel) return []
    return itemsDe(asignacionSel)
      .filter((i) => i.estado === 'hecho')
      .sort((a, b) => (ultimoEscaneo[b.id] ?? 0) - (ultimoEscaneo[a.id] ?? 0) || a.orden - b.orden)
  }, [asignacionSel, itemsDe, ultimoEscaneo])

  /** Ubicaciones mapeadas de un ítem (vacío si el artículo no está en el mapeo) */
  const ubicacionesDe = useCallback(
    (i: Item) => ubicaciones.get(String(i.codigo ?? '').trim().toUpperCase()) ?? [],
    [ubicaciones],
  )

  // Pendientes en el orden del depósito (PB-A1, PB-A2 …); los que no están mapeados, al final
  const pendientesDeSel = useMemo(() => {
    if (!asignacionSel) return []
    return itemsDe(asignacionSel)
      .filter((i) => i.estado === 'pendiente' && i.escaneadas < i.cantidad)
      .sort((a, b) => {
        const ua = ubicacionesDe(a)[0]
        const ub = ubicacionesDe(b)[0]
        const porUbicacion = ua && ub ? compararUbicaciones(ua, ub) : ua ? -1 : ub ? 1 : 0
        return (
          porUbicacion ||
          a.orden - b.orden ||
          String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'es')
        )
      })
  }, [asignacionSel, itemsDe, ubicacionesDe])

  const progresoSel = asignacionSel ? progreso(asignacionSel) : null

  /**
   * En la lista van los repos con algo por escanear que no finalicé, más los que
   * tengo abiertos (en curso / pausa). Los terminados o finalizados no se muestran.
   */
  const conPendientes = useMemo(
    () =>
      asignaciones.filter((a) => {
        const k = claveDe(a)
        if (abiertos[k]) return true
        return progreso(a).pendientes > 0 && !finalizados.has(k)
      }),
    [asignaciones, progreso, abiertos, finalizados],
  )

  /* ------------------------------------------------------------------ */
  /*  Tiempo: Iniciar / Pausar / Reanudar / Finalizar                    */
  /* ------------------------------------------------------------------ */
  const segundosSesion = sesion
    ? sesion.segundos + (sesion.estado === 'en_curso' ? (Date.now() - sesion.marca) / 1000 : 0)
    : 0

  // El cronómetro se redibuja cada segundo mientras está en curso
  useEffect(() => {
    if (sesion?.estado !== 'en_curso') return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [sesion?.estado])

  const recordarSesion = useCallback((a: Asignacion, s: Sesion | null) => {
    const k = claveDe(a)
    setAbiertos((prev) => {
      const nuevo = { ...prev }
      if (s && s.estado !== 'finalizada') nuevo[k] = s.estado
      else delete nuevo[k]
      return nuevo
    })
    if (s?.estado === 'finalizada') setFinalizados((prev) => new Set(prev).add(k))
  }, [])

  const accion = useCallback(
    async (fn: 'repo_iniciar' | 'repo_pausar' | 'repo_reanudar' | 'repo_finalizar') => {
      const sb = supabase
      if (!sb || !asignacionSel || accionSesion) return null
      setAccionSesion(true)
      setMensaje(null)
      try {
        const args =
          fn === 'repo_iniciar'
            ? { p_lote: asignacionSel.lote_id, p_local: asignacionSel.local }
            : { p_sesion: sesion?.id }
        const { data, error: eRpc } = await sb.rpc(fn, args)
        if (eRpc) throw new Error(eRpc.message)
        const fila = filaDe<FilaSesion>(data)
        if (!fila) throw new Error('La base no confirmó el cambio. Probá de nuevo.')
        const s = aSesion(fila)
        setSesion(s.estado === 'finalizada' ? null : s)
        recordarSesion(asignacionSel, s)
        if (s.estado === 'en_curso') enfocar()
        return fila
      } catch (e) {
        setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo registrar' })
        return null
      } finally {
        setAccionSesion(false)
      }
    },
    [asignacionSel, accionSesion, sesion?.id, recordarSesion, enfocar],
  )

  async function finalizar() {
    setConfirmarFin(false)
    const fila = await accion('repo_finalizar')
    if (!fila) return
    const faltaron = fila.pendientes_fin ?? 0
    setResumen(
      `Repo finalizado en ${fmtReloj(fila.segundos)} · ${fila.unidades} u. escaneadas` +
        (faltaron > 0 ? ` · ${faltaron} u. marcadas como faltantes (✕)` : ''),
    )
    setSel(null)
    setDeshacer(null)
    setCamara(false)
  }

  /* ------------------------------------------------------------------ */
  /*  Escaneo                                                            */
  /* ------------------------------------------------------------------ */
  /** La base es la fuente de verdad: el ítem queda como lo devolvió la función. */
  const aplicarFila = useCallback((f: FilaEscaneo) => {
    setItems((prev) =>
      prev.map((x) => (x.id === f.item_id ? { ...x, escaneadas: f.item_escaneadas, estado: f.item_estado } : x)),
    )
  }, [])

  const alEscanear = useCallback(
    (bruto: string) => {
      const cod = normalizaCodigo(bruto)
      const sb = supabase
      if (!cod || !asignacionSel || !sb) return
      if (sesion?.estado !== 'en_curso') {
        // La base también lo rechaza: el tiempo medido tiene que ser real
        setMensaje({ ok: false, texto: sesion ? 'Estás en pausa: tocá Reanudar' : 'Tocá Iniciar para empezar a escanear' })
        return
      }
      const { lote_id, local } = asignacionSel

      // No se bloquea mientras hay otro en viaje: cada lectura va a la base, que suma
      // de a una con bloqueo de fila (sql: escanear_codigo), así dos lecturas seguidas cuentan dos.
      setEnViaje((n) => n + 1)
      void (async () => {
        try {
          const { data, error: eRpc } = await sb.rpc('escanear_codigo', {
            p_lote: lote_id,
            p_local: local,
            p_codigo: cod,
          })
          if (eRpc) throw new Error(eRpc.message)
          const fila = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneo | null
          if (!fila) throw new Error('La base no confirmó el escaneo. Probá de nuevo.')

          aplicarFila(fila)
          setUltimoEscaneo((prev) => ({ ...prev, [fila.item_id]: Date.now() }))
          // Etiqueta legible del artículo (el lector manda "zh000200!02!xl")
          const etiqueta = etiquetaDe(itemsRef.current.find((x) => x.id === fila.item_id)) ?? fila.item_codigo ?? cod
          setDeshacer({ id: fila.item_id, codigo: etiqueta })
          setMensaje({
            ok: true,
            texto:
              fila.item_escaneadas >= fila.item_cantidad
                ? `${etiqueta} · completado (${fila.item_cantidad} u.)`
                : `${etiqueta} · ${fila.item_escaneadas} de ${fila.item_cantidad}`,
          })
        } catch (e) {
          setMensaje({
            ok: false,
            texto: e instanceof Error ? e.message : 'No se pudo registrar el escaneo',
          })
        } finally {
          setEnViaje((n) => n - 1)
          enfocar()
        }
      })()
    },
    [asignacionSel, sesion, aplicarFila, enfocar],
  )

  const deshacerUltimo = useCallback(async () => {
    const sb = supabase
    if (!deshacer || deshaciendo || !sb) return
    const ultimo = deshacer
    setDeshaciendo(true)
    try {
      const { data, error: eRpc } = await sb.rpc('deshacer_escaneo', { p_item: ultimo.id })
      if (eRpc) throw new Error(eRpc.message)
      const fila = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneo | null
      if (!fila) throw new Error('La base no confirmó el cambio. Probá de nuevo.')
      aplicarFila(fila)
      setDeshacer(null)
      setMensaje({ ok: true, texto: `${ultimo.codigo} · escaneo deshecho (${fila.item_escaneadas} de ${fila.item_cantidad})` })
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo deshacer' })
    } finally {
      setDeshaciendo(false)
      enfocar()
    }
  }, [deshacer, deshaciendo, aplicarFila, enfocar])

  function onSubmitInput(e: FormEvent) {
    e.preventDefault()
    const el = inputRef.current
    if (!el) return
    const v = el.value
    el.value = '' // el escáner escribe solo, así que limpiamos a mano
    alEscanear(v)
  }

  function abrirAsignacion(a: Asignacion) {
    setSel(claveDe(a))
    setMensaje(null)
    setDeshacer(null)
    setResumen(null)
    setSesion(null)
    // ¿Ya tenía una sesión abierta en este repo? (ej. la pausó y volvió)
    const sb = supabase
    if (!sb) return
    setCargandoSesion(true)
    void (async () => {
      const { data, error: eRpc } = await sb.rpc('repo_sesion_actual', { p_lote: a.lote_id, p_local: a.local })
      const fila = eRpc ? null : filaDe<FilaSesion>(data)
      setSesion(fila ? aSesion(fila) : null)
      setCargandoSesion(false)
      if (fila?.estado === 'en_curso') enfocar()
    })()
  }

  function cerrarRepo() {
    setSel(null)
    setMensaje(null)
    setDeshacer(null)
    setCamara(false)
    setSesion(null)
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */
  if (cargando) {
    return (
      <Layout wide={false}>
        <div className="flex items-center justify-center gap-2 py-24 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando tu repo…
        </div>
      </Layout>
    )
  }

  return (
    <Layout wide={false}>
      {/* Las cuentas de piso no tienen menú: Mi repo es su única pantalla */}
      {!soloPiso && <BackButton label="Menú" />}

      {!asignacionSel && (
        <div className="mb-4 flex items-center gap-3 sm:mb-5">
          <div
            className="rounded-xl border p-2.5 sm:p-3"
            style={{ color: '#d97706', backgroundColor: '#d9770624', borderColor: '#d9770640' }}
          >
            <ScanLine size={24} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Mi repo</h1>
            <p className="truncate text-sm text-sub">
              {empleadoNombre ?? 'Tus locales asignados'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {aviso && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {aviso}
          </p>
        </div>
      )}

      {/* Resumen del último repo finalizado */}
      {!asignacionSel && resumen && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-400">
          <Flag size={16} className="mt-0.5 shrink-0" aria-hidden /> {resumen}
        </div>
      )}

      {!aviso && !error && asignaciones.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 px-4 py-14 text-center text-sub">
          <Store size={28} aria-hidden />
          <p>Todavía no te asignaron ningún local en un repo.</p>
          <p className="text-xs">Cuando un administrador te asigne en Mayorista &gt; Reposición, aparece acá.</p>
        </div>
      )}

      {!aviso && !error && !asignacionSel && asignaciones.length > 0 && conPendientes.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-14 text-center text-emerald-400">
          <Check size={28} aria-hidden />
          <p className="font-medium">Terminaste todos tus repos</p>
          <p className="text-xs text-sub">Cuando te asignen uno nuevo, aparece acá.</p>
        </div>
      )}

      {/* ---------- Lista de repos (solo los que tienen algo pendiente o están abiertos) ---------- */}
      {!asignacionSel && conPendientes.length > 0 && (
        <div className="space-y-3">
          {conPendientes.map((a) => {
            const lote = lotes[a.lote_id]
            const p = progreso(a)
            const pct = p.total > 0 ? Math.round((p.listas / p.total) * 100) : 0
            const estado = abiertos[claveDe(a)]
            return (
              <button
                key={claveDe(a)}
                onClick={() => abrirAsignacion(a)}
                className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left shadow-soft transition active:scale-[0.99] hover:bg-surface2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-display font-semibold text-ink">
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
                      {a.local}
                    </span>
                    <span className="truncate">{lote?.nombre ?? 'Repo'}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-sub">
                    <span className="tabular-nums">{p.listas} de {p.total} unidades</span>
                    {estado === 'en_curso' && (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> En curso
                      </span>
                    )}
                    {estado === 'pausada' && (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                        <Pause size={11} aria-hidden /> En pausa
                      </span>
                    )}
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <ChevronRight size={20} aria-hidden className="shrink-0 text-sub" />
              </button>
            )
          })}
        </div>
      )}

      {/* ---------- Repo abierto ---------- */}
      {asignacionSel && progresoSel && (
        <div className="space-y-3 pb-4">
          <button
            onClick={cerrarRepo}
            className="-ml-1 inline-flex min-h-[2.5rem] items-center gap-1 px-1 text-sm font-medium text-sub transition hover:text-ink"
          >
            <ChevronRight size={16} aria-hidden className="rotate-180" /> Mis repos
          </button>

          {/* Panel fijo compacto: repo + cronómetro + botón en una fila, barra con contador, input.
              Queda arriba al bajar la lista; en celular ocupa lo mínimo. */}
          <div className="sticky top-0 z-[5] -mx-4 space-y-2 border-b border-line bg-paper px-4 pb-2.5 pt-1 sm:top-[61px] sm:mx-0 sm:space-y-3 sm:rounded-2xl sm:border sm:bg-surface sm:p-4 sm:shadow-soft">
            {/* Fila 1: repo · cronómetro · botón */}
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold leading-tight text-ink sm:text-base">
                  {lotes[asignacionSel.lote_id]?.nombre ?? 'Repo'}
                </p>
                <p className="flex items-center gap-1.5 text-xs leading-tight text-sub">
                  <span className="font-semibold text-amber-500">{asignacionSel.local}</span>
                  <span aria-hidden>·</span>
                  <Timer size={12} aria-hidden className={sesion?.estado === 'en_curso' ? 'text-emerald-400' : 'text-sub'} />
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${sesion?.estado === 'en_curso' ? 'text-ink' : 'text-sub'}`}
                    title={
                      cargandoSesion
                        ? 'Cargando…'
                        : sesion?.estado === 'en_curso'
                          ? 'En curso'
                          : sesion?.estado === 'pausada'
                            ? 'En pausa: el tiempo no corre'
                            : 'Sin iniciar'
                    }
                  >
                    {fmtReloj(segundosSesion)}
                  </span>
                  {sesion?.estado === 'pausada' && <span className="text-amber-400">en pausa</span>}
                </p>
              </div>

              {!cargandoSesion && !sesion && (
                <button
                  onClick={() => void accion('repo_iniciar')}
                  disabled={accionSesion}
                  className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {accionSesion ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />} Iniciar
                </button>
              )}
              {sesion?.estado === 'en_curso' && (
                <button
                  onClick={() => void accion('repo_pausar')}
                  disabled={accionSesion}
                  className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/25 disabled:opacity-60"
                >
                  {accionSesion ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Pause size={16} aria-hidden />} Pausar
                </button>
              )}
              {sesion?.estado === 'pausada' && (
                <button
                  onClick={() => void accion('repo_reanudar')}
                  disabled={accionSesion}
                  className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {accionSesion ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />} Reanudar
                </button>
              )}
            </div>

            {/* Fila 2: barra + contador que sube */}
            <div className="flex items-center gap-2.5" aria-live="polite">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    progresoSel.pendientes === 0 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{
                    width: `${progresoSel.total > 0 ? Math.round((progresoSel.listas / progresoSel.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <p
                className={`shrink-0 font-display text-lg font-bold leading-none tabular-nums ${
                  progresoSel.pendientes === 0 ? 'text-emerald-500' : 'text-ink'
                }`}
                title="Unidades escaneadas"
              >
                {progresoSel.listas}
                <span className="text-sm font-semibold text-sub">/{progresoSel.total}</span>
              </p>
            </div>

            {/* Entrada: escáner inalámbrico (escribe + Enter), teclado o cámara. Solo en curso. */}
            {sesion?.estado === 'en_curso' && (
              <form onSubmit={onSubmitInput} className="flex gap-2">
                <input
                  ref={inputRef}
                  name="codigo"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  placeholder="Escaneá o escribí el código…"
                  aria-label="Código de barra"
                  onBlur={() => { if (!camara && !confirmarFin) enfocar() }}
                  className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
                <button
                  type="button"
                  onClick={() => setCamara((c) => !c)}
                  className="btn-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
                  title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
                  aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
                >
                  {camara ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
                </button>
              </form>
            )}

            {/* Feedback del último escaneo */}
            {(mensaje || enViaje > 0) && (
              <div aria-live="polite" className="space-y-1.5">
                {mensaje && (
                  <div
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium ${
                      mensaje.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {mensaje.ok ? <Check size={16} className="shrink-0" aria-hidden /> : <AlertTriangle size={16} className="shrink-0" aria-hidden />}
                      <span className="truncate">{mensaje.texto}</span>
                    </span>
                    {mensaje.ok && deshacer && sesion?.estado === 'en_curso' && (
                      <button
                        onClick={() => void deshacerUltimo()}
                        disabled={deshaciendo}
                        className="inline-flex min-h-[2.25rem] shrink-0 items-center gap-1 rounded-lg border border-current px-2.5 text-xs font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
                      >
                        <Undo2 size={14} aria-hidden /> Deshacer
                      </button>
                    )}
                  </div>
                )}
                {enViaje > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-sub">
                    <Loader2 size={12} className="animate-spin" aria-hidden />
                    Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
                  </p>
                )}
              </div>
            )}
          </div>

          {camara && sesion?.estado === 'en_curso' && (
            <ScannerCamara
              onLectura={(t) => alEscanear(t)}
              onCerrar={() => {
                setCamara(false)
                enfocar()
              }}
            />
          )}

          {/* Lista de lo que falta: a medida que escanea, sale de acá (el contador de arriba sube) */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-display text-sm font-semibold text-ink">Faltan escanear</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-500">
                {progresoSel.pendientes} u.
              </span>
            </div>

            {pendientesDeSel.length === 0 ? (
              <div className="flex flex-col items-center gap-2 bg-emerald-500/10 px-4 py-10 text-center">
                <Check size={30} className="text-emerald-500" aria-hidden />
                <p className="font-display font-semibold text-emerald-500">¡Está todo escaneado!</p>
                <p className="text-xs text-sub">Tocá Finalizar para cerrar el repo y guardar tu tiempo.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {pendientesDeSel.map((i) => {
                  const talle = fmtTalle(i.talle)
                  const ubics = ubicacionesDe(i)
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        {/* Código + color + talle juntos: lo que hay que buscar en la etiqueta */}
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[15px] font-semibold text-ink">{i.codigo}</span>
                          {i.color && (
                            <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-xs font-semibold text-sky-400" title="Color">
                              {i.color}
                            </span>
                          )}
                          {talle && (
                            <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-xs font-semibold text-violet-400" title="Talle">
                              {talle}
                            </span>
                          )}
                          {ubics.length > 0 && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-500" title="Ubicación en el depósito">
                              ({ubics.join(' · ')})
                            </span>
                          )}
                        </span>
                        {i.articulo && (
                          <span className="mt-0.5 block truncate text-xs text-sub">{i.articulo.replace(/^\(\)\s*/, '')}</span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-bold tabular-nums ${
                          i.escaneadas > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-line text-sub'
                        }`}
                        title={i.escaneadas > 0 ? `${i.escaneadas} de ${i.cantidad} escaneadas` : undefined}
                      >
                        {/* Escaneadas / total, igual que el contador grande de arriba */}
                        {i.escaneadas > 0 ? `${i.escaneadas}/${i.cantidad}` : `×${i.cantidad}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Finalizar (el cuadro de escaneados va debajo). En celular deja lugar a la izquierda para el ícono M flotante. */}
          {sesion && (
            <button
              onClick={() => setConfirmarFin(true)}
              disabled={accionSesion}
              className={`btn-press ml-14 flex h-14 w-[calc(100%-3.5rem)] items-center justify-center gap-2 rounded-2xl text-base font-semibold shadow-soft transition disabled:opacity-60 sm:ml-0 sm:w-full ${
                progresoSel.pendientes === 0
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-brand-600/40 bg-brand-600/10 text-brand-400 hover:bg-brand-600/20'
              }`}
            >
              <Flag size={18} aria-hidden /> Finalizar repo
            </button>
          )}

          {/* Escaneados: lo que ya se completó, lo último arriba */}
          {escaneadosDeSel.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink">
                  <Check size={15} className="text-emerald-500" aria-hidden /> Escaneados
                </span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-500">
                  {escaneadosDeSel.reduce((s, i) => s + i.cantidad, 0)} u.
                </span>
              </div>
              <ul className="divide-y divide-line/60">
                {escaneadosDeSel.map((i) => {
                  const talle = fmtTalle(i.talle)
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2 opacity-80">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">{i.codigo}</span>
                          {i.color && (
                            <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-400">{i.color}</span>
                          )}
                          {talle && (
                            <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-violet-400">{talle}</span>
                          )}
                        </span>
                        {i.articulo && (
                          <span className="block truncate text-xs text-sub">{i.articulo.replace(/^\(\)\s*/, '')}</span>
                        )}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-bold tabular-nums text-emerald-500">
                        <Check size={12} aria-hidden /> {i.cantidad}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmarFin}
        title={progresoSel && progresoSel.pendientes > 0 ? '¿Finalizar con faltantes?' : '¿Finalizar el repo?'}
        message={
          progresoSel && progresoSel.pendientes > 0
            ? `Quedan ${progresoSel.pendientes} unidades sin escanear: se van a marcar como faltantes (✕).\nSe guarda tu tiempo (${fmtReloj(segundosSesion)}).`
            : `Se guarda tu tiempo: ${fmtReloj(segundosSesion)}.`
        }
        confirmLabel="Finalizar"
        busy={accionSesion}
        onCancel={() => {
          setConfirmarFin(false)
          enfocar()
        }}
        onConfirm={() => void finalizar()}
      />
    </Layout>
  )
}
