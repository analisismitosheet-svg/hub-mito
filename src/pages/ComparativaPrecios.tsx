import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Compras > Comparativa de precios                                    */
/*                                                                      */
/*  Mi precio público (articulos) contra el PRECIO DE LISTA de la web   */
/*  de la marca (precios_web, lo carga /api/precios-sync). La           */
/*  diferencia y el estado salen de public.vw_comparativa_precios; el   */
/*  precio vigente y el % OFF se muestran como dato.                    */
/* ------------------------------------------------------------------ */

type Estado = 'mas_caro' | 'igual' | 'mas_barato' | 'revisar' | 'sin_precio'

interface Fila {
  codigo: string
  id_art: string
  descripcion: string
  familia: string | null
  anio: number | null
  publicado: boolean | null
  mi_precio: number | null
  precio: number | null
  precio_lista: number | null
  desc_pct: number | null
  con_stock: boolean | null
  url: string | null
  nombre_web: string | null
  dif: number | null
  dif_pct: number | null
  estado: Estado
}

interface Sync {
  ultima_at: string | null
  consultados: number
  encontrados: number
  errores: number
  proximo: number | null
  total: number | null
}

const MARCAS = [
  { id: 'vans', label: 'Vans · vans.com.ar', activa: true },
  { id: 'converse', label: 'Converse (próximamente)', activa: false },
  { id: 'topper', label: 'Topper (próximamente)', activa: false },
]

const nf = new Intl.NumberFormat('es-AR')
const plata = (n: number | null | undefined) => (n == null ? '—' : `$ ${nf.format(Math.round(n))}`)
const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`

const ESTADOS: Record<Estado, { label: string; clase: string }> = {
  mas_caro: { label: 'Vos más caro', clase: 'bg-red-500/10 text-red-500' },
  igual: { label: 'Igual', clase: 'bg-blue-500/10 text-blue-500' },
  mas_barato: { label: 'Vos más barato', clase: 'bg-emerald-500/10 text-emerald-500' },
  revisar: { label: 'Revisar', clase: 'bg-amber-500/15 text-amber-500' },
  sin_precio: { label: 'Sin precio', clase: 'bg-surface2 text-sub' },
}

type Stock = 'si' | 'no' | 'todos'
type Kpi = 'todos' | 'mas_caro' | 'igual' | 'mas_barato' | 'oferta'
type Col = 'descripcion' | 'mi_precio' | 'precio_lista' | 'dif_pct' | 'estado' | 'con_stock'

const POR_PAGINA = 60

export default function ComparativaPrecios() {
  const { isAdmin } = useAuth()
  const [marca, setMarca] = useState('vans')
  const [filas, setFilas] = useState<Fila[]>([])
  const [sync, setSync] = useState<Sync | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [stock, setStock] = useState<Stock>('si')
  const [busqueda, setBusqueda] = useState('')
  const [soloPublicados, setSoloPublicados] = useState(false)
  const [kpi, setKpi] = useState<Kpi>('todos')
  const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: 'dif_pct', asc: false })
  const [mostrar, setMostrar] = useState(POR_PAGINA)

  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const todas: Fila[] = []
    for (let desde = 0; desde < 20000; desde += 1000) {
      const { data, error: e } = await supabase
        .from('vw_comparativa_precios')
        .select('codigo,id_art,descripcion,familia,anio,publicado,mi_precio,precio,precio_lista,desc_pct,con_stock,url,nombre_web,dif,dif_pct,estado')
        .eq('marca', marca)
        .order('codigo')
        .order('id_art')
        .range(desde, desde + 999)
      if (e) { setError(e.message); break }
      const pagina = (data as Fila[] | null) ?? []
      todas.push(...pagina.map((f) => ({
        ...f,
        mi_precio: f.mi_precio == null ? null : Number(f.mi_precio),
        precio: f.precio == null ? null : Number(f.precio),
        precio_lista: f.precio_lista == null ? null : Number(f.precio_lista),
        dif: f.dif == null ? null : Number(f.dif),
        dif_pct: f.dif_pct == null ? null : Number(f.dif_pct),
      })))
      if (pagina.length < 1000) break
    }
    setFilas(todas)
    const { data: s } = await supabase.from('precios_web_sync').select('ultima_at,consultados,encontrados,errores,proximo,total').eq('marca', marca).maybeSingle()
    setSync((s as Sync | null) ?? null)
    setCargando(false)
  }, [marca])

  useEffect(() => { void cargar() }, [cargar])

  /** "Actualizar ahora" (admin): encadena las tandas de /api/precios-sync hasta terminar. */
  async function actualizarAhora() {
    if (!supabase) return
    setAviso(null)
    setLeyendo('Arrancando…')
    try {
      let desde = 0
      let encontrados = 0
      for (let vuelta = 0; vuelta < 60; vuelta++) {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) throw new Error('Sin sesión activa.')
        const r = await fetch(`/api/precios-sync?marca=${marca}&desde=${desde}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const cuerpo = (await r.json().catch(() => null)) as
          | { error?: string; hasta: number; total: number; fin: boolean; encontrados: number }
          | null
        if (!r.ok || !cuerpo) throw new Error(cuerpo?.error ?? `Error ${r.status} leyendo la web`)
        encontrados += cuerpo.encontrados
        setLeyendo(`Leyendo la web: ${nf.format(cuerpo.hasta)} de ${nf.format(cuerpo.total)} códigos · ${nf.format(encontrados)} encontrados`)
        if (cuerpo.fin) break
        if (cuerpo.hasta <= desde) throw new Error('La lectura no avanza: probá de nuevo en un rato.')
        desde = cuerpo.hasta
      }
      setAviso({ ok: true, texto: `Listo: ${nf.format(encontrados)} códigos encontrados en la web.` })
      await cargar()
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo leer la web.' })
    } finally {
      setLeyendo(null)
    }
  }

  /* ---- Filtros: stock, búsqueda y publicados (los contadores se calculan sobre esto) ---- */
  const base = useMemo(() => {
    const t = busqueda.trim().toUpperCase()
    return filas.filter((f) =>
      (stock === 'todos' || (stock === 'si' ? f.con_stock === true : f.con_stock !== true)) &&
      (!soloPublicados || f.publicado === true) &&
      (!t || f.codigo.includes(t) || f.id_art.toUpperCase().includes(t) || f.descripcion.toUpperCase().includes(t)),
    )
  }, [filas, stock, busqueda, soloPublicados])

  const contadores = useMemo(() => {
    const prom = (xs: Fila[]) => (xs.length ? xs.reduce((s, f) => s + (f.dif_pct ?? 0), 0) / xs.length : null)
    const caro = base.filter((f) => f.estado === 'mas_caro')
    const barato = base.filter((f) => f.estado === 'mas_barato')
    return {
      todos: base.length,
      mas_caro: caro.length,
      promCaro: prom(caro),
      igual: base.filter((f) => f.estado === 'igual').length,
      mas_barato: barato.length,
      promBarato: prom(barato),
      oferta: base.filter((f) => (f.desc_pct ?? 0) > 0).length,
    }
  }, [base])

  const visibles = useMemo(() => {
    const lista = base.filter((f) =>
      kpi === 'todos' ? true : kpi === 'oferta' ? (f.desc_pct ?? 0) > 0 : f.estado === kpi,
    )
    const valor = (f: Fila): string | number | null => {
      switch (orden.col) {
        case 'descripcion': return f.descripcion
        case 'mi_precio': return f.mi_precio
        case 'precio_lista': return f.precio_lista
        case 'dif_pct': return f.dif_pct
        case 'estado': return ESTADOS[f.estado].label
        case 'con_stock': return f.con_stock ? 1 : 0
      }
    }
    return [...lista].sort((a, b) => {
      const va = valor(a)
      const vb = valor(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // los vacíos siempre al final
      if (vb == null) return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')
      return orden.asc ? c : -c
    })
  }, [base, kpi, orden])

  useEffect(() => { setMostrar(POR_PAGINA) }, [stock, busqueda, soloPublicados, kpi, orden])

  const ordenarPor = (col: Col) =>
    setOrden((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: col === 'descripcion' || col === 'estado' }))

  const th = (col: Col, label: string, derecha = false) => (
    <th className="whitespace-nowrap p-0 font-semibold">
      <button
        type="button"
        onClick={() => ordenarPor(col)}
        className={`flex w-full items-center gap-1 px-3 py-2.5 ${derecha ? 'justify-end' : ''} ${orden.col === col ? 'text-ink' : ''}`}
      >
        {label}
        {orden.col === col
          ? (orden.asc ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)
          : <ArrowDown size={11} className="opacity-30" aria-hidden />}
      </button>
    </th>
  )

  const tarjeta = (id: Kpi, titulo: string, valor: number, pie: string | null, punto: string | null) => (
    <button
      type="button"
      onClick={() => setKpi(kpi === id ? 'todos' : id)}
      aria-pressed={kpi === id}
      className={`flex flex-col gap-1 rounded-2xl border p-3.5 text-left transition hover:bg-surface2 ${
        kpi === id ? 'border-line2 bg-surface2' : 'border-line bg-surface'
      }`}
    >
      <span className="text-xs font-medium text-sub">
        {punto && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-[1px] ${punto}`} />}
        {titulo}
      </span>
      <span className="font-display text-2xl font-bold tabular-nums text-ink">{nf.format(valor)}</span>
      {pie && <span className="text-xs tabular-nums text-sub">{pie}</span>}
    </button>
  )

  const fecha = sync?.ultima_at
    ? new Date(sync.ultima_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Comparativa de precios</h1>
          <p className="text-sm text-sub">Tu precio público contra el precio de lista que publica la marca en su web.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => void actualizarAhora()}
            disabled={!!leyendo}
            className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-cyan-700 disabled:opacity-60"
            title="Vuelve a leer los precios de la web (tarda unos minutos)"
          >
            <RefreshCw size={15} aria-hidden className={leyendo ? 'animate-spin' : ''} />
            {leyendo ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        )}
      </header>

      {/* Marca + última lectura */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pl-3 pr-1.5 text-sm text-ink">
          Marca
          <select
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            className="rounded-lg border border-line bg-surface2 px-2 py-1 text-sm text-ink outline-none"
          >
            {MARCAS.map((m) => <option key={m.id} value={m.id} disabled={!m.activa}>{m.label}</option>)}
          </select>
        </label>
        <span className="w-full text-xs text-sub sm:ml-auto sm:w-auto">
          {sync?.proximo != null
            ? `Lectura en curso: ${nf.format(sync.proximo)} de ${nf.format(sync.total ?? 0)} códigos`
            : fecha
              ? `Última lectura: ${fecha} · ${nf.format(sync?.encontrados ?? 0)} códigos encontrados de ${nf.format(sync?.consultados ?? 0)}`
              : 'Todavía no se leyó la web de la marca.'}
        </span>
      </div>

      {leyendo && (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-500">
          <Loader2 size={15} className="animate-spin" aria-hidden /> {leyendo}
        </p>
      )}
      {aviso && (
        <p role="status" className={`mb-3 rounded-xl border p-3 text-sm ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
          {aviso.texto}
        </p>
      )}
      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Contadores (filtran la tabla) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tarjeta('todos', 'Artículos comparados', contadores.todos, null, null)}
        {tarjeta('mas_caro', 'Vos más caro', contadores.mas_caro, contadores.promCaro != null ? `promedio ${pct(contadores.promCaro)}` : null, 'bg-red-500')}
        {tarjeta('igual', 'Igual (±2%)', contadores.igual, null, 'bg-blue-500')}
        {tarjeta('mas_barato', 'Vos más barato', contadores.mas_barato, contadores.promBarato != null ? `promedio ${pct(contadores.promBarato)}` : null, 'bg-emerald-500')}
        {tarjeta('oferta', 'En oferta en la marca', contadores.oferta, null, 'bg-amber-500')}
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="Stock en la web">
          {([['si', 'Con stock en web'], ['no', 'Sin stock'], ['todos', 'Todos']] as [Stock, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStock(id)}
              aria-pressed={stock === id}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${stock === id ? 'bg-surface2 text-ink shadow-soft' : 'text-sub hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex h-[38px] min-w-0 flex-[1_1_220px] items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search size={15} className="shrink-0 text-sub" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código, ID o descripción"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-sub/60"
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-sub">
          <input type="checkbox" checked={soloPublicados} onChange={(e) => setSoloPublicados(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          Solo publicados
        </label>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface2 text-xs text-sub">
              <tr className="border-b border-line">
                {th('descripcion', 'Artículo')}
                {th('mi_precio', 'Mi precio', true)}
                {th('precio_lista', 'Precio marca', true)}
                {th('dif_pct', 'Diferencia', true)}
                {th('estado', 'Estado')}
                {th('con_stock', 'Stock web')}
                <th className="px-3 py-2.5"><span className="sr-only">Ver en la web</span></th>
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, mostrar).map((f) => {
                const e = ESTADOS[f.estado]
                const oferta = (f.desc_pct ?? 0) > 0
                return (
                  <tr key={`${f.codigo}-${f.id_art}`} className="border-b border-line/70 last:border-0 hover:bg-surface2">
                    <td className="max-w-[360px] px-3 py-2">
                      <span className="block truncate font-semibold text-ink" title={f.descripcion}>{f.descripcion}</span>
                      <span className="text-xs tabular-nums text-sub">{f.codigo} · {f.id_art}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{plata(f.mi_precio)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      <span className="block text-ink">{plata(f.precio_lista)}</span>
                      {oferta && (
                        <span className="mt-0.5 block text-xs text-sub">
                          hoy {plata(f.precio)}
                          <span className="ml-1.5 rounded-md bg-brand-600 px-1.5 py-px text-[11px] font-bold text-white">{f.desc_pct}% OFF</span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${e.clase}`}>{pct(f.dif_pct)}</span>
                      <span className="mt-0.5 block text-xs tabular-nums text-sub">{f.dif == null ? '' : `${f.dif > 0 ? '+' : ''}${plata(f.dif)}`}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>{e.label}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-sub">
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${f.con_stock ? 'bg-emerald-500' : 'bg-sub'}`} />
                      {f.con_stock ? 'Con stock' : 'Sin stock'}
                    </td>
                    <td className="px-3 py-2">
                      {f.url && (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          title={f.nombre_web ?? 'Ver en la web de la marca'}
                          className="inline-grid h-8 w-8 place-items-center rounded-lg border border-line text-sub hover:bg-surface2 hover:text-ink"
                        >
                          <ExternalLink size={14} aria-hidden />
                          <span className="sr-only">Ver {f.codigo} en la web</span>
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!visibles.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sub">
                    {cargando ? 'Cargando…' : 'No hay artículos con estos filtros.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface2 px-3.5 py-2.5 text-xs text-sub">
          <span>Mostrando {nf.format(Math.min(mostrar, visibles.length))} de {nf.format(visibles.length)}</span>
          {mostrar < visibles.length && (
            <button type="button" onClick={() => setMostrar((m) => m + POR_PAGINA)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-ink hover:bg-surface2">
              Mostrar más
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-sub">
        La diferencia es tu precio público contra el precio de lista de la marca (antes de la oferta). Igual = hasta ±2%.
        Si la marca tiene el artículo en oferta, se muestra debajo el precio de hoy y el % OFF. El precio de la marca no
        incluye promociones bancarias, y cuando la web no tiene stock suele quedar el último precio de liquidación.
        "Revisar" = algún precio menor a $10.000.
      </p>
    </Layout>
  )
}
