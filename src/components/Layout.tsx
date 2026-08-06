import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, configured } = useAuth()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              M
            </div>
            <span className="font-semibold">Hub Mito</span>
          </div>
          {configured && user && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-400 sm:inline">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800"
              >
                <LogOut size={15} /> Salir
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
