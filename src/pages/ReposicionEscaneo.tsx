import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Archive, Camera, Check, FileUp, Loader2, Package, ScanLine, Undo2, Volume2, VolumeX } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import { useAuth } from '@/context/AuthContext'
import { normalizaCodigo } from '@/lib/loginEmpleado'
import { suscribirCambios } from '@/lib/realtime'
import {
  cerrarRepo, crearRepo, deshacerUltima, escanearPrenda, leerArchivoExcel, listarRepos, moverLectura,
  traerAvance, traerDetalle, traerNombresLocales,
  type DetalleRepo, type RepoAbierta, type ResultadoEscaneo, type UltimaLectura,
} from '@/lib/repoEscaneo'

/* ------------------------------------------------------------------ */
/*  Reposición por escaneo: se carga el Excel, se escanea la prenda y  */
/*  la pantalla dice (y en voz alta) en qué caja va. La suma la hace   */
/*  la base, así varias personas pueden escanear la misma reposición.  */
/*  Base: sql/repo_escaneo.sql. Maqueta: mockups/reposicion-escaneo.   */
/* ------------------------------------------------------------------ */

const CLAVE_VOZ = 'repo-escaneo-voz'
const RESPALDO_MS = 60_000
const MAX_FILAS = 400

/** Un color bien distinto por local. Oscuro para que el blanco se lea en tema claro y oscuro. */
function colorLocal(i: number, total: number): string {
  return `hsl(${Math.round((i * 360) / Math.max(total, 1) + 8) % 360} 75% 38%)`
}

function leerVoz(): boolean {
  try { return localStorage.getItem(CLAVE_VOZ) !== 'no' } catch { return true }
}

function hablar(texto: string) {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel() // si escanea rápido, corta lo anterior
  const u = new SpeechSynthesisUtterance(texto)
  const voces = speechSynthesis.getVoices()
  const voz = voces.find((v) => /^es[-_]AR/i.test(v.lang)) ?? voces.find((v) => /^es/i.test(v.lang))
  if (voz) u.voice = voz
  u.lang = voz?.lang ?? 'es-AR'
  u.rate = 1.05
  speechSynthesis.speak(u)
}

let audio: AudioContext | null = null
function pitido(ok: boolean) {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = ok ? 880 : 220
    g.gain.value = 0.06
    o.connect(g)
    g.connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + (ok ? 0.08 : 0.3))
  } catch { /* sin audio: queda el cartel */ }
}

type Pantalla =
  | { tipo: 'vacio' }
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'error'; titulo: string; detalle: string }
  | { tipo: 'ok'; r: Extract<ResultadoEscaneo, { estado: 'ok' }> }

export default function ReposicionEscaneo() {
  const { can } = useAuth()
  const puedeCargar = can('repo_escaneo.cargar')

  const [abiertas, setAbiertas] = useState<RepoAbierta[] | null>(null)
  const [detalle, setDetalle] = useState<DetalleRepo | null>(null)
  const [hoja, setHoja] = useState('')
  const [ultimos, setUltimos] = useState<UltimaLectura[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)

  const [codigo, setCodigo] = useState('')
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'vacio' })
  const [voz, setVoz] = useState(leerVoz)
  const [camara, setCamara] = useState(false)
  const [cajaSel, setCajaSel] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState<'pend' | 'todo' | 'hecho'>('pend')

  const inputRef = useRef<HTMLInputElement>(null)
  const archivoRef = useRef<HTMLInputElement>(null)
  // Las lecturas van en fila: si el lector dispara dos seguidas, se cuentan y se anuncian en orden.
  const colaRef = useRef<Promise<void>>(Promise.resolve())
  const vozRef = useRef(voz)
  vozRef.current = voz

  const enfocar = useCallback(() => inputRef.current?.focus(), [])
  const nombreLocal = useCallback((c: string) => nombres[c] ?? c, [nombres])

  const cargarLista = useCallback(async () => {
    try {
      setAbiertas(await listarRepos())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista')
    }
  }, [])

  useEffect(() => {
    void cargarLista()
    void traerNombresLocales().then(setNombres)
  }, [cargarLista])

  const abrir = useCallback(async (id: string) => {
    setCargando(true)
    setError(null)
    try {
      const d = await traerDetalle(id)
      setDetalle(d)
      setHoja(d.hojas[0]?.hoja ?? '')
      setCajaSel(null)
      setPantalla({ tipo: 'vacio' })
      setBusca('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la reposición')
    } finally {
      setCargando(false)
    }
  }, [])

  const salir = useCallback(() => {
    setDetalle(null)
    setCamara(false)
    setAviso(null)
    void cargarLista()
  }, [cargarLista])

  const idActual = detalle?.id ?? null

  /** Trae lo que escanearon todos (también otras personas) y lo aplica. */
  const refrescar = useCallback(async () => {
    if (!idActual || !hoja) return
    try {
      const a = await traerAvance(idActual, hoja)
      if (a.cerrada_at) {
        setAviso('Esta reposición se cerró.')
        salir()
        return
      }
      const porId = new Map(a.items)
      setDetalle((d) => (d && d.id === idActual
        ? { ...d, items: d.items.map((it) => ({ ...it, escaneado: porId.get(it.id) ?? 0 })) }
        : d))
      setUltimos(a.ultimos)
    } catch { /* corte momentáneo: vuelve con el próximo aviso o el respaldo */ }
  }, [idActual, hoja, salir])

  useEffect(() => {
    if (!idActual) return
    void refrescar()
    const cortar = suscribirCambios(['repo_escaneo_lecturas'], () => void refrescar(), { espera: 1000 })
    const respaldo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refrescar()
    }, RESPALDO_MS)
    return () => {
      cortar()
      window.clearInterval(respaldo)
    }
  }, [idActual, refrescar])

  useEffect(() => {
    if (idActual) enfocar()
  }, [idActual, hoja, enfocar])

  // ---- Carga del Excel ----
  const cargarArchivo = useCallback(async (archivo: File | undefined) => {
    if (!archivo) return
    setCargando(true)
    setError(null)
    setAviso(null)
    try {
      const libro = await leerArchivoExcel(archivo)
      if (!libro.items.length) throw new Error('No encontré ninguna hoja con artículos y locales')
      const { id, ya_existia } = await crearRepo(archivo.name, libro)
      await abrir(id)
      setAviso(ya_existia
        ? `«${archivo.name}» ya estaba cargado: sigue desde donde quedó. Si el Excel cambió, cerrá esta reposición y volvé a cargarlo.`
        : `«${archivo.name}» cargado.`)
    } catch (e) {
      setError(`No se pudo cargar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCargando(false)
    }
  }, [abrir])

  const alSoltar = (ev: DragEvent) => {
    ev.preventDefault()
    setArrastrando(false)
    if (puedeCargar) void cargarArchivo(ev.dataTransfer.files[0])
  }

  // ---- Escaneo ----
  /** Actualiza el renglón en pantalla sin esperar al refresco. */
  const aplicarItem = useCallback((itemId: number, escaneado: number) => {
    setDetalle((d) => (d ? { ...d, items: d.items.map((it) => (it.id === itemId ? { ...it, escaneado } : it)) } : d))
  }, [])

  const mostrarResultado = useCallback((r: ResultadoEscaneo) => {
    if (r.estado === 'ok') {
      setPantalla({ tipo: 'ok', r })
      aplicarItem(r.item, r.escaneado)
      setFlash(r.local)
      window.setTimeout(() => setFlash((f) => (f === r.local ? null : f)), 700)
      if (vozRef.current) hablar(nombres[r.local] ?? r.local)
      else pitido(true)
      return
    }
    pitido(false)
    const prenda = [r.articulo, r.color && `color ${r.color}`, r.talle && `talle ${r.talle}`].filter(Boolean).join(' · ')
    if (r.estado === 'sobra') {
      setPantalla({ tipo: 'error', titulo: 'Sobra, separala', detalle: `${prenda}: ya está todo lo pedido (${r.pedidas}). No va en ninguna caja.` })
      if (vozRef.current) hablar('Sobra, separala')
    } else if (r.estado === 'ambiguo') {
      setPantalla({ tipo: 'error', titulo: 'Falta color o talle', detalle: `${prenda}: este artículo viene en varias variantes. Escaneá la etiqueta completa.` })
      if (vozRef.current) hablar('Falta color o talle')
    } else {
      const otras = r.otras_hojas.length ? ` Está en la hoja ${r.otras_hojas.join(' / ')}.` : ' Separala.'
      setPantalla({ tipo: 'error', titulo: 'No está en esta reposición', detalle: `${prenda}.${otras}` })
      if (vozRef.current) hablar('No está en la reposición')
    }
  }, [aplicarItem, nombres])

  const escanear = useCallback((bruto: string) => {
    const cod = normalizaCodigo(bruto)
    if (!cod || !idActual || !hoja) return
    colaRef.current = colaRef.current.then(async () => {
      try {
        mostrarResultado(await escanearPrenda(idActual, hoja, cod))
        void refrescar()
      } catch (e) {
        pitido(false)
        setPantalla({
          tipo: 'error',
          titulo: 'No se registró',
          detalle: `${cod}: ${e instanceof Error ? e.message : 'sin conexión'}. Volvé a escanearla.`,
        })
        if (vozRef.current) hablar('No se registró, volvé a escanear')
      }
    })
  }, [idActual, hoja, mostrarResultado, refrescar])

  const alEnviar = (ev: FormEvent) => {
    ev.preventDefault()
    escanear(codigo)
    setCodigo('')
    enfocar()
  }

  const deshacer = () => {
    if (!idActual) return
    colaRef.current = colaRef.current.then(async () => {
      try {
        const r = await deshacerUltima(idActual)
        if (r.estado === 'nada') {
          setPantalla({ tipo: 'aviso', texto: 'No tenés escaneos para deshacer' })
        } else {
          aplicarItem(r.item, r.escaneado)
          setPantalla({ tipo: 'aviso', texto: `Se deshizo: ${r.articulo} color ${r.color} talle ${r.talle}. Sacala de la caja de ${nombres[r.local] ?? r.local}.` })
          void refrescar()
        }
      } catch (e) {
        setPantalla({ tipo: 'error', titulo: 'No se pudo deshacer', detalle: e instanceof Error ? e.message : '' })
      }
      enfocar()
    })
  }

  const mover = (lectura: number, itemViejo: number, local: string) => {
    colaRef.current = colaRef.current.then(async () => {
      try {
        const r = await moverLectura(lectura, local)
        setDetalle((d) => (d ? { ...d, items: d.items.map((it) => (it.id === itemViejo ? { ...it, escaneado: Math.max(it.escaneado - 1, 0) } : it)) } : d))
        mostrarResultado(r)
        void refrescar()
      } catch (e) {
        setPantalla({ tipo: 'error', titulo: 'No se pudo corregir', detalle: e instanceof Error ? e.message : '' })
      }
      enfocar()
    })
  }

  const cerrar = async () => {
    if (!detalle) return
    const pend = totales.pedidas - totales.escaneadas
    const texto = pend > 0
      ? `Quedan ${pend} prendas sin escanear en esta hoja. ¿Cerrar «${detalle.nombre}» igual? Deja de verse en la lista.`
      : `¿Cerrar «${detalle.nombre}»? Deja de verse en la lista.`
    if (!window.confirm(texto)) return
    try {
      await cerrarRepo(detalle.id)
      salir()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar')
    }
  }

  const cambiarVoz = () => {
    const nueva = !voz
    setVoz(nueva)
    try { localStorage.setItem(CLAVE_VOZ, nueva ? 'si' : 'no') } catch { /* solo no se recuerda */ }
    if (nueva) hablar('Voz activada')
    enfocar()
  }

  // ---- Datos de la hoja ----
  const itemsHoja = useMemo(() => (detalle?.items ?? []).filter((it) => it.hoja === hoja), [detalle, hoja])
  const locales = useMemo(() => detalle?.hojas.find((h) => h.hoja === hoja)?.locales ?? [], [detalle, hoja])
  const colores = useMemo(() => {
    const m: Record<string, string> = {}
    locales.forEach((l, i) => { m[l] = colorLocal(i, locales.length) })
    return m
  }, [locales])

  const totales = useMemo(() => {
    const porLocal: Record<string, { pedidas: number; escaneadas: number }> = {}
    for (const l of locales) porLocal[l] = { pedidas: 0, escaneadas: 0 }
    let pedidas = 0
    let escaneadas = 0
    for (const it of itemsHoja) {
      const hechas = Math.min(it.escaneado, it.pedido)
      pedidas += it.pedido
      escaneadas += hechas
      const x = (porLocal[it.local] ??= { pedidas: 0, escaneadas: 0 })
      x.pedidas += it.pedido
      x.escaneadas += hechas
    }
    const completas = locales.filter((l) => porLocal[l].escaneadas >= porLocal[l].pedidas).length
    return { pedidas, escaneadas, porLocal, completas }
  }, [itemsHoja, locales])

  const filas = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return itemsHoja.filter((it) => {
      if (cajaSel && it.local !== cajaSel) return false
      const listo = it.escaneado >= it.pedido
      if (estadoFiltro === 'pend' && listo) return false
      if (estadoFiltro === 'hecho' && !listo) return false
      return !q || it.articulo.includes(q) || it.descripcion.toUpperCase().includes(q)
    })
  }, [itemsHoja, cajaSel, estadoFiltro, busca])

  const itemsPorId = useMemo(() => new Map(itemsHoja.map((it) => [it.id, it])), [itemsHoja])
  const pct = totales.pedidas ? Math.round((totales.escaneadas * 100) / totales.pedidas) : 0

  const btn = 'btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm font-medium text-ink hover:bg-line disabled:opacity-60'

  const zonaCarga = puedeCargar && (
    <div
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={alSoltar}
      className={`mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-3 transition ${arrastrando ? 'border-brand-500 bg-brand-500/10' : 'border-line bg-surface'}`}
    >
      <button
        onClick={() => archivoRef.current?.click()}
        disabled={cargando}
        className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {cargando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileUp size={15} aria-hidden />}
        Cargar Excel de reposición
      </button>
      <input
        ref={archivoRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => { void cargarArchivo(e.target.files?.[0]); e.target.value = '' }}
      />
      <p className="text-xs text-sub">También podés arrastrarlo acá. Cada hoja es una reposición; la fila de títulos lleva Articulo, Descripcion, Color, Talle y un local por columna.</p>
    </div>
  )

  const mensajes = (
    <>
      {error && <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">{error}</p>}
      {aviso && <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500" role="status">{aviso}</p>}
    </>
  )

  // ---- Lista de reposiciones abiertas ----
  if (!detalle) {
    return (
      <Layout>
        <BackButton />
        <header className="mb-3 mt-2">
          <h1 className="font-display text-2xl font-semibold text-ink">Reposición por escaneo</h1>
          <p className="text-sm text-sub">Escaneás la prenda y la pantalla te dice en qué caja (local) va. Se descuenta sola.</p>
        </header>
        {zonaCarga}
        {mensajes}
        {abiertas === null ? (
          <p className="flex items-center gap-2 text-sm text-sub"><Loader2 size={15} className="animate-spin" aria-hidden /> Cargando…</p>
        ) : abiertas.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-sub">
            <Package size={28} className="mx-auto mb-2 opacity-60" aria-hidden />
            No hay reposiciones abiertas.{puedeCargar ? ' Cargá un Excel para empezar.' : ' Cuando carguen una, aparece acá.'}
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {abiertas.map((r) => {
              const p = r.pedidas ? Math.round((r.escaneadas * 100) / r.pedidas) : 0
              return (
                <li key={r.id}>
                  <button
                    onClick={() => void abrir(r.id)}
                    disabled={cargando}
                    className="btn-press w-full rounded-2xl border border-line bg-surface p-4 text-left hover:bg-surface2 disabled:opacity-60"
                  >
                    <p className="truncate font-semibold text-ink">{r.nombre}</p>
                    <p className="mt-0.5 text-xs text-sub">
                      {new Date(r.creada_at).toLocaleDateString('es-AR')}{r.creada_por ? ` · ${r.creada_por}` : ''}
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-sub">{r.escaneadas.toLocaleString('es-AR')} de {r.pedidas.toLocaleString('es-AR')} prendas · {p} %</p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Layout>
    )
  }

  // ---- Reposición abierta ----
  return (
    <Layout>
      <button onClick={salir} className="btn-press inline-flex items-center gap-1 text-sm text-sub hover:text-ink">← Reposiciones</button>
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold text-ink">{detalle.nombre}</h1>
          <p className="text-sm text-sub">Escaneá la prenda: te digo en qué caja va.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detalle.hojas.length > 1 && (
            <div className="inline-flex overflow-hidden rounded-xl border border-line" role="group" aria-label="Hoja del Excel">
              {detalle.hojas.map((h) => (
                <button
                  key={h.hoja}
                  onClick={() => { setHoja(h.hoja); setCajaSel(null); setPantalla({ tipo: 'vacio' }) }}
                  aria-pressed={h.hoja === hoja}
                  className={`h-10 px-3 text-sm font-semibold ${h.hoja === hoja ? 'bg-brand-500/20 text-ink' : 'text-sub hover:bg-surface2'}`}
                >
                  {h.hoja}
                </button>
              ))}
            </div>
          )}
          <button onClick={cambiarVoz} className={btn} title="Decir el local en voz alta">
            {voz ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />} Voz: {voz ? 'sí' : 'no'}
          </button>
          {puedeCargar && (
            <button onClick={() => void cerrar()} className={btn}><Archive size={15} aria-hidden /> Cerrar reposición</button>
          )}
        </div>
      </header>

      {mensajes}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {[
          ['Escaneadas', totales.escaneadas.toLocaleString('es-AR')],
          ['Pendientes', (totales.pedidas - totales.escaneadas).toLocaleString('es-AR')],
          ['Cajas completas', `${totales.completas} / ${locales.length}`],
        ].map(([t, v]) => (
          <div key={t} className="min-w-[110px] rounded-xl border border-line bg-surface px-3 py-2">
            <p className="text-xs text-sub">{t}</p>
            <p className="text-xl font-bold tabular-nums text-ink">{v}</p>
          </div>
        ))}
        <div className="h-2.5 min-w-[160px] flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la hoja">
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <b className="tabular-nums text-ink">{pct} %</b>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Escaneo */}
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <form onSubmit={alEnviar} className="flex gap-2">
            <input
              ref={inputRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label="Código de la prenda"
              placeholder="Escaneá o tipeá el código…"
              className="h-12 min-w-0 flex-1 rounded-xl border-2 border-brand-500/50 bg-surface2 px-3 text-lg font-bold tracking-wide text-ink outline-none focus:border-brand-500"
            />
            <button className="btn-press inline-flex h-12 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">OK</button>
            <button type="button" onClick={() => setCamara((c) => !c)} aria-label="Escanear con la cámara" className="btn-press inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface2 text-ink hover:bg-line">
              <Camera size={18} aria-hidden />
            </button>
          </form>

          {camara && (
            <div className="mt-3">
              <ScannerCamara onLectura={(t) => escanear(t)} onCerrar={() => { setCamara(false); enfocar() }} />
            </div>
          )}

          <div
            className={`mt-3 flex min-h-[220px] flex-col items-center justify-center rounded-2xl p-5 text-center ${
              pantalla.tipo === 'ok' ? 'text-white'
                : pantalla.tipo === 'error' ? 'border-2 border-red-500 bg-red-500/10'
                  : 'border-2 border-dashed border-line'
            }`}
            style={pantalla.tipo === 'ok' ? { background: colores[pantalla.r.local] ?? '#334155' } : undefined}
            aria-live="polite"
          >
            {pantalla.tipo === 'vacio' && (
              <>
                <ScanLine size={34} className="text-sub opacity-60" aria-hidden />
                <p className="mt-2 text-sm text-sub">Escaneá una prenda para ver a qué caja va</p>
              </>
            )}
            {pantalla.tipo === 'aviso' && <p className="text-sm text-sub">{pantalla.texto}</p>}
            {pantalla.tipo === 'error' && (
              <>
                <p className="text-3xl font-bold text-red-400">{pantalla.titulo}</p>
                <p className="mt-2 text-sm text-ink">{pantalla.detalle}</p>
              </>
            )}
            {pantalla.tipo === 'ok' && (() => {
              const { r } = pantalla
              const falta = r.pedido - r.escaneado
              return (
                <>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-90">Poner en la caja</p>
                  <p className="my-1 text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">{nombreLocal(r.local)}</p>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-90">{r.local}</p>
                  <p className="mt-3 text-sm font-bold">{r.articulo} · color {r.color} · talle {r.talle}</p>
                  {r.descripcion && <p className="mt-0.5 text-xs opacity-90">{r.descripcion}</p>}
                  <p className="mt-3 rounded-full bg-black/25 px-3 py-1 text-xs font-bold">
                    {r.escaneado} de {r.pedido} para este local · {falta > 0 ? `faltan ${falta}` : '✓ renglón completo'}
                  </p>
                  {r.otras.length > 0 && (
                    <div className="mt-3 text-xs">
                      <p className="opacity-90">Este artículo también va a otras cajas. Si la pusiste en otra, tocala y se corrige:</p>
                      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                        {r.otras.map((l) => (
                          <button key={l} onClick={() => mover(r.lectura, r.item, l)} className="btn-press rounded-full border border-white/60 bg-black/20 px-3 py-1.5 font-bold hover:bg-black/40">
                            {nombreLocal(l)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Últimos escaneos</h2>
              <button onClick={deshacer} className="btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">
                <Undo2 size={13} aria-hidden /> Deshacer mi último
              </button>
            </div>
            {ultimos.length === 0 ? <p className="text-xs text-sub">Todavía nada</p> : (
              <ul className="divide-y divide-line text-xs">
                {ultimos.map((u) => {
                  const it = itemsPorId.get(u.item)
                  if (!it) return null
                  return (
                    <li key={u.id} className="flex justify-between gap-2 py-1.5">
                      <span className="min-w-0 text-ink">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: colores[it.local] }} aria-hidden />
                        <b>{nombreLocal(it.local)}</b> · {it.articulo} {it.color} {it.talle}
                      </span>
                      <span className="shrink-0 text-sub">{u.por ?? ''} · {it.escaneado}/{it.pedido}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Cajas y detalle */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Cajas por local</h2>
              <span className="text-xs text-sub">Tocá una para ver qué le falta</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 p-3">
              {locales.map((l) => {
                const x = totales.porLocal[l]
                const lista = x.escaneadas >= x.pedidas
                return (
                  <button
                    key={l}
                    onClick={() => setCajaSel((c) => (c === l ? null : l))}
                    aria-pressed={cajaSel === l}
                    className={`btn-press relative rounded-xl border p-2.5 text-left transition ${lista ? 'opacity-60' : ''} ${cajaSel === l ? 'border-ink' : 'border-line'} ${flash === l ? '-translate-y-0.5' : ''}`}
                    style={flash === l ? { boxShadow: `0 0 0 3px ${colores[l]}` } : undefined}
                  >
                    {lista && <Check size={14} className="absolute right-2 top-3 text-emerald-500" aria-label="Lista" />}
                    <div className="mb-2 h-1.5 rounded-full" style={{ background: colores[l] }} />
                    <p className="truncate pr-4 text-sm font-bold text-ink">{nombreLocal(l)}</p>
                    <p className="text-xs text-sub">{l}</p>
                    <p className="text-xs tabular-nums text-sub">{x.escaneadas} de {x.pedidas} · faltan {x.pedidas - x.escaneadas}</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                      <div className="h-full" style={{ width: `${x.pedidas ? (x.escaneadas * 100) / x.pedidas : 0}%`, background: colores[l] }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Detalle · {cajaSel ? nombreLocal(cajaSel) : 'todas las cajas'}</h2>
              <div className="flex flex-wrap gap-2">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar artículo…"
                  aria-label="Buscar artículo"
                  className="h-9 w-40 rounded-xl border border-line bg-surface2 px-2.5 text-sm text-ink outline-none"
                />
                <select
                  value={estadoFiltro}
                  onChange={(e) => setEstadoFiltro(e.target.value as typeof estadoFiltro)}
                  aria-label="Filtrar por estado"
                  className="h-9 rounded-xl border border-line bg-surface2 px-2 text-sm text-ink outline-none"
                >
                  <option value="pend">Pendientes</option>
                  <option value="todo">Todo</option>
                  <option value="hecho">Completos</option>
                </select>
              </div>
            </div>
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-solid text-left text-sub">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Artículo</th>
                    <th className="px-2 py-2 font-semibold">Col</th>
                    <th className="px-2 py-2 font-semibold">Talle</th>
                    <th className="px-2 py-2 font-semibold">Caja</th>
                    <th className="px-3 py-2 text-right font-semibold">Esc / Pedido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filas.slice(0, MAX_FILAS).map((it) => {
                    const listo = it.escaneado >= it.pedido
                    return (
                      <tr key={it.id} className={listo ? 'text-sub' : 'text-ink'}>
                        <td className="px-3 py-1.5"><b>{it.articulo}</b><p className="max-w-[320px] text-[11px] text-sub">{it.descripcion}</p></td>
                        <td className="px-2 py-1.5">{it.color}</td>
                        <td className="px-2 py-1.5">{it.talle}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: colores[it.local] }} aria-hidden />
                          {it.local}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums ${listo ? 'text-emerald-500' : ''}`}>
                          {listo ? '✓ ' : ''}{it.escaneado} / {it.pedido}
                        </td>
                      </tr>
                    )
                  })}
                  {filas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-sub">Nada para mostrar</td></tr>}
                  {filas.length > MAX_FILAS && <tr><td colSpan={5} className="px-3 py-3 text-center text-sub">… y {filas.length - MAX_FILAS} renglones más (usá el buscador)</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {detalle.raros.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-ink">
          <b className="text-amber-500">Celdas del Excel que quedaron afuera ({detalle.raros.length}):</b>{' '}
          {detalle.raros.map((r) => `${r[0]} ${r[1]} ${r[2]} ${r[3]} → ${r[4]} = «${r[5]}»`).join(' · ')}
        </div>
      )}
    </Layout>
  )
}
