import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { AreaDef } from '@/config/areas'
import { appsDeArea } from '@/config/areas'

export default function AreaCard({ area }: { area: AreaDef }) {
  const navigate = useNavigate()
  const Icon = area.icon
  const apps = appsDeArea(area.id)
  const activas = apps.filter((a) => !a.comingSoon).length

  return (
    <button
      onClick={() => navigate(`/area/${area.id}`)}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-left transition hover:-translate-y-0.5 hover:border-slate-700 hover:bg-slate-900"
    >
      <div className={`rounded-xl bg-slate-800/70 p-3 ${area.accent}`}>
        <Icon size={24} />
      </div>
      <div className="w-full">
        <h3 className="font-semibold text-white">{area.name}</h3>
        <p className="mt-1 text-sm text-slate-400">
          {apps.length === 0
            ? 'Sin apps todavía'
            : `${apps.length} app${apps.length > 1 ? 's' : ''}${
                activas ? ` · ${activas} activa${activas > 1 ? 's' : ''}` : ''
              }`}
        </p>
      </div>
      <span className="mt-auto flex items-center gap-1 text-sm text-brand-400 opacity-0 transition group-hover:opacity-100">
        Entrar <ArrowRight size={14} />
      </span>
    </button>
  )
}
