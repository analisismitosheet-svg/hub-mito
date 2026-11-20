import { useLayoutEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Fila } from '@/lib/reparto'

/**
 * Doble clic en el color: «Stock y venta x local» del artículo + color (todos los talles), como el
 * tablero de Power BI. Barras amarillas = stock + tránsito (de la foto, antes de repartir), verdes =
 * venta del período. Ordenado por venta. Panel chico encima de la columna Descripción, del mismo
 * alto que la tabla, sin scroll adentro; se cierra SOLO con la cruz y no tapa la grilla.
 */
export default function GraficoStockVenta({
  art,
  col,
  filas,
  locales,
  desde,
  hasta,
  onCerrar,
}: {
  art: string
  col: string
  filas: Fila[]
  locales: string[]
  desde: string
  hasta: string
  onCerrar: () => void
}) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const ubicar = () => {
      const th = document.querySelector('.rp-tabla thead tr.rp-head th.rp-c1') as HTMLElement | null
      const wrap = document.querySelector('.rp-wrap') as HTMLElement | null
      if (!th || !wrap) return
      const c = th.getBoundingClientRect(), t = wrap.getBoundingClientRect()
      // Mismo alto que la parte visible de la tabla, pero nunca menos de lo que hace falta para leer
      // los 20 locales: si la tabla está casi fuera de la pantalla, el panel se corre para arriba.
      const MIN = Math.min(window.innerHeight - 8, 460)
      let top = Math.max(4, t.top)
      const bot = Math.min(window.innerHeight - 4, t.bottom)
      let height = bot - top
      if (height < MIN) {
        height = MIN
        top = Math.max(4, Math.min(top, window.innerHeight - 4 - MIN))
      }
      setPos({ left: Math.max(4, c.left), width: Math.max(150, c.width), top, height })
    }
    ubicar()
    window.addEventListener('resize', ubicar)
    window.addEventListener('scroll', ubicar, true)
    // la tabla cambia de lugar/tamaño sin scroll (pantalla completa, carteles que aparecen)
    const wrapEl = document.querySelector('.rp-wrap')
    const ro = new ResizeObserver(() => requestAnimationFrame(ubicar))
    if (wrapEl) ro.observe(wrapEl)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('resize', ubicar)
      window.removeEventListener('scroll', ubicar, true)
      ro.disconnect()
    }
  }, [art, col])

  const mias = filas.filter((f) => f.articulo === art && f.color === col)
  if (!mias.length) return null
  const datos = locales
    .map((loc, i) => ({
      loc,
      stock: mias.reduce((x, f) => x + (f.base[i] || 0) + (f.trans[i] || 0), 0),
      venta: mias.reduce((x, f) => x + (f.vend[i] || 0), 0),
      rep: mias.reduce((x, f) => x + (f.cur[i] || 0) - (f.base[i] || 0), 0),
    }))
    .sort((a, b) => b.venta - a.venta || b.stock - a.stock || a.loc.localeCompare(b.loc))
  const max = Math.max(1, ...datos.map((d) => Math.max(d.stock, d.venta)))
  const nombre = mias[0].nombre
  const fecha = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line2 shadow-soft-lg"
      style={{ ...(pos ?? { left: 8, top: 8, width: 170, height: 400 }), background: 'var(--surface-solid)' }}
      role="dialog"
      aria-label={`Stock y venta por local de ${art} color ${col}`}
    >
      <div className="flex items-start justify-between gap-1 px-2 pb-1 pt-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-base font-extrabold leading-tight text-ink">
            {art} <span className="text-sm text-orange-300">Color {col}</span>
          </p>
          <p className="mt-0.5 text-[13px] font-bold leading-tight text-ink">{nombre}</p>
          <p className="mt-0.5 text-[10px] text-sub">Venta {fecha(desde)} al {fecha(hasta)}</p>
        </div>
        <button onClick={onCerrar} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Cerrar" title="Cerrar">
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap gap-x-2 px-2 pb-1 text-[9.5px] text-sub">
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />Stock+tránsito</span>
        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />Venta</span>
        <span>· por venta</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-1">
        {datos.map((d) => (
          <div key={d.loc} className="grid min-h-0 flex-1 grid-cols-[auto_1fr] items-center gap-1.5 border-b border-dashed border-line">
            <div className="w-12 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[9.5px] font-semibold text-ink">
              {d.loc}
              {d.rep ? <span className="block text-[8.5px] font-normal text-violet-300">{d.rep > 0 ? '+' : ''}{d.rep} rep.</span> : null}
            </div>
            <div className="flex flex-col justify-center gap-px">
              <div className="flex items-center leading-none">
                <span className="rounded-sm bg-yellow-400" style={{ width: `${(d.stock / max) * 80}%`, minWidth: 2, height: 'max(3px, min(8px, 1.1vh))' }} />
                <span className="ml-1 text-[9px] text-sub">{d.stock}</span>
              </div>
              <div className="flex items-center leading-none">
                <span className="rounded-sm bg-green-500" style={{ width: `${(d.venta / max) * 80}%`, minWidth: 2, height: 'max(3px, min(8px, 1.1vh))' }} />
                <span className="ml-1 text-[9px] text-sub">{d.venta}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-2 py-1 text-[9.5px] text-sub">
        Total: {datos.reduce((x, d) => x + d.stock, 0)} stock · {datos.reduce((x, d) => x + d.venta, 0)} venta
      </p>
    </div>
  )
}
