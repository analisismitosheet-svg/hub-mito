import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Plus, Pencil, Trash2, Eye, EyeOff, X, Hash, Upload,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Cliente {
  id: string
  n_cliente: number | null
  razon_social: string
  telefono: string | null
  direccion_barrio: string | null
  localidad_provincia: string | null
  transporte: string | null
  direccion_entrega: string | null
  valor_declarado: string | null
  cuenta: string | null
  sucursal: string | null
  obs_membretes: string | null
  obs_facturacion: string | null
  estado: string | null
  created_at: string
}

const CUENTA_OPCIONES = ['Corriente', 'Credito', 'Contado']
const VALOR_DEC_OPCIONES = ['Al neto', '75%', '80%', '85%', '90%', '100%']
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

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

function fmtN(n: number | null): string {
  if (n == null) return '-'
  return String(n)
}

function nextNCliente(todos: Cliente[]): number {
  const max = todos.reduce((m, c) => Math.max(m, c.n_cliente ?? 0), 0)
  return max > 0 ? max + 1 : 1001
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
  const [modal, setModal] = useState<'new' | 'edit' | 'importar' | null>(null)
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
      .order('n_cliente', { ascending: true })
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
      <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">{toast}</div>
    ) : null

  return (
    <Layout>
      <ToastEl />
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Clientes <span className="text-sm font-normal text-sub">({todos.length})</span></h1>
      </header>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por razon social o telefono..." className={inputCls + ' pl-8 text-xs'} />
        </div>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className={inputCls + ' w-auto text-xs'}>
          <option value="todos">Todos</option><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option>
        </select>
        <span className="text-[11px] text-sub/70">{totalActivos} act / {totalInactivos} inact / {todos.length} total</span>
        {puedeCrear && (
          <>
            <button onClick={() => setModal('importar')} className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">
              <Upload size={13} aria-hidden /> Importar
            </button>
            <button onClick={() => setModal('new')} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
              <Plus size={13} aria-hidden /> Nuevo Cliente
            </button>
          </>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{term || filtro !== 'todos' ? 'No se encontraron clientes.' : 'Todavia no hay clientes cargados.'}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line overflow-hidden">
          <table className="w-full text-[12px] leading-tight">
            <thead>
              <tr className="border-b border-line bg-zinc-800 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                <th className="w-[5%] px-1.5 py-1.5 text-center whitespace-nowrap">N</th>
                <th className="w-[14%] px-1.5 py-1.5 whitespace-nowrap">Razon Social</th>
                <th className="w-[9%] px-1.5 py-1.5 whitespace-nowrap">Telefono</th>
                <th className="w-[12%] px-1.5 py-1.5 whitespace-nowrap">Dir / Barrio</th>
                <th className="w-[11%] px-1.5 py-1.5 whitespace-nowrap">Localidad / Prov</th>
                <th className="w-[9%] px-1.5 py-1.5 whitespace-nowrap">Transporte</th>
                <th className="w-[11%] px-1.5 py-1.5 whitespace-nowrap">Dir Entrega</th>
                <th className="w-[6%] px-1.5 py-1.5 text-center whitespace-nowrap">% V.Dec</th>
                <th className="w-[7%] px-1.5 py-1.5 whitespace-nowrap">Cuenta</th>
                <th className="w-[7%] px-1.5 py-1.5 whitespace-nowrap">Sucursal</th>
                <th className="w-[5%] px-1.5 py-1.5 whitespace-nowrap">Estado</th>
                <th className="w-[4%] px-1.5 py-1.5 text-right whitespace-nowrap">Acc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50 bg-surface">
              {lista.map((c) => (
                <tr key={c.id} className="transition hover:bg-line/20">
                  <td className="px-1.5 py-1 text-center text-[11px] font-medium text-sub">{fmtN(c.n_cliente)}</td>
                  <td className="px-1.5 py-1">
                    <div className="flex items-center gap-1">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[9px] font-semibold text-amber-400">{iniciales(c.razon_social)}</div>
                      <span className="block truncate font-medium text-ink" title={c.razon_social}>{c.razon_social}</span>
                    </div>
                  </td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub">{c.telefono || '-'}</span></td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub" title={c.direccion_barrio || ''}>{c.direccion_barrio || '-'}</span></td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub" title={c.localidad_provincia || ''}>{c.localidad_provincia || '-'}</span></td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub">{c.transporte || '-'}</span></td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub" title={c.direccion_entrega || ''}>{c.direccion_entrega || '-'}</span></td>
                  <td className="px-1.5 py-1 text-center text-sub">{c.valor_declarado || '-'}</td>
                  <td className="px-1.5 py-1 whitespace-nowrap text-sub">{c.cuenta || '-'}</td>
                  <td className="px-1.5 py-1"><span className="block truncate text-sub">{c.sucursal || '-'}</span></td>
                  <td className="px-1.5 py-1"><span className={'inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium ' + estadoStyle(c.estado)}>{c.estado || 'INACTIVO'}</span></td>
                  <td className="px-1.5 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {puedeEditar && <button onClick={() => { setSel(c); setModal('edit') }} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={11} aria-hidden /></button>}
                      <button onClick={() => void toggleEstado(c)} className="rounded border border-line p-1 text-sub transition hover:text-ink" title={c.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}>{c.estado === 'ACTIVO' ? <EyeOff size={11} aria-hidden /> : <Eye size={11} aria-hidden />}</button>
                      {puedeBorrar && <button onClick={() => { setSel(c); void eliminar(c) }} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={11} aria-hidden /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'importar' && (
        <ImportarClientes todos={todos} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await cargar(); mostrarToast('Clientes importados') }} />
      )}
      {modal && modal !== 'importar' && (
        <ClienteModal cliente={modal === 'edit' ? sel : null} nCliente={modal === 'new' ? nextNCliente(todos) : sel?.n_cliente ?? null} onClose={() => { setModal(null); setSel(null) }} onSaved={async () => { setModal(null); setSel(null); await cargar(); mostrarToast(modal === 'edit' ? 'Cliente actualizado' : 'Cliente creado') }} />
      )}
    </Layout>
  )
}

function ClienteModal({ cliente, nCliente, onClose, onSaved }: { cliente: Cliente | null; nCliente: number | null; onClose: () => void; onSaved: () => void }) {
  const [razonSocial, setRazonSocial] = useState(cliente?.razon_social || '')
  const [telefono, setTelefono] = useState(cliente?.telefono || '')
  const [direccionBarrio, setDireccionBarrio] = useState(cliente?.direccion_barrio || '')
  const [localidadProvincia, setLocalidadProvincia] = useState(cliente?.localidad_provincia || '')
  const [transporte, setTransporte] = useState(cliente?.transporte || '')
  const [direccionEntrega, setDireccionEntrega] = useState(cliente?.direccion_entrega || '')
  const [valorDeclarado, setValorDeclarado] = useState(cliente?.valor_declarado || '')
  const [cuenta, setCuenta] = useState(cliente?.cuenta || 'Corriente')
  const [sucursal, setSucursal] = useState(cliente?.sucursal || '')
  const [obsMembretes, setObsMembretes] = useState(cliente?.obs_membretes || '')
  const [obsFacturacion, setObsFacturacion] = useState(cliente?.obs_facturacion || '')
  const [estado, setEstado] = useState(cliente?.estado || 'ACTIVO')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!razonSocial.trim()) { setError('La razon social es obligatoria.'); return }
    setBusy(true)
    setError(null)

    const payload: Record<string, unknown> = {
      razon_social: razonSocial.trim(),
      telefono: telefono.trim() || null,
      direccion_barrio: direccionBarrio.trim() || null,
      localidad_provincia: localidadProvincia.trim() || null,
      transporte: transporte.trim() || null,
      direccion_entrega: direccionEntrega.trim() || null,
      valor_declarado: valorDeclarado || null,
      cuenta,
      sucursal: sucursal.trim() || null,
      obs_membretes: obsMembretes.trim() || null,
      obs_facturacion: obsFacturacion.trim() || null,
      estado,
    }

    let result
    if (cliente) {
      result = await supabase.from('clientes').update(payload).eq('id', cliente.id).select().single()
    } else {
      payload.n_cliente = nCliente
      result = await supabase.from('clientes').insert(payload).select().single()
    }
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display font-semibold text-ink">
            <Hash size={16} aria-hidden /> {cliente ? 'Editar cliente' : 'Nuevo Cliente'}
            {nCliente != null && <span className="ml-2 rounded-full border border-line bg-surface2 px-2 py-0.5 text-xs font-medium text-sub">N° {nCliente}</span>}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">N° Cliente</span>
              <input value={nCliente ?? ''} disabled className="w-full rounded-xl border border-line bg-surface px-3 py-1.5 text-[13px] text-sub/60" />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Razon Social *</span>
              <input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} placeholder="Ej: Distribuidora del Sur" className={inputCls} autoFocus />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Telefono</span>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3516 82-1473" className={inputCls} />
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Direccion - Barrio</span>
              <input value={direccionBarrio} onChange={(e) => setDireccionBarrio(e.target.value)} placeholder="Av. Colon 1234, B Centro" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Localidad - Provincia</span>
              <input value={localidadProvincia} onChange={(e) => setLocalidadProvincia(e.target.value)} placeholder="Cordoba, Cordoba" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Transporte</span>
              <input value={transporte} onChange={(e) => setTransporte(e.target.value)} placeholder="Ej: CREDIFIN" className={inputCls} />
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Direccion de Entrega</span>
              <input value={direccionEntrega} onChange={(e) => setDireccionEntrega(e.target.value)} placeholder="Calle Falsa 123" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">% Valor Declarado</span>
              <select value={valorDeclarado} onChange={(e) => setValorDeclarado(e.target.value)} className={inputCls}>
                <option value="">-</option>
                {VALOR_DEC_OPCIONES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Cuenta</span>
              <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={inputCls}>
                {CUENTA_OPCIONES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Sucursal</span>
              <input value={sucursal} onChange={(e) => setSucursal(e.target.value)} placeholder="Ej: Central" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
                <option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option>
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Observaciones Membretes</span>
              <textarea value={obsMembretes} onChange={(e) => setObsMembretes(e.target.value)} placeholder="Facturar con membrete oficial" rows={2} className={inputCls + ' resize-none'} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Observaciones Facturacion</span>
              <textarea value={obsFacturacion} onChange={(e) => setObsFacturacion(e.target.value)} placeholder="IVA responsable inscripto" rows={2} className={inputCls + ' resize-none'} />
            </label>
          </div>

          {error && <p className="mt-3 text-sm text-brand-400">{error}</p>}

          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}{cliente ? 'Guardar cambios' : 'Crear Cliente'}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-5 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

type FileRow = Record<string, string>

interface Mapping {
  razon_social: number
  telefono: number
  direccion_barrio: number
  localidad_provincia: number
  transporte: number
  direccion_entrega: number
  valor_declarado: number
  cuenta: number
  sucursal: number
  obs_membretes: number
  obs_facturacion: number
}

const FIELD_LABELS: Record<keyof Mapping, string> = {
  razon_social: 'Razon Social',
  telefono: 'Telefono',
  direccion_barrio: 'Direccion - Barrio',
  localidad_provincia: 'Localidad - Provincia',
  transporte: 'Transporte',
  direccion_entrega: 'Direccion de Entrega',
  valor_declarado: 'Valor Declarado',
  cuenta: 'Cuenta',
  sucursal: 'Sucursal',
  obs_membretes: 'Obs Membretes',
  obs_facturacion: 'Obs Facturacion',
}

const AUTO_MAP: Record<keyof Mapping, string[]> = {
  razon_social: ['razon', 'social', 'nombre', 'cliente'],
  telefono: ['telefono', 'tel', 'phone'],
  direccion_barrio: ['direccion', 'barrio', 'dir'],
  localidad_provincia: ['localidad', 'provincia', 'ciudad'],
  transporte: ['transporte', 'transport'],
  direccion_entrega: ['entrega', 'dir entrega'],
  valor_declarado: ['valor', 'declarado'],
  cuenta: ['cuenta'],
  sucursal: ['sucursal', 'branch'],
  obs_membretes: ['membrete', 'obs membrete'],
  obs_facturacion: ['facturacion', 'obs facturacion'],
}

function autoMap(headers: string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().trim())
  const result: Mapping = {
    razon_social: -1, telefono: -1, direccion_barrio: -1, localidad_provincia: -1,
    transporte: -1, direccion_entrega: -1, valor_declarado: -1, cuenta: -1,
    sucursal: -1, obs_membretes: -1, obs_facturacion: -1,
  }
  for (const [field, keywords] of Object.entries(AUTO_MAP) as [keyof Mapping, string[]][]) {
    for (let i = 0; i < lower.length; i++) {
      if (keywords.some((kw) => lower[i].includes(kw))) {
        if (result[field] === -1) result[field] = i
        break
      }
    }
  }
  return result
}

function ImportarClientes({ todos, onClose, onSaved }: { todos: Cliente[]; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<FileRow[]>([])
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [paso, setPaso] = useState<'file' | 'map'>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progreso, setProgreso] = useState({ total: 0, listo: 0 })
  const fileRef = useRef<HTMLInputElement>(null)

  function onSelectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (!f) return
    setFile(f)
  }

  async function parseFile() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const wsName = wb.SheetNames[0]
      if (!wsName) { setError('El archivo no tiene hojas.'); setBusy(false); return }
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wsName], { defval: '' })
      if (jsonRows.length === 0) { setError('El archivo esta vacio.'); setBusy(false); return }
      const hdrs = Object.keys(jsonRows[0])
      const parsed: FileRow[] = jsonRows.map((r) => {
        const obj: FileRow = {}
        for (const h of hdrs) obj[h] = String(r[h] ?? '')
        return obj
      })
      setHeaders(hdrs)
      setRows(parsed)
      setMapping(autoMap(hdrs))
      setPaso('map')
    } catch (err) {
      setError('Error al leer: ' + (err instanceof Error ? err.message : String(err)))
    }
    setBusy(false)
  }

  async function importar() {
    if (!supabase || !mapping) return
    if (mapping.razon_social === -1) { setError('Debe mapear el campo Razon Social.'); return }
    const sinRazon = rows.filter((r) => !r[headers[mapping.razon_social]]?.trim())
    if (sinRazon.length > 0) { setError(sinRazon.length + ' filas sin razon social.'); return }
    setBusy(true)
    setError(null)
    const base = nextNCliente(todos)
    const payload = rows.map((r, i) => ({
      n_cliente: base + i,
      razon_social: r[headers[mapping.razon_social]]?.trim() || '',
      telefono: mapping.telefono >= 0 ? r[headers[mapping.telefono]]?.trim() || null : null,
      direccion_barrio: mapping.direccion_barrio >= 0 ? r[headers[mapping.direccion_barrio]]?.trim() || null : null,
      localidad_provincia: mapping.localidad_provincia >= 0 ? r[headers[mapping.localidad_provincia]]?.trim() || null : null,
      transporte: mapping.transporte >= 0 ? r[headers[mapping.transporte]]?.trim() || null : null,
      direccion_entrega: mapping.direccion_entrega >= 0 ? r[headers[mapping.direccion_entrega]]?.trim() || null : null,
      valor_declarado: mapping.valor_declarado >= 0 ? r[headers[mapping.valor_declarado]]?.trim() || null : null,
      cuenta: mapping.cuenta >= 0 ? r[headers[mapping.cuenta]]?.trim() || 'Corriente' : 'Corriente',
      sucursal: mapping.sucursal >= 0 ? r[headers[mapping.sucursal]]?.trim() || null : null,
      obs_membretes: mapping.obs_membretes >= 0 ? r[headers[mapping.obs_membretes]]?.trim() || null : null,
      obs_facturacion: mapping.obs_facturacion >= 0 ? r[headers[mapping.obs_facturacion]]?.trim() || null : null,
      estado: 'ACTIVO',
    }))
    setProgreso({ total: payload.length, listo: 0 })
    const CHUNK = 50
    let ok = 0
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK)
      const { error: err } = await supabase.from('clientes').insert(chunk)
      if (err) { setError('Error lote ' + (Math.floor(i / CHUNK) + 1) + ': ' + err.message); setBusy(false); return }
      ok += chunk.length
      setProgreso({ total: payload.length, listo: ok })
    }
    setBusy(false)
    onSaved()
  }

  function setField(field: keyof Mapping, val: string) {
    setMapping((m) => m ? { ...m, [field]: parseInt(val, 10) } : m)
  }

  const previewRows = rows.slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display font-semibold text-ink"><Upload size={16} aria-hidden /> Importar Clientes</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {paso === 'file' && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <p className="text-sm text-sub">Seleccione un archivo Excel (.xlsx, .xls) o CSV.</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onSelectFile} className="text-sm text-sub file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white file:hover:bg-brand-700" />
              {file && <p className="text-xs text-sub">Archivo: <span className="font-medium text-ink">{file.name}</span> ({rows.length > 0 ? rows.length + ' filas detectadas' : 'listo para parsear'})</p>}
            </div>
          )}

          {paso === 'map' && mapping && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-sub">{rows.length} filas detectadas. Mapee las columnas del archivo a los campos del cliente:</p>
                <span className="text-[11px] text-sub/60">Columnas sin mapear quedan en blanco</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((field) => (
                  <label key={field} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-sub">{FIELD_LABELS[field]}{field === 'razon_social' ? ' *' : ''}</span>
                    <select value={mapping[field]} onChange={(e) => setField(field, e.target.value)} className={inputCls + ' text-[12px]'}>
                      <option value="-1">-- No importar --</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              {previewRows.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-semibold text-sub">Vista previa (primeras 5 filas):</p>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-zinc-800 text-left text-[9px] uppercase tracking-wider text-zinc-300">
                          {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((field) => (
                            <th key={field} className="px-2 py-1.5 whitespace-nowrap">{FIELD_LABELS[field]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50 bg-surface">
                        {previewRows.map((r, ri) => (
                          <tr key={ri} className="hover:bg-line/20">
                            {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((field) => (
                              <td key={field} className="px-2 py-1 text-sub" title={mapping[field] >= 0 ? r[headers[mapping[field]]] : ''}>
                                {mapping[field] >= 0 ? (r[headers[mapping[field]]] || '-') : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-sm text-brand-400">{error}</p>}
        {busy && progreso.total > 0 && (
          <div className="px-5 pb-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: (progreso.listo / progreso.total * 100) + '%' }} />
            </div>
            <p className="mt-1 text-[11px] text-sub">{progreso.listo} / {progreso.total} clientes importados</p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          {paso === 'map' && <button onClick={() => setPaso('file')} disabled={busy} className="btn-press text-xs text-sub hover:text-ink">Volver</button>}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
            {paso === 'file' && <button onClick={() => void parseFile()} disabled={!file || busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null} Siguiente</button>}
            {paso === 'map' && <button onClick={() => void importar()} disabled={busy || mapping?.razon_social === -1} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />} Importar {rows.length} clientes</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

