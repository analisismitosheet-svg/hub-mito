import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X } from 'lucide-react'
import { Goma, type OpcionDesplegable } from './FiltroDesplegable'

/** Lo que se puede tipear: código entero o su principio (CF1662 trae CF166201, CF166202…). */
const VALIDO = /^[A-Z0-9]{1,20}$/
const partir = (t: string) => t.toUpperCase().split(/[\s,;|]+/).map((x) => x.trim()).filter((x) => VALIDO.test(x))

/**
 * Buscador de artículos con selección múltiple: se tipea un código (o el principio) y se elige de
 * la lista, o Enter para agregarlo tal cual. Pegar una lista (separada por espacios, comas o
 * renglones) agrega todos. Cada elegido queda como etiqueta con su ✕; la goma borra todos.
 */
export default function FiltroArticulos({
  titulo,
  valor,
  onChange,
  sugerencias = [],
  placeholder = 'Código o parte, ej. CF1662',
  ancho = 'w-72',
}: {
  titulo: string
  valor: string[]
  onChange: (v: string[]) => void
  sugerencias?: OpcionDesplegable[]
  placeholder?: string
  ancho?: string
}) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const elegidos = useMemo(() => new Set(valor), [valor])

  const t = texto.trim().toUpperCase()
  const lista = useMemo(() => {
    if (!t) return []
    const out: OpcionDesplegable[] = []
    for (const o of sugerencias) {
      if (o.id.startsWith(t) || o.label.toUpperCase().includes(t)) out.push(o)
      if (out.length >= 60) break
    }
    return out
  }, [sugerencias, t])

  const agregar = (ids: string[]) => {
    const nuevos = ids.filter((x) => !elegidos.has(x))
    if (nuevos.length) onChange([...valor, ...nuevos])
  }
  const alternar = (id: string) => (elegidos.has(id) ? onChange(valor.filter((x) => x !== id)) : agregar([id]))

  useLayoutEffect(() => {
    if (!abierto || !t) return
    const ubicar = () => {
      const r = caja.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.max(260, r.width)
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - width - 8), width })
    }
    ubicar()
    window.addEventListener('scroll', ubicar, true)
    window.addEventListener('resize', ubicar)
    return () => {
      window.removeEventListener('scroll', ubicar, true)
      window.removeEventListener('resize', ubicar)
    }
  }, [abierto, t])

  return (
    <div className={ancho}>
      <div className="mb-1 flex h-4 items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-sub/80">{titulo}</p>
        {valor.length > 0 && <Goma titulo={titulo} onClick={() => onChange([])} />}
      </div>
      <div
        ref={caja}
        onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
        className={
          'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 ' +
          (valor.length ? 'border-orange-500/60 bg-orange-500/10' : 'border-line2 bg-surface2')
        }
      >
        {valor.map((v) => (
          <span key={v} className="inline-flex items-center gap-0.5 rounded-md bg-orange-500/20 py-0.5 pl-1.5 pr-0.5 text-[11.5px] font-semibold text-orange-200">
            {v}
            <button type="button" onClick={(e) => { e.stopPropagation(); alternar(v) }} title={`Sacar ${v}`} aria-label={`Sacar ${v}`} className="rounded p-0.5 hover:bg-orange-500/30">
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <span className="flex min-w-[110px] flex-1 items-center gap-1">
          {!valor.length && <Search size={13} className="shrink-0 text-sub/70" aria-hidden />}
          <input
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setAbierto(true) }}
            onFocus={() => setAbierto(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                const ids = partir(texto)
                if (ids.length) { agregar(ids); setTexto('') }
              } else if (e.key === 'Backspace' && !texto && valor.length) {
                onChange(valor.slice(0, -1))
              } else if (e.key === 'Escape') {
                setAbierto(false)
              }
            }}
            onPaste={(e) => {
              const ids = partir(e.clipboardData.getData('text'))
              if (ids.length > 1) { e.preventDefault(); agregar(ids); setTexto('') }
            }}
            placeholder={valor.length ? 'Agregar otro…' : placeholder}
            aria-label={titulo}
            className="h-7 w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-sub/60"
          />
        </span>
      </div>
      {abierto && t && pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setAbierto(false)} />
            <div className="fixed z-[80] rounded-xl border border-line2 p-2 shadow-soft-lg" style={{ ...pos, background: 'var(--surface-solid)' }}>
              {VALIDO.test(t) && !elegidos.has(t) && (
                <button type="button" onClick={() => { agregar([t]); setTexto('') }} className="mb-1 flex w-full items-center gap-2 rounded-md border-b border-line px-1.5 py-1.5 text-left text-xs font-semibold text-ink hover:bg-surface2">
                  Agregar «{t}» <span className="font-normal text-sub">(todos los que empiezan así) · Enter</span>
                </button>
              )}
              <div className="max-h-64 overflow-y-auto">
                {lista.map((o) => (
                  <button key={o.id} type="button" onClick={() => alternar(o.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-ink hover:bg-surface2">
                    <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${elegidos.has(o.id) ? 'border-orange-500 bg-orange-500 text-white' : 'border-line2'}`}>
                      {elegidos.has(o.id) && <Check size={10} aria-hidden />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                ))}
                {!lista.length && sugerencias.length > 0 && <p className="p-1.5 text-xs text-sub">Ningún artículo de la lista coincide.</p>}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
