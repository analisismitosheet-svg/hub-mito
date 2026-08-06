import { useNavigate } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import type { AppDef } from '@/config/areas'

export default function AppCard({ app, index = 0 }: { app: AppDef; index?: number }) {
  const navigate = useNavigate()
  const Icon = app.icon
  const disabled = app.comingSoon

  function onClick() {
    if (disabled) return
    if (app.kind === 'external') {
      window.open(app.target, '_blank', 'noopener,noreferrer')
    } else {
      navigate(app.target)
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`animate-enter group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
        disabled
          ? 'cursor-not-allowed border-line bg-surface/60 opacity-70'
          : 'hub-card cursor-pointer border-line bg-surface'
      }`}
    >
      {!disabled && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 ease-out-strong group-hover:scale-x-100"
          style={{ backgroundColor: app.color }}
        />
      )}
      <div
        className={`rounded-xl border p-3 transition-transform duration-300 ease-out-strong ${
          disabled ? '' : 'group-hover:scale-110'
        }`}
        style={{
          color: app.color,
          backgroundColor: `${app.color}${disabled ? '18' : '24'}`,
          borderColor: `${app.color}40`,
        }}
      >
        <Icon size={24} aria-hidden />
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-display font-semibold text-ink">
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
        <span
          className="mt-auto flex items-center gap-1.5 text-sm font-medium"
          style={{ color: app.color }}
        >
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
