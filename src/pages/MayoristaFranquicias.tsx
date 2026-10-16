import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
// Va dentro del bundle: un fetch a /src/... solo anda en desarrollo (publicado devuelve index.html)
import datos from '@/data/franquicias-repo.json'
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

export default function MayoristaFranquicias() {
  const [filas, setFilas] = useState<Fila[]>([])
  const [materiales, setMateriales] = useState<string[]>([])
  const [selMat, setSelMat] = useState('')
  const [desde, setDesde] = useState('2026-09-16')
  const [hasta, setHasta] = useState('2026-10-15')

  useEffect(() => {
    const d = datos as { filas?: Fila[]; materiales?: string[]; desde?: string; hasta?: string }
    setFilas(d.filas || [])
    setMateriales(d.materiales || [])
    if (d.desde) setDesde(d.desde)
    if (d.hasta) setHasta(d.hasta)
  }, [])

  const filtrar = () => {
    let list = [...filas].filter((f) => f.stock > 0 && f.sugerido > 0)
    if (selMat) list = list.filter((f) => f.material === selMat)
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

  const enviarWhatsApp = () => {
    const list = filtrar().slice(0, 40)
    const rango = `${desde.slice(8,10)}/${desde.slice(5,7)}/${desde.slice(0,4)} al ${hasta.slice(8,10)}/${hasta.slice(5,7)}/${hasta.slice(0,4)}`
    let msg = `REPOSICIÓN SUGERIDA - CF USHUAIA (${rango})\nArtículos para reponer (solo con stock en MITO)${selMat ? ' - Material: ' + selMat : ''}:\n\n`
    list.forEach((f, i) => {
      msg += `${i + 1}. ${f.art} ${(f.color || 'U')}/${f.talle || '-'} | Vend:${f.vendido} | Stock MITO:${f.stock} | Stock CFU:${f.stockCli || 0} | Sug.reposición:${f.sugerido} | Estado:${f.stock <= 0 ? 'Urgente' : 'Normal'} | Mat:${f.material} | ${f.descrip || ''}\n`
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
        const opt = { margin: 0.5, filename: 'reposicion-sugerida-cf-ushuaia.pdf', html2canvas: { scale: 1.6, backgroundColor: '#050508' }, jsPDF: { unit: 'cm', format: 'a4', orientation: 'landscape' } as any }
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
    const header = ['Artículo', 'Descripción', 'Material', 'Color', 'Talle', 'Vendido', 'Stock MITO', 'Stock cliente', 'Sugerencia reposición', 'Estado']
    const rows = list.map((f) => [f.art, f.descrip || '', f.material || '', f.color || 'U', f.talle || '', String(f.vendido), String(f.stock), String(f.stockCli), String(f.sugerido), f.stock <= 0 ? 'Urgente' : (f.stock < f.vendido ? 'Normal' : 'Normal')])
    const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reposicion-sugerida-cf-ushuaia.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
              <p className="truncate text-sm text-sub">CF Ushuaia · venta del {desde.slice(8,10)}/{desde.slice(5,7)}/{desde.slice(0,4)} al {hasta.slice(8,10)}/{hasta.slice(5,7)}/{hasta.slice(0,4)} · contra el stock real de MITO</p>
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-sub">
                Desde
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              <label className="flex items-center gap-2 text-xs text-sub">
                Hasta
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink" />
              </label>
              <label className="flex items-center gap-2 text-xs text-sub">
                Material
                <select id="selMat" value={selMat} onChange={(e) => setSelMat(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink">
                  <option value="">Todos</option>
                  {materiales.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-amber-500" style={{ borderColor: 'rgba(217,119,6,.45)', background: 'rgba(217,119,6,.15)' }}>CF USHUAIA</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[640px] overflow-auto">
              <table className="t w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className="w-10 whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-sub">#</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-sub">Artículo</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-sub">Descripción</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] uppercase tracking-wide text-sub">Material</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Color</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Talle</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Vendido</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Stock MITO</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Stock cliente</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Sugerencia reposición</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center text-[11px] uppercase tracking-wide text-sub">Estado</th>
                  </tr>
                </thead>
                <tbody>
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
                        <td className="px-3 py-2 text-center tabular-nums text-ink">{fmt(f.vendido)}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stock <= 0 ? 'font-semibold text-red-400' : 'text-sub'}`}>{fmt(f.stock)}</td>
                        <td className={`px-3 py-2 text-center tabular-nums ${f.stockCli === 0 ? 'text-sub' : 'text-sky-400'}`}>{f.stockCli > 0 ? fmt(f.stockCli) : (f.stockCli === 0 ? '0' : '—')}</td>
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
                    <td colSpan={7} className="px-3 py-2 font-semibold text-ink">{fmt(count)} SKU a reponer (con stock en MITO)</td>
                    <td className="px-3 py-2 text-center font-bold text-sub">—</td>
                    <td className="px-3 py-2 text-center font-bold text-sub">—</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums text-emerald-500">{fmt(totalSug)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-sub">Solo se muestran los SKU con <b className="text-ink">stock en MITO &gt; 0</b> y sugerido &gt; 0. Ordenados: <b>Urgente</b> primero, luego <b>Normal</b>.</p>
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
