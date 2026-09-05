import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Loader2, Search, SearchX, Trash2, X, FileText, Eye, Plus, ClipboardList,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import HistorialLista from '@/components/HistorialLista'
import { registrarHistorial } from '@/lib/historial'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface NotaCredito {
  id: string
  guia_id: string | null
  nro_pedido: string | null
  n_cliente: string | null
  razon_social: string | null
  n_remito: string | null
  bulto: number | null
  fecha: string | null
  observaciones: string | null
  estado: string | null
  created_at: string
}

const ESTADOS = ['PENDIENTE', 'APLICADA', 'ANULADA']
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function estadoCls(e: string | null): string {
  if (e === 'APLICADA') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (e === 'ANULADA') return 'bg-red-500/15 text-red-400 border-red-500/30'
  return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
}

export default function NotasCredito() {
  const { can, perfil } = useAuth()
  const puedeCrear = can('mayorista.notas_credito.create')
  const puedeBorrar = can('mayorista.notas_credito.delete')

  const [todos, setTodos] = useState<NotaCredito[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [fEstado, setFEstado] = useState('')
  const [card, setCard] = useState<NotaCredito | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [crear, setCrear] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editando, setEditando] = useState<{ id: string; campo: string } | null>(null)

  const mostrarToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const { data, error: err } = await supabase
      .from('notas_credito')
      .select('*')
      .order('created_at', { ascending: false })
    if (err) { setError(err.message); setCargando(false); return }
    setTodos((data as NotaCredito[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (fEstado) r = r.filter((n) => (n.estado || 'PENDIENTE') === fEstado)
    if (term) r = r.filter((n) =>
      (n.nro_pedido || '').toUpperCase().includes(term) ||
      (n.n_cliente || '').toUpperCase().includes(term) ||
      (n.razon_social || '').toUpperCase().includes(term) ||
      (n.observaciones || '').toUpperCase().includes(term)
    )
    return r
  }, [todos, fEstado, term])

  async function eliminar(n: NotaCredito) {
    if (!supabase) return
    const { error: err } = await supabase.from('notas_credito').delete().eq('id', n.id)
    if (err) { mostrarToast('Error al eliminar'); return }
    void registrarHistorial('nota_credito', n.id, 'borrado', { nombre: perfil?.nombre ?? null, email: perfil?.email ?? null }, `Nota de credito N° ${n.nro_pedido ?? ''} - ${n.razon_social ?? ''}`)
    setCard(null); await cargar(); mostrarToast('Nota de credito eliminada')
  }

  async function guardarCampo(n: NotaCredito, campo: string, valor: unknown) {
    if (!supabase) return
    setEditando(null)
    const { error } = await supabase.from('notas_credito').update({ [campo]: valor }).eq('id', n.id)
    if (error) { mostrarToast('Error al guardar: ' + error.message); return }
    setTodos((prev) => prev.map((x) => (x.id === n.id ? { ...x, [campo]: valor } : x)))
    void registrarHistorial('nota_credito', n.id, 'modificacion', { nombre: perfil?.nombre ?? null, email: perfil?.email ?? null }, `${campo} = ${valor ?? '(vacío)'}`)
    mostrarToast('Guardado')
  }

  function empezarEdicion(n: NotaCredito, campo: string, _valorActual: unknown) {
    if (!puedeBorrar) return
    setEditando({ id: n.id, campo })
  }

  const ToastEl = () => toast ? (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">{toast}</div>
  ) : null

  function CRow({ label, value, badge, badgeCls }: { label: string; value: string | null | undefined; badge?: boolean; badgeCls?: string }) {
    return (
      <div className="flex flex-col">
        <dt className="text-[11px] font-medium text-sub/70">{label}</dt>
        {badge ? <dd className="mt-px"><span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + (badgeCls || '')}>{value || '—'}</span></dd>
          : <dd className="mt-px text-ink">{value || '—'}</dd>}
      </div>
    )
  }

  return (
    <Layout>
      <ToastEl />
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Notas de Credito <span className="text-sm font-normal text-sub">({todos.length})</span></h1>
        <p className="text-xs text-sub/70">Notas de credito generadas desde guias con pedido NOTA DE CREDITO o creadas manualmente</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por pedido, cliente, razon social..." className={inputCls + ' pl-8 text-xs'} />
        </div>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={selectCls + ' w-auto text-xs'}>
          <option value="">Estado (todos)</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="text-[11px] text-sub/70">{lista.length} notas</span>
        {puedeCrear && (
          <button onClick={() => setCrear(true)} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} aria-hidden /> Nueva Nota de Credito</button>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{term ? 'No se encontraron notas de credito.' : 'Todavia no hay notas de credito.'}</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="border-b border-line bg-zinc-800 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="px-2 py-1 whitespace-nowrap">Nro Pedido</th>
                  <th className="px-2 py-1 text-center whitespace-nowrap">Fecha</th>
                  <th className="px-2 py-1 text-center whitespace-nowrap">N Cl</th>
                  <th className="px-2 py-1 whitespace-nowrap">Razon Social</th>
                  <th className="px-2 py-1 text-center whitespace-nowrap">Remito</th>
                  <th className="px-2 py-1 text-center whitespace-nowrap">Bulto</th>
                  <th className="px-2 py-1 text-center whitespace-nowrap">Estado</th>
                  <th className="px-2 py-1 whitespace-nowrap">Obs</th>
                  <th className="px-2 py-1 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {lista.map((n) => {
                  const activo = editando?.id === n.id && editando?.campo === 'estado'
                  return (
                    <tr key={n.id} className={'cursor-pointer transition hover:bg-line/20' + (n.estado === 'ANULADA' ? ' bg-red-500/10 text-red-400' : '')} onClick={() => setCard(n)}>
                      <td className="px-2 py-1 font-medium text-ink">{n.nro_pedido || '-'}</td>
                      <td className="px-2 py-1 text-center text-sub">{fmtDate(n.fecha)}</td>
                      <td className="px-2 py-1 text-center text-sub">{n.n_cliente || '-'}</td>
                      <td className="px-2 py-1"><span className="block max-w-[240px] truncate text-sub" title={n.razon_social || ''}>{n.razon_social || '-'}</span></td>
                      <td className="px-2 py-1 text-center text-sub">{n.n_remito || '-'}</td>
                      <td className="px-2 py-1 text-center text-sub">{n.bulto != null ? n.bulto : '-'}</td>
                      <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                        {activo ? (
                          <select autoFocus value={n.estado || 'PENDIENTE'} onChange={(e) => { void guardarCampo(n, 'estado', e.target.value); setEditando(null) }} className={selectCls + ' w-auto text-xs py-0.5'}>
                            {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
                          </select>
                        ) : (
                          <button onClick={() => empezarEdicion(n, 'estado', n.estado)} title="Cambiar estado" className={'inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium leading-tight ' + estadoCls(n.estado)}>{n.estado || 'PENDIENTE'}</button>
                        )}
                      </td>
                      <td className="px-2 py-1"><span className="block max-w-[220px] truncate text-sub" title={n.observaciones || ''}>{n.observaciones || '-'}</span></td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex items-center justify-end gap-px" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setCard(n)} className="rounded border border-line p-0.5 text-sub transition hover:text-amber-400" title="Ver"><Eye size={10} aria-hidden /></button>
                          {puedeBorrar && <button onClick={() => setConfirm({ message: 'Eliminar nota de credito de "' + (n.razon_social || '-') + '"?', onConfirm: () => void eliminar(n) })} className="rounded border border-line p-0.5 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={10} aria-hidden /></button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail card */}
      {card && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => setCard(null)}>
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="truncate text-lg font-semibold text-ink"><FileText size={16} className="mr-2 inline text-amber-400" aria-hidden />Nota de Credito</h2>
              <button onClick={() => setCard(null)} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
            </div>
            <div className="space-y-3 overflow-y-auto p-5" style={{ maxHeight: 'calc(88vh - 120px)' }}>
              <section className="rounded-xl border border-line bg-surface2 p-4">
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-sub/70">Detalles</h3>
                <dl className="space-y-2 text-[13px]">
                  <CRow label="Nro Pedido" value={card.nro_pedido} />
                  <CRow label="Fecha" value={fmtDate(card.fecha)} />
                  <CRow label="N Cliente" value={card.n_cliente} />
                  <CRow label="Razon Social" value={card.razon_social} />
                  <CRow label="N Remito" value={card.n_remito} />
                  <CRow label="Bulto" value={card.bulto != null ? String(card.bulto) : null} />
                  <CRow label="Estado" value={card.estado || 'PENDIENTE'} badge badgeCls={estadoCls(card.estado)} />
                  <CRow label="Observaciones" value={card.observaciones} />
                </dl>
              </section>
              <HistorialLista entidad="nota_credito" registroId={card.id} />
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />

      {crear && <NuevaNotaCredito onClose={() => setCrear(false)} onSaved={() => { setCrear(false); void cargar() }} />}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */
/*  Nueva Nota de Credito (alta manual)                                */
/* ------------------------------------------------------------------ */

function NuevaNotaCredito({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { perfil } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nroPedido, setNroPedido] = useState('')
  const [nCliente, setNCliente] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [nRemito, setNRemito] = useState('')
  const [bulto, setBulto] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const hoy = new Date().toISOString().slice(0, 10)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nroPedido.trim()) { setError('El Nro Pedido es obligatorio.'); return }
    if (!nCliente.trim()) { setError('El Nro Cliente es obligatorio.'); return }
    setBusy(true); setError(null)

    const { data, error: err } = await supabase
      .from('notas_credito')
      .insert({
        guia_id: null,
        nro_pedido: nroPedido.trim(),
        n_cliente: nCliente.trim() || null,
        razon_social: razonSocial.trim() || null,
        n_remito: nRemito.trim() || null,
        bulto: bulto ? Number(bulto) || null : null,
        fecha: hoy,
        observaciones: observaciones.trim() || null,
        estado: 'PENDIENTE',
      })
      .select()
      .single()
    if (err) { setBusy(false); setError(err.message); return }
    if (data) void registrarHistorial(
      'nota_credito',
      (data as { id: string }).id,
      'creacion',
      { nombre: perfil?.nombre ?? null, email: perfil?.email ?? null },
      `Nota de credito N° ${nroPedido.trim()} - ${razonSocial.trim() || ''}`,
    )
    setBusy(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-display font-semibold text-ink"><ClipboardList size={16} aria-hidden /> Nueva Nota de Credito</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <label className="block col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Nro Pedido *</span>
              <input value={nroPedido} onChange={(e) => setNroPedido(e.target.value)} placeholder="874, 824, 682..." className={inputCls} autoFocus />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Nro Cliente *</span>
              <input value={nCliente} onChange={(e) => setNCliente(e.target.value)} placeholder="N° cliente..." className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Razon Social</span>
              <input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} placeholder="Razon social..." className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">N° Remito</span>
              <input value={nRemito} onChange={(e) => setNRemito(e.target.value)} placeholder="Remito (opcional)..." className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Cant. Bultos</span>
              <input type="number" min={0} value={bulto} onChange={(e) => setBulto(e.target.value)} placeholder="0" className={inputCls} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Observaciones</span>
              <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} placeholder="Notas adicionales..." className={inputCls + ' resize-none'} />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-press rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-sub hover:bg-line">Cancelar</button>
            <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
              Crear nota de credito
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}