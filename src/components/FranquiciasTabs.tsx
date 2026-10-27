import { NavLink } from 'react-router-dom'
import { CalendarDays, ClipboardList, Package, type LucideIcon } from 'lucide-react'

/* Una pantalla por función: reposición diaria, propuesta y materiales. */

const TABS: { to: string; label: string; detalle: string; Icon: LucideIcon; end: boolean }[] = [
  { to: '/mayorista/franquicias/diaria', label: 'Reposición diaria', detalle: 'Ventas contra stock real', Icon: CalendarDays, end: true },
  { to: '/mayorista/franquicias/propuestas', label: 'Propuesta de reposición', detalle: 'Armar, enviar y seguir', Icon: ClipboardList, end: false },
  { to: '/mayorista/franquicias/materiales', label: 'Reposición de materiales', detalle: 'Calzado por curva de talles', Icon: Package, end: false },
]

export default function FranquiciasTabs() {
  return (
    <nav aria-label="Pantallas de Franquicias" className="mb-4 grid gap-1.5 rounded-2xl border border-line bg-paper p-1.5 sm:grid-cols-3">
      {TABS.map(({ to, label, detalle, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
              isActive
                ? 'bg-surface2 text-ink shadow-sm ring-1 ring-brand-500/30'
                : 'text-sub hover:bg-surface/70 hover:text-ink'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${isActive ? 'bg-brand-500/15 text-brand-400' : 'bg-surface text-sub group-hover:text-ink'}`}>
                <Icon size={17} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{label}</span>
                <span className="block truncate text-[11px] text-sub">{detalle}</span>
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
