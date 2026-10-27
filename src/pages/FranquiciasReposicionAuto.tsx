import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, Minus, Pencil, Plus, RefreshCw, Save, Send, X, Zap,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { normalizarTelefono, telefonoValido } from '@/lib/informes'
import { cargarClientes, cargarMapaFranquicias, type BaseFranquicia, type ClienteFranquicia } from '@/lib/franquicias'

/* ------------------------------------------------------------------ */
/*  Mayorista → Franquicias → Reposición diaria automática.             */
/*  Paso 1: cliente ↔ base, sus WhatsApps y días/hora de salida.        */
/*  Paso 2: por cliente, una reposición por fecha de venta, con su      */
/*  tabla, el estado de cada WhatsApp y si ya la aceptaron.             */
/*  La arma el puente (reposicion-franquicias-auto.js) y el WhatsApp    */
/*  sale por /api/informe?evento=franquicias.                           */
/*  Datos: sql/franquicias_reposicion_auto.sql.                         */
/* ------------------------------------------------------------------ */

const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fmtHora = (iso: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso))
const DIA_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const etiquetaDia = (iso: string) => `${DIA_SEMANA[new Date(`${iso}T12:00:00`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const ayerIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv-SE') }
const linkDe = (token: string) => `${window.location.origin}/p/${token}`

interface ConfigCliente {
  cliente_id: string
  base: string
  telefono: string | null
  telefonos: string[]
  auto_activo: boolean
  auto_dias: number[]
  auto_hora: string
  auto_ultimo_hasta: string | null
  auto_pedido_at: string | null
  auto_error: string | null
}
interface Propuesta {
  id: string
  numero: string
  franquicia: string
  cliente_id: string | null
  cliente_nombre: string | null
  origen: string
  desde: string | null
  hasta: string | null
  estado: 'borrador' | 'enviada' | 'confirmada' | 'en_dragon' | 'anulada'
  token: string
  vence_at: string
  unidades_propuestas: number
  total_propuesto: number
  unidades_confirmadas: number | null
  total_confirmado: number | null
  confirmada_at: string | null
  confirmada_por: string | null
  dragon_pedido: string | null
  dragon_error: string | null
  comentario: string | null
  creado_at: string
}
interface Envio { id: number; propuesta_id: string; telefono: string; token: string; estado: 'pendiente' | 'enviado' | 'error'; detalle: string | null; enviado_at: string | null; abierto_at: string | null }
interface Item { id: number; art: string; descrip: string | null; material: string | null; color: string | null; talle: string | null; vendido: number; stock_cli: number; stock_mito: number; sugerido: number; precio: number | null; cantidad: number | null }

interface Form { cliente: string; base: string; sucursal: string; telefonos: string[]; activo: boolean; dias: number[]; hora: string }
const FORM_VACIO: Form = { cliente: '', base: '', sucursal: '', telefonos: [], activo: true, dias: [1, 2, 3, 4, 5, 6], hora: '09:00' }

/** POST a /api/informe con el JWT de la sesión. */
async function apiInforme(payload: Record<string, unknown>): Promise<{ enviados?: number; errores?: number; detalle?: string[] }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch('/api/informe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as { error?: string; enviados?: number; errores?: number; detalle?: string[] } | null
  if (!res.ok || body?.error) throw new Error(body?.error ?? `Error ${res.status}`)
  return body ?? {}
}

function chipEstado(p: Propuesta, envios: Envio[]) {
  if (p.estado === 'en_dragon') return { txt: `✓ Aceptado${p.confirmada_por ? ` por +${p.confirmada_por}` : ''} · En Dragon (PV ${p.dragon_pedido ?? ''})`, cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' }
  if (p.estado === 'confirmada' && p.dragon_error) return { txt: `Aceptado · error al cargar en Dragon`, cls: 'border-red-500/40 bg-red-500/10 text-red-400' }
  if (p.estado === 'confirmada') return { txt: `✓ Aceptado${p.confirmada_por ? ` por +${p.confirmada_por}` : ''} · cargando en Dragon…`, cls: 'border-teal-500/40 bg-teal-500/10 text-teal-400' }
  if (p.estado === 'anulada') return { txt: 'Anulada', cls: 'border-line bg-surface2 text-sub' }
  if (new Date(p.vence_at) < new Date()) return { txt: 'Vencida sin aceptar', cls: 'border-line bg-surface2 text-sub' }
  const ok = envios.filter((e) => e.estado === 'enviado').length
  const err = envios.filter((e) => e.estado === 'error').length
  if (ok) return { txt: `🔗 Link enviado a ${ok} número${ok === 1 ? '' : 's'} · esperando aceptación`, cls: 'border-sky-500/40 bg-sky-500/10 text-sky-400' }
  if (err) return { txt: 'WhatsApp con error · mandalo a mano o reintentá', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-400' }
  return { txt: '⏳ Pendiente de enviar link', cls: 'border-violet-500/40 bg-violet-500/10 text-violet-400' }
}

export default function FranquiciasReposicionAuto() {
  const [clientes, setClientes] = useState<ClienteFranquicia[]>([])
  const [bases, setBases] = useState<BaseFranquicia[]>([])
  const [configs, setConfigs] = useState<ConfigCliente[]>([])
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [envios, setEnvios] = useState<Envio[]>([])
  const [items, setItems] = useState<Record<string, Item[]>>({})
  const [cargando, setCargando] = useState(true)
  const [aviso, setAviso] = useState<{ ok: boolean; txt: string } | null>(null)

  const [form, setForm] = useState<Form>(FORM_VACIO)
  const [busca, setBusca] = useState('')
  const [nuevoWa, setNuevoWa] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [fechasAbiertas, setFechasAbiertas] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    const [cfg, props] = await Promise.all([
      supabase.from('franquicias_clientes').select('cliente_id,base,telefono,telefonos,auto_activo,auto_dias,auto_hora,auto_ultimo_hasta,auto_pedido_at,auto_error').order('cliente_id'),
      supabase.from('franquicias_propuestas').select('id,numero,franquicia,cliente_id,cliente_nombre,origen,desde,hasta,estado,token,vence_at,unidades_propuestas,total_propuesto,unidades_confirmadas,total_confirmado,confirmada_at,confirmada_por,dragon_pedido,dragon_error,comentario,creado_at')
        .eq('tipo', 'reposicion').order('hasta', { ascending: false, nullsFirst: false }).order('creado_at', { ascending: false }).limit(120),
    ])
    if (cfg.error) setAviso({ ok: false, txt: cfg.error.message })
    const ps = (props.data as Propuesta[] | null) ?? []
    setConfigs((cfg.data as ConfigCliente[] | null) ?? [])
    setPropuestas(ps)
    if (ps.length) {
      const { data } = await supabase.from('franquicias_propuesta_envios').select('id,propuesta_id,telefono,token,estado,detalle,enviado_at,abierto_at').in('propuesta_id', ps.map((p) => p.id)).order('id')
      setEnvios((data as Envio[] | null) ?? [])
    } else setEnvios([])
  }, [])

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const [m, cs] = await Promise.all([cargarMapaFranquicias(), cargarClientes()])
        if (!vivo) return
        setBases(m.bases)
        setClientes(cs)
        await cargar()
      } catch (e) {
        if (vivo) setAviso({ ok: false, txt: (e as Error).message })
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [cargar])

  const nombreCliente = useCallback((cod: string) => clientes.find((c) => c.codigo === cod)?.razonSocial ?? '', [clientes])
  const baseDe = (b: string) => bases.find((x) => x.base === b)

  /* ---------------- Paso 1: datos del cliente ---------------- */

  function elegirCliente(cod: string) {
    const c = configs.find((x) => x.cliente_id === cod)
    const base = c?.base ?? form.base ?? ''
    setForm({
      cliente: cod,
      base,
      sucursal: baseDe(base)?.sucursal ?? '',
      telefonos: c ? (c.telefonos?.length ? c.telefonos : c.telefono ? [c.telefono] : []) : [],
      activo: c ? c.auto_activo : true,
      dias: c?.auto_dias?.length ? c.auto_dias : [1, 2, 3, 4, 5, 6],
      hora: c?.auto_hora ?? '09:00',
    })
    setBusca(`${cod} · ${nombreCliente(cod)}`)
    setNuevoWa('')
  }

  function onBusca(v: string) {
    setBusca(v)
    const cod = v.match(/^\s*(\d{1,5})\b/)?.[1]
    if (cod && clientes.some((c) => c.codigo === cod.padStart(5, '0'))) elegirCliente(cod.padStart(5, '0'))
  }

  function agregarWa() {
    if (!telefonoValido(nuevoWa)) { setAviso({ ok: false, txt: 'Ingresá un número de WhatsApp válido (ej. 5492901554321).' }); return }
    const t = normalizarTelefono(nuevoWa)
    setForm((f) => (f.telefonos.includes(t) ? f : { ...f, telefonos: [...f.telefonos, t] }))
    setNuevoWa('')
    setAviso(null)
  }

  async function guardar() {
    if (!supabase) return
    if (!form.cliente) { setAviso({ ok: false, txt: 'Elegí el cliente.' }); return }
    setGuardando(true)
    setAviso(null)
    const { error } = await supabase.rpc('franquicias_guardar_auto', {
      p_cliente: form.cliente, p_base: form.base, p_sucursal: form.sucursal, p_telefonos: form.telefonos,
      p_activo: form.activo, p_dias: form.dias, p_hora: form.hora,
    })
    setGuardando(false)
    if (error) { setAviso({ ok: false, txt: error.message }); return }
    setAviso({ ok: true, txt: `Guardado: ${form.cliente} · ${nombreCliente(form.cliente)}.` })
    setAbiertos((s) => new Set(s).add(form.cliente))
    const m = await cargarMapaFranquicias().catch(() => null)
    if (m) setBases(m.bases)
    await cargar()
  }

  const resumenDias = (dias: number[]) => [...dias].sort().map((d) => DIAS[d - 1]).join(' ')

  /* ---------------- Paso 2: reposiciones por cliente ---------------- */

  const porCliente = useMemo(() => {
    const m = new Map<string, Propuesta[]>()
    for (const c of configs) {
      const clave = c.base.toUpperCase().replace(/^DRAGONFISH_/, '')
      // Las viejas (antes del multi-cliente) no traen cliente: se asignan por la base
      m.set(c.cliente_id, propuestas.filter((p) => p.cliente_id === c.cliente_id || (!p.cliente_id && p.franquicia === clave)))
    }
    return m
  }, [configs, propuestas])

  const enviosDe = (id: string) => envios.filter((e) => e.propuesta_id === id)

  async function abrirFecha(p: Propuesta) {
    setFechasAbiertas((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })
    if (items[p.id] || !supabase) return
    const { data } = await supabase.from('franquicias_propuesta_items').select('id,art,descrip,material,color,talle,vendido,stock_cli,stock_mito,sugerido,precio,cantidad').eq('propuesta_id', p.id).order('orden')
    setItems((s) => ({ ...s, [p.id]: (data as Item[] | null) ?? [] }))
  }

  /** Cambia lo que va en el link (solo mientras nadie la aceptó). */
  async function cambiarSugerido(p: Propuesta, it: Item, valor: number) {
    if (!supabase || p.estado !== 'enviada') return
    const nuevo = Math.max(0, Math.min(it.stock_mito, valor))
    if (nuevo === it.sugerido) return
    const lista = (items[p.id] ?? []).map((x) => (x.id === it.id ? { ...x, sugerido: nuevo } : x))
    setItems((s) => ({ ...s, [p.id]: lista }))
    const unidades = lista.reduce((s, x) => s + x.sugerido, 0)
    const total = lista.reduce((s, x) => s + x.sugerido * (x.precio ?? 0), 0)
    setPropuestas((ps) => ps.map((x) => (x.id === p.id ? { ...x, unidades_propuestas: unidades, total_propuesto: total } : x)))
    const [a, b] = await Promise.all([
      supabase.from('franquicias_propuesta_items').update({ sugerido: nuevo }).eq('id', it.id),
      supabase.from('franquicias_propuestas').update({ unidades_propuestas: unidades, total_propuesto: total }).eq('id', p.id).eq('estado', 'enviada'),
    ])
    if (a.error || b.error) setAviso({ ok: false, txt: (a.error ?? b.error)?.message ?? 'No se pudo guardar' })
  }

  async function armarAhora(c: ConfigCliente) {
    if (!supabase) return
    setOcupado(`armar-${c.cliente_id}`)
    const { error } = await supabase.rpc('franquicias_pedir_armado', { p_cliente: c.cliente_id })
    setOcupado(null)
    if (error) { setAviso({ ok: false, txt: error.message }); return }
    setAviso({ ok: true, txt: `Listo: el puente arma la de ${c.cliente_id} con la venta de ayer en el próximo minuto y sale el WhatsApp. Tocá «Actualizar» en un rato.` })
    void cargar()
  }

  async function enviarAhora(p: Propuesta, todos: boolean) {
    setOcupado(`enviar-${p.id}`)
    setAviso(null)
    try {
      const r = await apiInforme({ franquicias: p.id, todos })
      setAviso({ ok: !r.errores, txt: r.errores ? `No salió: ${(r.detalle ?? []).join(' · ')}` : `WhatsApp enviado a ${r.enviados ?? 0} número(s).` })
    } catch (e) {
      setAviso({ ok: false, txt: (e as Error).message })
    } finally {
      setOcupado(null)
      void cargar()
    }
  }

  function whatsappManual(p: Propuesta, e: Envio) {
    const venta = p.desde && p.hasta ? (p.desde === p.hasta ? p.hasta.split('-').reverse().join('/') : `${p.desde.split('-').reverse().join('/')} al ${p.hasta.split('-').reverse().join('/')}`) : ''
    const texto = `Hola ${p.cliente_nombre ?? ''}, te armamos la reposición ${p.numero}${venta ? ` según tu venta del ${venta}` : ''}: ${p.unidades_propuestas} unidades. Revisala y confirmá el pedido acá: ${linkDe(e.token)}`
    window.open(`https://wa.me/${normalizarTelefono(e.telefono)}?text=${encodeURIComponent(texto)}`, '_blank')
  }

  const inp = 'h-10 w-full rounded-xl border border-line2 bg-surface px-3 text-sm text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30'
  const lbl = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-sub'
  const btnSec = 'inline-flex items-center gap-1.5 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface2 disabled:opacity-50'
  const ayer = ayerIso()

  return (
    <Layout>
      <div className="px-3 pb-10 pt-3 md:px-4 md:pt-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <BackButton />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-400">Mayorista · Franquicias</p>
              <h1 className="font-display text-xl font-semibold text-ink md:text-2xl">Reposición diaria automática</h1>
              <p className="mt-1 max-w-2xl text-sm text-sub">Asociá el cliente con su base y sus números de WhatsApp, programá los días y la hora de salida, y consultá cada reposición por cliente y fecha.</p>
            </div>
          </div>
          <button type="button" onClick={() => void cargar()} className={btnSec}><RefreshCw size={13} aria-hidden /> Actualizar</button>
        </div>

        {aviso && (
          <p role="status" className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>
            <span className="flex-1">{aviso.txt}</span>
            <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso"><X size={14} aria-hidden /></button>
          </p>
        )}

        {/* ---------------- Paso 1 ---------------- */}
        <section className="mb-4 rounded-2xl border border-amber-500/30 bg-paper p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-base font-semibold text-ink">
                <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-red-300">Paso 1</span>
                Datos del cliente y horario automático
              </h2>
              <p className="mt-1 text-xs text-sub">Podés cargar uno o varios WhatsApp con <b className="text-ink">+</b>. Todos reciben el link y, apenas uno confirma el pedido, a los demás les queda bloqueado avisando que ya fue aceptado.</p>
            </div>
            {form.cliente && (
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${form.activo ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' : 'border-line bg-surface2 text-sub'}`}>
                {form.activo ? `⚡ Sale ${resumenDias(form.dias)} a las ${form.hora} hs` : '⏸ Envío automático pausado'}
              </span>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-[1.4fr_1.1fr_0.8fr_1.6fr]">
            <div>
              <label className={lbl} htmlFor="ra-cliente">1. Cliente (de Dragon)</label>
              <input id="ra-cliente" list="ra-clientes" value={busca} onChange={(e) => onBusca(e.target.value)} placeholder={cargando ? 'Cargando clientes…' : 'Código o nombre'} className={inp} />
              <datalist id="ra-clientes">
                {clientes.map((c) => <option key={c.id} value={`${c.codigo} · ${c.razonSocial}`} />)}
              </datalist>
            </div>
            <div>
              <label className={lbl} htmlFor="ra-base">2. Base de la franquicia</label>
              <select id="ra-base" value={form.base} onChange={(e) => setForm((f) => ({ ...f, base: e.target.value, sucursal: baseDe(e.target.value)?.sucursal ?? '' }))} className={inp}>
                <option value="">Elegir base…</option>
                {bases.map((b) => <option key={b.base} value={b.base}>{b.base}{b.nombre ? ` (${b.nombre})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="ra-suc">3. Sucursal stock</label>
              <input id="ra-suc" value={form.sucursal} onChange={(e) => setForm((f) => ({ ...f, sucursal: e.target.value }))} placeholder="BD_ORIGEN" className={inp} title="Sucursal del stock del cliente (columna BD_ORIGEN); es la misma para todos los clientes de esa base" />
            </div>
            <div>
              <label className={lbl} htmlFor="ra-wa">4. WhatsApps destino</label>
              <div className="flex gap-2">
                <input id="ra-wa" type="tel" inputMode="tel" value={nuevoWa} onChange={(e) => setNuevoWa(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarWa() } }} placeholder="Ej. 5492901554321 (dueño, encargado…)" className={inp} />
                <button type="button" onClick={agregarWa} aria-label="Agregar número" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"><Plus size={18} aria-hidden /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {form.telefonos.map((t, i) => (
                  <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                    +{t} <span className="font-normal opacity-70">(#{i + 1})</span>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, telefonos: f.telefonos.filter((x) => x !== t) }))} aria-label={`Quitar +${t}`}><X size={12} aria-hidden /></button>
                  </span>
                ))}
                {form.telefonos.length === 0 && <span className="text-xs text-sub">Sin números todavía.</span>}
              </div>
            </div>
          </div>

          <div className="mt-4 grid items-end gap-3 md:grid-cols-[auto_auto_auto_1fr_auto]">
            <div>
              <span className={lbl}>Estado de la tarea</span>
              <button type="button" onClick={() => setForm((f) => ({ ...f, activo: !f.activo }))} aria-pressed={form.activo}
                className={`inline-flex h-10 items-center gap-2 rounded-full border px-3 text-xs font-bold ${form.activo ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' : 'border-line2 bg-surface text-sub'}`}>
                <span className={`h-3 w-3 rounded-full ${form.activo ? 'bg-emerald-400' : 'bg-sub/50'}`} />
                {form.activo ? 'Automático ACTIVO' : 'Pausado'}
              </button>
            </div>
            <div>
              <span className={lbl}>Días que sale el link</span>
              <div className="flex gap-1">
                {DIAS.map((d, i) => {
                  const on = form.dias.includes(i + 1)
                  return (
                    <button key={d} type="button" aria-pressed={on}
                      onClick={() => setForm((f) => ({ ...f, dias: on ? f.dias.filter((x) => x !== i + 1) : [...f.dias, i + 1].sort() }))}
                      className={`h-10 w-9 rounded-lg border text-xs font-bold ${on ? 'border-amber-500/50 bg-amber-500/20 text-amber-300' : 'border-line2 bg-surface text-sub'}`}>{d}</button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className={lbl} htmlFor="ra-hora">Hora de salida</label>
              <input id="ra-hora" type="time" value={form.hora} onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value || '09:00' }))} className={`${inp} w-32`} />
            </div>
            <div className="min-w-0">
              <span className={lbl}>Resumen</span>
              <p className="text-xs leading-snug text-ink">
                {form.cliente
                  ? <>Cliente <b>{form.cliente}</b> ↔ base <b className="text-amber-400">{form.base || '—'}</b> → sale a <b className="text-emerald-400">{form.telefonos.length} WhatsApp</b>{form.telefonos.length ? ` (${form.telefonos.map((t) => `+${t}`).join(', ')})` : ''} con la venta de ayer.</>
                  : <span className="text-sub">Elegí un cliente para cargar o editar sus datos.</span>}
              </p>
            </div>
            <button type="button" onClick={() => void guardar()} disabled={guardando || !form.cliente}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Guardar datos del cliente
            </button>
          </div>
        </section>

        {/* ---------------- Paso 2 ---------------- */}
        <section className="rounded-2xl border border-line bg-paper p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 font-display text-base font-semibold text-ink">
                <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-red-300">Paso 2</span>
                Ventas por cliente y por fecha
              </h2>
              <p className="mt-1 text-xs text-sub">Desplegá un cliente y tocá una fecha para ver su tabla. Mientras nadie la acepte podés cambiar lo que va en el link.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnSec} onClick={() => setAbiertos(new Set(configs.map((c) => c.cliente_id)))}>Desplegar clientes</button>
              <button type="button" className={btnSec} onClick={() => setAbiertos(new Set())}>Contraer</button>
            </div>
          </div>

          {cargando && <p className="flex items-center gap-2 py-6 text-sm text-sub"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</p>}
          {!cargando && configs.length === 0 && <p className="py-6 text-sm text-sub">Todavía no hay clientes configurados: cargalos en el Paso 1.</p>}

          <div className="flex flex-col gap-2">
            {configs.map((c) => {
              const abierto = abiertos.has(c.cliente_id)
              const props = porCliente.get(c.cliente_id) ?? []
              const tels = c.telefonos?.length ? c.telefonos : c.telefono ? [c.telefono] : []
              const ultima = props[0]
              return (
                <div key={c.cliente_id} className={`rounded-2xl border ${abierto ? 'border-amber-500/35' : 'border-line'} bg-surface/40`}>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <button type="button" onClick={() => setAbiertos((s) => { const n = new Set(s); if (n.has(c.cliente_id)) n.delete(c.cliente_id); else n.add(c.cliente_id); return n })}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={abierto}>
                      {abierto ? <ChevronDown size={16} className="shrink-0 text-amber-400" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-sub" aria-hidden />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-ink">{c.cliente_id} · {nombreCliente(c.cliente_id) || 'Cliente'}</span>
                        <span className="block truncate text-[11px] text-sub">WhatsApps ({tels.length}): <b className="text-emerald-400">{tels.map((t) => `+${t}`).join(' · ') || '—'}</b></span>
                      </span>
                    </button>
                    <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">{c.base} (stock: {baseDe(c.base)?.sucursal || '—'})</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${c.auto_activo ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' : 'border-line bg-surface2 text-sub'}`}>
                      {c.auto_activo ? `⏰ ${resumenDias(c.auto_dias)} · ${c.auto_hora} hs` : '⏸ Pausado'}
                    </span>
                    {ultima && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-sub">Última: <b className="text-ink">{fmt(ultima.unidades_propuestas)} u.</b> · {fmtPesos(Number(ultima.total_propuesto))}</span>}
                    <button type="button" className={btnSec} disabled={ocupado === `armar-${c.cliente_id}` || Boolean(c.auto_pedido_at)} onClick={() => void armarAhora(c)}
                      title="Arma ya la reposición con la venta de ayer y manda el WhatsApp">
                      {c.auto_pedido_at ? <><Loader2 size={12} className="animate-spin" aria-hidden /> Armando…</> : <><Zap size={12} aria-hidden /> Armar ahora</>}
                    </button>
                    <button type="button" className={btnSec} onClick={() => { elegirCliente(c.cliente_id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Pencil size={12} aria-hidden /> Editar</button>
                  </div>
                  {c.auto_error && <p className="mx-3 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">El puente no pudo armarla: {c.auto_error}</p>}

                  {abierto && (
                    <div className="border-t border-line px-3 py-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sub">
                        <CalendarClock size={13} aria-hidden /> Reposiciones de {c.base} {c.auto_ultimo_hasta && <span className="normal-case tracking-normal">· última venta armada: {c.auto_ultimo_hasta.split('-').reverse().join('/')}</span>}
                      </p>
                      {props.length === 0 && <p className="py-3 text-sm text-sub">Todavía no hay reposiciones. Sale sola a la hora configurada, o tocá «Armar ahora».</p>}
                      <div className="flex flex-col gap-2">
                        {props.map((p) => {
                          const env = enviosDe(p.id)
                          const e = chipEstado(p, env)
                          const fAbierta = fechasAbiertas.has(p.id)
                          const lista = items[p.id]
                          const editable = p.estado === 'enviada' && new Date(p.vence_at) > new Date()
                          const confirmada = p.estado === 'confirmada' || p.estado === 'en_dragon'
                          const vendidoTot = (lista ?? []).reduce((s, i) => s + i.vendido, 0)
                          return (
                            <div key={p.id} className={`rounded-xl border ${fAbierta ? 'border-sky-500/30' : 'border-line'} bg-paper`}>
                              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                                <button type="button" onClick={() => void abrirFecha(p)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left" aria-expanded={fAbierta}>
                                  {fAbierta ? <ChevronDown size={14} className="text-sky-400" aria-hidden /> : <ChevronRight size={14} className="text-sub" aria-hidden />}
                                  <b className="text-sm text-ink">{p.hasta ? (p.desde && p.desde !== p.hasta ? `${etiquetaDia(p.desde)} al ${etiquetaDia(p.hasta)}` : etiquetaDia(p.hasta)) : p.creado_at.slice(0, 10)}</b>
                                  {p.hasta === ayer && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-300">Venta de ayer</span>}
                                  <span className="text-[11px] text-sub">{p.numero}{p.origen === 'auto' ? ' · automática' : ''}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${e.cls}`}>{e.txt}</span>
                                </button>
                                <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-sub">A reponer: <b className="text-emerald-400">{fmt(p.unidades_propuestas)} u.</b> · <b className="text-ink">{fmtPesos(Number(p.total_propuesto))}</b></span>
                                {confirmada && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-sub">Pidió: <b className="text-ink">{fmt(p.unidades_confirmadas ?? 0)} u.</b></span>}
                              </div>

                              {fAbierta && (
                                <div className="border-t border-line px-3 py-3">
                                  {!lista ? (
                                    <p className="flex items-center gap-2 text-xs text-sub"><Loader2 size={12} className="animate-spin" aria-hidden /> Cargando…</p>
                                  ) : (
                                    <div className="overflow-x-auto rounded-xl border border-line">
                                      <table className="w-full min-w-[860px] text-[12px]">
                                        <thead className="bg-surface text-[10px] uppercase tracking-wide text-sub">
                                          <tr>
                                            <th className="px-2 py-2 text-left">Artículo</th>
                                            <th className="px-2 py-2 text-left">Descripción</th>
                                            <th className="px-2 py-2 text-left">Material</th>
                                            <th className="px-2 py-2 text-center">Color</th>
                                            <th className="px-2 py-2 text-center">Talle</th>
                                            <th className="px-2 py-2 text-center">Vendido</th>
                                            <th className="px-2 py-2 text-center">Stock cliente</th>
                                            <th className="px-2 py-2 text-center">Stock MITO</th>
                                            <th className="px-2 py-2 text-center">A reponer (link)</th>
                                            {confirmada && <th className="px-2 py-2 text-center">Pidió</th>}
                                            <th className="px-2 py-2 text-right">Precio</th>
                                            <th className="px-2 py-2 text-right">Subtotal</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lista.map((it) => {
                                            const cant = confirmada ? (it.cantidad ?? 0) : it.sugerido
                                            return (
                                              <tr key={it.id} className={`border-t border-line/60 ${it.sugerido === 0 && !confirmada ? 'opacity-50' : ''}`}>
                                                <td className="px-2 py-1.5 font-semibold text-ink">{it.art}</td>
                                                <td className="max-w-[260px] truncate px-2 py-1.5 text-sub" title={it.descrip ?? ''}>{it.descrip || '—'}</td>
                                                <td className="px-2 py-1.5 text-sub">{it.material || '—'}</td>
                                                <td className="px-2 py-1.5 text-center text-sub">{it.color || 'U'}</td>
                                                <td className="px-2 py-1.5 text-center font-semibold text-ink">{it.talle || '—'}</td>
                                                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-sky-400">{it.vendido}</td>
                                                <td className="px-2 py-1.5 text-center tabular-nums text-sub">{it.stock_cli}</td>
                                                <td className={`px-2 py-1.5 text-center tabular-nums ${it.stock_mito <= 0 ? 'font-semibold text-red-400' : 'text-emerald-400'}`}>{it.stock_mito <= 0 ? '0 (sin stock)' : it.stock_mito}</td>
                                                <td className="px-2 py-1.5 text-center">
                                                  {editable && it.stock_mito > 0 ? (
                                                    <span className="inline-flex items-center overflow-hidden rounded-lg border border-line2">
                                                      <button type="button" aria-label="Menos" disabled={it.sugerido <= 0} onClick={() => void cambiarSugerido(p, it, it.sugerido - 1)} className="grid h-7 w-7 place-items-center bg-surface disabled:opacity-40"><Minus size={12} aria-hidden /></button>
                                                      <span className="w-8 text-center font-bold tabular-nums text-ink">{it.sugerido}</span>
                                                      <button type="button" aria-label="Más" disabled={it.sugerido >= it.stock_mito} onClick={() => void cambiarSugerido(p, it, it.sugerido + 1)} className="grid h-7 w-7 place-items-center bg-surface disabled:opacity-40"><Plus size={12} aria-hidden /></button>
                                                    </span>
                                                  ) : (
                                                    <b className="tabular-nums text-ink">{it.sugerido || '—'}</b>
                                                  )}
                                                </td>
                                                {confirmada && <td className={`px-2 py-1.5 text-center font-bold tabular-nums ${cant === 0 ? 'text-red-400' : cant !== it.sugerido ? 'text-amber-400' : 'text-emerald-400'}`}>{cant}</td>}
                                                <td className="px-2 py-1.5 text-right tabular-nums text-sub">{it.precio ? fmtPesos(Number(it.precio)) : '—'}</td>
                                                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">{cant && it.precio ? fmtPesos(cant * Number(it.precio)) : '—'}</td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                        <tfoot className="bg-surface text-[11px]">
                                          <tr>
                                            <td colSpan={5} className="px-2 py-2 font-semibold text-ink">{lista.length} SKU vendidos</td>
                                            <td className="px-2 py-2 text-center font-bold tabular-nums text-sky-400">{fmt(vendidoTot)}</td>
                                            <td colSpan={2} />
                                            <td className="px-2 py-2 text-center font-bold tabular-nums text-emerald-400">{fmt(p.unidades_propuestas)}</td>
                                            {confirmada && <td className="px-2 py-2 text-center font-bold tabular-nums text-ink">{fmt(p.unidades_confirmadas ?? 0)}</td>}
                                            <td />
                                            <td className="px-2 py-2 text-right font-bold tabular-nums text-ink">{fmtPesos(Number(confirmada ? p.total_confirmado ?? 0 : p.total_propuesto))}</td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    </div>
                                  )}

                                  {p.comentario && <p className="mt-2 text-xs text-sub">Comentario del cliente: <b className="text-ink">{p.comentario}</b></p>}
                                  {p.dragon_error && <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">Dragon: {p.dragon_error}</p>}

                                  <div className="mt-3 rounded-xl border border-line bg-surface/60 p-3">
                                    <p className="text-sm font-bold text-ink">Link de {p.numero} → {env.length || tels.length} número{(env.length || tels.length) === 1 ? '' : 's'}</p>
                                    <p className="mt-0.5 text-[11px] text-sub">El primero que toca «Confirmar pedido» lo carga en DRAGONFISH_MITO y a los demás el link les avisa que ya fue aceptado.</p>
                                    <ul className="mt-2 flex flex-col gap-1.5">
                                      {env.map((en) => (
                                        <li key={en.id} className="flex flex-wrap items-center gap-2 text-xs">
                                          <b className="text-ink">+{en.telefono}</b>
                                          <span className={en.estado === 'enviado' ? 'text-emerald-400' : en.estado === 'error' ? 'text-amber-400' : 'text-violet-300'}>
                                            {en.estado === 'enviado' ? `WhatsApp enviado ${en.enviado_at ? fmtHora(en.enviado_at) : ''}` : en.estado === 'error' ? `No salió: ${en.detalle ?? ''}` : 'En cola'}
                                            {en.abierto_at ? ` · abrió el link ${fmtHora(en.abierto_at)}` : ''}
                                            {p.confirmada_por === en.telefono ? ' · ✓ aceptó' : ''}
                                          </span>
                                          <span className="ml-auto flex gap-1.5">
                                            <a href={linkDe(en.token)} target="_blank" rel="noreferrer" className={btnSec}><ExternalLink size={12} aria-hidden /> Ver link</a>
                                            <button type="button" className={btnSec} onClick={() => { void navigator.clipboard?.writeText(linkDe(en.token)); setAviso({ ok: true, txt: `Link de +${en.telefono} copiado.` }) }}><Copy size={12} aria-hidden /> Copiar</button>
                                            {editable && <button type="button" className={btnSec} onClick={() => whatsappManual(p, en)} title="Abre tu WhatsApp con el mensaje y el link de este número">WhatsApp a mano</button>}
                                          </span>
                                        </li>
                                      ))}
                                      {env.length === 0 && (
                                        <li className="flex flex-wrap items-center gap-2 text-xs text-sub">
                                          Link general (sin número):
                                          <a href={linkDe(p.token)} target="_blank" rel="noreferrer" className={btnSec}><ExternalLink size={12} aria-hidden /> Ver link</a>
                                        </li>
                                      )}
                                    </ul>
                                    {editable && env.length > 0 && (
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        <button type="button" disabled={ocupado === `enviar-${p.id}`} onClick={() => void enviarAhora(p, false)}
                                          className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
                                          {ocupado === `enviar-${p.id}` ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Send size={12} aria-hidden />} Enviar por WhatsApp los que faltan
                                        </button>
                                        <button type="button" disabled={ocupado === `enviar-${p.id}`} onClick={() => { if (window.confirm('¿Volver a mandar el WhatsApp a todos los números?')) void enviarAhora(p, true) }} className={btnSec}>Reenviar a todos</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </Layout>
  )
}
