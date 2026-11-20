import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, Search, X } from 'lucide-react'
import Layout from '@/components/Layout'
import FranquiciasHeader from '@/components/FranquiciasHeader'
import FranquiciaPropuestas from '@/components/FranquiciaPropuestas'
import { useReposicionFranquicia, type Postura } from '@/hooks/useReposicionFranquicia'
import type { ItemPropuesta } from '@/components/FranquiciaPropuestas'

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const th = 'whitespace-nowrap px-3 py-2 text-[10.5px] uppercase tracking-wide text-sub'

export default function MayoristaFranquiciasPropuestas() {
  const {
    disponibles, franq, clienteSel, setClienteSel,
    desde, setDesde, hasta, setHasta,
    filas, posturas, precioDe, setArtsExtra,
    cargando, cargandoPrecios, cargandoMapa, error,
  } = useReposicionFranquicia()

  // Filtros: valen para la sugerencia y para el surtido
  const [selMats, setSelMats] = useState<Set<string>>(new Set())
  const [grupo, setGrupo] = useState('')
  const [temporada, setTemporada] = useState('')
  const [busca, setBusca] = useState('')
  // Surtido: posturas que el local no tiene
  const [soloFaltan, setSoloFaltan] = useState(true)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  // Posturas faltantes sumadas a la propuesta (clave art|color)
  const [extras, setExtras] = useState<Map<string, Postura>>(new Map())

  useEffect(() => {
    setSelMats(new Set()); setGrupo(''); setTemporada(''); setBusca('')
    setMarcadas(new Set()); setExtras(new Map())
  }, [franq?.base])

  useEffect(() => { setArtsExtra([...new Set([...extras.values()].map((p) => p.art))]) }, [extras, setArtsExtra])

  // Material: el filtro va por nombre (es lo que lleva la propuesta) y se muestra código · nombre
  const materiales = useMemo(() => [...new Set([...filas.map((f) => f.material), ...posturas.map((p) => p.material)].filter(Boolean))].sort(), [filas, posturas])
  const codMaterial = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of [...filas, ...posturas]) if (f.material && f.materialCod && !m.has(f.material)) m.set(f.material, f.materialCod)
    return m
  }, [filas, posturas])
  const etiquetaMat = (m: string) => { const c = codMaterial.get(m); return c && c !== m ? `${c} · ${m}` : m }
  const grupos = useMemo(() => [...new Set(posturas.filter((p) => !selMats.size || selMats.has(p.material)).map((p) => p.grupo).filter(Boolean))].sort(), [posturas, selMats])
  const temporadas = useMemo(() => [...new Set(posturas.map((p) => p.temporada).filter(Boolean))].sort(), [posturas])
  const hayFiltro = selMats.size > 0 || Boolean(grupo || temporada || busca.trim())

  const pasaFiltro = useCallback((f: { art: string; descrip: string; color: string; material: string; grupo: string; temporada: string }) => {
    if (selMats.size && !selMats.has(f.material)) return false
    if (grupo && f.grupo !== grupo) return false
    if (temporada && f.temporada !== temporada) return false
    const q = busca.trim().toUpperCase()
    if (q && !`${f.art} ${f.descrip} ${f.color}`.toUpperCase().includes(q)) return false
    return true
  }, [selMats, grupo, temporada, busca])

  const sugeridos = useMemo(() => {
    const list = filas.filter((f) => f.sugerido > 0 && pasaFiltro(f))
    list.sort((a, b) => b.vendido - a.vendido || b.sugerido - a.sugerido)
    return list
  }, [filas, pasaFiltro])

  // Lo que va a la propuesta: la sugerencia filtrada + las posturas faltantes que se sumaron (1 por talle con stock)
  const items = useMemo<ItemPropuesta[]>(() => {
    const list: ItemPropuesta[] = sugeridos.map((f) => ({
      art: f.art, descrip: f.descrip, material: f.material, color: f.color, talle: f.talle,
      stockCli: f.stockCli, vendido: f.vendido, stock: f.stock, stockPolo: f.stockPolo, sugerido: f.sugerido, precio: f.precio,
    }))
    const ya = new Set(list.map((i) => `${i.art}|${i.color}|${i.talle}`))
    for (const p of extras.values()) {
      for (const t of p.talles) {
        if (ya.has(`${p.art}|${p.color}|${t.talle}`)) continue
        list.push({ art: p.art, descrip: p.descrip, material: p.material, color: p.color, talle: t.talle, stockCli: 0, vendido: 0, stock: t.stock, sugerido: 1, precio: precioDe(p.art, p.color, t.talle) })
      }
    }
    return list
  }, [sugeridos, extras, precioDe])

  const totalSug = items.reduce((s, f) => s + f.sugerido, 0)
  const totalPesos = items.reduce((s, f) => s + (f.precio ?? 0) * f.sugerido, 0)
  const esExtra = (i: ItemPropuesta) => i.vendido === 0 && extras.has(`${i.art}|${i.color}`)

  // Surtido filtrado: todas las posturas con stock en MITO y si el local las tiene
  const surtido = useMemo(() => posturas.filter(pasaFiltro), [posturas, pasaFiltro])
  const faltan = useMemo(() => surtido.filter((p) => p.stockCli <= 0), [surtido])
  const surtidoVisible = useMemo(() => {
    const list = soloFaltan ? faltan : surtido
    return [...list].sort((a, b) => Number(a.stockCli > 0) - Number(b.stockCli > 0) || b.stock - a.stock || a.art.localeCompare(b.art))
  }, [surtido, faltan, soloFaltan])

  function alternarMarca(k: string) {
    setMarcadas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  function sumarMarcadas() {
    setExtras((e) => {
      const n = new Map(e)
      for (const p of faltan) { const k = `${p.art}|${p.color}`; if (marcadas.has(k)) n.set(k, p) }
      return n
    })
    setMarcadas(new Set())
  }
  function quitarExtra(k: string) {
    setExtras((e) => { const n = new Map(e); n.delete(k); return n })
  }

  function alternarMat(m: string) {
    setSelMats((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })
  }

  return (
    <Layout>
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <FranquiciasHeader
          titulo="Propuesta de reposición"
          descripcion="Armá la propuesta con la sugerencia del período, mandale el link al cliente y seguí la respuesta."
        />

        <div className="overflow-hidden rounded-2xl border border-line bg-paper p-3">
          <div className="mb-3 mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Preparar propuesta</h2>
              <p className="text-sm text-sub">El cliente elige qué quiere y confirma desde el link. El envío sigue siendo manual por WhatsApp.</p>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-sub">
                Cliente
                <select
                  value={clienteSel}
                  onChange={(e) => setClienteSel(e.target.value)}
                  disabled={disponibles.length === 0}
                  className="max-w-[280px] rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
                >
                  {disponibles.length === 0 && <option value="">Sin clientes con base</option>}
                  {disponibles.map((c) => (
                    <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.razonSocial}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-sub">
                Desde
                <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              <label className="flex items-center gap-2 text-xs text-sub">
                Hasta
                <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              {franq && (
                <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-amber-500" style={{ borderColor: 'rgba(217,119,6,.45)', background: 'rgba(217,119,6,.15)' }}>
                  {franq.nombre.toUpperCase()} · {franq.base}
                </span>
              )}
            </div>
          </div>

          {cargandoMapa && (
            <p className="mb-3 flex items-center gap-2 text-sm text-sub"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando clientes y bases…</p>
          )}
          {!cargandoMapa && !franq && (
            <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
              No hay ningún cliente con base asignada. Configurala en <Link to="/sistemas/franquicias" className="font-semibold underline">Sistemas → Franquicias</Link>.
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
              No se pudieron traer los datos: {error}
            </p>
          )}

          {franq && (
            <>
              <div className="mb-3 grid gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-line bg-surface px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sub">Artículos</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{cargando ? '…' : fmt(items.length)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sub">Unidades</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-500">{cargando ? '…' : fmt(totalSug)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sub">Importe</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{cargandoPrecios ? '…' : fmtPesos(totalPesos)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-sub">WhatsApp</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-ink">{franq.telefono ? `+${franq.telefono}` : 'Sin teléfono'}</p>
                  {!franq.telefono && <Link to="/sistemas/franquicias" className="text-[10px] font-semibold text-brand-400 hover:underline">Configurar en Sistemas</Link>}
                </div>
              </div>

              {materiales.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-sub">Material</span>
                  <button
                    onClick={() => setSelMats(new Set())}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${selMats.size === 0 ? 'border-line2 bg-surface2 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}
                  >
                    Todos
                  </button>
                  {materiales.map((m) => (
                    <button
                      key={m}
                      onClick={() => alternarMat(m)}
                      aria-pressed={selMats.has(m)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${selMats.has(m) ? 'border-amber-500/50 bg-amber-500/15 text-amber-400' : 'border-line bg-surface text-sub hover:text-ink'}`}
                    >
                      {etiquetaMat(m)}
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Grupo" className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
                  <option value="">Todos los grupos</option>
                  {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                {temporadas.length > 1 && (
                  <select value={temporada} onChange={(e) => setTemporada(e.target.value)} aria-label="Temporada" className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
                    <option value="">Todas las temporadas</option>
                    {temporadas.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink sm:max-w-xs">
                  <Search size={13} className="text-sub" aria-hidden />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Artículo, descripción o color" className="w-full bg-transparent outline-none placeholder:text-sub" />
                </label>
                {hayFiltro && (
                  <button onClick={() => { setSelMats(new Set()); setGrupo(''); setTemporada(''); setBusca('') }} className="text-xs font-semibold text-brand-400 hover:underline">Limpiar filtros</button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-line">
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr>
                        <th className={`text-left ${th}`}>Artículo</th>
                        <th className={`text-left ${th}`}>Descripción</th>
                        <th className={`text-center ${th}`}>Color / talle</th>
                        <th className={`text-center ${th}`}>Vendido</th>
                        <th className={`text-center ${th}`}>Stock cliente</th>
                        <th className={`text-center ${th}`}>Stock MITO</th>
                        <th className={`text-center ${th}`} title="Stock de Polo 52: completa lo que MITO no cubre y se carga como transferencia Polo → MITO">Stock Polo</th>
                        <th className={`text-center ${th}`}>Sugerido</th>
                        <th className={`text-right ${th}`}>Precio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && (
                        <tr><td colSpan={9} className="px-3 py-8 text-center text-sub"><Loader2 size={15} className="mr-2 inline animate-spin" aria-hidden />Trayendo la sugerencia…</td></tr>
                      )}
                      {!cargando && items.length === 0 && (
                        <tr><td colSpan={9} className="px-3 py-8 text-center text-sub">No hay artículos para proponer en ese rango.</td></tr>
                      )}
                      {!cargando && items.slice(0, 20).map((f) => (
                        <tr key={`${f.art}|${f.color}|${f.talle}`} className="border-t border-line/60">
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink">
                            {f.art}
                            {esExtra(f) && (
                              <button onClick={() => quitarExtra(`${f.art}|${f.color}`)} title="Sacar esta postura de la propuesta" className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                                Faltaba en el local <X size={10} aria-hidden />
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-sub">{f.descrip || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-center text-sub">{f.color || 'U'} / {f.talle || '—'}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-ink">{fmt(f.vendido)}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-sky-400">{fmt(f.stockCli)}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-sub">{fmt(f.stock)}</td>
                          <td className={`px-3 py-1.5 text-center tabular-nums ${f.stockPolo ? 'text-violet-400' : 'text-sub'}`}>{f.stockPolo ? fmt(f.stockPolo) : '—'}</td>
                          <td className="px-3 py-1.5 text-center font-bold tabular-nums text-emerald-500">
                            {fmt(f.sugerido)}
                            {f.sugerido > Math.max(0, f.stock) && <span className="block text-[10px] font-semibold text-violet-400">{fmt(f.sugerido - Math.max(0, f.stock))} de Polo</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-sub">{f.precio ? fmtPesos(f.precio) : cargandoPrecios ? '…' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface">
                      <tr>
                        <td colSpan={7} className="px-3 py-2 text-xs font-semibold text-ink">{fmt(items.length)} artículos{extras.size > 0 ? ` (incluye ${fmt(extras.size)} posturas que faltaban)` : ''} · {items.length > 20 ? `se muestran los primeros 20` : 'todo lo sugerido'}</td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums text-emerald-500">{fmt(totalSug)}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-ink">{cargandoPrecios ? '…' : fmtPesos(totalPesos)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-sub">
                La propuesta se arma con estos artículos. Si querés ajustar el período, cambiá Desde/Hasta antes de mandarla. Venta del {fmtDia(desde)} al {fmtDia(hasta)}.
              </p>

              <SeccionSurtido
                cargando={cargando}
                hayFiltro={hayFiltro}
                total={surtido.length}
                faltan={faltan.length}
                visibles={surtidoVisible}
                soloFaltan={soloFaltan}
                setSoloFaltan={setSoloFaltan}
                marcadas={marcadas}
                alternarMarca={alternarMarca}
                marcarTodas={() => setMarcadas(new Set(faltan.filter((p) => !extras.has(`${p.art}|${p.color}`)).map((p) => `${p.art}|${p.color}`)))}
                limpiarMarcas={() => setMarcadas(new Set())}
                sumarMarcadas={sumarMarcadas}
                extras={extras}
                nombre={franq.nombre}
              />

              <FranquiciaPropuestas
                franquicia={franq.id}
                nombre={franq.nombre}
                desde={desde}
                hasta={hasta}
                cliente={{ id: franq.clienteId, nombre: franq.clienteNombre }}
                telefono={franq.telefono}
                listo={!cargando && !cargandoPrecios && !error}
                items={items}
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}

const MAX_SURTIDO = 300

/** ¿El local tiene todas las posturas? Lista artículo + color con stock en MITO y marca las que faltan. */
function SeccionSurtido({
  cargando, hayFiltro, total, faltan, visibles, soloFaltan, setSoloFaltan,
  marcadas, alternarMarca, marcarTodas, limpiarMarcas, sumarMarcadas, extras, nombre,
}: {
  cargando: boolean
  hayFiltro: boolean
  total: number
  faltan: number
  visibles: Postura[]
  soloFaltan: boolean
  setSoloFaltan: (v: boolean) => void
  marcadas: Set<string>
  alternarMarca: (k: string) => void
  marcarTodas: () => void
  limpiarMarcas: () => void
  sumarMarcadas: () => void
  extras: Map<string, Postura>
  nombre: string
}) {
  const tiene = total - faltan
  const pct = total ? Math.round((tiene / total) * 100) : 0
  return (
    <section className="mt-5 rounded-xl border border-line bg-surface/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-ink">Surtido: ¿tiene todas las posturas?</h3>
          <p className="text-xs text-sub">Cada artículo + color con stock en MITO que entra en los filtros de arriba (por ejemplo, material MOCHILAS), contra el stock de {nombre}.</p>
        </div>
        {hayFiltro && !cargando && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-400">Tiene {fmt(tiene)} de {fmt(total)} ({pct}%)</span>
            <span className={`rounded-full border px-2.5 py-1 font-semibold ${faltan ? 'border-rose-500/40 bg-rose-500/10 text-rose-400' : 'border-line bg-surface text-sub'}`}>Faltan {fmt(faltan)}</span>
            <label className="flex items-center gap-1.5 text-sub">
              <input type="checkbox" checked={soloFaltan} onChange={(e) => setSoloFaltan(e.target.checked)} /> Solo las que faltan
            </label>
          </div>
        )}
      </div>

      {cargando && <p className="py-4 text-center text-sm text-sub"><Loader2 size={14} className="mr-2 inline animate-spin" aria-hidden />Trayendo el surtido…</p>}
      {!cargando && !hayFiltro && (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-sub">Elegí un material, grupo o temporada (o buscá un artículo) para ver qué posturas tiene y cuáles le faltan.</p>
      )}
      {!cargando && hayFiltro && (
        <>
          {faltan > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <button onClick={marcarTodas} className="rounded-full border border-line2 bg-surface px-2.5 py-1 font-semibold text-ink">Marcar todas las que faltan</button>
              {marcadas.size > 0 && <button onClick={limpiarMarcas} className="font-semibold text-sub hover:text-ink">Desmarcar</button>}
              <button
                onClick={sumarMarcadas}
                disabled={marcadas.size === 0}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 font-semibold text-white disabled:opacity-40"
              >
                <Plus size={13} aria-hidden /> Sumar {marcadas.size || ''} a la propuesta (1 por talle)
              </button>
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className={`w-8 ${th}`}><span className="sr-only">Marcar</span></th>
                    <th className={`text-left ${th}`}>Artículo</th>
                    <th className={`text-left ${th}`}>Descripción</th>
                    <th className={`text-center ${th}`}>Color</th>
                    <th className={`text-left ${th}`}>Grupo</th>
                    <th className={`text-center ${th}`}>Stock cliente</th>
                    <th className={`text-center ${th}`}>Stock MITO</th>
                    <th className={`text-center ${th}`}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-sub">{total === 0 ? 'No hay posturas con stock en MITO con esos filtros.' : 'Tiene todas las posturas con stock en MITO.'}</td></tr>
                  )}
                  {visibles.slice(0, MAX_SURTIDO).map((p) => {
                    const k = `${p.art}|${p.color}`
                    const falta = p.stockCli <= 0
                    const sumada = extras.has(k)
                    return (
                      <tr key={k} className={`border-t border-line/60 ${falta ? 'bg-rose-500/[.04]' : ''}`}>
                        <td className="px-2 py-1.5 text-center">
                          {falta && !sumada && <input type="checkbox" checked={marcadas.has(k)} onChange={() => alternarMarca(k)} aria-label={`Marcar ${p.art} ${p.color}`} />}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink">{p.art}</td>
                        <td className="px-3 py-1.5 text-sub">{p.descrip || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-center text-sub">{p.color || 'U'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-sub">{p.grupo || '—'}</td>
                        <td className={`px-3 py-1.5 text-center tabular-nums ${falta ? 'font-bold text-rose-400' : 'text-sky-400'}`}>{fmt(p.stockCli)}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums text-sub">{fmt(p.stock)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-center">
                          {sumada
                            ? <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-400">En la propuesta</span>
                            : falta
                              ? <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-rose-400">Falta</span>
                              : <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold text-sub">Tiene</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {visibles.length > MAX_SURTIDO && <p className="mt-1 text-[11px] text-sub">Se muestran {fmt(MAX_SURTIDO)} de {fmt(visibles.length)}: afiná los filtros para ver el resto.</p>}
        </>
      )}
    </section>
  )
}
