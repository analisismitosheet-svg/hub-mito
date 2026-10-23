import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Layout from '@/components/Layout'
import FranquiciasHeader from '@/components/FranquiciasHeader'
import FranquiciaPropuestas from '@/components/FranquiciaPropuestas'
import { useReposicionFranquicia } from '@/hooks/useReposicionFranquicia'

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const th = 'whitespace-nowrap px-3 py-2 text-[10.5px] uppercase tracking-wide text-sub'

export default function MayoristaFranquiciasPropuestas() {
  const {
    disponibles, franq, clienteSel, setClienteSel,
    desde, setDesde, hasta, setHasta,
    filas, cargando, cargandoPrecios, cargandoMapa, error,
  } = useReposicionFranquicia()

  const [selMats, setSelMats] = useState<Set<string>>(new Set())

  useEffect(() => { setSelMats(new Set()) }, [franq?.base])

  const materiales = useMemo(() => [...new Set(filas.map((f) => f.material).filter(Boolean))].sort(), [filas])

  const items = useMemo(() => {
    let list = filas.filter((f) => f.stock > 0 && f.sugerido > 0)
    if (selMats.size) list = list.filter((f) => selMats.has(f.material))
    list.sort((a, b) => b.vendido - a.vendido || b.sugerido - a.sugerido)
    return list
  }, [filas, selMats])

  const totalSug = items.reduce((s, f) => s + f.sugerido, 0)
  const totalPesos = items.reduce((s, f) => s + (f.precio ?? 0) * f.sugerido, 0)

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
                      {m}
                    </button>
                  ))}
                </div>
              )}

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
                        <th className={`text-center ${th}`}>Sugerido</th>
                        <th className={`text-right ${th}`}>Precio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-sub"><Loader2 size={15} className="mr-2 inline animate-spin" aria-hidden />Trayendo la sugerencia…</td></tr>
                      )}
                      {!cargando && items.length === 0 && (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-sub">No hay artículos para proponer en ese rango.</td></tr>
                      )}
                      {!cargando && items.slice(0, 20).map((f) => (
                        <tr key={`${f.art}|${f.color}|${f.talle}`} className="border-t border-line/60">
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink">{f.art}</td>
                          <td className="px-3 py-1.5 text-sub">{f.descrip || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-center text-sub">{f.color || 'U'} / {f.talle || '—'}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-ink">{fmt(f.vendido)}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-sky-400">{fmt(f.stockCli)}</td>
                          <td className="px-3 py-1.5 text-center tabular-nums text-sub">{fmt(f.stock)}</td>
                          <td className="px-3 py-1.5 text-center font-bold tabular-nums text-emerald-500">{fmt(f.sugerido)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-sub">{f.precio ? fmtPesos(f.precio) : cargandoPrecios ? '…' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-surface">
                      <tr>
                        <td colSpan={6} className="px-3 py-2 text-xs font-semibold text-ink">{fmt(items.length)} artículos · {items.length > 20 ? `se muestran los primeros 20` : 'todo lo sugerido'}</td>
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

              <FranquiciaPropuestas
                franquicia={franq.id}
                nombre={franq.nombre}
                desde={desde}
                hasta={hasta}
                cliente={{ id: franq.clienteId, nombre: franq.clienteNombre }}
                telefono={franq.telefono}
                listo={!cargando && !cargandoPrecios && !error}
                items={items.map((f) => ({
                  art: f.art, descrip: f.descrip, material: f.material, color: f.color, talle: f.talle,
                  stockCli: f.stockCli, vendido: f.vendido, stock: f.stock, sugerido: f.sugerido, precio: f.precio,
                }))}
              />
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}
