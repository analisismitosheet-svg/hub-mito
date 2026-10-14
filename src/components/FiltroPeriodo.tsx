import { ChevronLeft, ChevronRight } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Filtro de fechas único de Eficiencia mayorista: Día / Semana / Mes  */
/*  con ◀ ▶, o un rango libre (Fechas). Todas las secciones de la       */
/*  pantalla usan el mismo desde/hasta.                                 */
/* ------------------------------------------------------------------ */

export type ModoPeriodo = 'dia' | 'semana' | 'mes' | 'rango'

export interface Periodo {
  modo: ModoPeriodo
  /** AAAA-MM-DD, incluidos los dos */
  desde: string
  hasta: string
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const deIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const hoyIso = () => iso(new Date())
export const sumarDias = (s: string, n: number) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d) }
/** Días entre dos fechas, incluidas las dos */
export const diasEntre = (desde: string, hasta: string) => Math.round((deIso(hasta).getTime() - deIso(desde).getTime()) / 86400000) + 1
const fmt = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El período de ese modo que contiene la fecha `ref` */
export function periodoDe(modo: Exclude<ModoPeriodo, 'rango'>, ref: string): Periodo {
  const d = deIso(ref)
  if (modo === 'dia') return { modo, desde: ref, hasta: ref }
  if (modo === 'semana') {
    const lunes = sumarDias(ref, -((d.getDay() + 6) % 7))
    return { modo, desde: lunes, hasta: sumarDias(lunes, 6) }
  }
  const primero = iso(new Date(d.getFullYear(), d.getMonth(), 1))
  const ultimo = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  return { modo, desde: primero, hasta: ultimo }
}

export function etiquetaPeriodo(p: Periodo): string {
  const hoy = hoyIso()
  if (p.modo === 'dia') return `${p.desde === hoy ? 'Hoy · ' : ''}${fmt(p.desde)}`
  if (p.modo === 'semana') return `Semana ${fmt(p.desde)} – ${fmt(p.hasta)}`
  if (p.modo === 'mes') { const d = deIso(p.desde); return `${MESES[d.getMonth()]} ${d.getFullYear()}` }
  return `${fmt(p.desde)} – ${fmt(p.hasta)}`
}

const inputCls = 'rounded-xl border border-line bg-surface2 px-3 py-1.5 text-xs text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

export default function FiltroPeriodo({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  const hoy = hoyIso()
  const mover = (n: number) => {
    if (valor.modo === 'rango') return
    const ref = valor.modo === 'dia' ? sumarDias(valor.desde, n)
      : valor.modo === 'semana' ? sumarDias(valor.desde, n * 7)
        : (() => { const d = deIso(valor.desde); return iso(new Date(d.getFullYear(), d.getMonth() + n, 1)) })()
    if (ref > hoy) return
    onChange(periodoDe(valor.modo, ref))
  }
  const enElUltimo = valor.modo !== 'rango' && valor.hasta >= hoy

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-xl border border-line" role="tablist" aria-label="Período">
        {(['dia', 'semana', 'mes', 'rango'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={valor.modo === m}
            onClick={() => onChange(m === 'rango' ? { modo: 'rango', desde: valor.desde, hasta: valor.hasta } : periodoDe(m, hoy))}
            className={`px-3.5 py-2 text-sm font-bold ${valor.modo === m ? 'bg-sky-500/15 text-sky-400' : 'text-sub hover:text-ink'}`}
          >
            {m === 'dia' ? 'Día' : m === 'semana' ? 'Semana' : m === 'mes' ? 'Mes' : 'Fechas'}
          </button>
        ))}
      </div>
      {valor.modo === 'rango' ? (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={valor.desde}
            max={valor.hasta}
            onChange={(e) => e.target.value && onChange({ ...valor, desde: e.target.value })}
            className={inputCls}
            aria-label="Desde"
          />
          <span className="text-xs text-sub">a</span>
          <input
            type="date"
            value={valor.hasta}
            min={valor.desde}
            max={hoy}
            onChange={(e) => e.target.value && onChange({ ...valor, hasta: e.target.value })}
            className={inputCls}
            aria-label="Hasta"
          />
        </div>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface px-1 py-1">
          <button type="button" onClick={() => mover(-1)} className="rounded-lg p-1.5 text-ink hover:bg-line" aria-label="Anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[9.5rem] text-center text-xs font-semibold capitalize leading-tight text-ink">{etiquetaPeriodo(valor)}</span>
          <button type="button" onClick={() => mover(1)} disabled={enElUltimo} className="rounded-lg p-1.5 text-ink hover:bg-line disabled:opacity-30" aria-label="Siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
