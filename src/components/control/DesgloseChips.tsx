import { compararTalles } from '@/lib/ordenPiso'
import type { Desglose } from '@/lib/controlFisico'

/** Lo que cargó el operario en un renglón 00/U: un chip por color con sus talles. */
export default function DesgloseChips({ desglose }: { desglose: Desglose[] }) {
  const porColor = new Map<string, { desc: string | null; items: Desglose[] }>()
  for (const d of desglose) {
    const g = porColor.get(d.color) ?? { desc: d.color_desc ?? null, items: [] }
    g.items.push(d)
    porColor.set(d.color, g)
  }
  const colores = [...porColor.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
  if (!colores.length) return <span className="text-xs text-sub">Sin unidades (no llegó nada)</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {colores.map(([color, g]) => {
        const items = [...g.items].sort((a, b) => compararTalles(a.talle, b.talle))
        const tot = items.reduce((s, x) => s + x.cantidad, 0)
        return (
          <span key={color} className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink">
            <span className="rounded bg-sky-500/15 px-1.5 font-bold text-sky-400">
              {color}
              {g.desc ? ` ${g.desc}` : ''}
            </span>
            <span className="tabular-nums text-sub">{items.map((x) => `${x.talle} ${x.cantidad}`).join(' · ')}</span>
            <b className="tabular-nums">= {tot}</b>
          </span>
        )
      })}
    </div>
  )
}
