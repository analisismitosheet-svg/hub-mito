// Controles chicos y reutilizables del panel del editor.
import type { ReactNode } from 'react'
import { FUENTES, PALETA } from './tipos'

export function Grupo({ titulo, icono, children }: { titulo: string; icono?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface2/60 p-2.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sub/70">
        {icono}
        {titulo}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function Fila({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[11px] text-sub">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}

export function Deslizador({
  label, valor, min, max, paso = 1, onChange, mostrar,
}: {
  label: string
  valor: number
  min: number
  max: number
  paso?: number
  onChange: (v: number) => void
  mostrar?: (v: number) => string
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-sub">{label}</span>
        <span className="tabular-nums text-[11px] font-medium text-ink">{mostrar ? mostrar(valor) : valor}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-track slider-thumb w-full"
      />
    </div>
  )
}

export function Segmento<T extends string | number>({
  valor, opciones, onChange,
}: {
  valor: T
  opciones: { v: T; label?: string; icono?: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-line">
      {opciones.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          title={o.title ?? o.label}
          onClick={() => onChange(o.v)}
          className={
            'flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 text-[11px] font-medium transition ' +
            (valor === o.v ? 'bg-brand-600 text-white' : 'bg-surface text-sub hover:bg-surface2 hover:text-ink')
          }
        >
          {o.icono}
          {o.label && <span className="truncate">{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

export function Interruptor({ label, valor, onChange }: { label: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!valor)}
      className={
        'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ' +
        (valor ? 'border-brand-600/50 bg-brand-600/15 text-ink' : 'border-line bg-surface text-sub hover:text-ink')
      }
    >
      {label}
      <span className={'relative h-4 w-7 shrink-0 rounded-full transition ' + (valor ? 'bg-brand-600' : 'bg-line2')}>
        <span className={'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ' + (valor ? 'left-3.5' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function SelectorColor({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PALETA.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={
            'h-5 w-5 rounded-md border transition ' +
            (valor.toLowerCase() === c.toLowerCase() ? 'border-ink ring-2 ring-brand-600/60' : 'border-line hover:scale-110')
          }
        />
      ))}
      <input
        type="color"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        title="Color personalizado"
        className="h-5 w-7 cursor-pointer rounded-md border border-line bg-surface p-0"
      />
    </div>
  )
}

export function SelectorFuente({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink"
      style={{ fontFamily: `"${valor}", Poppins, sans-serif` }}
    >
      {FUENTES.map((f) => (
        <option key={f.id} value={f.id} style={{ fontFamily: `"${f.id}", sans-serif` }}>
          {f.nombre}
        </option>
      ))}
    </select>
  )
}
