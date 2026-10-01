import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * Botón "Volver" dinámico: vuelve a la página anterior real (de donde entraste),
 * usando el historial del navegador. Si no hay historial (ej. entraste directo por
 * URL), cae al menú principal.
 */
export default function BackButton({
  label = 'Volver',
  className = 'mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition duration-250 hover:-translate-x-1 hover:bg-surface2',
}: {
  label?: string
  className?: string
}) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
      className={className}
    >
      <ArrowLeft size={15} aria-hidden /> {label}
    </button>
  )
}
