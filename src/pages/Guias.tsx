import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Plus, Pencil, Trash2, X, ClipboardList, Upload, FileText,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
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
  estado: string | null
  fecha: string | null
  nro_remito: string | null
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

type EstadoGuia = 'NUEVO' | 'EN_PROCESO' | 'FINALIZADO'

function estadoDe(g: Pick<Guia, 'estado' | 'en_proceso' | 'finalizado'>): EstadoGuia {
  const e = (g.estado || '').toUpperCase()
  if (e === 'NUEVO' || e === 'EN_PROCESO' || e === 'FINALIZADO') return e as EstadoGuia
  return g.finalizado ? 'FINALIZADO' : 'EN_PROCESO'
}

function cambiarEstadoEnTodos(todos: Guia[], id: string, estado: EstadoGuia): Guia[] {
  return todos.map((x) => x.id === id ? {
    ...x,
    estado,
    en_proceso: estado === 'EN_PROCESO',
    finalizado: estado === 'FINALIZADO',
  } : x)
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
  const [modal, setModal] = useState<'new' | 'edit' | 'importar' | null>(null)
  const [sel, setSel] = useState<Guia | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [card, setCard] = useState<Guia | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
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

    const PAGE = 1000
    async function traerTodo<T>(fetcher: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
      const all: T[] = []
      let from = 0
      for (;;) {
        const res = await fetcher(from, from + PAGE - 1)
        const chunk = res.data ?? []
        all.push(...chunk)
        if (chunk.length < PAGE) break
        from += PAGE
      }
      return all
    }

    const [gu, cl, opRes] = await Promise.all([
      traerTodo<Guia>((f, t) => supabase!.from('guias').select('*').order('created_at', { ascending: false }).range(f, t)),
      traerTodo<ClienteMini>((f, t) => supabase!.from('clientes').select('id,n_cliente,razon_social').eq('estado', 'ACTIVO').order('razon_social').range(f, t)),
      supabase.from('guias_opciones').select('tipo,valor').order('valor'),
    ])
    setTodos(gu)
    setClientes(cl)
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
    const { error: err } = await supabase.from('guias').delete().eq('id', g.id)
    if (err) { mostrarToast('Error al eliminar'); return }
    setSel(null); setCard(null); await cargar(); mostrarToast('Guia eliminada')
  }

  async function cambiarEstado(g: Guia, estado: EstadoGuia) {
    if (!supabase) return
    setTodos((arr) => cambiarEstadoEnTodos(arr, g.id, estado))
    const { error: err } = await supabase.from('guias').update({ estado, en_proceso: estado === 'EN_PROCESO', finalizado: estado === 'FINALIZADO' }).eq('id', g.id)
    if (err) { mostrarToast('Error al actualizar estado'); await cargar() }
    else mostrarToast(estado === 'FINALIZADO' ? 'Guia finalizada' : estado === 'NUEVO' ? 'Guia nueva' : 'Guia en proceso')
  }

  const toggleSelect = (id: string) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const allSelected = listaPagina.length > 0 && listaPagina.every((r) => selected.has(r.id))
  const toggleSelectAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(listaPagina.map((r) => r.id)))
  }
  async function eliminarSeleccionados() {
    if (!supabase || selected.size === 0) return
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
          <button onClick={() => setConfirm({ message: `Eliminar ${selected.size} guia(s)?`, onConfirm: () => void eliminarSeleccionados() })} className="btn-press inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"><Trash2 size={13} aria-hidden /> Eliminar ({selected.size})</button>
        )}
        {puedeCrear && (
          <div className="flex items-center gap-2">
            <button onClick={() => setModal('importar')} className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Upload size={13} aria-hidden /> Importar</button>
            <button onClick={() => setModal('new')} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} aria-hidden /> Nueva Guia</button>
          </div>
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
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('fecha')}>Fecha{sortArrow('fecha')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('nro_remito')}>N° Remito{sortArrow('nro_remito')}</th>
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
                    <td className="px-1 py-[2px] text-center text-sub">{g.fecha || '-'}</td>
                    <td className="px-1 py-[2px] text-center text-sub">{g.nro_remito || '-'}</td>
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
                        <option value="NUEVO">Nuevo</option>
                        <option value="EN_PROCESO">En Proceso</option>
                        <option value="FINALIZADO">Finalizado</option>
                      </select>
                    </td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={g.observaciones || ''}>{g.observaciones || '-'}</span></td>
                    <td className="px-1 py-[2px] text-right">
                      <div className="flex items-center justify-end gap-px" onClick={(e) => e.stopPropagation()}>
                        {puedeEditar && <button onClick={() => { setSel(g); setModal('edit') }} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Editar"><Pencil size={10} aria-hidden /></button>}
                        {puedeBorrar && <button onClick={() => setConfirm({ message: 'Eliminar guia de "' + (g.razon_social || '-') + '"?', onConfirm: () => void eliminar(g) })} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={10} aria-hidden /></button>}
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
                  <CRow label="Fecha" value={card.fecha} />
                  <CRow label="N° Remito" value={card.nro_remito} />
                  <CRow label="N° Cliente" value={card.nro_cliente} />
                  <CRow label="Razon Social" value={card.razon_social} />
                  <CRow label="Pedido" value={card.pedido} />
                  <CRow label="Sucursal" value={card.sucursal} />
                  <CRow label="Estado" value={estadoDe(card)} badge badgeCls={estadoDe(card) === 'FINALIZADO' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : estadoDe(card) === 'NUEVO' ? 'bg-sky-500/15 text-sky-400 border-sky-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'} />
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

      {/* Import Modal */}
      {modal === 'importar' && (
        <ImportGuias onClose={() => setModal(null)} onSaved={async () => { setModal(null); await cargar(); mostrarToast('Guias importadas') }} />
      )}

      {/* Form Modal */}
      {modal && modal !== 'importar' && (
        <GuiaModal
          guia={modal === 'edit' ? sel : null}
          clientes={clientes}
          pedidoOpciones={pedidoOpciones}
          sucursalOpciones={sucursalOpciones}
          onClose={() => { setModal(null); setSel(null) }}
          onSaved={async () => { setModal(null); setSel(null); await cargar(); mostrarToast(modal === 'edit' ? 'Guia actualizada' : 'Guia creada') }}
        />
      )}
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
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
  const [estado, setEstado] = useState<EstadoGuia>(guia ? estadoDe(guia) : 'NUEVO')
  const [nroRemito, setNroRemito] = useState(guia?.nro_remito || '')
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
      en_proceso: estado === 'EN_PROCESO',
      finalizado: estado === 'FINALIZADO',
      estado,
      nro_remito: nroRemito.trim() || null,
      fecha: guia ? undefined : new Date().toISOString().slice(0, 10),
      observaciones: observaciones.trim() || null,
    }

    let result
    if (guia) {
      result = await supabase.from('guias').update(payload).eq('id', guia.id).select().single()
    } else {
      result = await supabase.from('guias').insert(payload).select().single()
      if (!result.error && supabase) {
        const obsFact = [
          `Generado desde Guia N° ${payload.nro_pedido}`,
          observaciones.trim() || null,
        ].filter(Boolean).join(' | ')
        await supabase.from('facturacion_fabrica').insert({
          n_cliente: nroCliente.trim() || null,
          razon_social: razonSocial.trim() || null,
          fecha_fact: new Date().toISOString().slice(0, 10),
          observaciones: obsFact || null,
        })
      }
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
            {/* Fecha (automatica) */}
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Fecha</span>
              <input value={guia?.fecha ?? new Date().toISOString().slice(0, 10)} readOnly className={inputCls + ' cursor-default opacity-70'} />
            </label>

            {/* Nro Pedido */}
            <label className="block">
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

            {/* Nro Remito */}
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">N° Remito</span>
              <input value={nroRemito} onChange={(e) => setNroRemito(e.target.value)} placeholder="Remito (opcional)..." className={inputCls} />
            </label>

            {/* Estado */}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoGuia)} className={selectCls}>
                <option value="NUEVO">Nuevo</option>
                <option value="EN_PROCESO">En Proceso</option>
                <option value="FINALIZADO">Finalizado</option>
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

/* ------------------------------------------------------------------ */
/*  Import Wizard (BUSCARV)                                            */
/* ------------------------------------------------------------------ */

type FileRow = Record<string, unknown>

function cleanVal(s: string): string { return s.replace(/[\u200B\uFEFF\u00A0]/g, '').trim() }

const PEDIDO_PALABRAS: Record<string, string> = { 'nota de credito': 'NOTA DE CREDITO', 'stock preventa': 'STOCK-PREVENTA', 'stock-preventa': 'STOCK-PREVENTA', 'stock': 'STOCK' }

function normalizarPedido(v: string): string {
  const t = cleanVal(v).toLowerCase()
  return PEDIDO_PALABRAS[t] || cleanVal(v)
}

function ImportGuias({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [paso, setPaso] = useState<'file' | 'map' | 'validate' | 'done'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<FileRow[]>([])
  const [map, setMap] = useState<Record<string, string>>({})
  const [validRows, setValidRows] = useState<FileRow[]>([])
  const [invalidRows, setInvalidRows] = useState<{ idx: number; err: string }[]>([])
  const [validCount, setValidCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultMsg, setResultMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const COLS_DESTINO = [
    { key: 'nro_pedido', label: 'N Pedido' },
    { key: 'nro_cliente', label: 'N Cliente' },
    { key: 'razon_social', label: 'Razon Social' },
    { key: 'pedido', label: 'Pedido' },
    { key: 'sucursal', label: 'Sucursal' },
    { key: 'nro_remito', label: 'N Remito' },
    { key: 'estado', label: 'Estado' },
    { key: 'observaciones', label: 'Observaciones' },
  ]

  const autoMap = useCallback((hdrs: string[]) => {
    const m: Record<string, string> = {}
    const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    hdrs.forEach((h) => {
      const n = norm(h)
      if (n.includes('npedido') || n.includes('nrodepedido')) m['nro_pedido'] = h
      else if (n.includes('ncliente') || n.includes('nrocliente')) m['nro_cliente'] = h
      else if (n.includes('razonsocial') || n.includes('razon')) m['razon_social'] = h
      else if (n === 'pedido' || n.includes('tipo')) m['pedido'] = h
      else if (n === 'sucursal' || n.includes('sucursal')) m['sucursal'] = h
      else if (n.includes('remito') || n === 'nremito') m['nro_remito'] = h
      else if (n === 'estado' || n === 'enproceso' || n.includes('finalizado')) { if (!m['estado']) m['estado'] = h }
      else if (n.includes('observacion') || n === 'obs') m['observaciones'] = h
    })
    return m
  }, [])

  function parseFile() {
    if (!file) return
    setBusy(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const XLSX = await import('xlsx')
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', raw: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<FileRow>(ws, { defval: '' })
        if (json.length === 0) { setBusy(false); return }
        const hdrs = Object.keys(json[0])
        setHeaders(hdrs)
        setRows(json)
        setMap(autoMap(hdrs))
        setPaso('map')
      } catch { alert('Error al leer el archivo.') }
      setBusy(false)
    }
    reader.readAsArrayBuffer(file)
  }

  function validate() {
    const errs: { idx: number; err: string }[] = []
    const valid: FileRow[] = []
    rows.forEach((row) => {
      const mapeo = Object.entries(map)
      /* Fila completamente vacia → se ignora */
      if (mapeo.every(([, src]) => !String(row[src] ?? '').trim())) return

      const nr: FileRow = {}
      mapeo.forEach(([dest, src]) => { if (dest && src) nr[dest] = String(row[src] ?? '').trim() })

      /* Estado → estado + en_proceso/finalizado */
      const stRaw = cleanVal(String(nr.estado ?? '')).toUpperCase()
      let st: EstadoGuia
      if (stRaw === 'NUEVO') st = 'NUEVO'
      else if (stRaw === 'FINALIZADO' || stRaw === 'VERDADERO' || stRaw === 'TRUE' || stRaw === '1') st = 'FINALIZADO'
      else st = 'EN_PROCESO'
      nr.estado = st
      nr.en_proceso = st === 'EN_PROCESO'
      nr.finalizado = st === 'FINALIZADO'

      nr.nro_cliente = nr.nro_cliente ? cleanVal(String(nr.nro_cliente)) : null
      nr.nro_pedido = nr.nro_pedido ? cleanVal(String(nr.nro_pedido)) : null
      nr.razon_social = nr.razon_social ? cleanVal(String(nr.razon_social)) : null
      nr.pedido = nr.pedido ? normalizarPedido(String(nr.pedido)) : null
      nr.sucursal = nr.sucursal ? cleanVal(String(nr.sucursal)).toUpperCase() : null
      nr.nro_remito = nr.nro_remito ? cleanVal(String(nr.nro_remito)) : null
      nr.observaciones = nr.observaciones ? cleanVal(String(nr.observaciones)) : null

      valid.push(nr)
    })
    setInvalidRows(errs); setValidRows(valid); setValidCount(valid.length); setPaso('validate')
  }

  async function importar() {
    if (!supabase || validRows.length === 0) return
    setBusy(true); setProgress(0)
    const batchSize = 50
    let inserted = 0
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize).map((r) => ({
        nro_pedido: r.nro_pedido || null,
        nro_cliente: r.nro_cliente || null,
        razon_social: r.razon_social || null,
        pedido: r.pedido || null,
        sucursal: r.sucursal || null,
        en_proceso: !!r.en_proceso,
        finalizado: !!r.finalizado,
        estado: (r.estado as EstadoGuia) || 'EN_PROCESO',
        nro_remito: r.nro_remito ? (r.nro_remito as string) : null,
        fecha: new Date().toISOString().slice(0, 10),
        observaciones: r.observaciones || null,
      }))
      const { error } = await supabase.from('guias').insert(batch)
      if (error) { setBusy(false); setResultMsg('Error: ' + error.message); setPaso('done'); return }
      inserted += batch.length
      setProgress(Math.round((inserted / validRows.length) * 100))
    }
    setResultMsg(`${inserted} guias importadas correctamente.`)
    setBusy(false); setPaso('done')
  }

  function downloadErrors() {
    if (invalidRows.length === 0) return
    const csv = 'Fila,Error\n' + invalidRows.map((e) => `"${e.idx + 1}","${e.err}"`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'errores_importacion.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function onDrop(e: React.DragEvent) { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }

  if (paso === 'done') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[90vw] max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-2xl">
          <FileText size={36} className="mx-auto mb-3 text-amber-400" aria-hidden />
          <p className="text-sm text-ink">{resultMsg}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => { if (validCount > 0 && resultMsg) onSaved(); else onClose() }} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[90vw] max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Upload size={18} className="text-amber-400" aria-hidden /> Importar Guias</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {paso === 'file' && (
            <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileRef.current?.click()} className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-surface2 py-12 text-center transition hover:border-amber-500/50 hover:bg-amber-500/5">
              <Upload size={32} className="mb-3 text-sub/40" aria-hidden />
              <p className="text-sm font-medium text-ink">{file ? file.name : 'Arrastra un archivo Excel o CSV'}</p>
              <p className="mt-1 text-xs text-sub/70">o haz clic para seleccionar</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
          {paso === 'map' && (
            <div className="space-y-2">
              <p className="mb-2 text-xs text-sub">Mapea las columnas del archivo. Las filas completamente vacias se ignoran; las celdas vacias se importan como null.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {COLS_DESTINO.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-xs">
                    <span className={'w-44 shrink-0 truncate text-sub'}>{col.label}</span>
                    <select value={map[col.key] || ''} onChange={(e) => setMap({ ...map, [col.key]: e.target.value })} className={selectCls + ' flex-1 text-xs'}>
                      <option value="">-- ignorar --</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
          {paso === 'validate' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-sub">{validCount} validos de {rows.length} filas. {invalidRows.length} con errores.</p>
                {invalidRows.length > 0 && <button onClick={downloadErrors} className="text-xs text-brand-400 hover:underline">Descargar errores CSV</button>}
              </div>
              {invalidRows.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  {invalidRows.map((e, i) => <p key={i}>{e.err}</p>)}
                </div>
              )}
              {busy && <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: progress + '%' }} /></div>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">Cancelar</button>
          {paso === 'file' && <button onClick={() => void parseFile()} disabled={!file || busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : null} Siguiente</button>}
          {paso === 'map' && <button onClick={validate} className="btn-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Validar datos</button>}
          {paso === 'validate' && <button onClick={() => void importar()} disabled={busy || validCount === 0} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Upload size={15} /> Importar {validCount} guias</button>}
        </div>
      </div>
    </div>
  )
}
