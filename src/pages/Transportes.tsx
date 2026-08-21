import { useEffect, useMemo, useRef, useState, useCallback, type FormEvent } from 'react'
import {
  ArrowLeft, Search, Loader2, SearchX, Plus, Pencil, Truck, Phone,
  Mail, Copy, MessageCircle, Eye, EyeOff, Trash2, Globe, ClipboardList,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Transporte {
  id: string; nombre: string; web: string | null; telefono: string | null
  whatsapp: string | null; email: string | null; retiro_calera: string | null
  retiro_polo52: string | null; via_solicitud_retiro: string | null
  etiquetas: string | null; estado: string | null; observaciones: string | null
  requisitos_remitente: string | null; requisitos_telefono: string | null
  requisitos_direccion_retiro: string | null; requisitos_destinatario: string | null
  requisitos_direccion_envio: string | null; requisitos_localidad: string | null
  requisitos_cantidad_bultos: number | null; requisitos_pago: string | null
  created_at: string
}

type Vista = 'lista' | 'ficha' | 'form'
const PAGO_OPCIONES = ['A cargo del remitente','A cargo del destinatario','Pagado','Contra entrega','Otro']
const VIA_OPCIONES = ['WhatsApp','Telefono','Email','Otro']
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
function clip(texto: string) { if (texto) void navigator.clipboard.writeText(texto) }

function Row({ icon: Icon, label, value }: { icon?: typeof Truck; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-sub/60" aria-hidden />}
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-sub">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
      </div>
    </div>
  )
}

function requisitosText(t: Transporte): string {
  return [
    'REQUISITOS DE TRANSPORTE', '',
    'Remitente: ' + (t.requisitos_remitente || '-'),
    'Telefono: ' + (t.requisitos_telefono || '-'),
    'Direccion de retiro: ' + (t.requisitos_direccion_retiro || '-'),
    'Destinatario: ' + (t.requisitos_destinatario || '-'),
    'Direccion de envio: ' + (t.requisitos_direccion_envio || '-'),
    'Localidad: ' + (t.requisitos_localidad || '-'),
    'Cantidad de bultos: ' + (t.requisitos_cantidad_bultos ?? '-'),
    'Pago: ' + (t.requisitos_pago || '-'),
  ].join('\n')
}
export default function Transportes() {
  const { can } = useAuth()
  const puedeCrear = can('mayorista.transportes.create')
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

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    const { data } = await supabase.from('transportes').select('*').order('nombre', { ascending: true }).limit(2000)
    setTodos((data as Transporte[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (filtro !== 'todos') r = r.filter((t) => t.estado === filtro)
    if (!term) return r
    return r.filter((t) => (t.nombre || '').toUpperCase().includes(term) || (t.telefono || '').includes(term.replace(/\D/g, '')))
  }, [todos, term, filtro])

  async function toggleEstado(t: Transporte) {
    if (!supabase) return
    const nuevo = t.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO'
    const { error } = await supabase.from('transportes').update({ estado: nuevo }).eq('id', t.id)
    if (error) { mostrarToast('Error al cambiar estado'); return }
    await cargar(); mostrarToast(nuevo === 'ACTIVO' ? 'Transporte activado' : 'Transporte desactivado')
  }

  async function eliminar(t: Transporte) {
    if (!supabase) return
    if (!window.confirm('Eliminar "' + t.nombre + '"?')) return
    const { error } = await supabase.from('transportes').delete().eq('id', t.id)
    if (error) { mostrarToast('Error al eliminar'); return }
    setVista('lista'); setSel(null); await cargar(); mostrarToast('Transporte eliminado')
  }

  function abrirNuevo() { setEditando(null); setVista('form') }
  function abrirEditar(t: Transporte) { setEditando(t); setVista('form') }
  function abrirFicha(t: Transporte) { setSel(t); setVista('ficha') }

  const totalActivos = todos.filter((t) => t.estado === 'ACTIVO').length
  const totalInactivos = todos.filter((t) => t.estado !== 'ACTIVO').length

  const ToastEl = () => toast ? (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 shadow-lg backdrop-blur-sm">{toast}</div>
  ) : null

  if (vista === 'form') {
    return <TransporteForm inicial={editando} onCancel={() => setVista(editando ? 'ficha' : 'lista')} onSaved={async (g) => { await cargar(); setSel(g); setVista('ficha') }} />
  }

  if (vista === 'ficha' && sel) {
    const hr = sel.requisitos_remitente || sel.requisitos_telefono || sel.requisitos_direccion_retiro || sel.requisitos_destinatario || sel.requisitos_direccion_envio || sel.requisitos_localidad || sel.requisitos_cantidad_bultos || sel.requisitos_pago
    return (
      <Layout>
        <ToastEl />
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setVista('lista')} className="inline-flex items-center gap-1 text-sm font-medium text-sub transition hover:text-ink"><ArrowLeft size={15} aria-hidden /> Volver a la lista</button>
          <div className="flex items-center gap-2">
            {puedeEditar && <button onClick={() => abrirEditar(sel)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line"><Pencil size={15} aria-hidden /> Editar</button>}
            {puedeBorrar && <button onClick={() => void eliminar(sel)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-brand-600/30 bg-brand-600/10 px-3 py-1.5 text-sm font-medium text-brand-400 hover:bg-brand-600/20"><Trash2 size={15} aria-hidden /> Eliminar</button>}
          </div>
        </div>
        <article className="mx-auto max-w-xl animate-enter overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          <header className="flex items-center gap-3 border-b border-line p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-display font-semibold text-amber-400">{iniciales(sel.nombre)}</div>
            <div className="min-w-0 flex-1"><h3 className="truncate font-display font-semibold text-ink">{sel.nombre}</h3></div>
            <span className={'shrink-0 rounded-full border px-3 py-1 text-xs font-medium ' + estadoStyle(sel.estado)}>{sel.estado || 'INACTIVO'}</span>
          </header>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            {sel.telefono && (<>
              <a href={'tel:' + sel.telefono} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Phone size={13} aria-hidden /> Llamar</a>
              <button onClick={() => { clip(sel.telefono!); mostrarToast('Telefono copiado') }} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Copy size={13} aria-hidden /> Copiar</button>
              <a href={'https://wa.me/' + (sel.whatsapp || sel.telefono || '').replace(/\D/g, '')} target="_blank" rel="noopener noreferrer" className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20"><MessageCircle size={13} aria-hidden /> WhatsApp</a>
            </>)}
            {sel.email && <a href={'mailto:' + sel.email} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Mail size={13} aria-hidden /> Email</a>}
            {sel.web && <a href={sel.web} target="_blank" rel="noopener noreferrer" className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Globe size={13} aria-hidden /> Web</a>}
          </div>
          {sel.web && <div className="border-b border-line"><dl><Row icon={Globe} label="Web" value={sel.web} /></dl></div>}
          {(sel.retiro_calera || sel.retiro_polo52 || sel.via_solicitud_retiro) && (
            <div className="border-b border-line px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub">Contactos de retiro</p>
              <dl className="divide-y divide-line/70">
                {sel.retiro_calera && <Row icon={Phone} label="Retiro Calera" value={sel.retiro_calera} />}
                {sel.retiro_polo52 && <Row icon={Phone} label="Retiro Polo 52" value={sel.retiro_polo52} />}
                {sel.via_solicitud_retiro && <Row label="Via de solicitud" value={sel.via_solicitud_retiro} />}
              </dl>
            </div>
          )}
          {sel.observaciones && <div className="border-b border-line"><dl><Row label="Observaciones" value={sel.observaciones} /></dl></div>}
          {hr && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sub"><ClipboardList size={14} aria-hidden /> Requisitos de transporte</p>
                <button onClick={() => { clip(requisitosText(sel)); mostrarToast('Requisitos copiados al portapapeles') }} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line"><Copy size={13} aria-hidden /> Copiar</button>
              </div>
              <dl className="divide-y divide-line/70">
                {sel.requisitos_remitente && <Row label="Remitente" value={sel.requisitos_remitente} />}
                {sel.requisitos_telefono && <Row label="Telefono" value={sel.requisitos_telefono} />}
                {sel.requisitos_direccion_retiro && <Row label="Direccion de retiro" value={sel.requisitos_direccion_retiro} />}
                {sel.requisitos_destinatario && <Row label="Destinatario" value={sel.requisitos_destinatario} />}
                {sel.requisitos_direccion_envio && <Row label="Direccion de envio" value={sel.requisitos_direccion_envio} />}
                {sel.requisitos_localidad && <Row label="Localidad" value={sel.requisitos_localidad} />}
                {sel.requisitos_cantidad_bultos != null && <Row label="Cantidad de bultos" value={String(sel.requisitos_cantidad_bultos)} />}
                {sel.requisitos_pago && <Row label="Pago" value={sel.requisitos_pago} />}
              </dl>
            </div>
          )}
        </article>
      </Layout>
    )
  }

  return (
    <Layout>
      <ToastEl />
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Transportes</h1>
        <p className="mt-1 text-sm text-sub">Gestion de transportes: crear, editar y administrar.</p>
      </header>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-sub">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-400"><Eye size={12} aria-hidden /> {totalActivos} activos</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-brand-400"><EyeOff size={12} aria-hidden /> {totalInactivos} inactivos</span>
        <span className="text-sub/70">{'\u00B7'} {todos.length} total</span>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[200px]">
          <span className="mb-1 block text-xs font-medium text-sub">Buscar</span>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o telefono..." className={inputCls + ' pl-9'} />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-sub">Estado</span>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className={inputCls + ' w-auto'}>
            <option value="todos">Todos</option><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option>
          </select>
        </label>
        {puedeCrear && <button onClick={abrirNuevo} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"><Plus size={15} aria-hidden /> Nuevo transporte</button>}
      </div>
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center"><SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden /><p className="text-sm text-sub">{term || filtro !== 'todos' ? 'No se encontraron transportes.' : 'Todavia no hay transportes cargados.'}</p></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs font-medium text-sub"><th className="px-4 py-2.5">Nombre</th><th className="px-4 py-2.5">Telefono</th><th className="px-4 py-2.5">Estado</th><th className="px-4 py-2.5 text-right">Acciones</th></tr></thead>
              <tbody className="divide-y divide-line/70">
                {lista.map((t) => (
                  <tr key={t.id} className="cursor-pointer transition hover:bg-line/30" onClick={() => abrirFicha(t)}>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400">{iniciales(t.nombre)}</div><span className="font-medium text-ink">{t.nombre}</span></div></td>
                    <td className="px-4 py-2.5 text-sub">{t.telefono || '\u2014'}</td>
                    <td className="px-4 py-2.5"><span className={'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ' + estadoStyle(t.estado)}>{t.estado || 'INACTIVO'}</span></td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-end gap-1">
                      {puedeEditar && <button onClick={() => abrirEditar(t)} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={13} aria-hidden /></button>}
                      <button onClick={() => void toggleEstado(t)} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink">{t.estado === 'ACTIVO' ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-line/70">
            {lista.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer transition hover:bg-line/30" onClick={() => abrirFicha(t)}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-sm font-semibold text-amber-400">{iniciales(t.nombre)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-medium text-ink">{t.nombre}</span><span className={'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ' + estadoStyle(t.estado)}>{t.estado || 'INACTIVO'}</span></div>
                  <p className="truncate text-xs text-sub">{t.telefono || 'Sin datos'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {puedeEditar && <button onClick={() => abrirEditar(t)} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={13} aria-hidden /></button>}
                  <button onClick={() => void toggleEstado(t)} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink">{t.estado === 'ACTIVO' ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  )
}

function TransporteForm({ inicial, onCancel, onSaved }: { inicial: Transporte | null; onCancel: () => void; onSaved: (t: Transporte) => void }) {
  const [nombre, setNombre] = useState(inicial?.nombre || '')
  const [web, setWeb] = useState(inicial?.web || '')
  const [retiroCalera, setRetiroCalera] = useState(inicial?.retiro_calera || '')
  const [retiroPolo52, setRetiroPolo52] = useState(inicial?.retiro_polo52 || '')
  const [viaSolicitud, setViaSolicitud] = useState(inicial?.via_solicitud_retiro || 'WhatsApp')
  const [etiquetas, setEtiquetas] = useState(inicial?.etiquetas || '')
  const [estado, setEstado] = useState(inicial?.estado || 'ACTIVO')
  const [obs, setObs] = useState(inicial?.observaciones || '')
  const [reqRemitente, setReqRemitente] = useState(inicial?.requisitos_remitente || '')
  const [reqTelefono, setReqTelefono] = useState(inicial?.requisitos_telefono || '')
  const [reqDirRetiro, setReqDirRetiro] = useState(inicial?.requisitos_direccion_retiro || '')
  const [reqDestinatario, setReqDestinatario] = useState(inicial?.requisitos_destinatario || '')
  const [reqDirEnvio, setReqDirEnvio] = useState(inicial?.requisitos_direccion_envio || '')
  const [reqLocalidad, setReqLocalidad] = useState(inicial?.requisitos_localidad || '')
  const [reqBultos, setReqBultos] = useState(inicial?.requisitos_cantidad_bultos?.toString() || '')
  const [reqPago, setReqPago] = useState(inicial?.requisitos_pago || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setBusy(true); setError(null)
    const payload = {
      nombre: nombre.trim(), web: web.trim() || null,
      retiro_calera: retiroCalera.trim() || null, retiro_polo52: retiroPolo52.trim() || null,
      via_solicitud_retiro: viaSolicitud || null, etiquetas: etiquetas.trim() || null,
      estado, observaciones: obs.trim() || null,
      requisitos_remitente: reqRemitente.trim() || null, requisitos_telefono: reqTelefono.trim() || null,
      requisitos_direccion_retiro: reqDirRetiro.trim() || null, requisitos_destinatario: reqDestinatario.trim() || null,
      requisitos_direccion_envio: reqDirEnvio.trim() || null, requisitos_localidad: reqLocalidad.trim() || null,
      requisitos_cantidad_bultos: reqBultos ? Number(reqBultos) : null, requisitos_pago: reqPago || null,
    }
    let result
    if (inicial) { result = await supabase.from('transportes').update(payload).eq('id', inicial.id).select().single() }
    else { result = await supabase.from('transportes').insert(payload).select().single() }
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved(result.data as Transporte)
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2"><h1 className="font-display text-2xl font-semibold text-ink">{inicial ? 'Editar transporte' : 'Nuevo transporte'}</h1></header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-sub"><Truck size={14} aria-hidden /> Informacion general</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Transporte *</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Expreso Lancioni" className={inputCls} /></label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Web</span><input value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://..." className={inputCls} /></label>
          </div>
        </fieldset>
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-sub"><Phone size={14} aria-hidden /> Contactos de retiro</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Retiro Calera</span><input value={retiroCalera} onChange={(e) => setRetiroCalera(e.target.value)} placeholder="+54 9 351 123-4567" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Retiro Polo 52</span><input value={retiroPolo52} onChange={(e) => setRetiroPolo52(e.target.value)} placeholder="+54 9 351 765-4321" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Via de solicitud de retiro</span>
              <select value={viaSolicitud} onChange={(e) => setViaSolicitud(e.target.value)} className={inputCls}>{VIA_OPCIONES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            </label>
          </div>
        </fieldset>
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-sub"><ClipboardList size={14} aria-hidden /> Requisitos de transporte</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Remitente</span><input value={reqRemitente} onChange={(e) => setReqRemitente(e.target.value)} placeholder="JEMAVA S.A.S." className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Telefono</span><input value={reqTelefono} onChange={(e) => setReqTelefono(e.target.value)} placeholder="+54 9 351 XXX XXXX" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Direccion de retiro</span><input value={reqDirRetiro} onChange={(e) => setReqDirRetiro(e.target.value)} placeholder="Av. XXXXX 1234" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Destinatario</span><input value={reqDestinatario} onChange={(e) => setReqDestinatario(e.target.value)} placeholder="Juan Perez" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Direccion de envio</span><input value={reqDirEnvio} onChange={(e) => setReqDirEnvio(e.target.value)} placeholder="Av. XXXXX 567" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Localidad</span><input value={reqLocalidad} onChange={(e) => setReqLocalidad(e.target.value)} placeholder="Cordoba" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Cantidad de bultos</span><input type="number" min="0" value={reqBultos} onChange={(e) => setReqBultos(e.target.value)} placeholder="3" className={inputCls} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Pago</span>
              <select value={reqPago} onChange={(e) => setReqPago(e.target.value)} className={inputCls}><option value="">Seleccionar...</option>{PAGO_OPCIONES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </label>
          </div>
        </fieldset>
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-sub"><ClipboardList size={14} aria-hidden /> Etiquetas para pegar en las cajas</legend>
          <label className="mt-3 block"><textarea value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} placeholder="Informacion para las etiquetas..." rows={3} className={inputCls + ' resize-none'} /></label>
        </fieldset>
        <fieldset className="rounded-2xl border border-line bg-surface p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-sub">Operacion</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-xs font-medium text-sub">Estado</span>
              <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select>
            </label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-sub">Observaciones</span><textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Notas internas..." rows={2} className={inputCls + ' resize-none'} /></label>
          </div>
        </fieldset>
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}{inicial ? 'Guardar cambios' : 'Crear transporte'}
          </button>
          <button type="button" onClick={onCancel} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
        </div>
      </form>
    </Layout>
  )
}