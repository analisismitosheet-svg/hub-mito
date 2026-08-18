import { useState } from 'react'
import { Star } from 'lucide-react'

interface StarRatingProps {
  /** valor actual (permite fracciones para mostrar promedios, ej. 4.4) */
  value: number
  /** cantidad de estrellas de la escala */
  max?: number
  /** callback al elegir (solo modo entrada) */
  onChange?: (v: number) => void
  /** permite medios puntos al tocar la mitad izquierda de una estrella */
  allowHalf?: boolean
  /** solo lectura: no responde a hover/click, muestra relleno fraccionario */
  readOnly?: boolean
  /** tamaño del ícono en px */
  size?: number
  className?: string
}

/** Una estrella con relleno fraccionario (0..1) superpuesto. */
function StarFill({ fill, size }: { fill: number; size: number }) {
  const pct = Math.max(0, Math.min(1, fill)) * 100
  return (
    <span className="relative inline-block leading-none" style={{ width: size, height: size }}>
      <Star size={size} className="text-line2" fill="none" strokeWidth={1.75} aria-hidden />
      <span
        className="absolute inset-y-0 left-0 overflow-hidden"
        style={{ width: `${pct}%` }}
        aria-hidden
      >
        <Star size={size} className="text-amber-400" fill="currentColor" strokeWidth={1.75} />
      </span>
    </span>
  )
}

export default function StarRating({
  value,
  max = 5,
  onChange,
  allowHalf = false,
  readOnly = false,
  size = 32,
  className = '',
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null)
  const activo = hover ?? value

  const estrellas = Array.from({ length: max }, (_, i) => i + 1)

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      onMouseLeave={() => setHover(null)}
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={readOnly ? `${value} de ${max} estrellas` : 'Calificación con estrellas'}
    >
      {estrellas.map((i) => {
        const fill = Math.max(0, Math.min(1, activo - (i - 1)))
        if (readOnly || !onChange) {
          return <StarFill key={i} fill={fill} size={size} />
        }
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <StarFill fill={fill} size={size} />
            {allowHalf ? (
              <>
                <button
                  type="button"
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={() => onChange(i - 0.5)}
                  aria-label={`${i - 0.5} estrellas`}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onChange(i)}
                  aria-label={`${i} estrellas`}
                />
              </>
            ) : (
              <button
                type="button"
                className="absolute inset-0 cursor-pointer"
                onMouseEnter={() => setHover(i)}
                onClick={() => onChange(i)}
                aria-label={`${i} estrella${i > 1 ? 's' : ''}`}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}
