import { useEffect, useMemo, useState } from 'react'
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
  foto_url: string | null
}

/** Estilo del semáforo de estado según el texto del estado. */
function estadoStyle(estado: string | null): string {
  const e = (estado || '').toUpperCase()
  if (e === 'ACTIVA') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (e.includes('CANCEL') || e.includes('CERRAD') || e.includes('SUSPEND') || e.includes('DEUDA'))
    return 'bg-brand-600/15 text-brand-400 border-brand-600/30'
  if (e.includes('FALTA')) return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return 'bg-surface2 text-sub border-line2'
}

function fmtDni(dni: string | null): string {
  if (!dni) return '—'
  return dni.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function iniciales(nombre: string | null): string {
  if (!nombre) return '?'
  const p = nombre.replace(',', ' ').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).slice(0, 2).toUpperCase() || '?'
}

/** Foto del DNI: se oculta sola si todavía no fue subida al storage. */
function FotoDni({ url }: { url: string | null }) {
  const [ok, setOk] = useState(true)
  if (!url || !ok) return null
  return (
    <div className="border-b border-line bg-surface2">
      <img
        src={url}
        alt="Foto del DNI"
        loading="lazy"
        onError={() => setOk(false)}
        className="mx-auto max-h-72 w-full object-contain"
      />
    </div>
  )
}

export default function CuentaAmigos() {
  const [todos, setTodos] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Cliente | null>(null)

  useEffect(() => {
    void cargar()
  }, [])

  async function cargar() {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    const { data } = await supabase
      .from('cuentas_amigos')
      .select('id,dni,nombre,telefono,forma_pago,titular,estado,foto_url')
      .order('nombre', { ascending: true })
      .limit(2000)
    setTodos((data as Cliente[]) ?? [])
    setCargando(false)
  }

  const term = q.trim().toUpperCase()
  const digits = q.replace(/\D/g, '')
  const lista = useMemo(() => {
    if (!term) return todos
    return todos.filter(
      (c) =>
        (c.nombre || '').toUpperCase().includes(term) ||
        (digits.length >= 2 && (c.dni || '').includes(digits)),
    )
  }, [todos, term, digits])

  // ---- Vista de ficha (cliente seleccionado) ----
  if (sel) {
    return (
      <Layout>
        <button
          onClick={() => setSel(null)}
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
        >
          <ArrowLeft size={15} aria-hidden /> Volver a la lista
        </button>

        <article className="mx-auto max-w-xl animate-enter overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <FotoDni url={sel.foto_url} />
          <header className="flex items-center gap-3 border-b border-line p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600/15 font-display font-semibold text-brand-400">
              {iniciales(sel.nombre)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display font-semibold text-ink">{sel.nombre}</h3>
              <p className="text-xs text-sub">Cuenta amigo</p>
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${estadoStyle(sel.estado)}`}>
              {sel.estado || 'SIN ESTADO'}
            </span>
          </header>
          <dl className="divide-y divide-line/70">
            <Row icon={Contact} label="DNI" value={fmtDni(sel.dni)} mono />
            <Row icon={Phone} label="Teléfono" value={sel.telefono || '—'} />
            <Row icon={CreditCard} label="Forma de pago" value={sel.forma_pago || '—'} />
            <Row icon={UserRound} label="Titular de cuenta" value={sel.titular || '—'} />
          </dl>
        </article>
      </Layout>
    )
  }

  // ---- Vista de lista ----
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
      <div className="relative mb-4">
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="search"
          placeholder="Filtrar por nombre o DNI…"
          className="w-full rounded-xl border border-line bg-surface2 py-3 pl-10 pr-24 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-sub">
          {cargando ? '' : `${lista.length} de ${todos.length}`}
        </span>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando clientes…
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <SearchX size={28} aria-hidden />
          <p>No se encontró ningún cliente con “<span className="text-ink">{q.trim()}</span>”.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 bg-surface2 text-left">
                  <th className="w-10 px-3 py-2.5 font-medium text-sub">#</th>
                  <th className="px-3 py-2.5 font-medium text-sub">Nombre</th>
                  <th className="px-3 py-2.5 font-medium text-sub">DNI</th>
                  <th className="px-3 py-2.5 font-medium text-sub">Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => setSel(c)}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface2"
                  >
                    <td className="px-3 py-2.5 text-sub">{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-ink">{c.nombre}</td>
                    <td className="px-3 py-2.5 font-mono tracking-wide text-sub">{fmtDni(c.dni)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${estadoStyle(c.estado)}`}>
                        {c.estado || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
      <dd className={`min-w-0 flex-1 text-sm text-ink ${mono ? 'font-mono tracking-wide' : ''}`}>{value}</dd>
    </div>
  )
}
