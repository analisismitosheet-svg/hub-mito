import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  Contact,
  Phone,
  CreditCard,
  UserRound,
  Loader2,
  SearchX,
  Plus,
  Pencil,
  Camera,
  Check,
  X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { getArea } from '@/config/areas'

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

type Vista = 'lista' | 'ficha' | 'form'

const ESTADOS = [
  'ACTIVA',
  'FALTA CEL',
  'FALTA DNI',
  'FALTA CEL Y DNI',
  'FALTA DE DOCUMENTACION',
  'SUSPENDIDA POR FALTA DE PAGO',
  'CANCELADA',
]

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

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
  const { can } = useAuth()
  const location = useLocation()
  const fromArea = (location.state as { fromArea?: string } | null)?.fromArea
  const backTo = fromArea ? `/area/${fromArea}` : '/area/tesoreria'
  const backLabel = (fromArea ? getArea(fromArea)?.name : 'Tesorería') ?? 'Tesorería'
  const puedeCrear = can('cuentas_amigos.create')
  const puedeEditar = can('cuentas_amigos.edit')
  const [todos, setTodos] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [vista, setVista] = useState<Vista>('lista')
  const [sel, setSel] = useState<Cliente | null>(null)
  const [editando, setEditando] = useState<Cliente | null>(null)

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

  function abrirNuevo() {
    setEditando(null)
    setVista('form')
  }
  function abrirEditar(c: Cliente) {
    setEditando(c)
    setVista('form')
  }
  function abrirFicha(c: Cliente) {
    setSel(c)
    setVista('ficha')
  }

  // ---------- FORM (nuevo / editar) ----------
  if (vista === 'form') {
    return (
      <ClienteForm
        inicial={editando}
        onCancel={() => setVista(editando ? 'ficha' : 'lista')}
        onSaved={async (guardado) => {
          await cargar()
          setSel(guardado)
          setVista('ficha')
        }}
      />
    )
  }

  // ---------- FICHA ----------
  if (vista === 'ficha' && sel) {
    return (
      <Layout>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setVista('lista')}
            className="inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
          >
            <ArrowLeft size={15} aria-hidden /> Volver a la lista
          </button>
          {puedeEditar && (
            <button
              onClick={() => abrirEditar(sel)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line"
            >
              <Pencil size={15} aria-hidden /> Editar
            </button>
          )}
        </div>

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

  // ---------- LISTA ----------
  return (
    <Layout>
      <Link
        to={backTo}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden /> {backLabel}
      </Link>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-green-500/30 bg-green-500/15 p-3 text-green-500">
            <Contact size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Cuenta Amigos</h1>
            <p className="text-sm text-sub">Clientes habilitados para retirar mercadería.</p>
          </div>
        </div>
        {puedeCrear && (
          <button
            onClick={abrirNuevo}
            className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-soft hover:bg-brand-700"
          >
            <Plus size={17} aria-hidden /> <span className="hidden sm:inline">Nuevo cliente</span>
          </button>
        )}
      </div>

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
                  <th className="w-10 px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => abrirFicha(c)}
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
                    <td className="px-2 py-2.5 text-right">
                      {puedeEditar && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            abrirEditar(c)
                          }}
                          aria-label={`Editar ${c.nombre}`}
                          className="rounded-lg p-1.5 text-sub transition-colors hover:bg-line hover:text-ink"
                        >
                          <Pencil size={15} aria-hidden />
                        </button>
                      )}
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

// ============ Formulario nuevo/editar ============
function ClienteForm({
  inicial,
  onCancel,
  onSaved,
}: {
  inicial: Cliente | null
  onCancel: () => void
  onSaved: (c: Cliente) => void
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [dni, setDni] = useState(inicial?.dni ?? '')
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '')
  const [formaPago, setFormaPago] = useState(inicial?.forma_pago ?? '')
  const [titular, setTitular] = useState(inicial?.titular ?? '')
  const [estado, setEstado] = useState(inicial?.estado ?? 'ACTIVA')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(inicial?.foto_url ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function elegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function subirFoto(f: File): Promise<string | null> {
    if (!supabase) return null
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `nuevos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage
      .from('dni')
      .upload(path, f, { upsert: true, contentType: f.type || 'image/jpeg' })
    if (error) {
      setError('No se pudo subir la foto: ' + error.message)
      return null
    }
    return supabase.storage.from('dni').getPublicUrl(path).data.publicUrl
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!nombre.trim()) {
      setError('El nombre es obligatorio.')
      return
    }
    if (!supabase) {
      setError('Supabase no está configurado.')
      return
    }
    setBusy(true)
    let foto = inicial?.foto_url ?? null
    if (file) {
      const url = await subirFoto(file)
      if (!url) {
        setBusy(false)
        return
      }
      foto = url
    }
    const payload = {
      nombre: nombre.trim(),
      dni: dni.replace(/\D/g, '') || null,
      telefono: telefono.trim() || null,
      forma_pago: formaPago.trim() || null,
      titular: titular.trim() || null,
      estado,
      foto_url: foto,
    }
    if (inicial) {
      const { data, error } = await supabase
        .from('cuentas_amigos')
        .update(payload)
        .eq('id', inicial.id)
        .select()
        .single()
      setBusy(false)
      if (error) return setError(error.message)
      onSaved(data as Cliente)
    } else {
      const { data, error } = await supabase.from('cuentas_amigos').insert(payload).select().single()
      setBusy(false)
      if (error) return setError(error.message)
      onSaved(data as Cliente)
    }
  }

  return (
    <Layout>
      <button
        onClick={onCancel}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden /> Cancelar
      </button>

      <h1 className="mb-5 font-display text-2xl font-bold text-ink">
        {inicial ? 'Editar cliente' : 'Nuevo cliente'}
      </h1>

      <form onSubmit={guardar} className="mx-auto max-w-xl space-y-4">
        {/* Foto */}
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="mb-3 text-sm font-medium text-ink">Foto del DNI</p>
          <div className="flex items-center gap-4">
            <div className="flex h-28 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface2">
              {preview ? (
                <img src={preview} alt="Foto" className="h-full w-full object-contain" />
              ) : (
                <Camera size={26} className="text-sub" aria-hidden />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={elegirFoto}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line"
              >
                <Camera size={15} aria-hidden /> Subir o sacar foto
              </button>
              <p className="text-xs text-sub">En el celu abre la cámara; en la compu, elegís un archivo.</p>
            </div>
          </div>
        </div>

        <Campo label="Nombre completo *">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="APELLIDO, NOMBRE" required />
        </Campo>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="DNI">
            <input value={dni} onChange={(e) => setDni(e.target.value)} inputMode="numeric" className={inputCls} placeholder="Solo números" />
          </Campo>
          <Campo label="Teléfono">
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" className={inputCls} placeholder="Cel/teléfono" />
          </Campo>
        </div>
        <Campo label="Forma de pago">
          <input value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={inputCls} placeholder="Ej: CTA CTE / EFECTIVO 30%…" />
        </Campo>
        <Campo label="Titular de cuenta">
          <input value={titular} onChange={(e) => setTitular(e.target.value)} className={inputCls} placeholder="Titular" />
        </Campo>
        <Campo label="Estado de cuenta">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
            {ESTADOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Campo>

        {error && (
          <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Check size={17} aria-hidden />}
            {busy ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Crear cliente'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2 px-4 py-2.5 font-medium text-ink hover:bg-line"
          >
            <X size={17} aria-hidden /> Cancelar
          </button>
        </div>
      </form>
    </Layout>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
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
