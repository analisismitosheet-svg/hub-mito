import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { leerVista, type FilaSql } from '@/lib/sqlApi'
import { cargarStockSku, claveSku, stockSkuDe, type StockSku } from '@/lib/stockSku'
// @ts-ignore
declare const html2pdf: any

type Fila = {
  art: string
  descrip: string
  color: string
  talle: string
  vendido: number
  stock: number
  stockCli: number
  sugerido: number
  material: string
}

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)

const estadoF = (f: Fila) => {
  if (f.stock <= 0) return { txt: 'Urgente', cls: 'text-red-500', dot: '#ef4444' }
  if (f.stock < f.vendido) return { txt: 'Normal', cls: 'text-amber-400', dot: '#fbbf24' }
  return { txt: 'Normal', cls: 'text-emerald-500', dot: '#34d399' }
}

/**
 * Franquicias registradas. Las ventas salen de la vista `venta_franquicias`
 * (hoy solo DRAGONFISH_CFU) y el stock del cliente de `vw_STOCK_SUCURSALES_REAL`
 * (columna BD_ORIGEN). El stock de MITO es el de `vw_STOCK_SKU_MITO`.
 * Para sumar otra franquicia: agregarla a las vistas y a esta lista.
 */
const FRANQUICIAS = [
  { id: 'CFU', nombre: 'CF Ushuaia', base: 'DRAGONFISH_CFU', origenStock: 'CAPTAIN FIN USHUAIA' },
]
const VISTA_VENTAS = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.venta_franquicias'
const VISTA_STOCK_SUC = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SUCURSALES_REAL'
const VISTA_MATERIALES = 'DWH.dbo.vw_DIM_MATERIAL'

const txt = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => Number(v) || 0
/** FFCH llega como fecha ISO (medianoche UTC): los primeros 10 caracteres son el día */
const diaDe = (v: unknown) => txt(v).slice(0, 10)
const isoLocal = (d: Date) => d.toLocaleDateString('sv-SE')
const haceDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d) }
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

interface Venta { dia: string; art: string; color: string; talle: string; cant: number; txt: string }

export default function MayoristaFranquicias() {
  const franq = FRANQUICIAS[0]
  const [ventas, setVentas] = useState<Venta[]>([])
  const [stockCli, setStockCli] = useState<Map<string, number>>(new Map())
  const [stockMito, setStockMito] = useState<StockSku | null>(null)
  const [articulos, setArticulos] = useState<Map<string, { descripcion: string; material: string }>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selMats, setSelMats] = useState<Set<string>>(new Set())
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(isoLocal(new Date()))

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [filasV, filasS, stock, filasM] = await Promise.all([
          leerVista(VISTA_VENTAS),
          leerVista(VISTA_STOCK_SUC),
          cargarStockSku(),
          leerVista(VISTA_MATERIALES).catch(() => [] as FilaSql[]),
        ])
        if (!activo) return

        // Ventas netas: facturas y tickets suman, notas de crédito restan; remitos y demás no cuentan
        const vs: Venta[] = []
        for (const f of filasV) {
          const tipo = txt(f.DESCFW).toUpperCase()
          const signo = /^(TICKET)?NOTADECREDITO/.test(tipo) ? -1 : /^(TICKET)?FACTURA/.test(tipo) ? 1 : 0
          if (!signo) continue
          vs.push({
            dia: diaDe(f.FFCH),
            art: txt(f.FART).toUpperCase(),
            color: txt(f.CCOLOR).toUpperCase(),
            talle: txt(f.TALLE).toUpperCase(),
            cant: signo * num(f.FCANT),
            txt: txt(f.FTXT),
          })
        }

        const sc = new Map<string, number>()
        for (const f of filasS) {
          if (txt(f.BD_ORIGEN).toUpperCase() !== franq.origenStock) continue
          const k = claveSku(f.ARTICULO, f.COLOR, f.TALLE)
          sc.set(k, (sc.get(k) ?? 0) + num(f.CANTIDAD_REAL))
        }

        // Descripción y material del maestro (copia en Supabase) + nombres de material del DWH
        const nombresMat = new Map(filasM.map((m) => [txt(m.ID_MATERIAL).toUpperCase(), txt(m.MATERIAL)]))
        const arts = [...new Set(vs.map((v) => v.art))]
        const info = new Map<string, { descripcion: string; material: string }>()
        for (let i = 0; supabase && i < arts.length; i += 300) {
          const { data } = await supabase.from('articulos').select('id_art,descripcion,id_material').in('id_art', arts.slice(i, i + 300))
          for (const a of (data as { id_art: string; descripcion: string | null; id_material: string | null }[] | null) ?? []) {
            const cod = txt(a.id_material).toUpperCase()
            info.set(txt(a.id_art).toUpperCase(), { descripcion: txt(a.descripcion), material: nombresMat.get(cod) || cod })
          }
        }
        if (!activo) return
        setVentas(vs)
        setStockCli(sc)
        setStockMito(stock)
        setArticulos(info)
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [franq.origenStock])

  // Una fila por SKU con lo vendido en el rango elegido
  const filas = useMemo<Fila[]>(() => {
    const porSku = new Map<string, Fila>()
    for (const v of ventas) {
      if (v.dia < desde || v.dia > hasta) continue
      const k = claveSku(v.art, v.color, v.talle)
      let f = porSku.get(k)
      if (!f) {
        const a = articulos.get(v.art)
        f = { art: v.art, descrip: a?.descripcion || v.txt, color: v.color, talle: v.talle, vendido: 0, stock: 0, stockCli: 0, sugerido: 0, material: a?.material || '' }
        porSku.set(k, f)
      }
      f.vendido += v.cant
    }
    for (const [k, f] of porSku) {
      f.stock = stockSkuDe(stockMito, f.art, f.color, f.talle) ?? 0
      f.stockCli = stockCli.get(k) ?? 0
      // Reponer lo vendido menos lo que el cliente todavía tiene, sin pasarse del stock de MITO
      f.sugerido = Math.max(0, Math.min(f.vendido - f.stockCli, f.stock))
    }
    return [...porSku.values()]
  }, [ventas, desde, hasta, articulos, stockMito, stockCli])

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
  const count = filtrar().length

  function alternarMat(m: string) {
    setSelMats((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })
  }

  const enviarWhatsApp = () => {
    const list = filtrar().slice(0, 40)
    const rango = `${fmtDia(desde)} al ${fmtDia(hasta)}`
    let msg = `REPOSICIÓN SUGERIDA - ${franq.nombre.toUpperCase()} (${rango})\nArtículos para reponer (solo con stock en MITO)${selMat ? ' - Material: ' + selMat : ''}:\n\n`
    list.forEach((f, i) => {
      msg += `${i + 1}. ${f.art} ${(f.color || 'U')}/${f.talle || '-'} | Base:${franq.base} | Stock ${franq.id}:${f.stockCli || 0} | Vend:${f.vendido} | Stock MITO:${f.stock} | Sug.reposición:${f.sugerido} | Estado:${f.stock <= 0 ? 'Urgente' : 'Normal'} | Mat:${f.material} | ${f.descrip || ''}\n`
    })
    if (list.length === 0) msg += '(Sin sugeridos con stock en MITO)\n'
    msg += `\nTotal sugerencia reposición: ${list.reduce((s, f) => s + f.sugerido, 0)}`
    try {
      const frame = document.querySelector('#frame') as HTMLElement | null
      if (frame) {
        const clone = frame.cloneNode(true) as HTMLElement
        const sel = clone.querySelector('#selMat') as HTMLElement | null
        if (sel) sel.style.display = 'none'
        clone.querySelectorAll('button').forEach((b) => ((b as HTMLElement).style.display = 'none'))
        const opt = { margin: 0.5, filename: `reposicion-sugerida-${franq.id.toLowerCase()}.pdf`, html2canvas: { scale: 1.6, backgroundColor: '#050508' }, jsPDF: { unit: 'cm', format: 'a4', orientation: 'landscape' } as any }
        const hpdf = (window as any).html2pdf || html2pdf
        hpdf().set(opt).from(clone).toPdf().output('blob').then((blob: Blob) => {
          const url = URL.createObjectURL(blob)
          window.open(url, '_blank')
          setTimeout(() => URL.revokeObjectURL(url), 120000)
        })
      }
    } catch (e) {}
    setTimeout(() => {
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')
    }, 800)
  }

  const exportExcel = () => {
    const list = filtrar()
    const header = ['Artículo', 'Descripción', 'Material', 'Color', 'Talle', 'Base', 'Stock cliente', 'Vendido', 'Stock MITO', 'Sugerencia reposición', 'Estado']
    const rows = list.map((f) => [f.art, f.descrip || '', f.material || '', f.color || 'U', f.talle || '', franq.base, String(f.stockCli), String(f.vendido), String(f.stock), String(f.sugerido), f.stock <= 0 ? 'Urgente' : 'Normal'])
    const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reposicion-sugerida-${franq.id.toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] uppercase tracking-wide text-sub'

  return (
    <Layout>
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton />
            <h1 className="font-display truncate text-lg font-semibold text-ink md:text-xl">Franquicias · Reposición sugerida</h1>
          </div>
        </div>

        <div id="frame" className="overflow-hidden rounded-2xl border border-line bg-paper p-3">
          <div className="mb-3 mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Reposición sugerida</h2>
              <p className="truncate text-sm text-sub">
                {franq.nombre} ({franq.base}) · venta del {fmtDia(desde)} al {fmtDia(hasta)} · contra el stock real de MITO
              </p>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-sub">
                Desde
                <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              <label className="flex items-center gap-2 text-xs text-sub">
                Hasta
                <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-amber-500" style={{ borderColor: 'rgba(217,119,6,.45)', background: 'rgba(217,119,6,.15)' }}>{franq.nombre.toUpperCase()}</span>
            </div>
          </div>

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
                    <th className={`text-left ${th}`}>Artículo</th>
                    <th className={`text-left ${th}`}>Descripción</th>
                    <th className={`text-left ${th}`}>Material</th>
                    <th className={`text-center ${th}`}>Color</th>
                    <th className={`text-center ${th}`}>Talle</th>
                    <th className={`text-left ${th}`}>Base</th>
                    <th className={`text-center ${th}`}>Stock cliente</th>
                    <th className={`text-center ${th}`}>Vendido</th>
                    <th className={`text-center ${th}`}>Stock MITO</th>
                    <th className={`text-center ${th}`}>Sugerencia reposición</th>
                    <th className={`text-center ${th}`}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center text-sub">
                        <Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />
                        Trayendo ventas y stock…
                      </td>
                    </tr>
                  )}
                  {!cargando && !error && visibles.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-10 text-center text-sub">No hay nada para reponer en ese rango.</td>
                    </tr>
                  )}
                  {visibles.map((f, i) => {
                    const e = estadoF(f)
                    return (
                      <tr key={`${f.art}|${f.color}|${f.talle}`} className="hover:bg-white/5">
                        <td className="whitespace-nowrap px-3 py-2 text-[11px] tabular-nums text-sub">{i + 1}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{f.art}</td>
                        <td className="px-3 py-2 text-sub">{f.descrip || '—'}</td>
                        <td className="px-3 py-2 text-sub">{f.material || '—'}</td>
                        <td className="px-3 py-2 text-center text-sub">{f.color || 'U'}</td>
                        <td className="px-3 py-2 text-center text-sub">{f.talle || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[11px] text-sub">{franq.base}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stockCli === 0 ? 'text-sub' : 'text-sky-400'}`}>{fmt(f.stockCli)}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-ink">{fmt(f.vendido)}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stock <= 0 ? 'font-semibold text-red-400' : 'text-sub'}`}>{fmt(f.stock)}</td>
                        <td className={`px-3 py-2 text-center font-bold tabular-nums ${f.sugerido > 0 ? 'text-emerald-500' : 'text-sub'}`}>{f.sugerido > 0 ? fmt(f.sugerido) : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${e.cls}`}>
                            <i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: e.dot }} />
                            {e.txt}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-surface">
                  <tr className="text-[12px]">
                    <td colSpan={10} className="px-3 py-2 font-semibold text-ink">{fmt(count)} SKU a reponer (con stock en MITO)</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums text-emerald-500">{fmt(totalSug)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-sub">
              Solo se muestran los SKU con <b className="text-ink">stock en MITO &gt; 0</b> y sugerido &gt; 0 (máximo 40). Sugerido = vendido − stock del cliente, sin pasar el stock de MITO.
            </p>
            <div className="flex gap-2">
              <button onClick={exportExcel} className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1 text-xs font-semibold text-ink">⬇ Excel</button>
              <button onClick={enviarWhatsApp} className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1 text-xs font-semibold text-ink">Enviar por WhatsApp</button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
