import { useNavigate } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import type { ModuleDef } from '@/config/modules'

export default function ModuleCard({ mod }: { mod: ModuleDef }) {
  const navigate = useNavigate()
  const Icon = mod.icon
  const disabled = mod.comingSoon

  function onClick() {
    if (disabled) return
    if (mod.kind === 'external') {
      window.open(mod.target, '_blank', 'noopener,noreferrer')
    } else {
      navigate(mod.target)
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-left transition ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900'
      }`}
    >
      <div className={`rounded-xl bg-slate-800/70 p-3 ${mod.accent}`}>
        <Icon size={24} />
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-white">
          {mod.title}
          {mod.kind === 'external' && !disabled && (
            <ExternalLink size={14} className="text-slate-500" />
          )}
        </h3>
        <p className="mt-1 text-sm text-slate-400">{mod.description}</p>
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
