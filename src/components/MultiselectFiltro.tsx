import { useMemo, useState } from 'react'
import { Filter, Search, X, ChevronDown } from 'lucide-react'

export interface OpcionMulti {
  id: string
  label: string
}

/**
 * Select con buscador (selección única). Muestra un botón con el valor elegido
 * y, al abrir, un dropdown con input de búsqueda para no desplazar la barra.
 */
export function SelectBuscar({
  label,
  opciones,
  valor,
  onChange,
  className,
}: {
  label: string
  opciones: OpcionMulti[]
  valor: string
  onChange: (v: string) => void
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busq, setBusq] = useState('')

  const filtradas = useMemo(() => {
    const t = busq.trim().toUpperCase()
    if (!t) return opciones
    return opciones.filter((o) => o.label.toUpperCase().includes(t))
  }, [opciones, busq])

  const elegida = opciones.find((o) => o.id === valor)

  return (
    <div className={'relative ' + (className ?? '')}>
      <button
        type="button"
        onClick={() => { setAbierto((o) => !o); setBusq('') }}
        className="btn-press inline-flex w-full items-center justify-between gap-1.5 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs font-medium text-ink hover:bg-line"
      >
        <span className="truncate">{valor ? elegida?.label ?? valor : label}</span>
        <ChevronDown size={13} className="shrink-0 text-sub" aria-hidden />
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <div className="flex items-center gap-1.5 border-b border-line pb-2">
              <Search size={13} className="shrink-0 text-sub/70" aria-hidden />
              <input
                autoFocus
                value={busq}
                onChange={(e) => setBusq(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}...`}
                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-sub/60 focus-visible:border-brand-500/40"
              />
              {busq && (
                <button onClick={() => setBusq('')} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto">
              <button
                type="button"
                onClick={() => { onChange(''); setAbierto(false) }}
                className={'w-full rounded-lg px-2 py-1 text-left text-xs ' + (!valor ? 'bg-brand-600/10 font-medium text-brand-400' : 'text-ink hover:bg-line/40')}
              >
                {label} (todos)
              </button>
              {filtradas.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setAbierto(false) }}
                  className={'w-full rounded-lg px-2 py-1 text-left text-xs ' + (o.id === valor ? 'bg-brand-600/10 font-medium text-brand-400' : 'text-ink hover:bg-line/40')}
                >
                  <span className="block truncate">{o.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Filtro multiselect con buscador (como los filtros de Excel).
 * Muestra un botón con el contador y, al abrir, un dropdown con input de
 * búsqueda para no tener que desplazar la barra.
 */
export default function MultiselectFiltro({
  label,
  opciones,
  seleccionadas,
  onChange,
}: {
  label: string
  opciones: OpcionMulti[]
  seleccionadas: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [busq, setBusq] = useState('')

  const filtradas = useMemo(() => {
    const t = busq.trim().toUpperCase()
    if (!t) return opciones
    return opciones.filter((o) => o.label.toUpperCase().includes(t))
  }, [opciones, busq])

  function toggle(id: string) {
    const nuevo = new Set(seleccionadas)
    if (nuevo.has(id)) nuevo.delete(id)
    else nuevo.add(id)
    onChange(nuevo)
  }

  function abrir() {
    setAbierto((o) => !o)
    setBusq('')
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={abrir}
        className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"
      >
        <Filter size={13} aria-hidden />
        {label} {seleccionadas.size > 0 ? `(${seleccionadas.size})` : ''}
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <div className="flex items-center gap-1.5 border-b border-line pb-2">
              <Search size={13} className="shrink-0 text-sub/70" aria-hidden />
              <input
                autoFocus
                value={busq}
                onChange={(e) => setBusq(e.target.value)}
                placeholder={`Buscar ${label.toLowerCase()}...`}
                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-sub/60 focus-visible:border-brand-500/40"
              />
              {busq && (
                <button onClick={() => setBusq('')} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-ink hover:bg-line/40">
              <input type="checkbox" checked={seleccionadas.size === 0} onChange={() => onChange(new Set())} className="h-3.5 w-3.5 rounded border-line bg-surface2 accent-brand-600" />
              Todos
            </label>
            <div className="my-1 border-t border-line" />
            <div className="max-h-56 overflow-y-auto">
              {filtradas.length === 0 ? (
                <p className="px-1.5 py-1 text-xs text-sub">Sin resultados.</p>
              ) : (
                filtradas.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs text-ink hover:bg-line/40">
                    <input
                      type="checkbox"
                      checked={seleccionadas.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="h-3.5 w-3.5 rounded border-line bg-surface2 accent-brand-600"
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}