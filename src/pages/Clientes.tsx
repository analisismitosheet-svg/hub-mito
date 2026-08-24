import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Plus, Pencil, Trash2, Eye, EyeOff, X, Hash, Upload, Check, UserRound,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Cliente {
  id: string
  n_cliente: string | null
  razon_social: string
  telefono: string | null
  telefono_2: string | null
  direccion_barrio: string | null
  direccion_barrio_2: string | null
  localidad_provincia: string | null
  transporte: string | null
  direccion_entrega: string | null
  direccion_entrega_2: string | null
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function nextNCliente(todos: Cliente[]): string {
  const nums = todos.map((c) => c.n_cliente).filter(Boolean).map((n) => parseInt(n!, 10)).filter((n) => !isNaN(n))
  const max = nums.length ? Math.max(...nums) : 0
  return String(max > 0 ? max + 1 : 1001)
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
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState<keyof Cliente>('n_cliente')
  const [sortAsc, setSortAsc] = useState(true)
  const [card, setCard] = useState<Cliente | null>(null)
  const POR_PAGINA = 50

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
    if (term) r = r.filter((c) => (c.razon_social || '').toUpperCase().includes(term) || String(c.n_cliente).includes(term.replace(/\D/g, '')) || (c.telefono || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')))
    r = [...r].sort((a, b) => {
      const av = (a[sortKey] ?? '') as string
      const bv = (b[sortKey] ?? '') as string
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return r
  }, [todos, term, filtro, sortKey, sortAsc])
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const listaPagina = lista.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA)

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

  useEffect(() => { setPagina(1) }, [q, filtro])

  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card])

  function toggleSort(key: keyof Cliente) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }

  function sortArrow(key: keyof Cliente) {
    if (sortKey !== key) return null
    return sortAsc ? ' ▲' : ' ▼'
  }

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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N° cliente, razon social o telefono..." className={inputCls + ' pl-8 text-xs'} />
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
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[13%]" />
                <col className="w-[5%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[5%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-zinc-800 text-left text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('n_cliente')}>N°{sortArrow('n_cliente')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('razon_social')}>Razon Social{sortArrow('razon_social')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('telefono')}>Telefono{sortArrow('telefono')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('direccion_barrio')}>Dir - Barrio{sortArrow('direccion_barrio')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('localidad_provincia')}>Localidad - Prov{sortArrow('localidad_provincia')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('transporte')}>Transporte{sortArrow('transporte')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('direccion_entrega')}>Dir Entrega{sortArrow('direccion_entrega')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('valor_declarado')}>V.Decl.{sortArrow('valor_declarado')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('cuenta')}>Cuenta{sortArrow('cuenta')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('sucursal')}>Sucursal{sortArrow('sucursal')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('estado')}>Estado{sortArrow('estado')}</th>
                  <th className="px-1 py-1 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {listaPagina.map((c) => (
                  <tr key={c.id} className="transition hover:bg-line/20 cursor-pointer" onClick={() => setCard(c)}>
                    <td className="px-1 py-[2px] text-center text-[10px] font-medium text-sub">{fmtN(c.n_cliente)}</td>
                    <td className="px-1 py-[2px]">
                      <div className="flex items-center gap-1 min-w-0">
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[8px] font-semibold text-amber-400">{iniciales(c.razon_social)}</div>
                        <span className="block truncate font-medium text-ink" title={c.razon_social}>{c.razon_social}</span>
                      </div>
                    </td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.telefono || ''}>{c.telefono || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.direccion_barrio || ''}>{c.direccion_barrio || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.localidad_provincia || ''}>{c.localidad_provincia || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.transporte || ''}>{c.transporte || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.direccion_entrega || ''}>{c.direccion_entrega || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center text-sub">{c.valor_declarado || '-'}</td>
                    <td className="px-1 py-[2px] whitespace-nowrap text-sub">{c.cuenta || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={c.sucursal || ''}>{c.sucursal || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center"><span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + estadoStyle(c.estado)}>{c.estado || 'INACTIVO'}</span></td>
                    <td className="px-1 py-[2px] text-right">
                      <div className="flex items-center justify-end gap-px" onClick={(e) => e.stopPropagation()}>
                        {puedeEditar && <button onClick={() => { setSel(c); setModal('edit') }} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Editar"><Pencil size={10} aria-hidden /></button>}
                        <button onClick={() => void toggleEstado(c)} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title={c.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}>{c.estado === 'ACTIVO' ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}</button>
                        {puedeBorrar && <button onClick={() => { setSel(c); void eliminar(c) }} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={10} aria-hidden /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-sub">
              <span>{lista.length} clientes | Pag {paginaSegura} de {totalPaginas}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPagina(1)} disabled={paginaSegura <= 1} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-line disabled:opacity-30">«</button>
                <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaSegura <= 1} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-line disabled:opacity-30">‹</button>
                <span className="px-1.5 text-[10px] font-medium text-ink">{paginaSegura}</span>
                <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaSegura >= totalPaginas} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-line disabled:opacity-30">›</button>
                <button onClick={() => setPagina(totalPaginas)} disabled={paginaSegura >= totalPaginas} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:bg-line disabled:opacity-30">»</button>
              </div>
            </div>
          )}
        </div>
      )}

      {card && (
        <ClienteCard
          cliente={card}
          onClose={() => setCard(null)}
          onEdit={() => { setSel(card); setModal('edit'); setCard(null) }}
          puedeEditar={puedeEditar}
        />
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
  const [nClienteVal, setNClienteVal] = useState<string>(nCliente != null ? String(nCliente) : '')
  const [razonSocial, setRazonSocial] = useState(cliente?.razon_social || '')
  const [telefono, setTelefono] = useState(cliente?.telefono || '')
  const [telefono2, setTelefono2] = useState(cliente?.telefono_2 || '')
  const [direccionBarrio, setDireccionBarrio] = useState(cliente?.direccion_barrio || '')
  const [direccionBarrio2, setDireccionBarrio2] = useState(cliente?.direccion_barrio_2 || '')
  const [localidadProvincia, setLocalidadProvincia] = useState(cliente?.localidad_provincia || '')
  const [transporte, setTransporte] = useState(cliente?.transporte || '')
  const [direccionEntrega, setDireccionEntrega] = useState(cliente?.direccion_entrega || '')
  const [direccionEntrega2, setDireccionEntrega2] = useState(cliente?.direccion_entrega_2 || '')
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
      telefono_2: telefono2.trim() || null,
      direccion_barrio: direccionBarrio.trim() || null,
      direccion_barrio_2: direccionBarrio2.trim() || null,
      localidad_provincia: localidadProvincia.trim() || null,
      transporte: transporte.trim() || null,
      direccion_entrega: direccionEntrega.trim() || null,
      direccion_entrega_2: direccionEntrega2.trim() || null,
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
      if (!nClienteVal.trim()) { setError('El N° Cliente es obligatorio.'); setBusy(false); return }
      payload.n_cliente = nClienteVal.trim()
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
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">N° Cliente *</span>
              <input type="text" value={nClienteVal} onChange={(e) => setNClienteVal(e.target.value)} placeholder="1001" className={inputCls} autoFocus />
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
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Telefono 2</span>
              <input value={telefono2} onChange={(e) => setTelefono2(e.target.value)} placeholder="Opcional" className={inputCls} />
            </label>

            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Direccion - Barrio</span>
              <input value={direccionBarrio} onChange={(e) => setDireccionBarrio(e.target.value)} placeholder="Av. Colon 1234, B Centro" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Direccion - Barrio 2</span>
              <input value={direccionBarrio2} onChange={(e) => setDireccionBarrio2(e.target.value)} placeholder="Opcional" className={inputCls} />
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
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Direccion de Entrega 2</span>
              <input value={direccionEntrega2} onChange={(e) => setDireccionEntrega2(e.target.value)} placeholder="Opcional" className={inputCls} />
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
              <input list="cuentas-list" value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="Corriente" className={inputCls} />
              <datalist id="cuentas-list">{CUENTA_OPCIONES.map((o) => <option key={o} value={o} />)}</datalist>
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

function ClienteCard({ cliente, onClose, onEdit, puedeEditar }: { cliente: Cliente; onClose: () => void; onEdit: () => void; puedeEditar: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative flex w-[92vw] max-w-[1100px] flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-ink">
              <UserRound size={18} className="shrink-0 text-amber-400" aria-hidden />
              <h2 className="truncate text-lg font-semibold">{cliente.razon_social}</h2>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-sub">
              <span className="font-medium text-ink">N° {fmtN(cliente.n_cliente)}</span>
              <span className="text-sub/50">|</span>
              <span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + estadoStyle(cliente.estado)}>{cliente.estado || 'INACTIVO'}</span>
              <span className="text-sub/50">|</span>
              <span>Alta: {fmtDate(cliente.created_at)}</span>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" title="Cerrar">
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Body — 3 columns */}
        <div className="grid grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-3" style={{ maxHeight: 'calc(88vh - 120px)' }}>
          {/* Col 1: Datos principales */}
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Datos Principales</h3>
            <dl className="space-y-2 text-[13px]">
              <Row label="Razón Social" value={cliente.razon_social} />
              <Row label="Teléfono" value={cliente.telefono} />
              {cliente.telefono_2 && <Row label="Teléfono 2" value={cliente.telefono_2} />}
              <Row label="Transporte" value={cliente.transporte} />
              <Row label="Cuenta" value={cliente.cuenta} />
              <Row label="Sucursal" value={cliente.sucursal} />
              <Row label="% Valor Declarado" value={cliente.valor_declarado} />
            </dl>
          </section>

          {/* Col 2: Direcciones */}
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Direcciones</h3>
            <dl className="space-y-2 text-[13px]">
              <Row label="Dirección - Barrio" value={cliente.direccion_barrio} />
              {cliente.direccion_barrio_2 && <Row label="Dirección - Barrio 2" value={cliente.direccion_barrio_2} />}
              <Row label="Localidad - Prov." value={cliente.localidad_provincia} />
              <Row label="Dirección de Entrega" value={cliente.direccion_entrega} />
              {cliente.direccion_entrega_2 && <Row label="Dirección de Entrega 2" value={cliente.direccion_entrega_2} />}
            </dl>
          </section>

          {/* Col 3: Observaciones */}
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Observaciones</h3>
            <dl className="space-y-2 text-[13px]">
              <Row label="Membretes" value={cliente.obs_membretes} />
              <Row label="Facturación" value={cliente.obs_facturacion} />
            </dl>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {puedeEditar && (
            <button onClick={onEdit} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Pencil size={14} aria-hidden /> Editar Cliente
            </button>
          )}
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-medium text-sub/70">{label}</dt>
      <dd className="mt-px whitespace-pre-wrap text-ink">{value?.trim() || '—'}</dd>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileRow = Record<string, any>

interface Mapping {
  n_cliente: number
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
  n_cliente: 'N Cliente',
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
  n_cliente: ['n cliente', 'n° cliente', 'num cliente', 'numero', 'codigo'],
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
    n_cliente: -1, razon_social: -1, telefono: -1, direccion_barrio: -1, localidad_provincia: -1,
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
  const [validRows, setValidRows] = useState<(FileRow & { _errors: string[]; _row: number })[]>([])
  const [paso, setPaso] = useState<'file' | 'map' | 'validate' | 'done'>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<{ total: number; listo: number; fallos: number; detalles: string[] }>({ total: 0, listo: 0, fallos: 0, detalles: [] })
  const [csvSep, setCsvSep] = useState(',')
  const [csvEnc, setCsvEnc] = useState('UTF-8')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File | null) {
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) { setError('Formato no soportado. Use .xlsx, .xls o .csv'); return }
    if (f.size > 5 * 1024 * 1024) { setError('El archivo supera 5 MB.'); return }
    setFile(f)
    setError(null)
  }


  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files?.[0] ?? null)
  }

  async function parseFile() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const XLSX = await import('xlsx')
      let jsonRows: Record<string, unknown>[]
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text()
        const lines = text.split(/\r?\n/).filter((l) => l.trim())
        if (lines.length === 0) { setError('CSV vacio.'); setBusy(false); return }
        const hdrs = lines[0].split(csvSep).map((h) => h.trim().replace(/^"|"$/g, ''))
        jsonRows = lines.slice(1).map((line) => {
          const vals = line.split(csvSep).map((v) => v.trim().replace(/^"|"$/g, ''))
          const obj: Record<string, unknown> = {}
          hdrs.forEach((h, i) => obj[h] = vals[i] ?? '')
          return obj
        })
      } else {
        const data = await file.arrayBuffer()
        const wb = XLSX.read(data, { type: 'array' })
        const wsName = wb.SheetNames[0]
        if (!wsName) { setError('El archivo no tiene hojas.'); setBusy(false); return }
        jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wsName], { defval: '' })
      }
      if (jsonRows.length === 0) { setError('El archivo esta vacio.'); setBusy(false); return }
      const hdrs = Object.keys(jsonRows[0])
      const parsed: FileRow[] = jsonRows.map((r) => {
        const obj: FileRow = {}
        for (const h of hdrs) obj[h] = String(r[h] ?? '')
        return obj
      })
      setHeaders(hdrs); setRows(parsed); setMapping(autoMap(hdrs)); setPaso('map')
    } catch (err) {
      setError('Error al leer: ' + (err instanceof Error ? err.message : String(err)))
    }
    setBusy(false)
  }

  function cleanVal(s: string | undefined): string {
    return (s || '').replace(/[\u00A0\u200B\uFEFF\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  function normalizeValorDeclarado(v: string): string {
    if (!v) return v
    let cleaned = v.replace(/^[.=]+/, '').trim()
    const up = cleaned.toUpperCase().replace(/[^A-Z0-9%]/g, '')
    if (up.includes('ALNETO') || up === 'ALNETO' || cleaned.toUpperCase().includes('AL NETO')) return 'Al neto'
    const pct = cleaned.match(/(\d{1,3})\s*%/)
    if (pct) return pct[1] + '%'
    return cleaned
  }

  function validate() {
    if (!mapping) return
    const razonIdx = mapping.razon_social
    const existeNames = new Set(todos.map((t) => t.razon_social.toUpperCase().trim()))
    const seen = new Set<string>()
    const validated = rows.filter((r) => {
      if (razonIdx < 0) return true
      const rs = cleanVal(r[headers[razonIdx]])
      return rs !== ''
    }).map((r, i) => {
      const errs: string[] = []
      const rs = razonIdx >= 0 ? cleanVal(r[headers[razonIdx]]) : ''
      if (rs) {
        if (existeNames.has(rs.toUpperCase())) errs.push('Ya existe en BD')
        else if (seen.has(rs.toUpperCase())) errs.push('Duplicada en archivo')
        else seen.add(rs.toUpperCase())
      }
      return { ...r, _errors: errs, _row: i + 1 }
    })
    setValidRows(validated); setPaso('validate')
  }

  function editRow(rowIdx: number, colHeader: string, val: string) {
    setValidRows((prev) => prev.map((r, i) => i === rowIdx ? { ...r, [colHeader]: val } : r))
  }

  async function importar() {
    if (!supabase || !mapping) return
    const toImport = validRows.filter((r) => r._errors.length === 0)
    if (toImport.length === 0) { setError('No hay filas validas para importar.'); return }
    setBusy(true); setError(null); setPaso('done')
    const base = nextNCliente(todos)
    const detalles: string[] = []
    let ok = 0; let fallos = 0
    setProgreso({ total: toImport.length, listo: 0, fallos: 0, detalles: [] })
    const CHUNK = 50
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const chunk = toImport.slice(i, i + CHUNK)
      const payload = chunk.map((r, j) => ({
        n_cliente: mapping.n_cliente >= 0 ? cleanVal(r[headers[mapping.n_cliente]]) || String(base + i + j) : String(base + i + j),
        razon_social: cleanVal(r[headers[mapping.razon_social]]) || '',
        telefono: mapping.telefono >= 0 ? cleanVal(r[headers[mapping.telefono]]) || null : null,
        direccion_barrio: mapping.direccion_barrio >= 0 ? cleanVal(r[headers[mapping.direccion_barrio]]) || null : null,
        localidad_provincia: mapping.localidad_provincia >= 0 ? cleanVal(r[headers[mapping.localidad_provincia]]) || null : null,
        transporte: mapping.transporte >= 0 ? cleanVal(r[headers[mapping.transporte]]) || null : null,
        direccion_entrega: mapping.direccion_entrega >= 0 ? cleanVal(r[headers[mapping.direccion_entrega]]) || null : null,
        valor_declarado: mapping.valor_declarado >= 0 ? normalizeValorDeclarado(cleanVal(r[headers[mapping.valor_declarado]])) || null : null,
        cuenta: mapping.cuenta >= 0 ? cleanVal(r[headers[mapping.cuenta]]) || 'Corriente' : 'Corriente',
        sucursal: mapping.sucursal >= 0 ? cleanVal(r[headers[mapping.sucursal]]) || null : null,
        obs_membretes: mapping.obs_membretes >= 0 ? cleanVal(r[headers[mapping.obs_membretes]]) || null : null,
        obs_facturacion: mapping.obs_facturacion >= 0 ? cleanVal(r[headers[mapping.obs_facturacion]]) || null : null,
        estado: 'ACTIVO',
      }))
      const { error: err } = await supabase.from('clientes').insert(payload)
      if (err) { fallos += chunk.length; detalles.push('Lote ' + (Math.floor(i / CHUNK) + 1) + ': ' + err.message) }
      else ok += chunk.length
      setProgreso({ total: toImport.length, listo: ok, fallos, detalles })
    }
    setBusy(false)
    if (ok > 0) onSaved()
  }

  function downloadErrors() {
    const errs = validRows.filter((r) => r._errors.length > 0)
    if (errs.length === 0) return
    const csv = ['Fila,Errores,' + headers.join(',')].concat(
      errs.map((r) => [r._row, r._errors.join('; '), ...headers.map((h) => '"' + (r[h] || '').replace(/"/g, '""') + '"')].join(','))
    ).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'errores_importacion.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function setField(field: keyof Mapping, val: string) {
    setMapping((m) => m ? { ...m, [field]: parseInt(val, 10) } : m)
  }



  const validCount = validRows.filter((r) => r._errors.length === 0).length
  const errorCount = validRows.length - validCount
  const previewRows = rows.slice(0, 5)

  const steps = ['Archivo', 'Mapeo', 'Validar', 'Importar']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display font-semibold text-ink"><Upload size={16} aria-hidden /> Importar Clientes</h2>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1 sm:flex">
              {steps.map((s, i) => (
                <span key={s} className={'flex items-center gap-1 text-[11px] font-medium ' + (i <= ['file', 'map', 'validate', 'done'].indexOf(paso) ? 'text-brand-400' : 'text-sub/40')}>
                  <span className={'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ' + (i <= ['file', 'map', 'validate', 'done'].indexOf(paso) ? 'bg-brand-600 text-white' : 'bg-line text-sub/40')}>{i + 1}</span>
                  {s}
                  {i < steps.length - 1 && <span className="mx-1 text-sub/30">-</span>}
                </span>
              ))}
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {paso === 'file' && (
            <div className="flex flex-col items-center gap-5 py-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={'flex w-full max-w-lg cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 transition ' + (dragOver ? 'border-brand-500 bg-brand-600/10' : 'border-line hover:border-brand-500/50 hover:bg-line/20')}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                <Upload size={32} className={dragOver ? 'text-brand-400' : 'text-sub/40'} />
                <p className="text-sm text-sub">{file ? 'Archivo seleccionado' : 'Arrastra tu archivo aqui o haz clic para seleccionar'}</p>
                <p className="text-[11px] text-sub/60">Formatos: .xlsx, .xls, .csv | Maximo 5 MB</p>
              </div>
              {file && (
                <div className="w-full max-w-lg space-y-3">
                  <p className="text-xs text-sub">Archivo: <span className="font-medium text-ink">{file.name}</span> ({(file.size / 1024).toFixed(0)} KB)</p>
                  {file.name.toLowerCase().endsWith('.csv') && (
                    <div className="flex gap-3">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium text-sub">Delimitador</span>
                        <select value={csvSep} onChange={(e) => setCsvSep(e.target.value)} className={inputCls + ' w-auto text-[12px]'}>
                          <option value=",">Coma (,)</option><option value=";">Punto y coma (;)</option><option value="&#9;">Tabulacion</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium text-sub">Codificacion</span>
                        <select value={csvEnc} onChange={(e) => setCsvEnc(e.target.value)} className={inputCls + ' w-auto text-[12px]'}>
                          <option value="UTF-8">UTF-8</option><option value="ISO-8859-1">ISO-8859-1</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <button onClick={() => { setFile(null); setError(null) }} className="text-[11px] text-brand-400 hover:text-brand-300">Cambiar archivo</button>
                </div>
              )}
            </div>
          )}

          {paso === 'map' && mapping && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-sub">{rows.length} filas detectadas. Mapee las columnas:</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((field) => (
                  <label key={field} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-sub">{FIELD_LABELS[field]}</span>
                    <select value={mapping[field]} onChange={(e) => setField(field, e.target.value)} className={inputCls + ' text-[12px]'}>
                      <option value="-1">-- Ignorar --</option>
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
                      <thead><tr className="bg-zinc-800 text-left text-[9px] uppercase tracking-wider text-zinc-300">
                        {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((f) => <th key={f} className="px-2 py-1.5 whitespace-nowrap">{FIELD_LABELS[f]}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-line/50 bg-surface">
                        {previewRows.map((r, ri) => (
                          <tr key={ri} className="hover:bg-line/20">
                            {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((f) => (
                              <td key={f} className="px-2 py-1 text-sub">{mapping[f] >= 0 ? (r[headers[mapping[f]]] || '-') : '-'}</td>
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

          {paso === 'validate' && (
            <div>
              <div className="mb-3 flex items-center gap-4">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">{validCount} validas</span>
                {errorCount > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-400">{errorCount} con errores</span>}
                {errorCount > 0 && <button onClick={downloadErrors} className="text-[11px] text-brand-400 hover:text-brand-300 underline">Descargar errores CSV</button>}
              </div>
              <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: '55vh' }}>
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 z-10"><tr className="bg-zinc-800 text-left text-[9px] uppercase tracking-wider text-zinc-300">
                    <th className="w-[4%] px-1.5 py-1.5 text-center">#</th>
                    {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((f) => <th key={f} className="px-1.5 py-1.5 whitespace-nowrap">{FIELD_LABELS[f]}</th>)}
                    <th className="w-[12%] px-1.5 py-1.5">Estado</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line/50 bg-surface">
                    {validRows.map((r, ri) => (
                      <tr key={ri} className={'transition ' + (r._errors.length > 0 ? 'bg-brand-600/5' : 'hover:bg-line/20')}>
                        <td className="px-1.5 py-1 text-center text-sub">{r._row}</td>
                        {(Object.keys(FIELD_LABELS) as (keyof Mapping)[]).map((f) => {
                          const hdr = mapping && mapping[f] >= 0 ? headers[mapping[f]] : null
                          return (
                            <td key={f} className="px-1 py-0.5">
                              {hdr ? (
                                <input value={r[hdr] || ''} onChange={(e) => editRow(ri, hdr, e.target.value)} className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-ink outline-none transition focus:border-brand-500 focus:bg-surface2" />
                              ) : <span className="text-sub/40">-</span>}
                            </td>
                          )
                        })}
                        <td className="px-1.5 py-1">
                          {r._errors.length > 0 ? (
                            <span className="text-[10px] text-brand-400" title={r._errors.join('; ')}>{r._errors.length} error(es)</span>
                          ) : <span className="text-[10px] text-emerald-400">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {paso === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8">
              {busy ? (
                <>
                  <Loader2 size={32} className="animate-spin text-brand-400" />
                  <p className="text-sm text-sub">Importando clientes...</p>
                  <div className="w-full max-w-md">
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: (progreso.total > 0 ? (progreso.listo + progreso.fallos) / progreso.total * 100 : 0) + '%' }} />
                    </div>
                    <p className="mt-1 text-center text-[11px] text-sub">{progreso.listo + progreso.fallos} / {progreso.total}</p>
                  </div>
                  {progreso.detalles.length > 0 && (
                    <div className="w-full max-w-md space-y-1">
                      {progreso.detalles.map((d, i) => <p key={i} className="text-[11px] text-brand-400">{d}</p>)}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><Check size={28} className="text-emerald-400" /></div>
                  <p className="font-display text-lg font-semibold text-ink">Importacion completada</p>
                  <div className="text-center text-sm text-sub">
                    <p>{progreso.listo} clientes creados correctamente</p>
                    {progreso.fallos > 0 && <p className="text-brand-400">{progreso.fallos} clientes fallaron</p>}
                  </div>
                  {progreso.fallos > 0 && <button onClick={downloadErrors} className="text-xs text-brand-400 hover:text-brand-300 underline">Descargar errores CSV</button>}
                  <button onClick={onClose} className="btn-press mt-2 rounded-xl bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700">Cerrar</button>
                </>
              )}
            </div>
          )}
        </div>

        {error && <p className="px-5 pb-2 text-sm text-brand-400">{error}</p>}

        {paso !== 'done' && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <div>
              {paso !== 'file' && <button onClick={() => setPaso(paso === 'validate' ? 'map' : 'file')} disabled={busy} className="btn-press text-xs text-sub hover:text-ink">Atras</button>}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
              {paso === 'file' && <button onClick={() => void parseFile()} disabled={!file || busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : null} Siguiente</button>}
              {paso === 'map' && <button onClick={() => { validate() }} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Validar datos</button>}
              {paso === 'validate' && <button onClick={() => void importar()} disabled={busy || validCount === 0} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Upload size={15} /> Importar {validCount} clientes</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}