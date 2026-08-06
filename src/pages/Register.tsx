import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserPlus, AlertTriangle, MailCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

const inputCls =
  'w-full rounded-xl border border-brand-200 bg-white px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-brand-700/40 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30'

export default function Register() {
  const { signUp, configured } = useAuth()
  const navigate = useNavigate()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== password2) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setBusy(true)
    const { error, needsConfirm } = await signUp(email.trim(), password, nombre.trim())
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    if (needsConfirm) {
      setSent(true)
    } else {
      navigate('/', { replace: true })
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm rounded-2xl border border-brand-100 bg-white p-8 text-center shadow-soft-lg">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <MailCheck size={26} />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">Revisá tu correo</h1>
          <p className="mt-2 text-sm text-brand-700/70">
            Te enviamos un mail a <span className="font-medium text-ink">{email}</span> para
            confirmar tu cuenta. Abrí el enlace y después iniciá sesión.
          </p>
          <Link
            to="/login"
            className="btn-press mt-6 inline-block cursor-pointer rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-soft hover:bg-brand-700"
          >
            Ir al login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-brand-100 bg-white p-8 shadow-soft-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft">
            <UserPlus size={26} />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">Crear cuenta</h1>
          <p className="text-sm text-brand-700/70">Registrate para acceder al hub</p>
        </div>

        {!configured && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-accent-600/25 bg-accent-600/10 p-3 text-xs text-accent-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Falta configurar Supabase; el registro no funcionará hasta configurarlo.</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-nombre" className="mb-1 block text-sm font-medium text-ink">
              Nombre
            </label>
            <input
              id="reg-nombre"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputCls}
              placeholder="Tu nombre"
            />
          </div>
          <div>
            <label htmlFor="reg-email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="reg-email"
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
            <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-ink">
              Contraseña
            </label>
            <input
              id="reg-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div>
            <label htmlFor="reg-password2" className="mb-1 block text-sm font-medium text-ink">
              Repetir contraseña
            </label>
            <input
              id="reg-password2"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" aria-live="polite" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !configured}
            className="btn-press w-full cursor-pointer rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft outline-none hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Creando…' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-brand-700/70">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
