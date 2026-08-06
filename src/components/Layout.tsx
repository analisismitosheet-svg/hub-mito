import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, configured } = useAuth()

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 font-display text-sm font-bold text-white shadow-glow">
              M
            </div>
            <span className="font-display font-semibold text-ink">Hub Mito</span>
          </div>
          {configured && user && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-sub sm:inline">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="btn-press flex cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                <LogOut size={15} aria-hidden /> Salir
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
