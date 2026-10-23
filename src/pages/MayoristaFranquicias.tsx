import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import Layout from '@/components/Layout'
import FranquiciasHeader from '@/components/FranquiciasHeader'
import FotoArticulo from '@/components/FotoArticulo'
import { normalizarTelefono } from '@/lib/informes'
import { useReposicionFranquicia, type FilaReposicion } from '@/hooks/useReposicionFranquicia'

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

/** Urgente: el cliente no tiene nada, vendió y en MITO hay más de 1 para reponer. */
const esUrgente = (f: FilaReposicion) => f.stockCli <= 0 && f.vendido >= 1 && f.stock > 1

const estadoF = (f: FilaReposicion) => {
  if (esUrgente(f)) return { txt: 'Urgente', cls: 'text-red-500', dot: '#ef4444' }
  if (f.stock < f.vendido) return { txt: 'Normal', cls: 'text-amber-400', dot: '#fbbf24' }
  return { txt: 'Normal', cls: 'text-emerald-500', dot: '#34d399' }
}

const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default function MayoristaFranquicias() {
  const {
    disponibles, franq, clienteSel, setClienteSel,
    desde, setDesde, hasta, setHasta,
    filas, cargando, cargandoPrecios, cargandoMapa, error,
  } = useReposicionFranquicia()

  const [selMats, setSelMats] = useState<Set<string>>(new Set())

  useEffect(() => { setSelMats(new Set()) }, [franq?.base])

  const materiales = useMemo(() => [...new Set(filas.map((f) => f.material).filter(Boolean))].sort(), [filas])
  const selMat = [...selMats].join(', ')

  const filtrar = () => {
    let list = filas.filter((f) => f.stock > 0 && f.sugerido > 0)
    if (selMats.size) list = list.filter((f) => selMats.has(f.material))
    list.sort((a, b) => {
      const urgA = a.stock <= 0 ? 1 : a.stock < a.vendido ? 0 : -1
      const urgB = b.stock <= 0 ? 1 : b.stock < b.vendido ? 0 : -1
      return urgB - urgA || b.vendido - a.vendido || b.sugerido - a.sugerido
    })
    return list
  }

  const visibles = filtrar().slice(0, 40)
  const totalSug = filtrar().reduce((s, f) => s + f.sugerido, 0)
  const subtotal = (f: FilaReposicion) => (f.precio ? f.precio * f.sugerido : 0)
  const totalPesos = filtrar().reduce((s, f) => s + subtotal(f), 0)
  const count = filtrar().length

  function alternarMat(m: string) {
    setSelMats((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })
  }

  const enviarWhatsApp = () => {
    if (!franq) return
    const list = filtrar().slice(0, 40)
    const rango = `${fmtDia(desde)} al ${fmtDia(hasta)}`
    let msg = `REPOSICIÓN DIARIA - ${franq.nombre.toUpperCase()} · ${franq.clienteNombre} (${rango})\nArtículos para reponer (solo con stock en MITO)${selMat ? ' - Material: ' + selMat : ''}:\n\n`
    list.forEach((f, i) => {
      msg += `${i + 1}. ${f.art} ${(f.color || 'U')}/${f.talle || '-'} | Stock ${franq.id}:${f.stockCli || 0} | Vend:${f.vendido} | Stock MITO:${f.stock} | Sug.reposición:${f.sugerido} | Precio:${f.precio ? fmtPesos(f.precio) : '-'} | Subtotal:${fmtPesos(subtotal(f))} | Estado:${esUrgente(f) ? 'Urgente' : 'Normal'} | Mat:${f.material} | ${f.descrip || ''}\n`
    })
    if (list.length === 0) msg += '(Sin sugeridos con stock en MITO)\n'
    msg += `\nTotal sugerencia reposición: ${list.reduce((s, f) => s + f.sugerido, 0)} u. · Total: ${fmtPesos(list.reduce((s, f) => s + subtotal(f), 0))}`
    const tel = franq.telefono ? normalizarTelefono(franq.telefono) : ''
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const exportExcel = () => {
    if (!franq) return
    const list = filtrar()
    const header = ['Artículo', 'Descripción', 'Material', 'Color', 'Talle', 'Stock cliente', 'Vendido', 'Stock MITO', 'Sugerencia reposición', 'Precio', 'Subtotal', 'Estado']
    const rows = list.map((f) => [f.art, f.descrip || '', f.material || '', f.color || 'U', f.talle || '', String(f.stockCli), String(f.vendido), String(f.stock), String(f.sugerido), f.precio ? String(f.precio) : '', String(subtotal(f)), esUrgente(f) ? 'Urgente' : 'Normal'])
    rows.push(['', 'TOTAL', '', '', '', '', '', '', String(list.reduce((s, f) => s + f.sugerido, 0)), '', String(list.reduce((s, f) => s + subtotal(f), 0)), ''])
    const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reposicion-diaria-${franq.id.toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] uppercase tracking-wide text-sub'
  const propuestaHref = `/mayorista/franquicias/propuestas?${new URLSearchParams({ cliente: clienteSel, desde, hasta }).toString()}`

  return (
    <Layout>
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <FranquiciasHeader
          titulo="Reposición diaria"
          descripcion="Qué reponerle a cada franquicia según lo que vendió y el stock real de MITO."
        />

        <div id="frame" className="overflow-hidden rounded-2xl border border-line bg-paper p-3">
          <div className="mb-3 mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Sugerencia del día</h2>
              <p className="truncate text-sm text-sub">
                {franq?.nombre ?? 'Sin cliente'} · venta del {fmtDia(desde)} al {fmtDia(hasta)} · contra el stock real de MITO
              </p>
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
              {franq?.telefono && (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                  WhatsApp · +{franq.telefono}
                </span>
              )}
            </div>
          </div>

          {cargandoMapa && (
            <p className="mb-3 flex items-center gap-2 text-sm text-sub"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando clientes y bases…</p>
          )}
          {!cargandoMapa && !franq && (
            <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
              No hay ningún cliente con base asignada. Configurala en <Link to="/sistemas/franquicias" className="font-semibold underline">Sistemas → Franquicias</Link> para poder traer sus ventas y su stock.
            </p>
          )}

          {materiales.length > 0 && (
            <div id="selMat" className="mb-3 flex flex-wrap items-center gap-1.5">
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
                  {m}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
              No se pudieron traer los datos: {error}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[640px] overflow-auto">
              <table className="t w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className={`w-10 text-left ${th}`}>#</th>
                    <th className={`text-left ${th}`}>Foto</th>
                    <th className={`text-left ${th}`}>Artículo</th>
                    <th className={`text-center ${th}`}>Estado</th>
                    <th className={`text-left ${th}`}>Descripción</th>
                    <th className={`text-left ${th}`}>Material</th>
                    <th className={`text-center ${th}`}>Color</th>
                    <th className={`text-center ${th}`}>Talle</th>
                    <th className={`text-center ${th}`}>Stock cliente</th>
                    <th className={`text-center ${th}`}>Vendido</th>
                    <th className={`text-center ${th}`}>Stock MITO</th>
                    <th className={`text-center ${th}`}>Sugerencia reposición</th>
                    <th className={`text-right ${th}`}>Precio</th>
                    <th className={`text-right ${th}`}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan={14} className="px-3 py-10 text-center text-sub">
                        <Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />
                        Trayendo ventas y stock…
                      </td>
                    </tr>
                  )}
                  {!cargando && !error && visibles.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-3 py-10 text-center text-sub">No hay nada para reponer en ese rango.</td>
                    </tr>
                  )}
                  {visibles.map((f, i) => {
                    const e = estadoF(f)
                    return (
                      <tr key={`${f.art}|${f.color}|${f.talle}`} className="hover:bg-white/5">
                        <td className="whitespace-nowrap px-3 py-2 text-[11px] tabular-nums text-sub">{i + 1}</td>
                        <td className="px-3 py-1.5"><FotoArticulo codigo={f.art} nombre={f.descrip} size={40} /></td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{f.art}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${e.cls}`}>
                            <i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: e.dot }} />
                            {e.txt}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sub">{f.descrip || '—'}</td>
                        <td className="px-3 py-2 text-sub">{f.material || '—'}</td>
                        <td className="px-3 py-2 text-center text-sub">{f.color || 'U'}</td>
                        <td className="px-3 py-2 text-center text-sub">{f.talle || '—'}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stockCli === 0 ? 'text-sub' : 'text-sky-400'}`}>{fmt(f.stockCli)}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-ink">{fmt(f.vendido)}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stock <= 0 ? 'font-semibold text-red-400' : 'text-sub'}`}>{fmt(f.stock)}</td>
                        <td className={`px-3 py-2 text-center font-bold tabular-nums ${f.sugerido > 0 ? 'text-emerald-500' : 'text-sub'}`}>{f.sugerido > 0 ? fmt(f.sugerido) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sub">{f.precio ? fmtPesos(f.precio) : cargandoPrecios ? '…' : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-ink">{f.precio ? fmtPesos(subtotal(f)) : cargandoPrecios ? '…' : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-surface">
                  <tr className="text-[12px]">
                    <td colSpan={10} className="px-3 py-2 font-semibold text-ink">{fmt(count)} SKU a reponer (con stock en MITO)</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums text-emerald-500">{fmt(totalSug)}</td>
                    <td className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-sub">Total</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm font-bold tabular-nums text-emerald-500">{cargandoPrecios ? '…' : fmtPesos(totalPesos)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-sub">
              Solo se muestran los SKU con <b className="text-ink">stock en MITO &gt; 0</b> y sugerido &gt; 0 (máximo 40). Sugerido = vendido − stock del cliente, sin pasar el stock de MITO.
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportExcel} className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1 text-xs font-semibold text-ink">⬇ Excel</button>
              <button onClick={enviarWhatsApp} className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1 text-xs font-semibold text-ink" title={franq?.telefono ? 'Abre el WhatsApp configurado del cliente' : 'Abre tu WhatsApp con la lista en texto'}>Compartir por WhatsApp</button>
              <Link to={propuestaHref} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-500">
                Armar propuesta
                <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
