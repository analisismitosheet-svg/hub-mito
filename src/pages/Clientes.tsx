import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2,
  Search,
  SearchX,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  X,
  Users,
  Building2,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Cliente {
  id: string
  razon_social: string
  telefono: string | null
  transporte: string | null
  direccion_entrega: string | null
  cuenta: string | null
  deposito: string | null
  localidad: string | null
  pago: string | null
  mayor: boolean
  obs_membretes: string | null
  obs_facturacion: string | null
  estado: string | null
  created_at: string
}

const CUENTA_OPCIONES = ['Corriente', 'Crédito', 'Contado']
const DEPOSITO_OPCIONES = ['Central', 'Norte', 'Sur', 'Este', 'Oeste']
const PAGO_OPCIONES = ['15d', '30d', '60d', '90d', 'Contado']
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

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

export default function Clientes() {
  const { can } = useAuth()
  const puedeCrear = can('mayorista.clientes.create')
  const puedeEditar = can('mayorista.clientes.edit')
  const puedeBorrar = can('mayorista.clientes.delete')
  const [todos, setTodos] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'ACTIVO' | 'INACTIVO'>('todos')
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<Cliente | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('clientes')
      .select('*')
      .order('razon_social', { ascending: true })
      .limit(2000)
    if (err) setError(err.message)
    setTodos((data as Cliente[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (filtro !== 'todos') r = r.filter((c) => c.estado === filtro)
    if (!term) return r
    return r.filter(
      (c) =>
        (c.razon_social || '').toUpperCase().includes(term) ||
        (c.telefono || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')),
    )
  }, [todos, term, filtro])

  async function toggleEstado(c: Cliente) {
    if (!supabase) return
    const nuevo = c.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'
    const { error: err } = await supabase.from('clientes').update({ estado: nuevo }).eq('id', c.id)
    if (err) { mostrarToast('Error al cambiar estado'); return }
    await cargar()
    mostrarToast(nuevo === 'ACTIVO' ? 'Cliente activado' : 'Cliente desactivado')
  }

  async function eliminar(c: Cliente) {
    if (!supabase) return
    if (!window.confirm('Eliminar "' + c.razon_social + '"?')) return
    const { error: err } = await supabase.from('clientes').delete().eq('id', c.id)
    if (err) { mostrarToast('Error al eliminar'); return }
    setSel(null); await cargar(); mostrarToast('Cliente eliminado')
  }

  const totalActivos = todos.filter((c) => c.estado === 'ACTIVO').length
  const totalInactivos = todos.filter((c) => c.estado !== 'ACTIVO').length

  const ToastEl = () =>
    toast ? (
      <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">
        {toast}
      </div>
    ) : null

  return (
    <Layout>
      <ToastEl />
      <BackButton />

      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border border-brand-600/40 bg-brand-600/15 p-3 text-brand-500">
          <Users size={26} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            Clientes <span className="text-sm font-normal text-sub">({todos.length})</span>
          </h1>
          <p className="text-sm text-sub">Gestión de clientes mayoristas, direcciones y condiciones de pago.</p>
        </div>
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por razón social o teléfono..."
            className={inputCls + ' pl-8 py-1.5 text-xs'}
          />
        </div>
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as typeof filtro)}
          className={inputCls + ' w-auto py-1.5 text-xs'}
        >
          <option value="todos">Todos</option>
          <option value="ACTIVO">Activos</option>
          <option value="INACTIVO">Inactivos</option>
        </select>
        <span className="text-[11px] text-sub/70">
          {totalActivos} act / {totalInactivos} inact / {todos.length} total
        </span>
        {puedeCrear && (
          <button
            onClick={() => setModal('new')}
            className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            <Plus size={13} aria-hidden /> Nuevo Cliente
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">
            {term || filtro !== 'todos'
              ? 'No se encontraron clientes.'
              : 'Todavía no hay clientes cargados.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line overflow-hidden">
          <table className="w-full text-[13px] leading-tight">
            <thead>
              <tr className="border-b border-line bg-zinc-800 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                <th className="w-[18%] px-2 py-2 whitespace-nowrap">Razón Social</th>
                <th className="w-[12%] px-2 py-2 whitespace-nowrap">Teléfono</th>
                <th className="w-[12%] px-2 py-2 whitespace-nowrap">Transporte</th>
                <th className="w-[18%] px-2 py-2 whitespace-nowrap">Dirección</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">Cuenta</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">Depósito</th>
                <th className="w-[10%] px-2 py-2 whitespace-nowrap">Localidad</th>
                <th className="w-[8%] px-2 py-2 whitespace-nowrap">Pago</th>
                <th className="w-[8%] px-2 py-2 whitespace-nowrap">Estado</th>
                <th className="w-[4%] px-2 py-2 text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50 bg-surface">
              {lista.map((c) => (
                <tr key={c.id} className="transition hover:bg-line/20">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-400">
                        {iniciales(c.razon_social)}
                      </div>
                      <span className="block truncate font-medium text-ink" title={c.razon_social}>
                        {c.razon_social}
                        {c.mayor && (
                          <span className="ml-1 inline-block rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[8px] font-semibold text-amber-400">MAY</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block truncate text-sub" title={c.telefono || ''}>
                      {c.telefono || <span className="text-sub/40">—</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block truncate text-sub" title={c.transporte || ''}>
                      {c.transporte || <span className="text-sub/40">—</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block truncate text-sub" title={c.direccion_entrega || ''}>
                      {c.direccion_entrega || <span className="text-sub/40">—</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-sub">{c.cuenta || '—'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-sub">{c.deposito || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className="block truncate text-sub" title={c.localidad || ''}>
                      {c.localidad || <span className="text-sub/40">—</span>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-sub">{c.pago || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className={'inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium ' + estadoStyle(c.estado)}>
                      {c.estado || 'INACTIVO'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {puedeEditar && (
                        <button
                          onClick={() => { setSel(c); setModal('edit') }}
                          className="rounded border border-line p-1 text-sub transition hover:text-ink"
                          title="Editar"
                          aria-label={`Editar ${c.razon_social}`}
                        >
                          <Pencil size={12} aria-hidden />
                        </button>
                      )}
                      <button
                        onClick={() => void toggleEstado(c)}
                        className="rounded border border-line p-1 text-sub transition hover:text-ink"
                        title={c.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}
                      >
                        {c.estado === 'ACTIVO' ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                      </button>
                      {puedeBorrar && (
                        <button
                          onClick={() => { setSel(c); void eliminar(c) }}
                          className="rounded border border-line p-1 text-sub transition hover:text-ink"
                          title="Eliminar"
                          aria-label={`Eliminar ${c.razon_social}`}
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ClienteModal
          cliente={modal === 'edit' ? sel : null}
          onClose={() => { setModal(null); setSel(null) }}
          onSaved={async () => { setModal(null); setSel(null); await cargar(); mostrarToast(modal === 'edit' ? 'Cliente actualizado' : 'Cliente creado') }}
        />
      )}
    </Layout>
  )
}

function ClienteModal({
  cliente,
  onClose,
  onSaved,
}: {
  cliente: Cliente | null
  onClose: () => void
  onSaved: () => void
}) {
  const [razonSocial, setRazonSocial] = useState(cliente?.razon_social || '')
  const [telefono, setTelefono] = useState(cliente?.telefono || '')
  const [transporte, setTransporte] = useState(cliente?.transporte || '')
  const [direccionEntrega, setDireccionEntrega] = useState(cliente?.direccion_entrega || '')
  const [cuenta, setCuenta] = useState(cliente?.cuenta || 'Corriente')
  const [deposito, setDeposito] = useState(cliente?.deposito || 'Central')
  const [localidad, setLocalidad] = useState(cliente?.localidad || '')
  const [pago, setPago] = useState(cliente?.pago || '30d')
  const [mayor, setMayor] = useState(cliente?.mayor ?? false)
  const [obsMembretes, setObsMembretes] = useState(cliente?.obs_membretes || '')
  const [obsFacturacion, setObsFacturacion] = useState(cliente?.obs_facturacion || '')
  const [estado, setEstado] = useState(cliente?.estado || 'ACTIVO')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!razonSocial.trim()) { setError('La razón social es obligatoria.'); return }
    setBusy(true)
    setError(null)

    const payload = {
      razon_social: razonSocial.trim(),
      telefono: telefono.trim() || null,
      transporte: transporte.trim() || null,
      direccion_entrega: direccionEntrega.trim() || null,
      cuenta,
      deposito,
      localidad: localidad.trim() || null,
      pago,
      mayor,
      obs_membretes: obsMembretes.trim() || null,
      obs_facturacion: obsFacturacion.trim() || null,
      estado,
    }

    let result
    if (cliente) {
      result = await supabase.from('clientes').update(payload).eq('id', cliente.id).select().single()
    } else {
      result = await supabase.from('clientes').insert(payload).select().single()
    }
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display font-semibold text-ink">
              <Building2 size={16} aria-hidden /> {cliente ? 'Editar cliente' : 'Nuevo Cliente'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Razón Social *</span>
            <input
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              placeholder="Ej: Distribuidora del Sur"
              className={inputCls}
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Teléfono</span>
            <input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="3516 82-1473"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Transporte</span>
            <input
              value={transporte}
              onChange={(e) => setTransporte(e.target.value)}
              placeholder="Ej: CREDIFIN"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Dirección de Entrega</span>
            <input
              value={direccionEntrega}
              onChange={(e) => setDireccionEntrega(e.target.value)}
              placeholder="Av. Colón 1234"
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Cuenta</span>
              <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={inputCls}>
                {CUENTA_OPCIONES.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Depósito</span>
              <select value={deposito} onChange={(e) => setDeposito(e.target.value)} className={inputCls}>
                {DEPOSITO_OPCIONES.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Localidad</span>
              <input
                value={localidad}
                onChange={(e) => setLocalidad(e.target.value)}
                placeholder="Córdoba"
                className={inputCls}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Pago</span>
              <select value={pago} onChange={(e) => setPago(e.target.value)} className={inputCls}>
                {PAGO_OPCIONES.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-0.5">
              <input
                type="checkbox"
                checked={mayor}
                onChange={(e) => setMayor(e.target.checked)}
                className="h-4 w-4 rounded border-line bg-surface2 accent-brand-600"
              />
              <span className="text-sm text-ink">Mayor</span>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Observaciones Membretes</span>
            <textarea
              value={obsMembretes}
              onChange={(e) => setObsMembretes(e.target.value)}
              placeholder="Facturar con membrete oficial"
              rows={2}
              className={inputCls + ' resize-none'}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Observaciones Facturación</span>
            <textarea
              value={obsFacturacion}
              onChange={(e) => setObsFacturacion(e.target.value)}
              placeholder="IVA responsable inscripto"
              rows={2}
              className={inputCls + ' resize-none'}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
              <option value="ACTIVO">Activo</option>
              <option value="INACTIVO">Inactivo</option>
            </select>
          </label>

          {error && <p className="text-sm text-brand-400">{error}</p>}

          <div className="flex gap-2 border-t border-line pt-3">
            <button
              type="submit"
              disabled={busy}
              className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {cliente ? 'Guardar cambios' : 'Crear Cliente'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
