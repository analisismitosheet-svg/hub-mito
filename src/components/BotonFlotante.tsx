import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Botón flotante que se puede arrastrar a cualquier lugar de la pantalla
 * (mouse o dedo). La posición queda guardada en el navegador por `clave`.
 * Un toque sin arrastrar dispara `onClick`; si se arrastró, no.
 */

const MARGEN = 12
/** Pixeles de movimiento a partir de los cuales cuenta como arrastre y no como clic */
const UMBRAL_ARRASTRE = 6

interface Pos { x: number; y: number }

function leerPos(clave: string): Pos | null {
  try {
    const p = JSON.parse(localStorage.getItem(`flotante.${clave}`) ?? 'null') as Pos | null
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  } catch {
    return null
  }
}

function guardarPos(clave: string, p: Pos) {
  try { localStorage.setItem(`flotante.${clave}`, JSON.stringify(p)) } catch { /* sin almacenamiento */ }
}

export default function BotonFlotante({
  clave,
  onClick,
  icono,
  texto,
  titulo,
}: {
  /** Identifica el botón para recordar su posición (ej. 'facturacion-nuevo') */
  clave: string
  onClick: () => void
  icono: ReactNode
  /** Texto al lado del ícono (en celular se ve solo el ícono) */
  texto?: string
  titulo?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<Pos | null>(() => leerPos(clave))
  const arrastre = useRef<{ dx: number; dy: number; x0: number; y0: number; movio: boolean } | null>(null)

  /** Mantiene el botón entero dentro de la ventana */
  const encuadrar = useCallback((p: Pos): Pos => {
    const el = ref.current
    const w = el?.offsetWidth ?? 56
    const h = el?.offsetHeight ?? 56
    return {
      x: Math.min(Math.max(MARGEN, p.x), window.innerWidth - w - MARGEN),
      y: Math.min(Math.max(MARGEN, p.y), window.innerHeight - h - MARGEN),
    }
  }, [])

  // Posición inicial (abajo a la derecha, arriba del botón del chat) y
  // reencuadre si cambia el tamaño de la ventana
  useEffect(() => {
    const ubicar = () =>
      setPos((p) => {
        const el = ref.current
        const base = p ?? {
          x: window.innerWidth - (el?.offsetWidth ?? 56) - 24,
          y: window.innerHeight - (el?.offsetHeight ?? 56) - 96,
        }
        return encuadrar(base)
      })
    ubicar()
    window.addEventListener('resize', ubicar)
    return () => window.removeEventListener('resize', ubicar)
  }, [encuadrar])

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || !pos) return
    e.currentTarget.setPointerCapture(e.pointerId)
    arrastre.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, x0: e.clientX, y0: e.clientY, movio: false }
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const a = arrastre.current
    if (!a) return
    if (!a.movio && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < UMBRAL_ARRASTRE) return
    a.movio = true
    setPos(encuadrar({ x: e.clientX - a.dx, y: e.clientY - a.dy }))
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const a = arrastre.current
    arrastre.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!a) return
    if (a.movio) {
      if (pos) guardarPos(clave, pos)
    } else {
      onClick()
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      title={titulo ?? (texto ? `${texto} (arrastrá para moverlo)` : 'Arrastrá para moverlo')}
      aria-label={texto ?? titulo}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { arrastre.current = null }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, touchAction: 'none' }}
      className="fixed z-40 inline-flex cursor-grab select-none items-center gap-2 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(225,29,46,0.45)] outline-none transition-shadow hover:shadow-[0_10px_30px_rgba(225,29,46,0.6)] focus-visible:ring-2 focus-visible:ring-white/60 active:cursor-grabbing sm:px-5 sm:py-3.5"
    >
      {icono}
      {texto && <span className="hidden sm:inline">{texto}</span>}
    </button>
  )
}
