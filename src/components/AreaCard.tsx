import type { CSSProperties } from 'react'
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
      // --c: color propio del área; tiñe el ícono, el borde y el brillo al pasar el mouse
      style={{ animationDelay: `${index * 40}ms`, '--c': area.color } as CSSProperties}
      className="hub-card animate-enter group relative flex flex-col items-start gap-4 overflow-hidden border border-line bg-surface p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-6"
    >
      <div className="icon-tile h-12 w-12 transition-transform duration-300 ease-out-strong group-hover:scale-110 sm:h-14 sm:w-14">
        <Icon size={24} aria-hidden />
      </div>
      <div className="w-full">
        <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{area.name}</h3>
        <p className="mt-1 text-sm text-sub">
          {apps.length === 0
            ? 'Sin apps todavía'
            : `${apps.length} app${apps.length > 1 ? 's' : ''}${
                activas ? ` · ${activas} activa${activas > 1 ? 's' : ''}` : ''
              }`}
        </p>
      </div>
      <span className="card-link mt-auto flex items-center gap-1.5 text-sm font-semibold transition-[gap] duration-300 group-hover:gap-2.5">
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
