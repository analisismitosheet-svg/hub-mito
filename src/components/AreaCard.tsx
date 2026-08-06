import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { AreaDef } from '@/config/areas'
import { appsDeArea } from '@/config/areas'

export default function AreaCard({ area, index = 0 }: { area: AreaDef; index?: number }) {
  const navigate = useNavigate()
  const Icon = area.icon
  const apps = appsDeArea(area.id)
  const activas = apps.filter((a) => !a.comingSoon).length

  return (
    <button
      onClick={() => navigate(`/area/${area.id}`)}
      style={{ animationDelay: `${index * 40}ms` }}
      className="hub-card animate-enter group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-brand-100 bg-white p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      {/* barra de acento con el color del área: se revela desde la izquierda */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 ease-out-strong group-hover:scale-x-100"
        style={{ backgroundColor: area.color }}
      />
      <div
        className="rounded-xl border p-3 transition-transform duration-300 ease-out-strong group-hover:scale-110"
        style={{
          color: area.color,
          backgroundColor: `${area.color}14`,
          borderColor: `${area.color}26`,
        }}
      >
        <Icon size={24} aria-hidden />
      </div>
      <div className="w-full">
        <h3 className="font-display font-semibold text-ink">{area.name}</h3>
        <p className="mt-1 text-sm text-brand-700/70">
          {apps.length === 0
            ? 'Sin apps todavía'
            : `${apps.length} app${apps.length > 1 ? 's' : ''}${
                activas ? ` · ${activas} activa${activas > 1 ? 's' : ''}` : ''
              }`}
        </p>
      </div>
      <span
        className="mt-auto flex items-center gap-1.5 text-sm font-medium"
        style={{ color: area.color }}
      >
        Entrar
        <ArrowRight
          size={14}
          aria-hidden
          className="transition-transform duration-300 ease-out-strong group-hover:translate-x-1"
        />
      </span>
    </button>
  )
}
