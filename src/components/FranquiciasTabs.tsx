import { NavLink } from 'react-router-dom'

/* Solapas de Franquicias (mismo orden que la maqueta). */

const TABS = [
  { to: '/mayorista/franquicias', label: 'Propuestas de reposición', icono: '📦', end: true },
  { to: '/mayorista/franquicias/calzado', label: 'Pedido de venta de calzado', icono: '👟', end: false },
  { to: '/mayorista/franquicias/clientes', label: 'Clientes y bases', icono: '🔗', end: false },
]

export default function FranquiciasTabs() {
  return (
    <nav aria-label="Solapas de Franquicias" className="mb-3 flex flex-wrap items-center gap-1.5 rounded-full border border-line bg-paper p-1">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              isActive ? 'bg-surface2 text-ink shadow-sm' : 'text-sub hover:text-ink'
            }`
          }
        >
          <span aria-hidden>{t.icono}</span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
