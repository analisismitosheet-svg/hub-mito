import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, UserX, ChevronDown } from 'lucide-react'

export interface EmpleadoOpcion {
  id: string
  nombre: string
  legajo?: string | null
}

/** minúsculas y sin acentos: "munoz" encuentra "MUÑOZ"/"Muñoz" */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const MAX_RESULTADOS = 50

/**
 * Selector de empleado con búsqueda por nombre o número de legajo.
 * La lista se dibuja en un portal (encima de todo) porque suele usarse dentro
 * de filas con overflow-hidden.
 */
export default function SelectorEmpleado({
  empleados,
  valor,
  onElegir,
  placeholder = 'Responsable…',
  className = '',
}: {
  empleados: EmpleadoOpcion[]
  valor: string | null
  onElegir: (id: string | null) => void
  placeholder?: string
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; arriba: boolean } | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const elegido = empleados.find((e) => e.id === valor) ?? null

  const resultados = useMemo(() => {
    const t = normalizar(texto)
    if (!t) return empleados.slice(0, MAX_RESULTADOS)
    const esNumero = /^\d+$/.test(t)
    const coinciden = empleados.filter((e) => {
      const leg = normalizar(String(e.legajo ?? ''))
      if (esNumero) return leg.includes(t)
      return normalizar(e.nombre).includes(t) || leg.includes(t)
    })
    // Legajo exacto primero, después los que empiezan con lo escrito
    if (esNumero) {
      coinciden.sort((a, b) => {
        const la = String(a.legajo ?? '')
        const lb = String(b.legajo ?? '')
        return Number(lb === t) - Number(la === t) || Number(lb.startsWith(t)) - Number(la.startsWith(t))
      })
    }
    return coinciden.slice(0, MAX_RESULTADOS)
  }, [empleados, texto])

  // Opción 0 = "Sin responsable" solo si hay alguien asignado
  const conQuitar = Boolean(valor)
  const total = resultados.length + (conQuitar ? 1 : 0)

  function ubicar() {
    const r = botonRef.current?.getBoundingClientRect()
    if (!r) return
    const ancho = Math.min(320, window.innerWidth - 16)
    const left = Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8))
    const arriba = r.bottom + 340 > window.innerHeight && r.top > 360
    setPos({ top: arriba ? r.top - 6 : r.bottom + 6, left, width: ancho, arriba })
  }

  useLayoutEffect(() => {
    if (abierto) ubicar()
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const cerrarAfuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !botonRef.current?.contains(t)) setAbierto(false)
    }
    const reubicar = () => ubicar()
    document.addEventListener('mousedown', cerrarAfuera)
    window.addEventListener('resize', reubicar)
    window.addEventListener('scroll', reubicar, true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', cerrarAfuera)
      window.removeEventListener('resize', reubicar)
      window.removeEventListener('scroll', reubicar, true)
    }
  }, [abierto])

  useEffect(() => setActivo(0), [texto])

  function elegir(id: string | null) {
    setAbierto(false)
    setTexto('')
    if (id !== valor) onElegir(id)
    botonRef.current?.focus()
  }

  function onTecla(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActivo((a) => Math.min(a + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (conQuitar && activo === 0) elegir(null)
      else {
        const emp = resultados[activo - (conQuitar ? 1 : 0)]
        if (emp) elegir(emp.id)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAbierto(false)
      botonRef.current?.focus()
    }
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        title={elegido ? `Responsable: ${elegido.nombre}` : 'Elegir empleado responsable'}
        className={`inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none transition hover:border-line2 focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
          elegido ? 'text-ink' : 'text-sub'
        } ${className}`}
      >
        <span className="truncate">
          {elegido ? (elegido.legajo ? `#${elegido.legajo} · ${elegido.nombre}` : elegido.nombre) : placeholder}
        </span>
        <ChevronDown size={12} aria-hidden className="shrink-0 text-sub" />
      </button>

      {abierto &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[90] overflow-hidden rounded-xl border border-line bg-surface shadow-soft-lg"
            style={{
              left: pos.left,
              width: pos.width,
              ...(pos.arriba ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search size={14} aria-hidden className="shrink-0 text-sub" />
              <input
                ref={inputRef}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={onTecla}
                placeholder="Nombre o N° de legajo…"
                aria-label="Buscar empleado por nombre o legajo"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-sub/70"
              />
            </div>
            <ul role="listbox" className="max-h-72 overflow-y-auto py-1 text-sm">
              {conQuitar && (
                <li
                  role="option"
                  aria-selected={activo === 0}
                  onMouseDown={(e) => { e.preventDefault(); elegir(null) }}
                  onMouseEnter={() => setActivo(0)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sub ${activo === 0 ? 'bg-surface2 text-ink' : ''}`}
                >
                  <UserX size={14} aria-hidden /> Sin responsable
                </li>
              )}
              {resultados.map((e, n) => {
                const idx = n + (conQuitar ? 1 : 0)
                return (
                  <li
                    key={e.id}
                    role="option"
                    aria-selected={e.id === valor}
                    onMouseDown={(ev) => { ev.preventDefault(); elegir(e.id) }}
                    onMouseEnter={() => setActivo(idx)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${activo === idx ? 'bg-surface2' : ''} ${
                      e.id === valor ? 'font-semibold text-brand-500' : 'text-ink'
                    }`}
                  >
                    {e.legajo && <span className="w-12 shrink-0 font-mono text-xs text-sub">#{e.legajo}</span>}
                    <span className="truncate">{e.nombre}</span>
                  </li>
                )
              })}
              {resultados.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-sub">No hay empleados con “{texto}”.</li>
              )}
            </ul>
            {!texto && empleados.length > MAX_RESULTADOS && (
              <p className="border-t border-line px-3 py-1.5 text-[11px] text-sub">
                Mostrando {MAX_RESULTADOS} de {empleados.length}: escribí para buscar.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
