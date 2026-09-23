import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ScanLine, Loader2, Store, Check, Undo2, Camera, CameraOff, ChevronRight, AlertTriangle,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { normalizaCodigo } from '@/lib/loginEmpleado'

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

export default function MiRepo() {
  const { perfil } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [empleadoNombre, setEmpleadoNombre] = useState<string | null>(null)
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [lotes, setLotes] = useState<Record<string, Lote>>({})
  const [items, setItems] = useState<Item[]>([])

  const [sel, setSel] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [deshacer, setDeshacer] = useState<UltimoEscaneo | null>(null)
  // Escaneos en viaje: se cuentan (no se bloquea), así un lector rápido no pierde lecturas
  const [enViaje, setEnViaje] = useState(0)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [camara, setCamara] = useState(false)

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
      setItems(todos.filter((i) => permitidas.has(claveDe(i))))
      setCargando(false)
      enfocar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar tus repos.')
      setCargando(false)
    }
  }, [perfil?.legajo, perfil?.nombre, enfocar])

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
        const hechas = Math.min(i.escaneadas, i.cantidad)
        total += i.cantidad
        listas += hechas
      }
      return { total, listas, pendientes: total - listas }
    },
    [itemsDe],
  )

  const pendientesDeSel = useMemo(() => {
    if (!asignacionSel) return []
    return itemsDe(asignacionSel)
      .filter((i) => i.estado !== 'faltante' && i.escaneadas < i.cantidad)
      .sort(
        (a, b) =>
          a.orden - b.orden ||
          String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''), 'es'),
      )
  }, [asignacionSel, itemsDe])

  const progresoSel = asignacionSel ? progreso(asignacionSel) : null

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
          setDeshacer({ id: fila.item_id, codigo: cod })
          setMensaje({
            ok: true,
            texto:
              fila.item_escaneadas >= fila.item_cantidad
                ? `${cod} · completado (${fila.item_cantidad} u.)`
                : `${cod} · ${fila.item_escaneadas} de ${fila.item_cantidad}`,
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
    [asignacionSel, aplicarFila, enfocar],
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
    enfocar()
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
      <BackButton label="Menú" />

      <div className="mb-5 flex items-center gap-3">
        <div
          className="rounded-xl border p-3"
          style={{ color: '#d97706', backgroundColor: '#d9770624', borderColor: '#d9770640' }}
        >
          <ScanLine size={26} aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-ink">Mi repo</h1>
          <p className="truncate text-sm text-sub">
            {empleadoNombre ? `${empleadoNombre} · ` : ''}Escaneá y se va sacando de la lista
          </p>
        </div>
      </div>

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

      {!aviso && !error && asignaciones.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <Store size={28} aria-hidden />
          <p>Todavía no te asignaron ningún local en un repo.</p>
          <p className="text-xs">
            Cuando un administrador te asigne en Mayorista &gt; Reposición, aparece acá.
          </p>
        </div>
      )}

      {/* ---------- Lista de asignaciones ---------- */}
      {!asignacionSel && asignaciones.length > 0 && (
        <div className="space-y-3">
          {asignaciones.map((a) => {
            const lote = lotes[a.lote_id]
            const p = progreso(a)
            const pct = p.total > 0 ? Math.round((p.listas / p.total) * 100) : 0
            return (
              <button
                key={claveDe(a)}
                onClick={() => abrirAsignacion(a)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left shadow-soft transition hover:bg-surface2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-display font-semibold text-ink">
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
                      {a.local}
                    </span>
                    <span className="truncate">{lote?.nombre ?? 'Repo'}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-sub">
                    {p.pendientes === 0
                      ? 'Terminado ✓'
                      : `${p.pendientes} de ${p.total} unidades por escanear`}
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <ChevronRight size={18} aria-hidden className="shrink-0 text-sub" />
              </button>
            )
          })}
        </div>
      )}

      {/* ---------- Repo abierto: escaneo ---------- */}
      {asignacionSel && progresoSel && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setSel(null)
              setMensaje(null)
              setDeshacer(null)
              setCamara(false)
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-sub transition hover:text-ink"
          >
            <ChevronRight size={15} aria-hidden className="rotate-180" /> Todos mis repos
          </button>

          <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-bold text-ink">
                  {lotes[asignacionSel.lote_id]?.nombre ?? 'Repo'}
                </p>
                <p className="text-sm text-sub">Local {asignacionSel.local}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`font-display text-xl font-bold tabular-nums ${
                    progresoSel.pendientes === 0 ? 'text-emerald-500' : 'text-amber-500'
                  }`}
                >
                  {progresoSel.listas}/{progresoSel.total}
                </p>
                <p className="text-[11px] text-sub">unidades</p>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-all ${
                  progresoSel.pendientes === 0 ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{
                  width: `${progresoSel.total > 0 ? Math.round((progresoSel.listas / progresoSel.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Feedback del último escaneo */}
          <div aria-live="polite" className="min-h-[2.75rem]">
            {mensaje && (
              <div
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-sm font-medium ${
                  mensaje.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {mensaje.ok ? (
                    <Check size={16} className="shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle size={16} className="shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{mensaje.texto}</span>
                </span>
                {mensaje.ok && deshacer && (
                  <button
                    onClick={() => void deshacerUltimo()}
                    disabled={deshaciendo}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-current px-2 py-1 text-xs font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
                  >
                    <Undo2 size={13} aria-hidden /> Deshacer
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Entrada: escáner inalámbrico (escribe + Enter) o teclado */}
          <form onSubmit={onSubmitInput} className="flex gap-2">
            <input
              ref={inputRef}
              name="codigo"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Escaneá o escribí el código…"
              aria-label="Código de barra"
              onBlur={() => { if (!camara) enfocar() }}
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 px-3.5 text-ink transition hover:bg-line"
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={19} aria-hidden /> : <Camera size={19} aria-hidden />}
            </button>
          </form>
          {enViaje > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-sub" aria-live="polite">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
            </p>
          )}

          {camara && (
            <ScannerCamara
              onLectura={(t) => alEscanear(t)}
              onCerrar={() => {
                setCamara(false)
                enfocar()
              }}
            />
          )}

          {/* Lista de lo que falta: a medida que escanea, sale de acá */}
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
                <p className="font-display font-semibold text-emerald-500">¡Repo terminado!</p>
                <p className="text-xs text-sub">No queda nada por escanear en este local.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line/60">
                {pendientesDeSel.map((i) => {
                  const faltan = i.cantidad - i.escaneadas
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">
                          {i.codigo}
                          {i.color ? ` · ${i.color}` : ''}
                          {i.talle ? ` · T${i.talle}` : ''}
                        </span>
                        {i.articulo && <span className="block truncate text-xs text-sub">{i.articulo}</span>}
                      </span>
                      <span
                        className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ${
                          i.escaneadas > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-line text-sub'
                        }`}
                        title={
                          i.escaneadas > 0 ? `${i.escaneadas} de ${i.cantidad} escaneadas` : undefined
                        }
                      >
                        {i.escaneadas > 0 ? `${faltan} de ${i.cantidad}` : `×${i.cantidad}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
