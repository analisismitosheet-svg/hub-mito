import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, Loader2, Maximize2, Minimize2, Redo2, Send, Sparkles, Undo2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import GrillaReparto, { type Cambio, type MarcaRuta } from '@/components/reparto/GrillaReparto'
import GraficoStockVenta from '@/components/reparto/GraficoStockVenta'
import FiltroDesplegable from '@/components/reparto/FiltroDesplegable'
import {
  BASE_TRACKING,
  FILTROS,
  OPCIONES_SUGERENCIA,
  bajarExcelRemitos,
  calcularMovimientos,
  cargarEnTransferencias,
  cargarOpciones,
  cargarRutas,
  cargarStock,
  construirModelo,
  ordenar,
  ordenTalle,
  resumen as calcularResumen,
  sugerir,
  type ClaveFiltro,
  type DatosReparto,
  type Fila,
  type Opciones,
  type OpcionesSugerencia,
  type ResultadoSugerencia,
  type RutaVehiculo,
} from '@/lib/reparto'

/**
 * Reposiciones / Transferencias > Reparto manual (/transferencias/reparto).
 *
 * 1) Filtrar (mismos filtros que el tablero de PBI) → 2) Armar: el Puente trae stock y venta de cada
 * local y depósito (solo lectura) y se reparte en la grilla tipo Excel (o con la Sugerencia por
 * código + color = Repo diaria + Cascada) → 3) Cargar en Transferencias como un lote más.
 * Plan y reglas: docs/borradores/reparto-transferencias.md · maqueta: mockups/reparto-transferencias.html
 */

const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Cordoba' })
const menosDias = (n: number) => {
  const d = new Date(`${hoyISO()}T12:00:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const fechaCorta = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')
const TODOS_LOCALES = ['VCPD', 'WALMARTD', 'DINOD', 'RIVERAD', 'CFRA', 'RUTA9D', 'CFR9', 'BUSTOD', 'CFD', 'CFPO', 'GRALPAZ', 'MUNOZ', '9DEJULIO', 'LIBERD', 'ESPINOD', 'NVOCED', 'CFR4', 'DEPO', 'MAYORD', 'POLO52']
const NOMBRE_LOCAL: Record<string, string> = { DEPO: 'DEPO (Indo)', MAYORD: 'MAYORD (MITO)', POLO52: 'POLO52 (Polo)' }
const btn = 'btn-press inline-flex h-8 items-center gap-1.5 rounded-lg border border-line2 bg-surface2 px-2.5 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-40'
const tilde = 'flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink'

export default function RepartoTransferencias() {
  /* ---------- paso 1: filtros ---------- */
  const [opciones, setOpciones] = useState<Opciones | null>(null)
  const [errOpciones, setErrOpciones] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<ClaveFiltro, Set<string>>>(() =>
    Object.fromEntries(FILTROS.map((f) => [f.k, new Set<string>()])) as Record<ClaveFiltro, Set<string>>,
  )
  const [locSel, setLocSel] = useState<Set<string>>(new Set())
  const [art, setArt] = useState('')
  const [dias, setDias] = useState(14)
  const [desde, setDesde] = useState(() => menosDias(14))
  const [hasta, setHasta] = useState(() => menosDias(1))

  /* ---------- paso 2: datos y grilla ---------- */
  const [datos, setDatos] = useState<DatosReparto | null>(null)
  const [locales, setLocales] = useState<string[]>([])
  const modelo = useRef<Fila[]>([])
  const [version, setVersion] = useState(0)
  const historial = useRef<Cambio[][]>([])
  const futuro = useRef<Cambio[][]>([])
  const [armando, setArmando] = useState(false)
  const [esperando, setEsperando] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cancelado = useRef(false)

  const [orden, setOrden] = useState<'venta' | 'codigo'>('venta')
  const [buscar, setBuscar] = useState('')
  const [fColor, setFColor] = useState('')
  const [fTalle, setFTalle] = useState('')
  const [fGrupo, setFGrupo] = useState('')

  const [verTransporte, setVerTransporte] = useState(true)
  const [rutas, setRutas] = useState<RutaVehiculo[]>([])
  const [semaforo, setSemaforo] = useState({ on: false, verde: 15, amarillo: 45, colores: { v: true, a: true, r: true } })
  const [opSug, setOpSug] = useState<OpcionesSugerencia>(OPCIONES_SUGERENCIA)
  const [artSel, setArtSel] = useState<{ art: string; col: string } | null>(null)
  const [sugerencia, setSugerencia] = useState<(ResultadoSugerencia & { art: string; col: string }) | null>(null)
  const [grafico, setGrafico] = useState<{ art: string; col: string } | null>(null)
  const [completa, setCompleta] = useState(false)
  const zona = useRef<HTMLDivElement>(null)

  /* ---------- paso 3: cargar ---------- */
  const [nombreLote, setNombreLote] = useState('')
  const [obs, setObs] = useState('')
  const [cargando, setCargando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  useEffect(() => {
    cargarOpciones().then(setOpciones).catch((e: Error) => setErrOpciones(e.message))
  }, [])

  // Ruta de la Master y la Mercedes (se relee cada 60 s con la pestaña visible)
  useEffect(() => {
    if (!datos) return
    let vivo = true
    const leer = () => cargarRutas().then((r) => vivo && setRutas(r)).catch((e) => console.warn('[reparto] tracking:', e))
    leer() // la primera vez siempre; después cada 60 s solo con la pestaña visible, y al volver a ella
    const t = setInterval(() => document.visibilityState === 'visible' && leer(), 60_000)
    const alVolver = () => document.visibilityState === 'visible' && leer()
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [datos])

  const opcionesDe = (k: ClaveFiltro) =>
    (opciones?.[k] ?? []).map((o) => ({ id: o.cod, label: o.nom ? `${o.cod} ${o.nom}` : o.cod }))
  const hayNinguno = Object.values(sel).some((s) => s.has('\u0000')) || locSel.has('\u0000')
  const hayFiltroArt = FILTROS.some((f) => sel[f.k].size > 0) || art.trim() !== ''
  const localesElegidos = locSel.size ? TODOS_LOCALES.filter((l) => locSel.has(l)) : TODOS_LOCALES
  const motivoNoArmar = hayNinguno
    ? 'Hay un filtro en «Ninguno»: elegí algo o volvé a «Seleccionar todo».'
    : !hayFiltroArt
      ? 'Elegí al menos un filtro de artículo (proveedor, material, temporada, año, línea, familia, género, grupo o artículo).'
      : localesElegidos.length < 2
        ? 'Elegí al menos 2 locales.'
        : desde > hasta
          ? '«Desde» es posterior a «hasta».'
          : ''

  /* ---------- Armar ---------- */
  async function armar() {
    setError(null)
    setArmando(true)
    setEsperando(0)
    cancelado.current = false
    try {
      const filtros = Object.fromEntries(FILTROS.map((f) => [f.k, [...sel[f.k]]])) as Record<ClaveFiltro, string[]>
      const r = await cargarStock({ ...filtros, art: art.trim().toUpperCase() }, desde, hasta, setEsperando, () => cancelado.current)
      if (r.estado === 'demasiados') {
        setError(`El filtro trae ${r.articulos.toLocaleString('es-AR')} artículos (máximo ${r.max}). Achicalo con más filtros.`)
        return
      }
      // Solo las columnas de los locales elegidos
      const idx = localesElegidos.map((l) => r.locales.indexOf(l)).filter((i) => i >= 0)
      const proy: DatosReparto = {
        ...r,
        locales: idx.map((i) => r.locales[i]),
        filas: r.filas.map((f) => ({ ...f, s: idx.map((i) => f.s[i]), v: idx.map((i) => f.v[i]), tr: idx.map((i) => f.tr[i]), u: idx.map((i) => f.u[i]) })),
      }
      modelo.current = construirModelo(proy)
      historial.current = []
      futuro.current = []
      setLocales(proy.locales)
      setDatos(proy)
      setArtSel(null)
      setSugerencia(null)
      setResultado(null)
      setNombreLote(`${hoyISO().slice(2).replace(/-/g, '')} - REPARTO`)
      setVersion((v) => v + 1)
    } catch (e) {
      if ((e as Error).message !== 'cancelado') setError((e as Error).message)
    } finally {
      setArmando(false)
    }
  }

  /* ---------- edición / historial ---------- */
  const aplicar = useCallback((cambios: Cambio[], usarDespues: boolean) => {
    for (const c of cambios) c.fila.cur[c.i] = usarDespues ? c.despues : c.antes
    setVersion((v) => v + 1)
  }, [])
  const onCambios = useCallback((c: Cambio[]) => {
    aplicar(c, true)
    historial.current.push(c)
    futuro.current = []
    setResultado(null)
  }, [aplicar])
  const deshacer = useCallback(() => {
    const a = historial.current.pop()
    if (!a) return
    aplicar(a, false)
    futuro.current.push(a)
  }, [aplicar])
  const rehacer = useCallback(() => {
    const a = futuro.current.pop()
    if (!a) return
    aplicar(a, true)
    historial.current.push(a)
  }, [aplicar])

  /* ---------- vista ---------- */
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const f = modelo.current.filter(
      (x) =>
        (!fColor || x.color === fColor) && (!fTalle || x.talle === fTalle) && (!fGrupo || x.grupo === fGrupo) &&
        (!q || x.articulo.toLowerCase().includes(q) || x.desc.toLowerCase().includes(q)),
    )
    return ordenar(f, orden)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, buscar, fColor, fTalle, fGrupo, orden])
  const res = useMemo(() => calcularResumen(visibles, locales), [visibles, locales, version])
  const movimientos = useMemo(() => calcularMovimientos(modelo.current, locales), [locales, version])
  const negativos = useMemo(
    () => modelo.current.filter((f) => f.cur.reduce((a, b) => a + b, 0) > f.base.reduce((a, b) => a + b, 0)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )
  const valores = (k: 'color' | 'talle' | 'grupo') => {
    const s = [...new Set(modelo.current.map((f) => f[k]).filter(Boolean))]
    return k === 'talle' ? s.sort(ordenTalle) : s.sort()
  }

  // Marcas de la ruta: local → [{vehículo, clase, hora}] (Master m1, Mercedes m2)
  const faltaPasar = useMemo(() => {
    if (!verTransporte) return null
    const out: Record<string, MarcaRuta[]> = {}
    rutas.forEach((r, i) => {
      const clase = /mercedes/i.test(r.vehiculo) ? 'm2' : /master/i.test(r.vehiculo) ? 'm1' : i === 0 ? 'm1' : 'm2'
      for (const p of r.pendientes) {
        const loc = BASE_TRACKING[p.base_id] ?? p.base_id
        ;(out[loc] ??= []).push({ vehiculo: r.vehiculo.replace(/\s*TRANSPORTE\s*/i, ''), clase, hora: p.hora_limite })
      }
    })
    return out
  }, [rutas, verTransporte])

  /* ---------- sugerencia ---------- */
  function hacerSugerencia() {
    if (!artSel) return
    const r = sugerir(modelo.current, visibles, locales, artSel.art, artSel.col, opSug)
    if (r.cambios.length) onCambios(r.cambios)
    setSugerencia({ ...r, art: artSel.art, col: artSel.col })
  }

  /* ---------- pantalla completa ---------- */
  function pantallaCompleta(on: boolean) {
    setCompleta(on)
    if (on && zona.current?.requestFullscreen && !document.fullscreenElement) zona.current.requestFullscreen().catch(() => {})
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const salir = () => { if (!document.fullscreenElement) setCompleta(false) }
    document.addEventListener('fullscreenchange', salir)
    return () => document.removeEventListener('fullscreenchange', salir)
  }, [])

  /* ---------- cargar ---------- */
  async function cargar() {
    setCargando(true)
    setResultado(null)
    try {
      const r = await cargarEnTransferencias(nombreLote.trim(), obs.trim(), movimientos)
      setResultado(
        r.repetido
          ? `Ya había un lote «${nombreLote.trim()}» de los últimos 7 días: no se cargó de nuevo (${r.renglones} renglones, ${r.unidades} unidades). Cambiale el nombre si es otro.`
          : `✓ Lote «${nombreLote.trim()}» cargado en Transferencias: ${r.renglones} renglones, ${r.unidades} unidades. A los locales origen les suena la campana.`,
      )
    } catch (e) {
      setResultado(`✕ ${(e as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  const paso = datos ? 2 : 1
  const resumenFiltro = FILTROS.filter((f) => sel[f.k].size)
    .map((f) => `${f.titulo.replace('ID proveedor descripción', 'Proveedor')}: ${[...sel[f.k]].join(', ')}`)
    .concat(art.trim() ? [`Artículo: ${art.trim().toUpperCase()}`] : [])
    .join(' · ')

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Reparto manual</h1>
        <p className="text-sm text-sub">Elegí qué querés repartir, tocá Armar y el hub trae el stock y la venta de cada local y del depósito.</p>
      </header>

      <ol className="mb-4 flex flex-wrap items-center gap-2 text-[13px] font-semibold">
        {['Filtrar', 'Armar y repartir', 'Lote'].map((t, i) => (
          <li key={t} className={`flex items-center gap-1.5 ${paso === i + 1 ? 'text-ink' : 'text-sub'}`}>
            <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${paso > i + 1 ? 'border-lime-400/50 bg-lime-400/15 text-lime-300' : paso === i + 1 ? 'border-orange-500 bg-orange-500 text-white' : 'border-line2'}`}>{i + 1}</span>
            {t}
            {i < 2 && <span className="mx-1 h-px w-8 bg-line2" />}
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {/* ===================== PASO 1 ===================== */}
      {!datos && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-[15px] font-bold text-ink">¿Qué querés repartir?</h2>
          <p className="text-xs text-sub">Los mismos filtros del tablero. Tenés que elegir al menos un filtro de artículo.</p>
          {errOpciones && <p className="mt-2 text-xs text-red-300">No se pudieron leer los filtros: {errOpciones}</p>}

          <p className="mb-1 mt-4 text-[11px] font-medium uppercase tracking-wider text-sub/80">Venta a mirar</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-sub">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-0.5 block h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink [color-scheme:dark]" /></label>
            <label className="text-[11px] text-sub">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-0.5 block h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink [color-scheme:dark]" /></label>
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" onClick={() => { setDias(d); setDesde(menosDias(d)); setHasta(menosDias(1)) }} className={`h-9 rounded-lg border px-3 text-xs ${dias === d ? 'border-orange-500/60 bg-orange-500/15 font-semibold text-orange-300' : 'border-line text-sub hover:text-ink'}`}>
                {d === 7 ? 'Últimos 7 días' : d}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <FiltroDesplegable titulo="Locales" todos="Todos" opciones={TODOS_LOCALES.map((l) => ({ id: l, label: NOMBRE_LOCAL[l] ?? l }))} valor={locSel} onChange={setLocSel} />
            {FILTROS.map((f) => (
              <FiltroDesplegable key={f.k} titulo={f.titulo} opciones={opcionesDe(f.k)} valor={sel[f.k]} onChange={(s) => setSel((p) => ({ ...p, [f.k]: s }))} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-medium uppercase tracking-wider text-sub/80">
              Artículo (opcional)
              <input value={art} onChange={(e) => setArt(e.target.value)} placeholder="Código o parte, ej. CF1662" className="mt-1 block h-9 w-72 rounded-lg border border-line bg-surface2 px-2.5 text-sm normal-case tracking-normal text-ink" />
            </label>
            <button type="button" className="h-9 text-xs text-sky-400" onClick={() => { setSel(Object.fromEntries(FILTROS.map((f) => [f.k, new Set<string>()])) as Record<ClaveFiltro, Set<string>>); setLocSel(new Set()); setArt('') }}>
              Limpiar todos los filtros
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={`text-xs ${motivoNoArmar ? 'text-red-300' : 'text-sub'}`}>
              {armando ? (
                <span className="inline-flex items-center gap-2 text-sky-300"><Loader2 size={14} className="animate-spin" aria-hidden /> Leyendo stock y venta de cada local y del depósito… {esperando ? `${esperando} s` : ''} (tarda 1 o 2 minutos)</span>
              ) : (
                motivoNoArmar || `${localesElegidos.length} locales · venta del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`
              )}
            </p>
            <div className="flex gap-2">
              {armando && <button type="button" className={btn} onClick={() => { cancelado.current = true }}>Cancelar</button>}
              <button type="button" disabled={!!motivoNoArmar || armando || !opciones} onClick={() => void armar()} className="btn-press h-10 rounded-lg bg-orange-500 px-7 text-[15px] font-bold text-white transition hover:bg-orange-400 disabled:opacity-40">
                Armar
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ===================== PASO 2 ===================== */}
      {datos && (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-sub">
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-bold text-sky-300">Foto {new Date(datos.foto_en ?? Date.now()).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
            {resumenFiltro} · {modelo.current.length.toLocaleString('es-AR')} SKU · {locales.length} locales · venta del {fechaCorta(datos.desde)} al {fechaCorta(datos.hasta)}
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar artículo o descripción…" className="h-8 w-60 rounded-lg border border-line bg-surface2 px-2.5 text-xs text-ink" />
            {(['color', 'talle', 'grupo'] as const).map((k) => (
              <select key={k} value={k === 'color' ? fColor : k === 'talle' ? fTalle : fGrupo} onChange={(e) => (k === 'color' ? setFColor : k === 'talle' ? setFTalle : setFGrupo)(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
                <option value="">{k[0].toUpperCase() + k.slice(1)}: todos</option>
                {valores(k).map((v) => <option key={v}>{v}</option>)}
              </select>
            ))}
            <div className="inline-flex overflow-hidden rounded-lg border border-line2">
              {(['venta', 'codigo'] as const).map((o) => (
                <button key={o} type="button" onClick={() => setOrden(o)} className={`h-8 px-2.5 text-xs font-semibold ${orden === o ? 'bg-surface2 text-ink' : 'text-sub'}`}>{o === 'venta' ? 'Por venta' : 'Por código'}</button>
              ))}
            </div>
            <button type="button" className={btn} onClick={() => { if (historial.current.length) { const todo = historial.current.flat().reverse(); aplicar(todo, false); historial.current = []; futuro.current = [] } }}>Descartar cambios</button>
            <button type="button" className={btn} onClick={() => { if (!historial.current.length || confirm('Vas a perder lo que repartiste. ¿Seguro?')) { setDatos(null); setCompleta(false) } }}>
              <ArrowLeft size={13} aria-hidden /> Cambiar filtros
            </button>
          </div>
          <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sub">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-400/40 align-[-1px]" />vendió en el período</span>
            <span>🚚 en tránsito (en 0: no es hueco, ya le llega)</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400/50 align-[-1px]" />cambiada (<b className="text-green-300">+1</b> recibe · <b className="text-red-300">−2</b> dona)</span>
            <span>· tipeá el número · flechas / Enter / Tab · Shift+flechas = rango · Ctrl+C / Ctrl+V · Supr · Ctrl+Z · tocar el código = sugerencia · doble clic en el color = gráfico</span>
          </p>

          <div ref={zona} className={completa ? 'fixed inset-0 z-40 flex flex-col overflow-hidden p-3' : ''} style={completa ? { background: 'var(--paper)' } : undefined}>
            {completa && <p className="mb-2 text-[13px] font-bold text-ink">{resumenFiltro} · {modelo.current.length} SKU · venta del {fechaCorta(datos.desde)} al {fechaCorta(datos.hasta)}</p>}
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className={tilde}><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={verTransporte} onChange={(e) => setVerTransporte(e.target.checked)} /> 🚚 Ver transporte</label>
              <label className={tilde}><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={semaforo.on} onChange={(e) => setSemaforo((s) => ({ ...s, on: e.target.checked }))} /> 🚦 Días sin venta</label>
              {semaforo.on && (
                <span className="inline-flex flex-wrap items-center gap-1.5 text-sub">
                  {([['v', 'Verde', 'bg-green-600'], ['a', 'Amarillo', 'bg-amber-500'], ['r', 'Rojo', 'bg-red-600']] as const).map(([k, t, c]) => (
                    <label key={k} className="ml-1 inline-flex cursor-pointer items-center gap-1 font-semibold text-ink">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-orange-500" checked={semaforo.colores[k]} onChange={(e) => setSemaforo((s) => ({ ...s, colores: { ...s.colores, [k]: e.target.checked } }))} />
                      <i className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />{t}
                      {k === 'v' && <> hasta <input type="number" min={1} value={semaforo.verde} onChange={(e) => setSemaforo((s) => ({ ...s, verde: Math.max(1, +e.target.value || 1) }))} className="h-6 w-12 rounded border border-line bg-surface2 px-1 text-ink" /> días</>}
                      {k === 'a' && <> hasta <input type="number" min={2} value={semaforo.amarillo} onChange={(e) => setSemaforo((s) => ({ ...s, amarillo: Math.max(2, +e.target.value || 2) }))} className="h-6 w-12 rounded border border-line bg-surface2 px-1 text-ink" /> días</>}
                      {k === 'r' && <span className="font-normal text-sub">más o nunca</span>}
                    </label>
                  ))}
                </span>
              )}
              <span className="ml-auto inline-flex overflow-hidden rounded-lg border border-line2" title="Ctrl+Z / Ctrl+Y">
                <button type="button" className="inline-flex h-8 items-center gap-1 px-2.5 font-semibold text-ink disabled:opacity-40" disabled={!historial.current.length} onClick={deshacer}><Undo2 size={13} aria-hidden /> Volver</button>
                <button type="button" className="inline-flex h-8 items-center gap-1 px-2.5 font-semibold text-ink disabled:opacity-40" disabled={!futuro.current.length} onClick={rehacer}><Redo2 size={13} aria-hidden /> Adelante</button>
              </span>
              <button type="button" className={btn} onClick={() => pantallaCompleta(!completa)}>
                {completa ? <><Minimize2 size={13} aria-hidden /> Salir de pantalla completa</> : <><Maximize2 size={13} aria-hidden /> Pantalla completa</>}
              </button>
            </div>

            {/* Sugerencia */}
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className={tilde} title="El stock ideal ordena: recibe primero el que más lejos está de su ideal y dona primero el que más le sobra.">
                <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={opSug.segunIdeal} onChange={(e) => setOpSug((o) => ({ ...o, segunIdeal: e.target.checked }))} /> Según stock ideal
              </label>
              <span className="inline-flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sub">Donan:
                {([['donaMito', 'MITO'], ['donaIndo', 'Indo'], ['donaPolo', 'Polo']] as const).map(([k, t]) => (
                  <label key={k} className={tilde}><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={opSug[k]} onChange={(e) => setOpSug((o) => ({ ...o, [k]: e.target.checked }))} /> {t}</label>
                ))}
              </span>
              <label className={tilde} title="Cada par local donante → local receptor tiene que sumar al menos esto (regla de la Cascada; MITO, Indo y Polo no cuentan). 1 = sin mínimo.">
                Mín. por envío <input type="number" min={1} max={10} value={opSug.minEnvio} onChange={(e) => setOpSug((o) => ({ ...o, minEnvio: Math.max(1, +e.target.value || 1) }))} className="h-7 w-12 rounded border border-line bg-surface2 px-1 text-ink" />
              </label>
              <label className={tilde} title="Apagado (como la Cascada): solo tapa huecos de talles que se vendieron en el período.">
                <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={opSug.huecosSinVenta} onChange={(e) => setOpSug((o) => ({ ...o, huecosSinVenta: e.target.checked }))} /> Tapar huecos de talles sin venta
              </label>
              <label className={tilde} title="Si el local no tiene ningún talle de ese color, le manda la curva (1 por talle).">
                <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={opSug.abrirColores} onChange={(e) => setOpSug((o) => ({ ...o, abrirColores: e.target.checked }))} /> Abrir colores que el local no tiene
              </label>
              <button type="button" disabled={!artSel} onClick={hacerSugerencia} className="btn-press inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-orange-500 to-purple-500 px-3 font-bold text-white disabled:from-slate-600 disabled:to-slate-600 disabled:opacity-50" title={artSel ? `Repartir ${artSel.art} color ${artSel.col} cubriendo venta y huecos` : 'Tocá un código para habilitarlo'}>
                <Sparkles size={13} aria-hidden /> Sugerencia{artSel ? ` ${artSel.art} · color ${artSel.col}` : ''}
              </button>
            </div>

            {sugerencia && <CartelSugerencia s={sugerencia} op={opSug} onCerrar={() => setSugerencia(null)} />}

            {verTransporte && (
              <div className="mb-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <b className="text-ink">Locales por los que todavía tienen que pasar hoy</b>
                  <span className="inline-flex items-center gap-1 text-sub"><i className="inline-block h-3 w-3 rounded-sm bg-yellow-500/60" />Master</span>
                  <span className="inline-flex items-center gap-1 text-sub"><i className="inline-block h-3 w-3 rounded-sm bg-pink-500/60" />Mercedes</span>
                  <span className="inline-flex items-center gap-1 text-sub"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: 'linear-gradient(135deg,#eab308 50%,#ec4899 50%)' }} />los dos</span>
                  <span className="text-sub/70">· se marcan en la línea donde está el mouse</span>
                </div>
                {!rutas.length && <p className="mt-1 text-sub">Sin datos del Tracking de hoy.</p>}
                {rutas.map((r) => {
                  const merc = /mercedes/i.test(r.vehiculo)
                  const min = r.ultima_at ? Math.round((Date.now() - new Date(r.ultima_at).getTime()) / 60000) : null
                  return (
                    <div key={r.vehiculo} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex min-w-[150px] items-center gap-1.5 font-bold text-ink">
                        <i className={`inline-block h-3 w-3 rounded-sm ${merc ? 'bg-pink-500/60' : 'bg-yellow-500/60'}`} />
                        {r.vehiculo.replace(/\s*TRANSPORTE\s*/i, '')}
                        <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10.5px] text-sky-300">{min == null ? 'sin señal hoy' : min <= 15 ? `señal hace ${min} min` : `sin señal hace ${min >= 60 ? Math.round(min / 60) + ' h' : min + ' min'}`}</span>
                      </span>
                      {r.pendientes.length ? r.pendientes.map((p, i) => (
                        <span key={p.base_id} className="inline-flex items-center gap-1">
                          {i > 0 && <span className="text-sub">›</span>}
                          <span className={`rounded-full border px-2 py-0.5 font-semibold text-white ${merc ? 'border-pink-500 bg-pink-500/50' : 'border-yellow-500 bg-yellow-500/50'}`}>
                            {BASE_TRACKING[p.base_id] ?? p.base_id}
                            {p.hora_limite && <small className="ml-1 font-normal opacity-80">{p.hora_limite}</small>}
                            {!locales.includes(BASE_TRACKING[p.base_id] ?? p.base_id) && <small className="ml-1 font-normal opacity-80">(no está en el reparto)</small>}
                          </span>
                        </span>
                      )) : <span className="text-sub">ya pasó por todos los locales de hoy</span>}
                    </div>
                  )
                })}
              </div>
            )}

            <GrillaReparto
              filas={visibles}
              locales={locales}
              resumen={res}
              version={version}
              onCambios={onCambios}
              onDeshacer={deshacer}
              onRehacer={rehacer}
              faltaPasar={faltaPasar}
              semaforo={semaforo}
              artSel={artSel}
              onElegirArt={(a, c) => setArtSel((s) => (s && s.art === a && s.col === c ? null : { art: a, col: c }))}
              onGrafico={(a, c) => setGrafico({ art: a, col: c })}
              completa={completa}
            />
            {grafico && <GraficoStockVenta {...grafico} filas={modelo.current} locales={locales} desde={datos.desde} hasta={datos.hasta} onCerrar={() => setGrafico(null)} />}
          </div>

          {/* ===================== PASO 3 ===================== */}
          <div className="mt-4 grid gap-4 pb-8 xl:grid-cols-[1.2fr_.8fr]">
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-[15px] font-bold text-ink">Movimientos que salen del reparto</h2>
              <p className="text-xs text-sub">Lo que bajó en un local va a donde subió. Esto es lo que se carga como lote.</p>
              <div className="my-3 flex flex-wrap gap-2">
                {[
                  [movimientos.length, 'renglones'],
                  [movimientos.reduce((a, m) => a + m.cantidad, 0), 'unidades'],
                  [new Set(movimientos.map((m) => m.desde)).size, 'locales origen'],
                ].map(([v, t]) => (
                  <div key={t as string} className="min-w-[110px] rounded-xl border border-line px-3 py-2">
                    <b className="block font-display text-xl text-ink">{v}</b>
                    <span className="text-[11.5px] text-sub">{t}</span>
                  </div>
                ))}
              </div>
              {negativos > 0 && <p className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">⚠ {negativos} SKU con Rem. negativo (repartiste más de lo que hay). No se puede cargar hasta corregirlo.</p>}
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10.5px] uppercase tracking-wider text-sub/70">
                    <tr><th className="py-1">Artículo</th><th>Color</th><th>Talle</th><th>Origen → destino</th><th className="text-right">Unid.</th></tr>
                  </thead>
                  <tbody>
                    {movimientos.slice(0, 400).map((m, i) => (
                      <tr key={i} className="border-t border-line text-ink">
                        <td className="py-1">{m.articulo}</td><td>{m.color}</td><td>{m.talle}</td>
                        <td><b>{m.desde}</b> <span className="text-sub">→</span> <b>{m.hacia}</b></td>
                        <td className="text-right">{m.cantidad}</td>
                      </tr>
                    ))}
                    {!movimientos.length && <tr><td colSpan={5} className="py-2 text-sub">Todavía no moviste nada. Bajá el número en un local y subilo en otro, o usá la Sugerencia.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-[15px] font-bold text-ink">Cargar</h2>
              <label className="mt-2 block text-[11px] font-medium uppercase tracking-wider text-sub/80">
                Nombre del lote
                <input value={nombreLote} onChange={(e) => setNombreLote(e.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-line bg-surface2 px-2.5 text-sm normal-case tracking-normal text-ink" />
              </label>
              <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider text-sub/80">
                Observación <span className="normal-case tracking-normal">(opcional · la ven los locales en el lote)</span>
                <textarea value={obs} maxLength={300} rows={3} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: buzos W26 para reforzar locales del centro antes del finde" className="mt-1 block w-full rounded-lg border border-line bg-surface2 px-2.5 py-2 text-sm normal-case tracking-normal text-ink" />
              </label>
              <p className="text-right text-[11px] text-sub">{obs.length}/300</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={!movimientos.length || negativos > 0 || cargando || !nombreLote.trim()} onClick={() => void cargar()} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-lime-400/50 bg-lime-400/15 px-3 text-sm font-semibold text-lime-200 disabled:opacity-40">
                  {cargando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />} Cargar en Transferencias
                </button>
                <button type="button" disabled={!movimientos.length} onClick={() => void bajarExcelRemitos(movimientos, locales)} className={btn + ' h-9'}>
                  <Download size={13} aria-hidden /> Excel de remitos
                </button>
              </div>
              {resultado && <p className={`mt-3 rounded-lg border p-2 text-sm ${resultado.startsWith('✓') ? 'border-lime-400/40 bg-lime-400/10 text-lime-200' : 'border-amber-400/40 bg-amber-400/10 text-amber-200'}`}>{resultado}</p>}
              <ol className="ml-4 mt-3 list-decimal space-y-1 text-xs text-sub">
                <li>Crea el lote en Transferencias (origen = el que bajó, destino = el que subió).</li>
                <li>A los locales origen les suena la campana hasta que marquen el primer renglón.</li>
                <li>Si sale o llega a DEPO, avisa a Depósito Indo.</li>
                <li>No se repite: el mismo nombre en 7 días no crea otro lote.</li>
              </ol>
            </section>
          </div>
        </>
      )}
    </Layout>
  )
}

function CartelSugerencia({ s, op, onCerrar }: { s: ResultadoSugerencia & { art: string; col: string }; op: OpcionesSugerencia; onCerrar: () => void }) {
  const sinCub = s.sinCubrir.restriccion + s.sinCubrir.sin_donante
  const apagado = (on: boolean, n: number) => (on ? n : 'apagado')
  return (
    <div className="mb-2 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-[12.5px] text-ink">
      {s.total ? (
        <>
          <p>✨ <b className="text-purple-200">Sugerencia {s.art} · color {s.col}</b>: {s.total} unidades.{s.yaCubre ? <span className="text-sub"> ({s.yaCubre} de la venta ya la cubre el stock o el tránsito de cada local: no se mandan)</span> : null}</p>
          <p>
            <b>Repo MITO</b> {s.usaMito ? s.repo + (s.deMito ? '' : ' (no es de MOCF/MOZH/MOFR: MITO no repone)') : 'apagado'} · <b>Cascada</b>: Indo {apagado(s.principales.includes('DEPO'), s.indo)} · Polo {apagado(s.principales.includes('POLO52'), s.polo)} · locales {s.locales} · huecos {s.huecos}{s.abre ? ` · abrir colores ${s.abre}` : ''}.
          </p>
        </>
      ) : (
        <p>
          ✨ <b className="text-purple-200">{s.art} · color {s.col}</b>: no se mandó nada.{' '}
          {s.descartadas ? (
            <span className="text-amber-200">Había {s.descartadas} unidades pero salían de locales con menos de {op.minEnvio} por envío y se descartaron: bajá «Mín. por envío» a 1{!s.usaMito && !s.principales.length ? ' o prendé MITO / Indo / Polo' : ''}.</span>
          ) : s.huecosPendientes || sinCub ? (
            <span className="text-amber-200">Hay {s.huecosPendientes ? `${s.huecosPendientes} huecos` : ''}{s.huecosPendientes && sinCub ? ' y ' : ''}{sinCub ? `${sinCub} de venta` : ''} sin tapar porque nadie tiene de sobra de esos talles{!s.usaMito && !s.principales.length ? ' (MITO, Indo y Polo están apagados)' : ''}.</span>
          ) : (
            'No queda venta sin cubrir ni huecos para tapar.'
          )}
        </p>
      )}
      {s.total > 0 && s.descartadas > 0 && <p className="text-amber-200">Descartadas {s.descartadas} por el mínimo de {op.minEnvio} por envío entre locales (bajalo a 1 para mandarlas).</p>}
      {s.total > 0 && sinCub > 0 && <p className="text-red-300">Venta sin cubrir {sinCub}: restricción de proveedor {s.sinCubrir.restriccion} · sin stock de dónde sacar {s.sinCubrir.sin_donante}.</p>}
      {op.segunIdeal && s.total > 0 && <p className="text-sub">Según stock ideal: recibe primero el que más le falta; dona primero el que más le sobra (se queda con lo que vendió, mínimo 1).</p>}
      {Object.keys(s.noRecibenHuecos).length > 0 && <p className="text-sub">{Object.entries(s.noRecibenHuecos).map(([l, t]) => `${l} no recibe huecos (regla de la Cascada): quedó sin ${t.join(', ')}`).join(' · ')}.</p>}
      {s.huecosSinVentaPosibles > 0 && <p className="text-amber-200">Quedan {s.huecosSinVentaPosibles} huecos en talles que nadie vendió en el período ({s.tallesSinVenta.join(', ')}): prendé «Tapar huecos de talles sin venta» para completarlos.</p>}
      <p className="text-sub">
        {s.total ? 'Revisalo en la grilla (celdas en violeta); «Volver» la deshace entera. ' : ''}
        <button type="button" onClick={onCerrar} className="text-sky-400">Ocultar</button>
      </p>
    </div>
  )
}
