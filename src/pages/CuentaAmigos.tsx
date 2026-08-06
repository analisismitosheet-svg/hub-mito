import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  Contact,
  Phone,
  CreditCard,
  UserRound,
  Loader2,
  SearchX,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'

interface Cliente {
  id: number
  dni: string | null
  nombre: string | null
  telefono: string | null
  forma_pago: string | null
  titular: string | null
  estado: string | null
}

/** Estilo del semáforo de estado según el texto del estado. */
function estadoStyle(estado: string | null): { cls: string; label: string } {
  const e = (estado || '').toUpperCase()
  if (e === 'ACTIVA') return { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'ACTIVA' }
  if (e.includes('CANCEL') || e.includes('CERRADA') || e.includes('SUSPEND') || e.includes('DEUDA'))
    return { cls: 'bg-brand-600/15 text-brand-400 border-brand-600/30', label: e }
  if (e.includes('FALTA'))
    return { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: e }
  return { cls: 'bg-surface2 text-sub border-line2', label: e || 'SIN ESTADO' }
}

function fmtDni(dni: string | null): string {
  if (!dni) return '—'
  const n = dni.replace(/\D/g, '')
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function iniciales(nombre: string | null): string {
  if (!nombre) return '?'
  const parts = nombre.replace(',', ' ').trim().split(/\s+/)
  return (parts[0]?.[0] || '' + (parts[1]?.[0] || '')).slice(0, 2).toUpperCase() || '?'
}

export default function CuentaAmigos() {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(false)
  const [buscado, setBuscado] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const term = q.trim()

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (term.length < 2) {
      setResultados([])
      setBuscado(false)
      return
    }
    debounce.current = setTimeout(() => void buscar(term), 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  async function buscar(t: string) {
    if (!supabase) return
    setLoading(true)
    const like = `%${t}%`
    const { data } = await supabase
      .from('cuentas_amigos')
      .select('id,dni,nombre,telefono,forma_pago,titular,estado')
      .or(`dni.ilike.${like},nombre.ilike.${like}`)
      .order('nombre', { ascending: true })
      .limit(30)
    setResultados((data as Cliente[]) ?? [])
    setLoading(false)
    setBuscado(true)
  }

  const hint = useMemo(() => {
    if (!term) return 'Ingresá un DNI o un nombre para buscar.'
    if (term.length < 2) return 'Escribí al menos 2 caracteres.'
    return null
  }, [term])

  return (
    <Layout>
      <Link
        to="/area/locales"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden /> Locales
      </Link>

      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-xl border border-green-500/30 bg-green-500/15 p-3 text-green-500">
          <Contact size={26} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Cuenta Amigos</h1>
          <p className="text-sm text-sub">Clientes habilitados para retirar mercadería.</p>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative mb-6">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub"
        />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="search"
          placeholder="Buscar por DNI o nombre…"
          className="w-full rounded-xl border border-line bg-surface2 py-3 pl-10 pr-10 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
        />
        {loading && (
          <Loader2
            size={18}
            aria-hidden
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-sub"
          />
        )}
      </div>

      {hint && <p className="text-sm text-sub">{hint}</p>}

      {!hint && buscado && !loading && resultados.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <SearchX size={28} aria-hidden />
          <p>
            No se encontró ningún cliente con “<span className="text-ink">{term}</span>”.
          </p>
        </div>
      )}

      {resultados.length > 0 && (
        <>
          <p className="mb-3 text-sm text-sub">
            {resultados.length} resultado{resultados.length > 1 ? 's' : ''}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {resultados.map((c) => {
              const est = estadoStyle(c.estado)
              return (
                <article
                  key={c.id}
                  className="animate-enter overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
                >
                  <header className="flex items-center gap-3 border-b border-line p-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600/15 font-display font-semibold text-brand-400">
                      {iniciales(c.nombre)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-display font-semibold text-ink">{c.nombre}</h3>
                      <p className="text-xs text-sub">Cuenta amigo</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${est.cls}`}
                    >
                      {est.label}
                    </span>
                  </header>

                  <dl className="divide-y divide-line/70">
                    <Row icon={Contact} label="DNI" value={fmtDni(c.dni)} mono />
                    <Row icon={Phone} label="Teléfono" value={c.telefono || '—'} />
                    <Row icon={CreditCard} label="Forma de pago" value={c.forma_pago || '—'} />
                    <Row icon={UserRound} label="Titular de cuenta" value={c.titular || '—'} />
                  </dl>
                </article>
              )
            })}
          </div>
        </>
      )}
    </Layout>
  )
}

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Contact
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-sub" />
      <dt className="w-32 shrink-0 text-sm text-sub">{label}</dt>
      <dd className={`min-w-0 flex-1 text-sm text-ink ${mono ? 'font-mono tracking-wide' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
