import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

export default function Login() {
  const { signIn, configured, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    navigate('/', { replace: true })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error)
    else navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-soft-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-glow">
            <LogIn size={26} aria-hidden />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">Hub Mito</h1>
          <p className="text-sm text-sub">Ingresá con tu usuario</p>
        </div>

        {!configured && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-accent-500/30 bg-accent-500/10 p-3 text-xs text-accent-400">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Falta configurar Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el
              archivo .env). Podés ver la interfaz pero el login no funcionará hasta configurarlo.
            </span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="tu@email.com"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-ink">
              Contraseña
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" aria-live="polite" className="text-sm text-brand-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !configured}
            className="btn-press w-full cursor-pointer rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft outline-none hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-sub">
          ¿No tenés cuenta?{' '}
          <Link to="/register" className="font-medium text-brand-500 hover:underline">
            Registrate
          </Link>
        </p>
      </div>
    </div>
  )
}
