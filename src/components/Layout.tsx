import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Sun, Moon, RefreshCw, Home } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import CampanaNotificaciones from '@/components/CampanaNotificaciones'
import ChatAgentes from '@/components/ChatAgentes'

/**
 * Shell de la app. Todas las pantallas ocupan el 100% del ancho del dispositivo
 * (solo un margen chico a los costados).
 *
 * En celular no hay barra: el contenido empieza arriba de todo y el ícono rojo "M"
 * flota abajo a la izquierda; abre un menú con recargar, tema, avisos y salir.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, configured, soloPiso } = useAuth()
  const { tema, toggle } = useTheme()
  const logueado = configured && Boolean(user)

  const [menuAbierto, setMenuAbierto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Luz que sigue al mouse dentro de las tarjetas .hub-card (un solo listener para todo el hub)
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('.hub-card') as HTMLElement | null
      if (!card) return
      const r = card.getBoundingClientRect()
      card.style.setProperty('--mx', `${e.clientX - r.left}px`)
      card.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('pointermove', mover, { passive: true })
    return () => document.removeEventListener('pointermove', mover)
  }, [])

  useEffect(() => {
    if (!menuAbierto) return
    const cerrar = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAbierto(false)
    }
    const conEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAbierto(false)
    }
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('touchstart', cerrar)
    document.addEventListener('keydown', conEsc)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('touchstart', cerrar)
      document.removeEventListener('keydown', conEsc)
    }
  }, [menuAbierto])

  const logo = (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-display text-sm font-bold text-white shadow-[0_4px_12px_rgba(239,68,68,0.4)] transition-transform group-hover:scale-105">
      M
    </div>
  )
  // En celular es un botón flotante: más grande para el dedo
  const logoFlotante = (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-display text-base font-bold text-white shadow-[0_6px_20px_rgba(239,68,68,0.45)] transition-transform active:scale-95">
      M
    </div>
  )

  const itemMenu =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink outline-none transition hover:bg-surface2 focus-visible:bg-surface2'

  return (
    <div className="min-h-screen text-ink">
      {/* ---------- Computadora: barra completa (píldora de vidrio flotante) ---------- */}
      <header className="sticky top-3 z-10 hidden px-4 sm:block lg:px-6">
        <div className="flex items-center justify-between rounded-full border border-line bg-surface py-2 pl-3 pr-2 shadow-soft backdrop-blur-xl">
          <Link
            to="/"
            title="Ir al menu"
            aria-label="Ir al menu"
            className="group flex cursor-pointer items-center gap-2.5 rounded-xl outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            {logo}
            <span className="font-display font-semibold text-ink">Hub Mito</span>
          </Link>
          {logueado && user && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="btn-press flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-surface2 text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
                title="Recargar pagina y datos"
                aria-label="Recargar pagina y datos"
              >
                <RefreshCw size={16} aria-hidden />
              </button>
              <button
                onClick={toggle}
                className="btn-press flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-surface2 text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
                title={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                aria-label="Cambiar tema"
              >
                {tema === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
              </button>
              <CampanaNotificaciones />
              <span className="hidden text-sm text-sub lg:inline">{user.email}</span>
              <span
                aria-hidden
                title={user.email ?? ''}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/10 bg-gradient-to-br from-blue-500 to-violet-500 text-sm font-semibold uppercase text-white shadow-[0_0_15px_rgba(59,130,246,0.45)]"
              >
                {(user.email ?? '?').charAt(0)}
              </span>
              <button
                onClick={() => signOut()}
                className="btn-press flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <LogOut size={15} aria-hidden /> Salir
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ---------- Celular: sin barra. El ícono rojo flota abajo a la izquierda y abre el menú ---------- */}
      <div className="fixed bottom-4 left-4 z-40 sm:hidden" ref={menuRef}>
        {logueado ? (
          <button
            type="button"
            onClick={() => setMenuAbierto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            aria-label="Abrir menú"
            className="group block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            {logoFlotante}
          </button>
        ) : (
          <Link to="/" aria-label="Ir al inicio" className="group block rounded-full">
            {logoFlotante}
          </Link>
        )}

        {menuAbierto && logueado && user && (
          <div
            role="menu"
            className="absolute bottom-full left-0 z-50 mb-3 w-64 rounded-[1.25rem] border border-line bg-surface p-1.5 shadow-soft-lg"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 pb-2 pt-1.5">
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold text-ink">Hub Mito</p>
                <p className="truncate text-xs text-sub">{user.email}</p>
              </div>
              <CampanaNotificaciones />
            </div>
            <div className="pt-1">
              {!soloPiso && (
                <Link to="/" role="menuitem" onClick={() => setMenuAbierto(false)} className={itemMenu}>
                  <Home size={16} aria-hidden /> Ir al menú
                </Link>
              )}
              <button type="button" role="menuitem" onClick={() => window.location.reload()} className={itemMenu}>
                <RefreshCw size={16} aria-hidden /> Recargar
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggle()
                  setMenuAbierto(false)
                }}
                className={itemMenu}
              >
                {tema === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                {tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => signOut()}
                className={`${itemMenu} text-brand-400`}
              >
                <LogOut size={16} aria-hidden /> Salir
              </button>
            </div>
          </div>
        )}
      </div>

      {/* En celular: sin espacio arriba (no hay barra) y margen abajo para el ícono flotante */}
      <main className="w-full px-4 pb-24 pt-4 sm:pb-10 sm:pt-10 lg:px-6">{children}</main>
      {logueado && <ChatAgentes />}
    </div>
  )
}
