import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Eraser, Search } from 'lucide-react'

export interface OpcionDesplegable { id: string; label: string }

/**
 * Filtro como los del tablero de Power BI: lista desplegable con buscador, «Seleccionar todo» y
 * casillas. Vacío = «Todas» (se dibuja todo tildado; destildar uno lo saca). Muestra «Todas»,
 * el elegido, «Todos menos X, Y» o «Selección múltiple (n)». Activo = naranja.
 * Con algo elegido aparece la goma junto al título: borra solo ese filtro.
 */
export default function FiltroDesplegable({
  titulo,
  opciones,
  valor,
  onChange,
  todos = 'Todas',
}: {
  titulo: string
  opciones: OpcionDesplegable[]
  valor: Set<string>
  onChange: (s: Set<string>) => void
  todos?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busq, setBusq] = useState('')
  const boton = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const filtradas = useMemo(() => {
    const t = busq.trim().toUpperCase()
    return t ? opciones.filter((o) => o.label.toUpperCase().includes(t)) : opciones
  }, [opciones, busq])

  const ninguno = valor.has('\u0000')
  const tildada = (id: string) => !ninguno && (valor.size === 0 || valor.has(id))
  const activo = valor.size > 0
  const faltan = opciones.filter((o) => !valor.has(o.id))
  const texto = ninguno
    ? 'Ninguno'
    : valor.size === 0
      ? todos
      : valor.size === 1
        ? opciones.find((o) => valor.has(o.id))?.label ?? [...valor][0]
        : faltan.length > 0 && faltan.length <= 2 && valor.size > 2
          ? `Todos menos ${faltan.map((o) => o.id).join(', ')}`
          : `Selección múltiple (${valor.size})`

  function toggle(id: string) {
    const base = valor.size === 0 || ninguno ? new Set(ninguno ? [] : opciones.map((o) => o.id)) : new Set(valor)
    if (base.has(id)) base.delete(id)
    else base.add(id)
    if (base.size === opciones.length) onChange(new Set())
    else if (base.size === 0) onChange(new Set(['\u0000']))
    else onChange(base)
  }

  useLayoutEffect(() => {
    if (!abierto) return
    const ubicar = () => {
      const r = boton.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.max(240, r.width)
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - width - 8), width })
    }
    ubicar()
    window.addEventListener('scroll', ubicar, true)
    window.addEventListener('resize', ubicar)
    return () => {
      window.removeEventListener('scroll', ubicar, true)
      window.removeEventListener('resize', ubicar)
    }
  }, [abierto])

  return (
    <div>
      <div className="mb-1 flex h-4 items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-sub/80">{titulo}</p>
        {activo && <Goma titulo={titulo} onClick={() => onChange(new Set())} />}
      </div>
      <button
        ref={boton}
        type="button"
        onClick={() => { setAbierto((a) => !a); setBusq('') }}
        className={
          'btn-press flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-[13px] transition ' +
          (activo ? 'border-orange-500/60 bg-orange-500/10 font-semibold text-orange-300' : 'border-line2 bg-surface2 text-ink hover:border-line2')
        }
      >
        <span className="truncate">{texto}</span>
        <ChevronDown size={14} className="shrink-0 text-sub" aria-hidden />
      </button>
      {abierto && pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setAbierto(false)} />
            <div className="fixed z-[80] rounded-xl border border-line2 p-2 shadow-soft-lg" style={{ ...pos, background: 'var(--surface-solid)' }}>
              <div className="mb-1 flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2">
                <Search size={13} className="text-sub/70" aria-hidden />
                <input autoFocus value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar" className="h-8 w-full bg-transparent text-xs text-ink outline-none placeholder:text-sub/60" />
              </div>
              <label className="flex cursor-pointer items-center gap-2 border-b border-line px-1.5 py-1.5 text-xs font-semibold text-ink">
                <input type="checkbox" className="h-3.5 w-3.5 accent-orange-500" checked={valor.size === 0} onChange={(e) => onChange(e.target.checked ? new Set() : new Set(['\u0000']))} />
                Seleccionar todo
              </label>
              <div className="max-h-64 overflow-y-auto">
                {filtradas.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink hover:bg-surface2">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-orange-500" checked={tildada(o.id)} onChange={() => toggle(o.id)} />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
                {!filtradas.length && <p className="p-2 text-xs text-sub">Sin resultados</p>}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

/** Goma: borra un solo filtro (vuelve a «Todas»). */
export function Goma({ titulo, onClick }: { titulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Borrar el filtro ${titulo}`}
      aria-label={`Borrar el filtro ${titulo}`}
      className="btn-press inline-flex h-4 shrink-0 items-center gap-1 rounded px-1 text-[10.5px] font-semibold text-orange-300 hover:bg-orange-500/15"
    >
      <Eraser size={12} aria-hidden /> borrar
    </button>
  )
}
