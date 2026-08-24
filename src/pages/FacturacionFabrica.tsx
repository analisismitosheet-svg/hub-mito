import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Plus, Pencil, Trash2, X, Upload, FileText, Lock,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FactRegistro {
  id: string
  autorizacion: string | null
  cliente_id: string | null
  razon_social: string | null
  fecha_fact: string | null
  n_remito: string | null
  n_cliente: number | null
  bulto: number | null
  transporte: string | null
  porcentaje_declarado: string | null
  solicitud_retiro: string | null
  total_despachos: string | null
  empleado_id: string | null
  n_legajo: string | null
  quien_facturo: string | null
  polo52: boolean
  fecha_envio: string | null
  quien_retira_fabrica: string | null
  observaciones: string | null
  created_at: string
}

interface ClienteMini { id: string; n_cliente: number | null; razon_social: string }
interface EmpleadoMini { id: string; legajo: string | null; nombre: string }

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TRANSPORTE_OPCIONES = ['RETIRA', 'COMISIONISTA', 'CADETERIA', 'CREDIFIN', 'OTRO']
const RETIRO_OPCIONES = ['VERDADERO', 'FALSO']
const VALOR_DEC_OPCIONES = ['Al neto', '75%', '80%', '85%', '90%', '100%']
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SortKey = keyof FactRegistro

function fmtN(n: number | null | string): string { return n == null ? '-' : String(n) }

function retiroStyle(v: string | null): string {
  return (v || '').toUpperCase() === 'VERDADERO'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-surface2 text-sub border-line'
}
function cleanVal(s: string): string { return s.replace(/[\u200B\uFEFF\u00A0]/g, '').trim() }
function fmtDateSlider(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function FacturacionFabrica() {
  const { can, isAdmin } = useAuth()
  const puedeCrear = can('mayorista.facturacion.create')
  const puedeEditar = can('mayorista.facturacion.edit')
  const puedeBorrar = can('mayorista.facturacion.delete')

  const [todos, setTodos] = useState<FactRegistro[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filtroTransporte, setFiltroTransporte] = useState('todos')
  const [filtroPol, setFiltroPol] = useState(false)
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [modal, setModal] = useState<'new' | 'edit' | 'importar' | null>(null)
  const [sel, setSel] = useState<FactRegistro | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pagina, setPagina] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('fecha_fact')
  const [sortAsc, setSortAsc] = useState(false)
  const [card, setCard] = useState<FactRegistro | null>(null)
  const POR_PAGINA = 50

  const [clientes, setClientes] = useState<ClienteMini[]>([])
  const [empleados, setEmpleados] = useState<EmpleadoMini[]>([])
  const [transportes, setTransportes] = useState<{ id: string; nombre: string }[]>([])

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const [res, clRes, emRes, trRes] = await Promise.all([
      supabase.from('facturacion_fabrica').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('clientes').select('id,n_cliente,razon_social').eq('estado', 'ACTIVO').order('razon_social'),
      supabase.from('empleados').select('id,legajo,nombre').order('nombre'),
      supabase.from('transportes').select('id,nombre').order('nombre'),
    ])
    if (res.error) setError(res.error.message)
    setTodos((res.data as FactRegistro[]) ?? [])
    setClientes((clRes.data as ClienteMini[]) ?? [])
    setEmpleados((emRes.data as EmpleadoMini[]) ?? [])
    setTransportes((trRes.data as { id: string; nombre: string }[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    if (!card) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [card])

  /* Filtering */
  const term = q.trim().toUpperCase()
  const transporteFiltro = useMemo(() => {
    return [...transportes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [transportes])

  const dateRange = useMemo(() => {
    const fechas = todos.map((r) => r.fecha_fact).filter(Boolean).sort()
    return { min: fechas[0] || '2020-01-01', max: fechas[fechas.length - 1] || '2099-12-31' }
  }, [todos])

  const lista = useMemo(() => {
    let r = todos
    if (!isAdmin && !filtroPol) r = r.filter((f) => !f.polo52)
    if (filtroTransporte !== 'todos') r = r.filter((f) => f.transporte === filtroTransporte)
    if (filtroFechaDesde) r = r.filter((f) => (f.fecha_fact || '') >= filtroFechaDesde)
    if (filtroFechaHasta) r = r.filter((f) => (f.fecha_fact || '') <= filtroFechaHasta)
    if (term) r = r.filter((f) =>
      (f.razon_social || '').toUpperCase().includes(term) ||
      (f.n_remito || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')) ||
      (f.autorizacion || '').toUpperCase().includes(term) ||
      (f.quien_facturo || '').toUpperCase().includes(term)
    )
    r = [...r].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      if (typeof av === 'boolean' && typeof bv === 'boolean') return sortAsc ? (av ? 1 : 0) - (bv ? 1 : 0) : (bv ? 1 : 0) - (av ? 1 : 0)
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return r
  }, [todos, term, filtroTransporte, filtroPol, filtroFechaDesde, filtroFechaHasta, isAdmin, sortKey, sortAsc])

  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const listaPagina = lista.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA)

  useEffect(() => { setPagina(1) }, [q, filtroTransporte, filtroPol, filtroFechaDesde, filtroFechaHasta])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(true) }
  }
  function sortArrow(key: SortKey) { return sortKey !== key ? null : sortAsc ? ' ▲' : ' ▼' }

  async function eliminar(r: FactRegistro) {
    if (!supabase) return
    if (!window.confirm('Eliminar registro de facturacion de "' + (r.razon_social || '-') + '"?')) return
    const { error: err } = await supabase.from('facturacion_fabrica').delete().eq('id', r.id)
    if (err) { mostrarToast('Error al eliminar'); return }
    setSel(null); setCard(null); await cargar(); mostrarToast('Registro eliminado')
  }

  const polCount = todos.filter((f) => f.polo52).length

  const ToastEl = () => toast ? (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">{toast}</div>
  ) : null

  return (
    <Layout>
      <ToastEl />
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Facturacion Fabrica <span className="text-sm font-normal text-sub">({todos.length})</span></h1>
        <p className="text-xs text-sub/70">Gestion de facturacion, remitos y despachos desde fabrica</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por razon social, remito, autorizacion..." className={inputCls + ' pl-8 text-xs'} />
        </div>
        <select value={filtroTransporte} onChange={(e) => setFiltroTransporte(e.target.value)} className={selectCls + ' w-auto text-xs'}>
          <option value="todos">Todos transportes</option>
          {transporteFiltro.map((t) => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-sub whitespace-nowrap">{fmtDateSlider(filtroFechaDesde) || '...'}</span>
          <input type="range" min={dateRange.min || '2020-01-01'} max={dateRange.max || '2099-12-31'} step="1"
            value={filtroFechaDesde || dateRange.min || '2020-01-01'}
            onChange={(e) => { const v = e.target.value; if (v <= (filtroFechaHasta || dateRange.max || '2099-12-31')) setFiltroFechaDesde(v) }}
            className="slider-track w-28 accent-brand-600" title="Fecha desde" />
          <span className="text-[10px] text-sub/50">—</span>
          <input type="range" min={dateRange.min || '2020-01-01'} max={dateRange.max || '2099-12-31'} step="1"
            value={filtroFechaHasta || dateRange.max || '2099-12-31'}
            onChange={(e) => { const v = e.target.value; if (v >= (filtroFechaDesde || dateRange.min || '2020-01-01')) setFiltroFechaHasta(v) }}
            className="slider-track w-28 accent-brand-600" title="Fecha hasta" />
          <span className="text-[11px] text-sub whitespace-nowrap">{fmtDateSlider(filtroFechaHasta) || '...'}</span>
        </div>
        {isAdmin && (
          <label className="flex items-center gap-1.5 text-xs text-sub">
            <input type="checkbox" checked={filtroPol} onChange={(e) => setFiltroPol(e.target.checked)} className="h-3.5 w-3.5 rounded border-line bg-surface2 accent-brand-600" />
            Mostrar restringidos
          </label>
        )}
        <span className="text-[11px] text-sub/70">{lista.length} registros {polCount > 0 && isAdmin ? `(${polCount} POLO52)` : ''}</span>
        {puedeCrear && (
          <>
            <button onClick={() => setModal('importar')} className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Upload size={13} aria-hidden /> Importar</button>
            <button onClick={() => setModal('new')} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} aria-hidden /> Nuevo Registro</button>
          </>
        )}
      </div>

      {/* Table */}
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{term || filtroTransporte !== 'todos' ? 'No se encontraron registros.' : 'Todavia no hay registros de facturacion.'}</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
              <colgroup>
                <col className="w-[4%]" />  {/* Aut */}
                <col className="w-[11%]" /> {/* Razon */}
                <col className="w-[6%]" />  {/* F.Fact */}
                <col className="w-[8%]" />  {/* Remito */}
                <col className="w-[4%]" />  {/* N Cl */}
                <col className="w-[3%]" />  {/* Bulto */}
                <col className="w-[6%]" />  {/* Transp */}
                <col className="w-[5%]" />  {/* %Decl */}
                <col className="w-[6%]" />  {/* SolRetiro */}
                <col className="w-[5%]" />  {/* TotDesp */}
                <col className="w-[5%]" />  {/* Legajo */}
                <col className="w-[8%]" />  {/* Quien Fact */}
                <col className="w-[5%]" />  {/* POLO52 */}
                <col className="w-[6%]" />  {/* F.Envio */}
                <col className="w-[6%]" />  {/* Retira */}
                <col className="w-[7%]" />  {/* Obs */}
                <col className="w-[5%]" />  {/* Acc */}
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-zinc-800 text-left text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('autorizacion')}>Aut{sortArrow('autorizacion')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('razon_social')}>Razon Social{sortArrow('razon_social')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('fecha_fact')}>F.Fact{sortArrow('fecha_fact')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('n_remito')}>N Remito{sortArrow('n_remito')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('n_cliente')}>N Cl{sortArrow('n_cliente')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('bulto')}>Bulto{sortArrow('bulto')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('transporte')}>Transporte{sortArrow('transporte')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('porcentaje_declarado')}>%Decl{sortArrow('porcentaje_declarado')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('solicitud_retiro')}>Sol.Retiro{sortArrow('solicitud_retiro')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('total_despachos')}>Tot.Desp{sortArrow('total_despachos')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('n_legajo')}>Legajo{sortArrow('n_legajo')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('quien_facturo')}>Quien Fact{sortArrow('quien_facturo')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('polo52')}>Polo{sortArrow('polo52')}</th>
                  <th className="cursor-pointer px-1 py-1 text-center whitespace-nowrap hover:text-ink" onClick={() => toggleSort('fecha_envio')}>F.Envio{sortArrow('fecha_envio')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('quien_retira_fabrica')}>Quien Retira{sortArrow('quien_retira_fabrica')}</th>
                  <th className="cursor-pointer px-1 py-1 whitespace-nowrap hover:text-ink" onClick={() => toggleSort('observaciones')}>Observ{sortArrow('observaciones')}</th>
                  <th className="px-1 py-1 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {listaPagina.map((r) => (
                  <tr key={r.id} className="transition hover:bg-line/20 cursor-pointer" onClick={() => setCard(r)}>
                    <td className="px-1 py-[2px] text-center text-[10px] font-medium text-sub">{r.autorizacion || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate font-medium text-ink" title={r.razon_social || ''}>{r.razon_social || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center text-sub whitespace-nowrap">{r.fecha_fact || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={r.n_remito || ''}>{r.n_remito || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center text-sub">{fmtN(r.n_cliente)}</td>
                    <td className="px-1 py-[2px] text-center text-sub">{fmtN(r.bulto)}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={r.transporte || ''}>{r.transporte || '-'}</span></td>
                    <td className="px-1 py-[2px] text-sub">{r.porcentaje_declarado || '-'}</td>
                    <td className="px-1 py-[2px]"><span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + retiroStyle(r.solicitud_retiro)}>{r.solicitud_retiro || 'FALSO'}</span></td>
                    <td className="px-1 py-[2px] text-center text-sub">{r.total_despachos || '-'}</td>
                    <td className="px-1 py-[2px] text-center text-[10px] font-medium text-sub">{r.n_legajo || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={r.quien_facturo || ''}>{r.quien_facturo || '-'}</span></td>
                    <td className="px-1 py-[2px] text-center">{r.polo52 ? <span className="inline-block whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-px text-[9px] font-medium text-amber-400"><Lock size={8} className="mr-0.5 inline" aria-hidden />POLO52</span> : <span className="text-sub/60">-</span>}</td>
                    <td className="px-1 py-[2px] text-center text-sub whitespace-nowrap">{r.fecha_envio || '-'}</td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={r.quien_retira_fabrica || ''}>{r.quien_retira_fabrica || '-'}</span></td>
                    <td className="px-1 py-[2px]"><span className="block truncate text-sub" title={r.observaciones || ''}>{r.observaciones || '-'}</span></td>
                    <td className="px-1 py-[2px] text-right">
                      <div className="flex items-center justify-end gap-px" onClick={(e) => e.stopPropagation()}>
                        {puedeEditar && <button onClick={() => { setSel(r); setModal('edit') }} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Editar"><Pencil size={10} aria-hidden /></button>}
                        {puedeBorrar && <button onClick={() => void eliminar(r)} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={10} aria-hidden /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-sub">
              <span>{lista.length} registros | Pag {paginaSegura} de {totalPaginas}</span>
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

      {/* Detail card */}
      {card && <FactCard registro={card} onClose={() => setCard(null)} onEdit={() => { setSel(card); setModal('edit'); setCard(null) }} puedeEditar={puedeEditar} empleados={empleados} />}

      {/* Modals */}
      {modal === 'importar' && (
        <ImportFacturacion clientes={clientes} empleados={empleados} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await cargar(); mostrarToast('Registros importados') }} />
      )}
      {modal && modal !== 'importar' && (
        <FactModal registro={modal === 'edit' ? sel : null} clientes={clientes} empleados={empleados} onClose={() => { setModal(null); setSel(null) }} onSaved={async () => { setModal(null); setSel(null); await cargar(); mostrarToast(modal === 'edit' ? 'Registro actualizado' : 'Registro creado') }} />
      )}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail Card                                                        */
/* ------------------------------------------------------------------ */

function FactCard({ registro: r, onClose, onEdit, puedeEditar, empleados }: {
  registro: FactRegistro; onClose: () => void; onEdit: () => void; puedeEditar: boolean; empleados: EmpleadoMini[]
}) {
  const empLabel = empleados.find((e) => e.id === r.empleado_id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex w-[92vw] max-w-[1100px] flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-ink">
              <FileText size={18} className="shrink-0 text-amber-400" aria-hidden />
              <h2 className="truncate text-lg font-semibold">{r.razon_social || 'Sin razon social'}</h2>
              {r.polo52 && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400"><Lock size={10} aria-hidden /> Restringido</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-sub">
              <span className="font-medium text-ink">Aut: {r.autorizacion || '-'}</span>
              <span className="text-sub/50">|</span>
              <span>F.Fact: {r.fecha_fact || '-'}</span>
              {r.fecha_envio && <><span className="text-sub/50">|</span><span>F.Envio: {r.fecha_envio}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" title="Cerrar"><X size={16} aria-hidden /></button>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-3" style={{ maxHeight: 'calc(88vh - 120px)' }}>
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Datos Principales</h3>
            <dl className="space-y-2 text-[13px]">
              <CRow label="Razon Social" value={r.razon_social} />
              <CRow label="N Cliente" value={fmtN(r.n_cliente)} />
              <CRow label="N Remito" value={r.n_remito} />
              <CRow label="Transporte" value={r.transporte} />
              <CRow label="% Declarado" value={r.porcentaje_declarado} />
              <CRow label="Bulto" value={fmtN(r.bulto)} />
              <CRow label="Total Despachos" value={r.total_despachos} />
            </dl>
          </section>
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Estados y Personas</h3>
            <dl className="space-y-2 text-[13px]">
              <CRow label="Solicitud Retiro" value={r.solicitud_retiro || 'FALSO'} badge badgeCls={retiroStyle(r.solicitud_retiro)} />
              <CRow label="POLO52" value={r.polo52 ? 'VERDADERO' : 'FALSO'} badge badgeCls={r.polo52 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-surface2 text-sub border-line'} />
              <CRow label="Quien Facturo" value={empLabel ? `#${empLabel.legajo} - ${empLabel.nombre}` : r.quien_facturo} />
              <CRow label="Quien Retira en Fabrica" value={r.quien_retira_fabrica} />
            </dl>
          </section>
          <section className="rounded-xl border border-line bg-surface2 p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Observaciones</h3>
            <dl className="space-y-2 text-[13px]">
              <CRow label="Observaciones" value={r.observaciones} pre />
            </dl>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {puedeEditar && <button onClick={onEdit} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><Pencil size={14} aria-hidden /> Editar Registro</button>}
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function CRow({ label, value, badge, badgeCls, pre }: { label: string; value: string | null | undefined; badge?: boolean; badgeCls?: string; pre?: boolean }) {
  const txt = value?.trim() || '—'
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] font-medium text-sub/70">{label}</dt>
      {badge ? <dd className="mt-px"><span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + (badgeCls || '')}>{txt}</span></dd>
        : <dd className={'mt-px text-ink' + (pre ? ' whitespace-pre-wrap' : '')}>{txt}</dd>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Form Modal                                                         */
/* ------------------------------------------------------------------ */

function FactModal({ registro, clientes, empleados, onClose, onSaved }: {
  registro: FactRegistro | null; clientes: ClienteMini[]; empleados: EmpleadoMini[]; onClose: () => void; onSaved: () => void
}) {
  const [autorizacion, setAutorizacion] = useState(registro?.autorizacion || '')
  const [clienteId, setClienteId] = useState(registro?.cliente_id || '')
  const [razonSocial, setRazonSocial] = useState(registro?.razon_social || '')
  const [nCliente, setNCliente] = useState<number | null>(registro?.n_cliente ?? null)
  const [fechaFact, setFechaFact] = useState(registro?.fecha_fact || new Date().toISOString().slice(0, 10))
  const [nRemito, setNRemito] = useState(registro?.n_remito || '')
  const [bulto, setBulto] = useState(registro?.bulto != null ? String(registro.bulto) : '')
  const [transporte, setTransporte] = useState(registro?.transporte || '')
  const [porcentajeDeclarado, setPorcentajeDeclarado] = useState(registro?.porcentaje_declarado || '')
  const [solicitudRetiro, setSolicitudRetiro] = useState(registro?.solicitud_retiro || 'FALSO')
  const [totalDespachos, setTotalDespachos] = useState(registro?.total_despachos || '')
  const [empleadoId, setEmpleadoId] = useState(registro?.empleado_id || '')
  const [nLegajo, setNLegajo] = useState(registro?.n_legajo || '')
  const [quienFacturo, setQuienFacturo] = useState(registro?.quien_facturo || '')
  const [polo52, setPolo52] = useState(registro?.polo52 ?? false)
  const [fechaEnvio, setFechaEnvio] = useState(registro?.fecha_envio || '')
  const [quienRetiraFabrica, setQuienRetiraFabrica] = useState(registro?.quien_retira_fabrica || '')
  const [observaciones, setObservaciones] = useState(registro?.observaciones || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Client dropdown */
  const [busqCliente, setBusqCliente] = useState('')
  const [openCliDrop, setOpenCliDrop] = useState(false)
  const clientesFiltrados = useMemo(() => {
    const t = busqCliente.toUpperCase()
    return clientes.filter((c) => !t || c.razon_social.toUpperCase().includes(t) || String(c.n_cliente).includes(t))
  }, [clientes, busqCliente])

  /* Employee autocomplete */
  const [busqEmpleado, setBusqEmpleado] = useState('')
  const [openEmpDrop, setOpenEmpDrop] = useState(false)
  const empleadosFiltrados = useMemo(() => {
    const t = busqEmpleado.toUpperCase()
    return empleados.filter((e) => !t || e.nombre.toUpperCase().includes(t) || (e.legajo || '').includes(t))
  }, [empleados, busqEmpleado])

  function seleccionarCliente(c: ClienteMini) {
    setClienteId(c.id); setRazonSocial(c.razon_social); setNCliente(c.n_cliente); setOpenCliDrop(false); setBusqCliente('')
  }
  function seleccionarEmpleado(e: EmpleadoMini) {
    setEmpleadoId(e.id); setQuienFacturo(e.nombre); setNLegajo(e.legajo || ''); setOpenEmpDrop(false); setBusqEmpleado('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nCliente) { setError('Debe seleccionar un N° Cliente.'); return }
    if (!autorizacion) { setError('Debe seleccionar Autorizacion (SI/NO).'); return }
    if (!quienFacturo.trim()) { setError('Debe seleccionar quien facturo.'); return }
    setBusy(true); setError(null)
    const payload: Record<string, unknown> = {
      autorizacion: autorizacion.trim() || null,
      cliente_id: clienteId || null,
      razon_social: razonSocial.trim() || null,
      fecha_fact: fechaFact.trim() || null,
      n_remito: nRemito.trim() || null,
      n_cliente: nCliente,
      bulto: bulto ? Number(bulto) : null,
      transporte: transporte || null,
      porcentaje_declarado: porcentajeDeclarado || null,
      solicitud_retiro: solicitudRetiro || 'FALSO',
      total_despachos: totalDespachos.trim() || null,
      empleado_id: empleadoId || null,
      n_legajo: nLegajo || null,
      quien_facturo: quienFacturo.trim() || null,
      polo52,
      fecha_envio: fechaEnvio.trim() || null,
      quien_retira_fabrica: quienRetiraFabrica.trim() || null,
      observaciones: observaciones.trim() || null,
    }
    let result
    if (registro) result = await supabase.from('facturacion_fabrica').update(payload).eq('id', registro.id).select().single()
    else result = await supabase.from('facturacion_fabrica').insert(payload).select().single()
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex w-[92vw] max-w-[1000px] flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><FileText size={18} className="text-amber-400" aria-hidden />{registro ? 'Editar Registro' : 'Nuevo Registro'}</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {/* Row 1 */}
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Autorizacion *</span>
              <select value={autorizacion} onChange={(e) => setAutorizacion(e.target.value)} className={selectCls}><option value="">--</option><option value="SI">SI</option><option value="NO">NO</option></select>
            </label>
            {/* N° Cliente — searchable dropdown */}
            <label className="block relative">
              <span className="mb-1 block text-xs font-medium text-sub">N Cliente *</span>
              <div className="relative">
                <input value={openCliDrop ? busqCliente : (nCliente != null ? String(nCliente) : '')} onChange={(e) => { setBusqCliente(e.target.value); setOpenCliDrop(true) }} onFocus={() => setOpenCliDrop(true)} placeholder="Buscar por N° o nombre..." className={inputCls} />
                {openCliDrop && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
                    <div className="sticky top-0 bg-surface p-1"><input autoFocus value={busqCliente} onChange={(e) => setBusqCliente(e.target.value)} placeholder="Buscar..." className={inputCls + ' text-xs'} /></div>
                    {clientesFiltrados.length === 0 && <p className="p-2 text-xs text-sub">No hay clientes disponibles.</p>}
                    {clientesFiltrados.map((c) => (
                      <button key={c.id} type="button" onClick={() => seleccionarCliente(c)} className={'w-full px-3 py-1.5 text-left text-xs hover:bg-line/30 ' + (c.id === clienteId ? 'bg-brand-600/10 text-brand-400' : 'text-ink')}>
                        {c.razon_social} ({fmtN(c.n_cliente)})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            {/* Razon Social — autocompletada (BUSCARV) */}
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Razon Social</span><input value={razonSocial} readOnly className={inputCls + ' bg-line/30 text-sub'} placeholder="Se autocompleta al seleccionar N° Cliente" /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Fecha Facturacion</span><input type="date" value={fechaFact} onChange={(e) => setFechaFact(e.target.value)} className={inputCls} /></label>

            {/* Row 2 */}
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">N Remito</span><input value={nRemito} onChange={(e) => setNRemito(e.target.value)} placeholder="30307 - 30308" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Bulto</span><input type="number" value={bulto} onChange={(e) => setBulto(e.target.value)} placeholder="0" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Transporte</span>
              <input list="transportes-list" value={transporte} onChange={(e) => setTransporte(e.target.value)} placeholder="Seleccionar o escribir..." className={inputCls} />
              <datalist id="transportes-list">{TRANSPORTE_OPCIONES.map((v) => <option key={v} value={v} />)}</datalist>
            </label>

            {/* Row 3 */}
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">% Declarado</span>
              <select value={porcentajeDeclarado} onChange={(e) => setPorcentajeDeclarado(e.target.value)} className={selectCls}><option value="">--</option>{VALOR_DEC_OPCIONES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            </label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Solicitud Retiro</span>
              <select value={solicitudRetiro} onChange={(e) => setSolicitudRetiro(e.target.value)} className={selectCls}>{RETIRO_OPCIONES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            </label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Total Despachos</span><input value={totalDespachos} onChange={(e) => setTotalDespachos(e.target.value)} placeholder="-" className={inputCls} /></label>

            {/* Row 4 — Employee autocomplete */}
            <label className="block sm:col-span-2 relative">
              <span className="mb-1 block text-xs font-medium text-sub">Quien Facturo *</span>
              <div className="relative">
                <input value={openEmpDrop ? busqEmpleado : (quienFacturo ? `${nLegajo ? '#' + nLegajo + ' - ' : ''}${quienFacturo}` : '')} onChange={(e) => { setBusqEmpleado(e.target.value); setOpenEmpDrop(true) }} onFocus={() => setOpenEmpDrop(true)} placeholder="Buscar por legajo o nombre..." className={inputCls} />
                {openEmpDrop && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
                    <div className="sticky top-0 bg-surface p-1"><input autoFocus value={busqEmpleado} onChange={(e) => setBusqEmpleado(e.target.value)} placeholder="Buscar..." className={inputCls + ' text-xs'} /></div>
                    {empleadosFiltrados.length === 0 && <p className="p-2 text-xs text-sub">No hay empleados disponibles.</p>}
                    {empleadosFiltrados.map((em) => (
                      <button key={em.id} type="button" onClick={() => seleccionarEmpleado(em)} className={'w-full px-3 py-1.5 text-left text-xs hover:bg-line/30 ' + (em.id === empleadoId ? 'bg-brand-600/10 text-brand-400' : 'text-ink')}>
                        #{em.legajo || '?'} - {em.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Fecha Envio</span><input type="date" value={fechaEnvio} onChange={(e) => setFechaEnvio(e.target.value)} className={inputCls} /></label>
            <label className="block flex items-end gap-3 pb-1">
              <input type="checkbox" checked={polo52} onChange={(e) => setPolo52(e.target.checked)} className="h-4 w-4 rounded border-line bg-surface2 accent-brand-600" />
              <span className="text-sm text-ink">POLO52 (restringido)</span>
            </label>

            {/* Row 5 */}
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Quien Retira en Fabrica</span><input value={quienRetiraFabrica} onChange={(e) => setQuienRetiraFabrica(e.target.value)} placeholder="Nombre completo" className={inputCls} /></label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Observaciones</span><textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className={inputCls + ' resize-none'} /></label>
          </div>
        </form>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">Cancelar</button>
          <button onClick={(e) => void handleSubmit(e)} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}{registro ? 'Guardar cambios' : 'Crear Registro'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Import Wizard (BUSCARV)                                            */
/* ------------------------------------------------------------------ */

type FileRow = Record<string, any>

function ImportFacturacion({ clientes, empleados, onClose, onSaved }: {
  clientes: ClienteMini[]; empleados: EmpleadoMini[]; onClose: () => void; onSaved: () => void
}) {
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
    { key: 'n_cliente', label: '★ N Cliente (obligatorio)', req: true },
    { key: 'quien_facturo', label: '★ Legajo / Quien Facturo (obligatorio)', req: true },
    { key: 'autorizacion', label: 'Autorizacion' },
    { key: 'fecha_fact', label: 'Fecha Fact' },
    { key: 'n_remito', label: 'N Remito' },
    { key: 'bulto', label: 'Bulto' },
    { key: 'transporte', label: 'Transporte' },
    { key: 'porcentaje_declarado', label: '% Declarado' },
    { key: 'solicitud_retiro', label: 'Solicitud Retiro' },
    { key: 'total_despachos', label: 'Total Despachos' },
    { key: 'polo52', label: 'POLO52' },
    { key: 'fecha_envio', label: 'Fecha Envio' },
    { key: 'quien_retira_fabrica', label: 'Quien Retira Fabrica' },
    { key: 'observaciones', label: 'Observaciones' },
  ]

  const autoMap = useCallback((hdrs: string[]) => {
    const m: Record<string, string> = {}
    const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    hdrs.forEach((h) => {
      const n = norm(h)
      // N° CLIENTE → n_cliente
      if (n.includes('ncliente') || n.includes('ncliente') || n === 'ncliente' || n.includes('nrocliente')) m['n_cliente'] = h
      // Legajo / Quien Facturo → quien_facturo
      else if (n.includes('legajo') || n.includes('quienfacturo') || n.includes('quien')) m['quien_facturo'] = h
      // Razon Social → ignorar
      else if (n.includes('razonsocial') || n.includes('razon')) { /* ignorar */ }
      // Nombre empleado → ignorar
      else if (n.includes('nombreempleado') || n.includes('nombre')) { /* ignorar */ }
      else {
        const found = COLS_DESTINO.find((c) => norm(c.label.replace('★ ', '').replace(' (obligatorio)', '')) === n || norm(c.key) === n)
        if (found) m[found.key] = h
      }
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
        const wb = XLSX.read(data, { type: 'array' })
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
    rows.forEach((row, i) => {
      const nr: FileRow = {}
      Object.entries(map).forEach(([dest, src]) => { if (dest && src) nr[dest] = String(row[src] ?? '').trim() })

      /* BUSCARV N° CLIENTE → cliente */
      const ncRaw = cleanVal(nr.n_cliente || '')
      const nc = ncRaw ? Number(ncRaw) : NaN
      if (!nc || isNaN(nc)) { errs.push({ idx: i, err: `Fila ${i + 1}: N° Cliente "${ncRaw}" invalido.` }); return }
      const cli = clientes.find((c) => c.n_cliente === nc)
      if (!cli) { errs.push({ idx: i, err: `Fila ${i + 1}: Cliente Nº ${nc} no existe en el sistema.` }); return }
      nr._cliente_id = cli.id; nr.n_cliente = cli.n_cliente; nr.razon_social = cli.razon_social

      /* BUSCARV LEGAJO / NOMBRE → empleado */
      const empRaw = cleanVal(nr.quien_facturo || '')
      if (!empRaw) { errs.push({ idx: i, err: `Fila ${i + 1}: Quien Facturo vacio.` }); return }
      const empNum = Number(empRaw)
      let emp: EmpleadoMini | undefined
      if (!isNaN(empNum) && empNum > 0) {
        emp = empleados.find((e) => Number(e.legajo) === empNum)
      } else {
        emp = empleados.find((e) => e.nombre.toUpperCase() === empRaw.toUpperCase())
          || empleados.find((e) => e.nombre.toUpperCase().includes(empRaw.toUpperCase()))
      }
      if (!emp) { errs.push({ idx: i, err: `Fila ${i + 1}: Empleado "${empRaw}" no encontrado.` }); return }
      nr._empleado_id = emp.id; nr.n_legajo = emp.legajo || ''; nr.quien_facturo = emp.nombre

      /* POLO52 */
      if (nr.polo52) { const v = String(nr.polo52).toUpperCase(); nr.polo52 = v === 'VERDADERO' || v === '1' || v === 'SI' || v === 'TRUE' }
      else nr.polo52 = false
      if (nr.bulto) nr.bulto = Number(nr.bulto) || null

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
      const batch = validRows.slice(i, i + batchSize).map(({ _cliente_id, _empleado_id, ...rest }) => ({
        autorizacion: rest.autorizacion || null, cliente_id: _cliente_id || null, razon_social: rest.razon_social || null,
        fecha_fact: rest.fecha_fact || null, n_remito: rest.n_remito || null, n_cliente: rest.n_cliente ?? null,
        bulto: rest.bulto ?? null, transporte: rest.transporte || null, porcentaje_declarado: rest.porcentaje_declarado || null,
        solicitud_retiro: rest.solicitud_retiro || 'FALSO', total_despachos: rest.total_despachos || null,
        empleado_id: _empleado_id || null, n_legajo: rest.n_legajo || null, quien_facturo: rest.quien_facturo || null,
        polo52: !!rest.polo52, fecha_envio: rest.fecha_envio || null, quien_retira_fabrica: rest.quien_retira_fabrica || null,
        observaciones: rest.observaciones || null,
      }))
      const { error } = await supabase.from('facturacion_fabrica').insert(batch)
      if (error) { setBusy(false); setResultMsg('Error: ' + error.message); setPaso('done'); return }
      inserted += batch.length
      setProgress(Math.round((inserted / validRows.length) * 100))
    }
    setResultMsg(`${inserted} registros importados correctamente.`)
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
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Upload size={18} className="text-amber-400" aria-hidden /> Importar Facturacion</h2>
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
              <p className="mb-2 text-xs text-sub">Mapea las columnas del archivo. Los campos con ★ son obligatorios. "Razon Social" y "Nombre Empleado" se ignoran (se autocompletan desde Clientes/Empleados).</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {COLS_DESTINO.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-xs">
                    <span className={'w-44 shrink-0 truncate ' + (col.req ? 'font-semibold text-amber-400' : 'text-sub')}>{col.label}</span>
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
          {paso === 'validate' && <button onClick={() => void importar()} disabled={busy || validCount === 0} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Upload size={15} /> Importar {validCount} registros</button>}
        </div>
      </div>
    </div>
  )
}
