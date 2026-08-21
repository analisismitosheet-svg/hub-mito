import { useEffect, useMemo, useRef, useState, useCallback, type FormEvent } from 'react'
import {
  ArrowLeft,
  Search,
  Loader2,
  SearchX,
  Plus,
  Pencil,
  Truck,
  Phone,
  Mail,
  Copy,
  MessageCircle,
  MapPin,
  Clock,
  Car,
  Box,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Transporte {
  id: string
  nombre: string
  empresa: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  patente: string | null
  tipo_vehiculo: string | null
  capacidad: string | null
  zonas_cobertura: string | null
  horarios: string | null
  estado: string | null
  observaciones: string | null
  created_at: string
}

type Vista = 'lista' | 'ficha' | 'form'

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

function estadoStyle(estado: string | null): string {
  const e = (estado || '').toUpperCase()
  if (e === 'ACTIVO') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  return 'bg-brand-600/15 text-brand-400 border-brand-600/30'
}

function iniciales(nombre: string | null): string {
  if (!nombre) return '?'
  const p = nombre.replace(',', ' ').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).slice(0, 2).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ */
/*  Copy-to-clipboard helper                                           */
/* ------------------------------------------------------------------ */

function copiar(texto: string) {
  if (!texto) return
  void navigator.clipboard.writeText(texto)
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export default function Transportes() {
  const { can } = useAuth()
  const puedeCrear  = can('mayorista.transportes.create')
  const puedeEditar = can('mayorista.transportes.edit')
  const puedeBorrar = can('mayorista.transportes.delete')

  const [todos, setTodos] = useState<Transporte[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'ACTIVO' | 'INACTIVO'>('todos')
  const [vista, setVista] = useState<Vista>('lista')
  const [sel, setSel] = useState<Transporte | null>(null)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  /* ---------- data loading ---------- */

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    const { data } = await supabase
      .from('transportes')
      .select('*')
      .order('nombre', { ascending: true })
      .limit(2000)
    setTodos((data as Transporte[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  /* ---------- search + filter ---------- */

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let result = todos
    if (filtro !== 'todos') result = result.filter((t) => t.estado === filtro)
    if (!term) return result
    return result.filter(
      (t) =>
        (t.nombre || '').toUpperCase().includes(term) ||
        (t.empresa || '').toUpperCase().includes(term) ||
        (t.telefono || '').includes(term.replace(/\D/g, '')) ||
        (t.patente || '').toUpperCase().includes(term),
    )
  }, [todos, term, filtro])

  /* ---------- toggles ---------- */

  async function toggleEstado(t: Transporte) {
    if (!supabase) return
    const nuevo = t.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'
    const { error } = await supabase.from('transportes').update({ estado: nuevo }).eq('id', t.id)
    if (error) { mostrarToast('Error al cambiar estado'); return }
    await cargar()
    mostrarToast(nuevo === 'ACTIVO' ? 'Transporte activado' : 'Transporte desactivado')
  }

  async function eliminar(t: Transporte) {
    if (!supabase) return
    if (!window.confirm(`¿Eliminar "${t.nombre}"? Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('transportes').delete().eq('id', t.id)
    if (error) { mostrarToast('Error al eliminar'); return }
    setVista('lista')
    setSel(null)
    await cargar()
    mostrarToast('Transporte eliminado')
  }

  /* ---------- open helpers ---------- */

  function abrirNuevo() { setEditando(null); setVista('form') }
  function abrirEditar(t: Transporte) { setEditando(t); setVista('form') }
  function abrirFicha(t: Transporte) { setSel(t); setVista('ficha') }

  /* ---------- counts ---------- */

  const totalActivos   = todos.filter((t) => t.estado === 'ACTIVO').length
  const totalInactivos = todos.filter((t) => t.estado !== 'ACTIVO').length

  /* ---------- FORM ---------- */

  if (vista === 'form') {
    return (
      <TransporteForm
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

  /* ---------- FICHA ---------- */

  if (vista === 'ficha' && sel) {
    return (
      <Layout>
        {toast && (
          <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">
            {toast}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setVista('lista')}
            className="inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
          >
            <ArrowLeft size={15} aria-hidden /> Volver a la lista
          </button>
          <div className="flex items-center gap-2">
            {puedeEditar && (
              <button
                onClick={() => abrirEditar(sel)}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line"
              >
                <Pencil size={15} aria-hidden /> Editar
              </button>
            )}
            {puedeBorrar && (
              <button
                onClick={() => void eliminar(sel)}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-brand-600/30 bg-brand-600/10 px-3 py-1.5 text-sm font-medium text-brand-400 hover:bg-brand-600/20"
              >
                <Trash2 size={15} aria-hidden /> Eliminar
              </button>
            )}
          </div>
        </div>

        <article className="mx-auto max-w-xl animate-enter overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <header className="flex items-center gap-3 border-b border-line p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-display font-semibold text-amber-400">
              {iniciales(sel.nombre)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display font-semibold text-ink">{sel.nombre}</h3>
              {sel.empresa && <p className="text-xs text-sub">{sel.empresa}</p>}
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${estadoStyle(sel.estado)}`}>
              {sel.estado || 'INACTIVO'}
            </span>
          </header>

          {/* Quick actions */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            {sel.telefono && (
              <>
                <a
                  href={`tel:${sel.telefono}`}
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"
                >
                  <Phone size={13} aria-hidden /> Llamar
                </a>
                <button
                  onClick={() => { copiar(sel.telefono!); mostrarToast('Teléfono copiado') }}
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"
                >
                  <Copy size={13} aria-hidden /> Copiar
                </button>
                <a
                  href={`https://wa.me/${(sel.whatsapp || sel.telefono || '').replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20"
                >
                  <MessageCircle size={13} aria-hidden /> WhatsApp
                </a>
              </>
            )}
            {sel.email && (
              <a
                href={`mailto:${sel.email}`}
                className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"
              >
                <Mail size={13} aria-hidden /> Email
              </a>
            )}
          </div>

          <dl className="divide-y divide-line/70">
            {sel.patente && (
              <Row icon={Car} label="Patente" value={sel.patente.toUpperCase()} mono />
            )}
            {sel.tipo_vehiculo && (
              <Row icon={Truck} label="Tipo de vehículo" value={sel.tipo_vehiculo} />
            )}
            {sel.capacidad && (
              <Row icon={Box} label="Capacidad" value={sel.capacidad} />
            )}
            {sel.zonas_cobertura && (
              <Row icon={MapPin} label="Zonas de cobertura" value={sel.zonas_cobertura} />
            )}
            {sel.horarios && (
              <Row icon={Clock} label="Horarios" value={sel.horarios} />
            )}
            {sel.observaciones && (
              <Row label="Observaciones" value={sel.observaciones} />
            )}
          </dl>
        </article>
      </Layout>
    )
  }

  /* ---------- LISTA ---------- */

  return (
    <Layout>
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
      <BackButton />

      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Transportes</h1>
        <p className="mt-1 text-sm text-sub">Gestión de transportes: crear, editar y administrar.</p>
      </header>

      {/* Summary bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-sub">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-400">
          <Eye size={12} aria-hidden /> {totalActivos} activos
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-brand-400">
          <EyeOff size={12} aria-hidden /> {totalInactivos} inactivos
        </span>
        <span className="text-sub/70">· {todos.length} total</span>
      </div>

      {/* Search + filter + new */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[200px]">
          <span className="mb-1 block text-xs font-medium text-sub">Buscar</span>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, empresa, patente o teléfono…"
              className={`${inputCls} pl-9`}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-sub">Estado</span>
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            className={`${inputCls} w-auto`}
          >
            <option value="todos">Todos</option>
            <option value="ACTIVO">Activos</option>
            <option value="INACTIVO">Inactivos</option>
          </select>
        </label>
        {puedeCrear && (
          <button
            onClick={abrirNuevo}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={15} aria-hidden /> Nuevo transporte
          </button>
        )}
      </div>

      {/* Content */}
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">
            {term || filtro !== 'todos' ? 'No se encontraron transportes con esos filtros.' : 'Todavía no hay transportes cargados.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-sub">
                  <th className="px-4 py-2.5">Nombre</th>
                  <th className="px-4 py-2.5">Empresa</th>
                  <th className="px-4 py-2.5">Patente</th>
                  <th className="px-4 py-2.5">Teléfono</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {lista.map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer transition hover:bg-line/30"
                    onClick={() => abrirFicha(t)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400">
                          {iniciales(t.nombre)}
                        </div>
                        <span className="font-medium text-ink">{t.nombre}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sub">{t.empresa || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-sub">{t.patente?.toUpperCase() || '—'}</td>
                    <td className="px-4 py-2.5 text-sub">{t.telefono || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${estadoStyle(t.estado)}`}>
                        {t.estado || 'INACTIVO'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {puedeEditar && (
                          <button
                            onClick={() => abrirEditar(t)}
                            aria-label={`Editar ${t.nombre}`}
                            className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                          >
                            <Pencil size={13} aria-hidden />
                          </button>
                        )}
                        <button
                          onClick={() => void toggleEstado(t)}
                          aria-label={t.estado === 'ACTIVO' ? `Desactivar ${t.nombre}` : `Activar ${t.nombre}`}
                          className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                        >
                          {t.estado === 'ACTIVO' ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-line/70">
            {lista.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition hover:bg-line/30"
                onClick={() => abrirFicha(t)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-400">
                  {iniciales(t.nombre)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{t.nombre}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${estadoStyle(t.estado)}`}>
                      {t.estado || 'INACTIVO'}
                    </span>
                  </div>
                  <p className="truncate text-xs text-sub">
                    {[t.empresa, t.patente?.toUpperCase(), t.telefono].filter(Boolean).join(' · ') || 'Sin datos'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {puedeEditar && (
                    <button
                      onClick={() => abrirEditar(t)}
                      aria-label={`Editar ${t.nombre}`}
                      className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                  )}
                  <button
                    onClick={() => void toggleEstado(t)}
                    aria-label={t.estado === 'ACTIVO' ? `Desactivar ${t.nombre}` : `Activar ${t.nombre}`}
                    className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                  >
                    {t.estado === 'ACTIVO' ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */
/*  Row helper (detail view)                                           */
/* ------------------------------------------------------------------ */

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon?: typeof Truck
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-sub/60" aria-hidden />}
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-sub">{label}</dt>
        <dd className={`mt-0.5 break-words text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Form (create / edit)                                               */
/* ------------------------------------------------------------------ */

function TransporteForm({
  inicial,
  onCancel,
  onSaved,
}: {
  inicial: Transporte | null
  onCancel: () => void
  onSaved: (t: Transporte) => void
}) {
  const [nombre, setNombre]       = useState(inicial?.nombre || '')
  const [empresa, setEmpresa]     = useState(inicial?.empresa || '')
  const [telefono, setTelefono]   = useState(inicial?.telefono || '')
  const [whatsapp, setWhatsapp]   = useState(inicial?.whatsapp || '')
  const [email, setEmail]         = useState(inicial?.email || '')
  const [patente, setPatente]     = useState(inicial?.patente || '')
  const [tipoVehiculo, setTipoVehiculo] = useState(inicial?.tipo_vehiculo || '')
  const [capacidad, setCapacidad] = useState(inicial?.capacidad || '')
  const [zonas, setZonas]         = useState(inicial?.zonas_cobertura || '')
  const [horarios, setHorarios]   = useState(inicial?.horarios || '')
  const [estado, setEstado]       = useState(inicial?.estado || 'ACTIVO')
  const [obs, setObs]             = useState(inicial?.observaciones || '')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }

    setBusy(true)
    setError(null)

    const payload = {
      nombre: nombre.trim(),
      empresa: empresa.trim() || null,
      telefono: telefono.trim() || null,
      whatsapp: whatsapp.trim() || null,
      email: email.trim() || null,
      patente: patente.trim() || null,
      tipo_vehiculo: tipoVehiculo.trim() || null,
      capacidad: capacidad.trim() || null,
      zonas_cobertura: zonas.trim() || null,
      horarios: horarios.trim() || null,
      estado,
      observaciones: obs.trim() || null,
    }

    let result
    if (inicial) {
      result = await supabase.from('transportes').update(payload).eq('id', inicial.id).select().single()
    } else {
      result = await supabase.from('transportes').insert(payload).select().single()
    }

    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved(result.data as Transporte)
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">
          {inicial ? 'Editar transporte' : 'Nuevo transporte'}
        </h1>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Datos principales */}
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-sub">Datos principales</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-sub">Nombre *</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan López" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Empresa</span>
              <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Transportes SA" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Patente</span>
              <input value={patente} onChange={(e) => setPatente(e.target.value)} placeholder="ABC 123" className={`${inputCls} uppercase`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Tipo de vehículo</span>
              <select value={tipoVehiculo} onChange={(e) => setTipoVehiculo(e.target.value)} className={inputCls}>
                <option value="">Seleccionar…</option>
                <option value="CAMION">Camión</option>
                <option value="CAMIONETA">Camioneta</option>
                <option value="FURGON">Furgón</option>
                <option value="MOTO">Moto</option>
                <option value="ACOPLE">Acople</option>
                <option value="SEMIACOPLE">Semi-acople</option>
                <option value="OTRO">Otro</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Capacidad</span>
              <input value={capacidad} onChange={(e) => setCapacidad(e.target.value)} placeholder="Ej: 1.5 ton, 20 m³" className={inputCls} />
            </label>
          </div>
        </fieldset>

        {/* Contacto */}
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-sub">Contacto</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Teléfono</span>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+54 11 1234-5678" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">WhatsApp</span>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="5491112345678" className={inputCls} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-sub">Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@transportes.com" className={inputCls} />
            </label>
          </div>
        </fieldset>

        {/* Operación */}
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-sub">Operación</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-sub">Zonas de cobertura</span>
              <textarea value={zonas} onChange={(e) => setZonas(e.target.value)} placeholder="Ej: CABA, GBA Norte, Zona Oeste" rows={2} className={`${inputCls} resize-none`} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-sub">Horarios</span>
              <input value={horarios} onChange={(e) => setHorarios(e.target.value)} placeholder="Ej: Lun-Vie 8 a 18, Sáb 8 a 13" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>
          </div>
        </fieldset>

        {/* Observaciones */}
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-sub">Observaciones</legend>
          <label className="mt-3 block">
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Notas internas, restricciones, etc." rows={3} className={`${inputCls} resize-none`} />
          </label>
        </fieldset>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {inicial ? 'Guardar cambios' : 'Crear transporte'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Layout>
  )
}
