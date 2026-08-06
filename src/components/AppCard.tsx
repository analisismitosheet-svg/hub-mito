import { useNavigate } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import type { AppDef } from '@/config/areas'

export default function AppCard({ app }: { app: AppDef }) {
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
      className={`group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-left transition ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900'
      }`}
    >
      <div className="rounded-xl bg-slate-800/70 p-3 text-brand-400">
        <Icon size={24} />
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-white">
          {app.title}
          {app.kind === 'external' && !disabled && (
            <ExternalLink size={14} className="text-slate-500" />
          )}
        </h3>
        <p className="mt-1 text-sm text-slate-400">{app.description}</p>
      </div>
      {disabled ? (
        <span className="mt-auto inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400">
          Próximamente
        </span>
      ) : (
        <span className="mt-auto flex items-center gap-1 text-sm text-brand-400 opacity-0 transition group-hover:opacity-100">
          Abrir <ArrowRight size={14} />
        </span>
      )}
    </button>
  )
}
