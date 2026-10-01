import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import type { AppDef } from '@/config/areas'

export default function AppCard({
  app,
  index = 0,
  areaId,
}: {
  app: AppDef
  index?: number
  areaId?: string
}) {
  const navigate = useNavigate()
  const Icon = app.icon
  const disabled = app.comingSoon

  function onClick() {
    if (disabled) return
    if (app.kind === 'external') {
      window.open(app.target, '_blank', 'noopener,noreferrer')
    } else {
      // Guardamos el área de origen para que "Volver" regrese a la correcta
      // (una misma app puede vivir en varias áreas, ej. Cuentas Amigos).
      navigate(app.target, { state: { fromArea: areaId } })
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ animationDelay: `${index * 40}ms`, '--c': app.color } as CSSProperties}
      className={`animate-enter group relative flex flex-col items-start gap-4 overflow-hidden rounded-3xl border p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-6 ${
        disabled
          ? 'cursor-not-allowed border-line bg-surface opacity-60'
          : 'hub-card cursor-pointer border-line bg-surface'
      }`}
    >
      <div
        className={`icon-tile h-12 w-12 transition-transform duration-300 ease-out-strong sm:h-14 sm:w-14 ${
          disabled ? 'grayscale' : 'group-hover:scale-110'
        }`}
      >
        <Icon size={24} aria-hidden />
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink">
          {app.title}
          {app.kind === 'external' && !disabled && (
            <ExternalLink size={14} className="text-sub" aria-hidden />
          )}
        </h3>
        <p className="mt-1 text-sm text-sub">{app.description}</p>
      </div>
      {disabled ? (
        <span className="mt-auto inline-flex items-center rounded-full bg-surface2 px-2.5 py-0.5 text-xs font-medium text-sub">
          Próximamente
        </span>
      ) : (
        <span className="card-link mt-auto flex items-center gap-1.5 text-sm font-semibold transition-[gap] duration-300 group-hover:gap-2.5">
          Abrir
          <ArrowRight
            size={14}
            aria-hidden
            className="transition-transform duration-300 ease-out-strong group-hover:translate-x-1"
          />
        </span>
      )}
    </button>
  )
}
