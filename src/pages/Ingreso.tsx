import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ScanLine, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { emailDeLegajo, normalizaLegajo } from '@/lib/loginEmpleado'

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/**
 * Ingreso de empleados: legajo + contraseña que le asigna el administrador.
 * No hay registro: la cuenta la da de alta el admin desde /usuarios.
 */
export default function Ingreso() {
  const { signIn, configured, user } = useAuth()
  const navigate = useNavigate()
  const [legajo, setLegajo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const legajoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    legajoRef.current?.focus()
  }, [])

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const email = emailDeLegajo(normalizaLegajo(legajo))
    if (!email) {
      setError('Ingresá tu número de legajo.')
      return
    }

    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)

    if (error) {
      // Mensaje genérico a propósito: no revelamos si el legajo existe.
      setError('Legajo o contraseña incorrectos.')
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-soft-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-glow">
            <ScanLine size={26} aria-hidden />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">Ingreso de empleados</h1>
          <p className="text-sm text-sub">Tu legajo y la contraseña que te dieron</p>
        </div>

        {!configured && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-accent-500/30 bg-accent-500/10 p-3 text-xs text-accent-400">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>Falta configurar Supabase. El ingreso no va a funcionar hasta configurarlo.</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="ingreso-legajo" className="mb-1 block text-sm font-medium text-ink">
              Legajo
            </label>
            <input
              ref={legajoRef}
              id="ingreso-legajo"
              name="legajo"
              type="text"
              autoComplete="username"
              inputMode="numeric"
              spellCheck={false}
              required
              value={legajo}
              onChange={(e) => setLegajo(e.target.value)}
              className={inputCls}
              placeholder="Ej: 935"
            />
          </div>
          <div>
            <label htmlFor="ingreso-password" className="mb-1 block text-sm font-medium text-ink">
              Contraseña
            </label>
            <input
              id="ingreso-password"
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

        <div className="mt-5 flex flex-col items-center gap-2 border-t border-line pt-4 text-center text-sm text-sub">
          <Link to="/login" className="inline-flex items-center gap-1 font-medium text-brand-500 hover:underline">
            <ArrowLeft size={14} aria-hidden /> Soy personal / administración
          </Link>
        </div>
      </div>
    </div>
  )
}
