import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Plus, Pencil, Trash2, X, ClipboardList,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Guia {
  id: string
  nro_pedido: string | null
  nro_cliente: string | null
  razon_social: string | null
  pedido: string | null
  sucursal: string | null
  en_proceso: boolean
  finalizado: boolean
  observaciones: string | null
  created_at: string
}

interface ClienteMini { id: string; n_cliente: string | null; razon_social: string }

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PEDIDO_OPCIONES_FIJAS = [
  'NOTA DE CREDITO', 'STOCK', 'STOCK-PREVENTA', 'PREPARACION MERCADERIA', 'PREVENTA', 'SE PIDIO A LOCALES',
]
const SUCURSAL_OPCIONES_FIJAS = [
  'MITO', 'CUENTAS', 'REMITO DE VENTA', 'CANVEL', 'REM REPO LOC', 'MITO/REPOLOC',
]
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SortKey = keyof Guia

type EstadoGuia = 'en_proceso' | 'finalizado'

function estadoDe(g: Pick<Guia, 'en_proceso' | 'finalizado'>): EstadoGuia {
  return g.finalizado ? 'finalizado' : 'en_proceso'
}

function cambiarEstadoEnTodos(todos: Guia[], id: string, estado: EstadoGuia): Guia[] {
  return todos.map((x) => x.id === id ? { ...x, en_proceso: estado === 'en_proceso', finalizado: estado === 'finalizado' } : x)
}


/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function Guias() {
  const { can } = useAuth()
  const puedeCrear = can('mayorista.guias.create')
  const puedeEditar = can('mayorista.guias.edit')
  const puedeBorrar = can('mayorista.guias.delete')

  const [todos, setTodos] = useState<Guia[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<Guia | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [card, setCard] = useState<Guia | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const POR_PAGINA = 50

  const [clientes, setClientes] = useState<ClienteMini[]>([])
  const [pedidoOpciones, setPedidoOpciones] = useState<string[]>(PEDIDO_OPCIONES_FIJAS)
  const [sucursalOpciones, setSucursalOpciones] = useState<string[]>(SUCURSAL_OPCIONES_FIJAS)

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const [res, clRes, opRes] = await Promise.all([
      supabase.from('guias').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('clientes').select('id,n_cliente,razon_social').eq('estado', 'ACTIVO').order('razon_social'),
      supabase.from('guias_opciones').select('tipo,valor').order('valor'),
    ])
    if (res.error) setError(res.error.message)
    setTodos((res.data as Guia[]) ?? [])
    setClientes((clRes.data as ClienteMini[]) ?? [])
    const ops = (opRes.data as { tipo: string; valor: string }[]) ?? []
    const ped = ops.filter((o) => o.tipo === 'pedido').map((o) => o.valor)
    const suc = ops.filter((o) => o.tipo === 'sucursal').map((o) => o.valor)
    setPedidoOpciones([...new Set([...PEDIDO_OPCIONES_FIJAS, ...ped])])
    setSucursalOpciones([...new Set([...SUCURSAL_OPCIONES_FIJAS, ...suc])])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    if (!card) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [card])

  /* Filtering & sorting */
  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (term) r = r.filter((g) =>
      (g.nro_pedido || '').toUpperCase().includes(term) ||
      (g.nro_cliente || '').toUpperCase().includes(term) ||
      (g.razon_social || '').toUpperCase().includes(term) ||
      (g.pedido || '').toUpperCase().includes(term) ||
      (g.sucursal || '').toUpperCase().includes(term)
    )
    r = [...r].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (typeof av === 'boolean' && typeof bv === 'boolean') return sortAsc ? (av ? 1 : 0) - (bv ? 1 : 0) : (bv ? 1 : 0) - (av ? 1 : 0)
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return r
  }, [todos, term, sortKey, sortAsc])

  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const paginaSafe = Math.min(pagina, totalPaginas)
  const listaPagina = lista.slice((paginaSafe - 1) * POR_PAGINA, paginaSafe * POR_PAGINA)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }
  function sortArrow(key: SortKey) { return sortKey !== key ? null : sortAsc ? ' ▲' : ' ▼' }

  /* CRUD */
  async function eliminar(g: Guia) {
    if (!supabase) return
    if (!window.confirm('Eliminar guia de "' + (g.razon_social || '-') + '"?')) return
    const { error: err } = await supabase.from('guias').delete().eq('id', g.id)
    if (err) { mostrarToast('Error al eliminar'); return }
    setSel(null); setCard(null); await cargar(); mostrarToast('Guia eliminada')
  }

  async function cambiarEstado(g: Guia, estado: EstadoGuia) {
    if (!supabase) return
    setTodos((arr) => cambiarEstadoEnTodos(arr, g.id, estado))
    const { error: err } = await supabase.from('guias').update({ en_proceso: estado === 'en_proceso', finalizado: estado === 'finalizado' }).eq('id', g.id)
    if (err) { mostrarToast('Error al actualizar estado'); await cargar() }
    else mostrarToast(estado === 'finalizado' ? 'Guia finalizada' : 'Guia en proceso')
  }

  const toggleSelect = (id: string) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const allSelected = listaPagina.length > 0 && listaPagina.every((r) => selected.has(r.id))
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(listaPagina.map((r) => r.id)))
  }
  async function eliminarSeleccionados() {
    if (!supabase || selected.size === 0) return
    if (!window.confirm(`Eliminar ${selected.size} guia(s)?`)) return
    const ids = [...selected]
    const { error: err } = await supabase.from('guias').delete().in('id', ids)
    if (err) { mostrarToast('Error al eliminar'); return }
    setSelected(new Set()); await cargar(); mostrarToast(`${ids.length} guia(s) eliminadas`)
  }

  const ToastEl = () => toast ? (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">{toast}</div>
  ) : null

  return (
    <Layout>
      <ToastEl />
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Guias <span className="text-sm font-normal text-sub">({todos.length})</span></h1>
        <p className="text-xs text-sub/70">Gestion de guias de despacho y pedidos</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por pedido, cliente, razon social..." className={inputCls + ' pl-8 text-xs'} />
        </div>
        <span className="text-[11px] text-sub/70">{lista.length} guias</span>
        {selected.size > 0 && puedeBorrar && (
          <button onClick={() => void eliminarSeleccionados()} className="btn-press inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"><Trash2 size={13} aria-hidden /> Eliminar ({selected.size})</button>
        )}
        {puedeCrear && (
          <button onClick={() => setModal('new')} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} aria-hidden /> Nueva Guia</button>
        )}
      </div>

      {/* Table */}
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{term ? 'No se encontraron guias.' : 'Todavia no hay guias creadas.'}</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
              <colgroup>
                <col className="w-[3%]" />  {/* Check */}
                <col className="w-[12%]" /> {/* Nro Pedido */}
                <col className="w-[8%]" />  {/* Nro Cliente */}
                <col className="w-[18%]" /> {/* Razon Social */}
                <col className="w-[14%]" /> {/* Pedido */}
                <col className="w-[10%]" /> {/* Sucursal */}
                <col className="w-[14%]" /> {/* Estado */}
                <col className="w-[14%]" /> {/* Observaciones */}
                <col className="w-[7%]" />  {/* Acc */}
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-zinc-800 text-left text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="px-1 py-1 text-center"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3 w-3 rounded border-line bg-surface2 accent-brand-600" /></th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('nro_pedido')}>N° Pedido{sortArrow('nro_pedido')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('nro_cliente')}>N° Cl{sortArrow('nro_cliente')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('razon_social')}>Razon Social{sortArrow('razon_social')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('pedido')}>Pedido{sortArrow('pedido')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('sucursal')}>Sucursal{sortArrow('sucursal')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('finalizado')}>Estado{sortArrow('finalizado')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('observaciones')}>Obs{sortArrow('observaciones')}</th>
                  <th className="px-1 py-1 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {listaPagina.map((g) => (
                  <tr key={g.id} className={'transition hover:bg-line/20 cursor-pointer' + (selected.has(g.id) ? ' bg-brand-600/10' : '')} onClick={() => setCard(g)}>
                    <td className="px-1 py-[2px] text-center" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSelect(g.id)} className="h-3 w-3 rounded border-line bg-surface2 accent-brand-600" /></td>
                    <td className="px-1 py-[2px]"><span className="block truncate font-medium text-ink" title={g.nro_pedido || ''}>{g.nro_pedido || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center text-sub">{g.nro_cliente || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate font-medium text-ink" title={g.razon_social || ''}>{g.razon_social || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={g.pedido || ''}>{g.pedido || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={g.sucursal || ''}>{g.sucursal || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={estadoDe(g)}
                        onChange={(e) => void cambiarEstado(g, e.target.value as EstadoGuia)}
                        disabled={!puedeEditar}
                        className="cursor-pointer rounded border border-line bg-surface2 px-1 py-[1px] text-[9px] font-medium text-ink outline-none transition hover:border-brand-500/60 disabled:cursor-default disabled:opacity-60"
                      >
                        <option value="en_proceso">En Proceso</option>
                        <option value="finalizado">Finalizado</option>
                      </select>
                    </td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={g.observaciones || ''}>{g.observaciones || '-'}</span></td>
                    <td className="px-1 py-[2px] text-right">
                      <div className="flex items-center justify-end gap-px" onClick={(e) => e.stopPropagation()}>
                        {puedeEditar && <button onClick={() => { setSel(g); setModal('edit') }} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Editar"><Pencil size={10} aria-hidden /></button>}
                        {puedeBorrar && <button onClick={() => void eliminar(g)} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={10} aria-hidden /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-sub">
              <span>{(paginaSafe - 1) * POR_PAGINA + 1}–{Math.min(paginaSafe * POR_PAGINA, lista.length)} de {lista.length}</span>
              <div className="flex gap-1">
                <button disabled={paginaSafe <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded border border-line px-2 py-0.5 text-[10px] hover:bg-line disabled:opacity-40">←</button>
                <span className="px-2 py-0.5 text-[10px] font-medium text-ink">{paginaSafe}/{totalPaginas}</span>
                <button disabled={paginaSafe >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded border border-line px-2 py-0.5 text-[10px] hover:bg-line disabled:opacity-40">→</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Card */}
      {card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => setCard(null)}>
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="truncate text-lg font-semibold text-ink">{card.razon_social || 'Sin razon social'}</h2>
              <button onClick={() => setCard(null)} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
            </div>
            <div className="overflow-y-auto p-5" style={{ maxHeight: 'calc(88vh - 120px)' }}>
              <section className="rounded-xl border border-line bg-surface2 p-4">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Detalles</h3>
                <dl className="space-y-2 text-[13px]">
                  <CRow label="N° Pedido" value={card.nro_pedido} />
                  <CRow label="N° Cliente" value={card.nro_cliente} />
                  <CRow label="Razon Social" value={card.razon_social} />
                  <CRow label="Pedido" value={card.pedido} />
                  <CRow label="Sucursal" value={card.sucursal} />
                  <CRow label="Estado" value={estadoDe(card) === 'finalizado' ? 'FINALIZADO' : 'EN PROCESO'} badge badgeCls={estadoDe(card) === 'finalizado' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'} />
                  <CRow label="Observaciones" value={card.observaciones} />
                </dl>
              </section>
            </div>
            {puedeEditar && (
              <div className="border-t border-line px-5 py-3">
                <button onClick={() => { setSel(card); setCard(null); setModal('edit') }} className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-line"><Pencil size={12} aria-hidden /> Editar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Form Modal */}
      {modal && (
        <GuiaModal
          guia={modal === 'edit' ? sel : null}
          clientes={clientes}
          pedidoOpciones={pedidoOpciones}
          sucursalOpciones={sucursalOpciones}
          onClose={() => { setModal(null); setSel(null) }}
          onSaved={async () => { setModal(null); setSel(null); await cargar(); mostrarToast(modal === 'edit' ? 'Guia actualizada' : 'Guia creada') }}
        />
      )}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail Row                                                         */
/* ------------------------------------------------------------------ */

function CRow({ label, value, badge, badgeCls }: { label: string; value: string | null; badge?: boolean; badgeCls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sub shrink-0">{label}</dt>
      <dd className="text-right text-ink truncate">
        {badge && value ? <span className={'inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ' + badgeCls}>{value}</span> : (value || '-')}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Form Modal                                                         */
/* ------------------------------------------------------------------ */

function GuiaModal({ guia, clientes, pedidoOpciones, sucursalOpciones, onClose, onSaved }: {
  guia: Guia | null; clientes: ClienteMini[]; pedidoOpciones: string[]; sucursalOpciones: string[]
  onClose: () => void; onSaved: () => void
}) {
  const [nroPedido, setNroPedido] = useState(guia?.nro_pedido || '')
  const [nroCliente, setNroCliente] = useState(guia?.nro_cliente || '')
  const [razonSocial, setRazonSocial] = useState(guia?.razon_social || '')
  const [pedido, setPedido] = useState(guia?.pedido || '')
  const [sucursal, setSucursal] = useState(guia?.sucursal || '')
  const [estado, setEstado] = useState<EstadoGuia>(estadoDe(guia ?? { en_proceso: false, finalizado: false }))
  const [observaciones, setObservaciones] = useState(guia?.observaciones || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [openCliDrop, setOpenCliDrop] = useState(false)
  const [busqCliente, setBusqCliente] = useState('')

  const [customPedido, setCustomPedido] = useState('')
  const [showPedidoCustom, setShowPedidoCustom] = useState(false)
  const [customSucursal, setCustomSucursal] = useState('')
  const [showSucursalCustom, setShowSucursalCustom] = useState(false)

  const filteredClientes = useMemo(() => {
    const t = busqCliente.trim().toUpperCase()
    return clientes.filter((c) => !t || (c.razon_social || '').toUpperCase().includes(t) || String(c.n_cliente).includes(t))
  }, [clientes, busqCliente])

  function seleccionarCliente(c: ClienteMini) {
    setNroCliente(c.n_cliente || ''); setRazonSocial(c.razon_social); setOpenCliDrop(false); setBusqCliente('')
  }

  async function agregarPedidoCustom() {
    const val = customPedido.trim().toUpperCase()
    if (!val || !supabase) return
    await supabase.from('guias_opciones').insert({ tipo: 'pedido', valor: val })
    setPedido(val); setCustomPedido(''); setShowPedidoCustom(false)
  }
  async function agregarSucursalCustom() {
    const val = customSucursal.trim().toUpperCase()
    if (!val || !supabase) return
    await supabase.from('guias_opciones').insert({ tipo: 'sucursal', valor: val })
    setSucursal(val); setCustomSucursal(''); setShowSucursalCustom(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nroPedido.trim()) { setError('El Nro Pedido es obligatorio.'); return }
    if (!nroCliente.trim()) { setError('El Nro Cliente es obligatorio.'); return }
    setBusy(true); setError(null)

    const payload: Record<string, unknown> = {
      nro_pedido: nroPedido.trim(),
      nro_cliente: nroCliente.trim(),
      razon_social: razonSocial || null,
      pedido: pedido || null,
      sucursal: sucursal || null,
      en_proceso: estado === 'en_proceso',
      finalizado: estado === 'finalizado',
      observaciones: observaciones.trim() || null,
    }

    let result
    if (guia) {
      result = await supabase.from('guias').update(payload).eq('id', guia.id).select().single()
    } else {
      result = await supabase.from('guias').insert(payload).select().single()
    }
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display font-semibold text-ink">
            <ClipboardList size={16} aria-hidden /> {guia ? 'Editar guia' : 'Nueva Guia'}
          </h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* Nro Pedido */}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Nro Pedido *</span>
              <input value={nroPedido} onChange={(e) => setNroPedido(e.target.value)} placeholder="874, 824, 682" className={inputCls} />
            </label>

            {/* Nro Cliente + Razon Social */}
            <label className="block relative">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Nro Cliente *</span>
              <input value={openCliDrop ? busqCliente : (nroCliente || '')} onChange={(e) => { setBusqCliente(e.target.value); setOpenCliDrop(true) }} onFocus={() => setOpenCliDrop(true)} placeholder="Buscar por N° o nombre..." className={inputCls} />
              {openCliDrop && (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  <li><button type="button" onClick={() => setOpenCliDrop(false)} className="w-full px-3 py-1.5 text-left text-[11px] text-sub hover:bg-line">Cerrar</button></li>
                  {filteredClientes.slice(0, 50).map((c) => (
                    <li key={c.id}><button type="button" onClick={() => seleccionarCliente(c)} className="w-full px-3 py-1.5 text-left text-[12px] text-ink hover:bg-line truncate">{c.n_cliente} — {c.razon_social}</button></li>
                  ))}
                  {filteredClientes.length === 0 && <li className="px-3 py-2 text-[11px] text-sub">Sin resultados</li>}
                </ul>
              )}
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Razon Social</span>
              <input value={razonSocial} readOnly className={inputCls + ' bg-line/30 text-sub'} placeholder="Auto" />
            </label>

            {/* Pedido */}
            <label className="block relative">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Pedido</span>
              {!showPedidoCustom ? (
                <>
                  <select value={pedido} onChange={(e) => { if (e.target.value === '__custom__') setShowPedidoCustom(true); else setPedido(e.target.value) }} className={selectCls}>
                    <option value="">-- seleccionar --</option>
                    {pedidoOpciones.map((o) => <option key={o} value={o}>{o}</option>)}
                    <option value="__custom__">+ Crear nuevo...</option>
                  </select>
                </>
              ) : (
                <div className="flex gap-1">
                  <input value={customPedido} onChange={(e) => setCustomPedido(e.target.value)} placeholder="Nuevo pedido..." className={inputCls} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregarPedidoCustom() } if (e.key === 'Escape') setShowPedidoCustom(false) }} />
                  <button type="button" onClick={() => void agregarPedidoCustom()} className="shrink-0 rounded-lg bg-brand-600 px-2 text-xs text-white hover:bg-brand-700">OK</button>
                  <button type="button" onClick={() => setShowPedidoCustom(false)} className="shrink-0 rounded-lg border border-line px-2 text-xs text-sub hover:bg-line">X</button>
                </div>
              )}
            </label>

            {/* Sucursal */}
            <label className="block relative">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Sucursal</span>
              {!showSucursalCustom ? (
                <select value={sucursal} onChange={(e) => { if (e.target.value === '__custom__') setShowSucursalCustom(true); else setSucursal(e.target.value) }} className={selectCls}>
                  <option value="">-- seleccionar --</option>
                  {sucursalOpciones.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value="__custom__">+ Crear nuevo...</option>
                </select>
              ) : (
                <div className="flex gap-1">
                  <input value={customSucursal} onChange={(e) => setCustomSucursal(e.target.value)} placeholder="Nueva sucursal..." className={inputCls} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregarSucursalCustom() } if (e.key === 'Escape') setShowSucursalCustom(false) }} />
                  <button type="button" onClick={() => void agregarSucursalCustom()} className="shrink-0 rounded-lg bg-brand-600 px-2 text-xs text-white hover:bg-brand-700">OK</button>
                  <button type="button" onClick={() => setShowSucursalCustom(false)} className="shrink-0 rounded-lg border border-line px-2 text-xs text-sub hover:bg-line">X</button>
                </div>
              )}
            </label>

            {/* Estado */}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoGuia)} className={selectCls}>
                <option value="en_proceso">En Proceso</option>
                <option value="finalizado">Finalizado</option>
              </select>
            </label>

            {/* Observaciones */}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Observaciones</span>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} placeholder="Notas adicionales..." className={inputCls + ' resize-none'} />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-press rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-sub hover:bg-line">Cancelar</button>
            <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
              {guia ? 'Guardar cambios' : 'Crear guia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
