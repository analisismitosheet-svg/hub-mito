import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bell, CheckSquare, CircleX, ClipboardCheck, FileText, Lock, Loader2, Paperclip, Plus, Search, Send, ShieldCheck, Undo2, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { useAuth } from '@/context/AuthContext'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  PASOS, QUIEN_TXT, cancelarOrden, borrarOrden, cargarEventos, cargarOrden, cargarOrdenes, etapaDe, fechaCorta, fechaHora,
  guardarObsPropias, mandarADragon, nombreCorto, pedirAutorizacion, pesos, sugeridoDe, tildarPaso, urlArchivo, vencida,
  type EventoOc, type OrdenCompra, type PasoClave,
} from '@/lib/ordenesCompra'
import FormOrdenCompra from '@/components/FormOrdenCompra'
import AutorizadoresOc from '@/components/AutorizadoresOc'

/* ------------------------------------------------------------------ */
/*  Órdenes de compras (Compras · Depósito · Diseño · Arquitectura ·    */
/*  Administración). Reemplaza la planilla «Alta Órdenes de Compras».  */
/*  Base y reglas: sql/ordenes_compra.sql. La autorización se pide por  */
/*  WhatsApp con «Pedir autorización» (nunca sola).                    */
/* ------------------------------------------------------------------ */

const PAGINA = 100

const KPIS: Array<{ k: string; titulo: string; pie: string; color: string; Icono: typeof Bell }> = [
  { k: 'valid', titulo: 'Validación compras', pie: 'pendientes', color: '#f59e0b', Icono: ClipboardCheck },
  { k: 'autor', titulo: 'Autorización financiera', pie: 'pendientes', color: '#a78bfa', Icono: ShieldCheck },
  { k: 'env', titulo: 'Envío al proveedor', pie: 'pendientes', color: '#38bdf8', Icono: Send },
  { k: 'acep', titulo: 'Aceptación proveedor', pie: 'pendientes', color: '#2dd4bf', Icono: Lock },
  { k: 'flex', titulo: 'Carga en Flexxus', pie: 'OC, remito o factura', color: '#f472b6', Icono: FileText },
  { k: 'canc', titulo: 'Rechazadas / canceladas', pie: 'en total', color: '#ef4444', Icono: CircleX },
]
const COLORES_KPI = coloresUnicos(KPIS.map((k) => k.color))
const TONO: Record<string, string> = { amber: 'text-amber-400', green: 'text-emerald-400', red: 'text-red-400' }
const CHIP_TIPO: Record<string, string> = {
  Producto: 'border-lime-400/40 text-lime-300', Gastos: 'border-sky-400/40 text-sky-300',
  Servicios: 'border-fuchsia-400/40 text-fuchsia-300', Talleres: 'border-orange-400/40 text-orange-300',
}

const enKpi = (o: OrdenCompra, k: string) => {
  const e = etapaDe(o).clave
  return k === 'flex' ? ['f_oc', 'f_rem', 'f_fac'].includes(e) : e === k
}

export default function OrdenesCompra() {
  const { isAdmin, can, perfil, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [lista, setLista] = useState<OrdenCompra[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [fResp, setFResp] = useState('')
  const [fMes, setFMes] = useState('')
  const [fPago, setFPago] = useState('')
  const [mias, setMias] = useState(false)
  const [verCanc, setVerCanc] = useState(false)
  const [kpi, setKpi] = useState('')
  const [tope, setTope] = useState(PAGINA)
  const [form, setForm] = useState<{ oc: OrdenCompra | null; enfocarDragon?: boolean } | null>(null)
  const [verAut, setVerAut] = useState(false)
  const sel = Number(params.get('n')) || null
  const setSel = (n: number | null) => setParams(n ? { n: String(n) } : {}, { replace: true })

  const esCompras = can('ordenes_compra.compras')

  const cargar = useCallback(async () => {
    try {
      setLista(await cargarOrdenes())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const actualizarUna = useCallback(async (numero: number) => {
    const o = await cargarOrden(numero).catch(() => null)
    setLista((l) => {
      if (!l) return l
      if (!o) return l.filter((x) => x.numero !== numero)
      const i = l.findIndex((x) => x.numero === numero)
      if (i < 0) return [o, ...l].sort((a, b) => b.numero - a.numero)
      const c = [...l]
      c[i] = o
      return c
    })
  }, [])

  const meses = useMemo(
    () => [...new Set((lista ?? []).map((o) => o.fecha_compra?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(),
    [lista],
  )
  const responsables = useMemo(
    () => [...new Set((lista ?? []).map((o) => o.responsable).filter(Boolean) as string[])].sort(),
    [lista],
  )

  const texto = q.trim().toLowerCase()
  const visibles = useMemo(() => (lista ?? []).filter((o) => {
    if (!verCanc && o.cancelada_at && kpi !== 'canc') return false
    if (fTipo && o.tipo !== fTipo) return false
    if (fResp && o.responsable !== fResp) return false
    if (fPago && o.forma_pago !== fPago) return false
    if (fMes && o.fecha_compra?.slice(0, 7) !== fMes) return false
    if (mias && o.creada_por !== user?.id) return false
    if (kpi && !enKpi(o, kpi)) return false
    if (texto && ![o.numero, o.proveedor, o.observacion, o.proveedor_cuit, o.responsable, o.creada_por_nombre, o.dragon_proveedor]
      .join(' ').toLowerCase().includes(texto)) return false
    return true
  }), [lista, verCanc, fTipo, fResp, fPago, fMes, mias, kpi, texto, user?.id])
  useEffect(() => setTope(PAGINA), [verCanc, fTipo, fResp, fPago, fMes, mias, kpi, texto])

  const oc = (lista ?? []).find((o) => o.numero === sel) ?? null
  const total = visibles.reduce((s, o) => s + (o.monto_bruto ?? 0), 0)
  const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const sel_ = 'h-9 rounded-xl border border-line bg-surface2 px-2 text-sm text-ink outline-none'

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Órdenes de compras</h1>
          <p className="text-sm text-sub">
            Alta de OC y su recorrido: validación de Compras → autorización → proveedor → Flexxus.
            {lista && ` ${lista.length.toLocaleString('es-AR')} OC.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button onClick={() => setVerAut(true)} className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm font-medium text-ink hover:bg-line">
              <Bell size={15} className="text-amber-400" aria-hidden /> Autorizadores
            </button>
          )}
          <button onClick={() => setForm({ oc: null })} className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-lime-600 px-4 text-sm font-semibold text-white shadow-soft hover:bg-lime-700">
            <Plus size={16} aria-hidden /> Nueva OC
          </button>
        </div>
      </header>

      {error && <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

      {/* KPIs: los 6 contadores de la hoja «Desempeño Compras» */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k, i) => {
          const n = (lista ?? []).filter((o) => enKpi(o, k.k)).length
          const on = kpi === k.k
          return (
            <button key={k.k} onClick={() => setKpi(on ? '' : k.k)}
              className={`rounded-2xl border bg-surface p-3 text-left transition hover:bg-surface2 ${on ? 'ring-1' : 'border-line'}`}
              style={on ? { borderColor: COLORES_KPI[i], boxShadow: `inset 0 0 0 1px ${COLORES_KPI[i]}` } : undefined}>
              <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-sub">
                <k.Icono size={14} style={{ color: COLORES_KPI[i] }} aria-hidden /> {k.titulo}
              </span>
              <span className="mt-0.5 block font-display text-2xl font-bold tabular-nums" style={{ color: COLORES_KPI[i] }}>{lista ? n : '…'}</span>
              <span className="text-[11px] text-sub">{k.pie}</span>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[240px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar N° de OC, proveedor, observación, CUIT…"
            className="h-9 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub" />
        </label>
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={sel_} aria-label="Tipo de compra">
          <option value="">Todos los tipos</option>
          {['Producto', 'Gastos', 'Servicios', 'Talleres'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={fResp} onChange={(e) => setFResp(e.target.value)} className={`${sel_} max-w-[200px]`} aria-label="Responsable">
          <option value="">Todos los responsables</option>
          {responsables.map((r) => <option key={r} value={r}>{nombreCorto(r)}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={sel_} aria-label="Mes">
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{MESES[+m.slice(5)]} {m.slice(0, 4)}</option>)}
        </select>
        <select value={fPago} onChange={(e) => setFPago(e.target.value)} className={sel_} aria-label="Forma de pago">
          <option value="">Toda forma de pago</option>
          {['Bancos', 'Cheques3ros', 'Efectivo', 'MercadoPago'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm text-sub">
          <input type="checkbox" checked={mias} onChange={(e) => setMias(e.target.checked)} className="accent-lime-500" /> Las mías
        </label>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm text-sub">
          <input type="checkbox" checked={verCanc} onChange={(e) => setVerCanc(e.target.checked)} className="accent-lime-500" /> Ver canceladas
        </label>
      </div>

      <div className={`grid gap-3 ${oc ? 'lg:grid-cols-[minmax(0,1fr)_420px]' : ''}`}>
        <div className="min-w-0 overflow-x-auto rounded-2xl border border-line bg-surface">
          {!lista ? (
            <p className="flex items-center gap-2 p-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando órdenes…</p>
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wide text-sub">
                  {['N° OC', 'Fecha', 'Entrega', 'Proveedor', 'Tipo', 'Observación', 'Responsable', 'Monto bruto', 'Pago', 'Etapa', ''].map((h) => (
                    <th key={h} className={`px-3 py-2 font-semibold ${h === 'Monto bruto' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, tope).map((o) => {
                  const et = etapaDe(o)
                  const venc = vencida(o)
                  return (
                    <tr key={o.numero} onClick={() => setSel(o.numero)}
                      className={`cursor-pointer border-b border-line/60 align-top transition hover:bg-surface2 ${sel === o.numero ? 'bg-lime-500/5' : ''} ${o.cancelada_at ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2 font-bold tabular-nums text-ink">{o.numero}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fechaCorta(o.fecha_compra)}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${venc ? 'font-semibold text-red-400' : ''}`}>{fechaCorta(o.fecha_entrega)}{venc && ' ⚠'}</td>
                      <td className="px-3 py-2"><div className="font-semibold text-ink">{o.proveedor}</div>{o.proveedor_cuit && <div className="text-xs text-sub">{o.proveedor_cuit}</div>}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CHIP_TIPO[o.tipo] ?? ''}`}>{o.tipo}</span>
                        <div className="mt-1 text-[11px] text-sub">{o.planificable ? 'Planificable' : 'No planif.'} · {o.metodo.toLowerCase()}</div>
                      </td>
                      <td className="max-w-[260px] px-3 py-2 text-sub"><span className="line-clamp-2">{o.observacion}</span></td>
                      <td className="px-3 py-2">{nombreCorto(o.responsable)}{o.area && <div className="text-xs text-sub">{o.area}</div>}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{pesos(o.monto_bruto)}</td>
                      <td className="px-3 py-2">{o.forma_pago}<div className="text-xs text-sub">{o.plazo}</div></td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5">
                          {PASOS.map((p) => (
                            <i key={p.k} title={p.titulo} className={`h-1.5 w-3.5 rounded ${o.pasos?.[p.k] ? 'bg-emerald-500' : et.clave === p.k ? 'bg-amber-400' : o.cancelada_at && et.clave === 'canc' ? 'bg-white/10' : 'bg-white/10'}`} />
                          ))}
                        </div>
                        <div className={`mt-1 whitespace-nowrap text-[11px] ${TONO[et.tono]}`}>{et.texto}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <BotonPedir o={o} chico userId={user?.id} esCompras={esCompras} onListo={() => void actualizarUna(o.numero)} />
                        {(o.dragon_estado === 'ok' || (o.importada && o.dragon)) && <span className="ml-1 rounded-full border border-teal-400/40 px-2 py-0.5 text-[11px] text-teal-300">Dragon</span>}
                        {(o.archivo_url || o.archivo_path) && <Paperclip size={13} className="ml-1 inline text-sub" aria-label="Con archivo" />}
                      </td>
                    </tr>
                  )
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={11} className="p-8 text-center text-sm text-sub">No hay órdenes con estos filtros.</td></tr>
                )}
              </tbody>
            </table>
          )}
          {lista && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-sub">
              <span>
                <b className="text-ink">{visibles.length.toLocaleString('es-AR')}</b> órdenes
                {visibles.length > tope && (
                  <> · mostrando {tope} <button onClick={() => setTope((t) => t + PAGINA)} className="ml-2 rounded-lg border border-line px-2 py-1 text-ink hover:bg-surface2">Ver {PAGINA} más</button></>
                )}
              </span>
              <span>Total bruto: <b className="text-ink">{pesos(total)}</b></span>
            </div>
          )}
        </div>

        {oc && (
          <DetalleOc key={oc.numero} oc={oc} onCerrar={() => setSel(null)} onCambio={() => void actualizarUna(oc.numero)}
            onBorrada={() => { setSel(null); void cargar() }}
            onEditar={(enfocarDragon) => setForm({ oc, enfocarDragon })} />
        )}
      </div>

      {form && (
        <FormOrdenCompra oc={form.oc} enfocarDragon={form.enfocarDragon} nombreUsuario={perfil?.nombre ?? ''}
          onCerrar={() => setForm(null)}
          onGuardada={(n) => { setForm(null); void actualizarUna(n); setSel(n) }} />
      )}
      {verAut && <AutorizadoresOc onCerrar={() => setVerAut(false)} />}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */

function BotonPedir({ o, chico, userId, esCompras, onListo }: {
  o: OrdenCompra; chico?: boolean; userId?: string; esCompras: boolean; onListo: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (o.cancelada_at || o.pasos?.autor) return null
  if (o.pedida_at) {
    return chico
      ? <span title={`Pedida a ${o.pedida_a?.join(', ') ?? ''} · ${fechaHora(o.pedida_at)}`} className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[11px] text-emerald-300">💬 Pedida</span>
      : null
  }
  if (!(esCompras || o.creada_por === userId)) return null
  const pedir = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setEnviando(true)
    setMsg(null)
    try {
      const r = await pedirAutorizacion(o.numero)
      setMsg(r.errores.length ? `Enviado a ${r.enviados}; errores: ${r.errores.join(' · ')}` : `Enviado a ${r.destinatarios.join(', ')}`)
      onListo()
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <span className={chico ? '' : 'flex flex-col gap-1'}>
      <button onClick={pedir} disabled={enviando}
        className={`btn-press inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 ${chico ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs'}`}>
        {enviando ? <Loader2 size={12} className="animate-spin" /> : '💬'} Pedir autorización
      </button>
      {msg && !chico && <span className="text-xs text-sub">{msg}</span>}
      {msg && chico && <span className="sr-only">{msg}</span>}
    </span>
  )
}

function DetalleOc({ oc, onCerrar, onCambio, onBorrada, onEditar }: {
  oc: OrdenCompra; onCerrar: () => void; onCambio: () => void; onBorrada: () => void; onEditar: (enfocarDragon?: boolean) => void
}) {
  const { isAdmin, can, user } = useAuth()
  const [eventos, setEventos] = useState<EventoOc[]>([])
  const [sug, setSug] = useState<{ nombres: string[]; resto: string[]; motivo: string | null; horas: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [nota, setNota] = useState(oc.obs_propias ?? '')
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const et = etapaDe(oc)
  const esCompras = can('ordenes_compra.compras')
  const puedeEditar = esCompras || (oc.creada_por === user?.id && !oc.pasos?.autor)

  useEffect(() => {
    void cargarEventos(oc.numero).then(setEventos).catch(() => setEventos([]))
    if (!oc.pasos?.autor && !oc.cancelada_at) void sugeridoDe(oc.numero).then(setSug).catch(() => setSug(null))
  }, [oc])

  const hacer = async (clave: string, fn: () => Promise<unknown>) => {
    setOcupado(clave)
    setError(null)
    try {
      await fn()
      onCambio()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const abrirArchivo = async () => {
    if (oc.archivo_path) {
      const u = await urlArchivo(oc.archivo_path)
      if (u) window.open(u, '_blank', 'noopener')
    } else if (oc.archivo_url) window.open(oc.archivo_url, '_blank', 'noopener')
  }
  const campo = (t: string, v: React.ReactNode) => (
    <><dt className="text-sub">{t}</dt><dd className="font-medium text-ink">{v || '—'}</dd></>
  )

  return (
    <aside className="self-start rounded-2xl border border-line bg-surface lg:sticky lg:top-3 lg:max-h-[calc(100vh-24px)] lg:overflow-auto">
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div>
          <p className="text-xs text-sub">Orden de compra{oc.importada && ' · de la planilla'}</p>
          <h2 className="font-display text-xl font-bold text-ink">N° {oc.numero}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className={`rounded-full border px-2 py-0.5 font-semibold ${CHIP_TIPO[oc.tipo] ?? ''}`}>{oc.tipo}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-sub">{oc.planificable ? 'Planificable' : 'No planificable'}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-sub">{oc.metodo}</span>
          </div>
        </div>
        <button onClick={onCerrar} className="rounded-lg border border-line p-1.5 text-sub hover:bg-surface2" aria-label="Cerrar"><X size={16} /></button>
      </div>
      <div className="flex flex-col gap-4 p-4 text-sm">
        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{error}</p>}
        {oc.cancelada_at && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
            <b>{oc.no_autorizada ? 'No autorizada' : 'Cancelada'}</b> por {oc.cancelada_por} · {fechaHora(oc.cancelada_at)}{oc.cancelada_motivo && ` — ${oc.cancelada_motivo}`}
          </p>
        )}
        {vencida(oc) && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">⚠ La fecha de entrega ({fechaCorta(oc.fecha_entrega)}) ya pasó y el proveedor todavía no la aceptó.</p>}

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {campo('Proveedor', <>{oc.proveedor}{oc.proveedor_cuit && <span className="block text-xs text-sub">{oc.proveedor_cuit}</span>}</>)}
          {campo('Observación', oc.observacion)}
          {campo('Creada por', <>{oc.creada_por_nombre} <span className="text-xs text-sub">· {oc.importada ? fechaCorta(oc.fecha_compra) : fechaHora(oc.creada_at)}</span></>)}
          {campo('Responsable', <>{oc.responsable}{oc.area && <span className="text-xs text-sub"> ({oc.area})</span>}</>)}
          {campo('Compra / entrega', `${fechaCorta(oc.fecha_compra)} → ${fechaCorta(oc.fecha_entrega)}`)}
          {campo('Pago', [oc.forma_pago, oc.plazo].filter(Boolean).join(' · '))}
          {campo('Monto bruto', <span className="text-base">{pesos(oc.monto_bruto)}</span>)}
          {campo('Contacto', [oc.contacto, oc.telefono, oc.mail].filter(Boolean).join(' · '))}
          {campo('Archivo', (oc.archivo_path || oc.archivo_url)
            ? <button onClick={() => void abrirArchivo()} className="inline-flex items-center gap-1 text-sky-400 hover:underline"><Paperclip size={13} /> Abrir archivo</button>
            : null)}
        </dl>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-sub">Recorrido · <span className={TONO[et.tono]}>{et.texto}</span></p>
          <ol className="divide-y divide-dashed divide-line">
            {PASOS.map((p, i) => {
              const h = oc.pasos?.[p.k]
              const puede = can(p.permiso)
              const toca = !h && et.clave === p.k
              return (
                <li key={p.k} className="grid grid-cols-[26px_1fr_auto] items-center gap-2.5 py-2">
                  <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${h ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : toca ? 'border-amber-400 text-amber-300' : 'border-line text-sub'}`}>{h ? '✓' : i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{p.titulo}</p>
                    <p className="text-[11.5px] text-sub">
                      {h ? <>✓ Tildó <b className="text-ink">{h.por}</b> · {h.via === 'planilla' ? 'planilla' : fechaHora(h.at)}{h.via === 'whatsapp' && ' · por WhatsApp'}{h.via === 'telegram' && ' · por Telegram'}</>
                        : p.k === 'autor' && !oc.cancelada_at ? <AvisoAutorizacion oc={oc} sug={sug} />
                          : toca ? `Le toca a: ${QUIEN_TXT[p.quien]}` : ''}
                    </p>
                    {p.k === 'autor' && !h && <div className="mt-1.5"><BotonPedir o={oc} userId={user?.id} esCompras={esCompras} onListo={onCambio} /></div>}
                  </div>
                  <div>
                    {!oc.cancelada_at && puede && (h
                      ? <button disabled={!!ocupado} onClick={() => void hacer(p.k, () => tildarPaso(oc.numero, p.k as PasoClave, false))}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-sub hover:bg-surface2"><Undo2 size={12} /> Deshacer</button>
                      : <button disabled={!!ocupado} onClick={() => void hacer(p.k, () => tildarPaso(oc.numero, p.k as PasoClave, true))}
                        className="inline-flex items-center gap-1 rounded-lg bg-lime-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-lime-700">
                        {ocupado === p.k ? <Loader2 size={12} className="animate-spin" /> : <CheckSquare size={12} />} {p.k === 'autor' ? 'Autorizar' : 'Tildar'}</button>)}
                    {!h && !puede && <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-sub">{QUIEN_TXT[p.quien]}</span>}
                  </div>
                </li>
              )
            })}
            {(oc.dragon || oc.tipo === 'Producto' || oc.tipo === 'Talleres') && (
              <li className="grid grid-cols-[26px_1fr_auto] items-center gap-2.5 py-2">
                <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${oc.dragon_estado === 'ok' || (oc.importada && oc.dragon) ? 'border-teal-400 bg-teal-500/15 text-teal-200' : 'border-line text-sub'}`}>
                  {oc.dragon_estado === 'ok' || (oc.importada && oc.dragon) ? '✓' : 'D'}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">Cargada en DragonFish <span className="text-[11px] font-normal text-teal-300">· automático</span></p>
                  <p className="text-[11.5px] text-sub">
                    {oc.dragon_estado === 'ok' ? <>✓ Pedido de compra X-0164-{oc.numero} en DRAGONFISH_{oc.dragon_base} · mandada por <b className="text-ink">{oc.dragon_por}</b> · {fechaHora(oc.dragon_at)}</>
                      : oc.importada && oc.dragon ? 'Tildada en la planilla'
                        : oc.dragon_estado === 'pendiente' || oc.dragon_estado === 'enviando' ? `⏳ En cola: el puente la manda a DRAGONFISH_${oc.dragon_base} en menos de 1 minuto`
                          : oc.dragon_estado === 'error' ? <span className="text-red-300">{oc.dragon_error?.startsWith('No se mandó sola') ? oc.dragon_error : `Dragon la rechazó: ${oc.dragon_error}`}</span>
                            : oc.dragon ? (oc.pasos?.autor ? 'Lista para mandar' : 'Se crea sola cuando la autoricen') : 'No está marcada para Dragon'}
                  </p>
                </div>
                <div>
                  {esCompras && !oc.cancelada_at && oc.dragon_estado !== 'ok' && oc.dragon_estado !== 'enviando' && oc.dragon_estado !== 'pendiente' && !(oc.importada && oc.dragon) && (
                    oc.dragon
                      ? oc.pasos?.autor && <button disabled={!!ocupado} onClick={() => void hacer('dragon', () => mandarADragon(oc.numero))}
                        className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700">{oc.dragon_estado === 'error' ? 'Reintentar' : 'Crear OC en Dragon'}</button>
                      : <button onClick={() => onEditar(true)} className="rounded-lg border border-teal-500/50 px-2.5 py-1 text-xs text-teal-300 hover:bg-teal-500/10">Cargar para Dragon</button>
                  )}
                </div>
              </li>
            )}
          </ol>
        </div>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-sub">Observaciones propias</p>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} onBlur={() => nota !== (oc.obs_propias ?? '') && void hacer('nota', () => guardarObsPropias(oc.numero, nota))}
            placeholder="Notas internas (no se le mandan al proveedor)"
            className="min-h-[56px] w-full rounded-xl border border-line bg-surface2 p-2.5 text-sm text-ink outline-none" />
        </div>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-sub">Historial</p>
          <ul className="flex flex-col gap-1 text-xs text-sub">
            {oc.importada && <li>Importada de la planilla «Alta Órdenes de Compras Mito» (los tildes de la planilla no dicen quién ni a qué hora).</li>}
            {eventos.map((e) => <li key={e.id}><b className="text-ink">{nombreCorto(e.por)}</b> {e.texto} · {fechaHora(e.at)}</li>)}
          </ul>
        </div>

        {cancelando ? (
          <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 p-3">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (rechazada, cancelada, vencida…)" className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink outline-none" />
            <div className="flex gap-2">
              <button onClick={() => setCancelando(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs">Volver</button>
              <button disabled={!motivo.trim() || !!ocupado} onClick={() => void hacer('canc', () => cancelarOrden(oc.numero, motivo)).then(() => setCancelando(false))}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Cancelar la OC</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {puedeEditar && <button onClick={() => onEditar()} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface2">✏️ Editar</button>}
            {(esCompras || can('ordenes_compra.autorizar')) && (oc.cancelada_at
              ? <button onClick={() => void hacer('reab', () => cancelarOrden(oc.numero, '', true))} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface2">Reabrir</button>
              : <button onClick={() => setCancelando(true)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">Rechazar / cancelar</button>)}
            {isAdmin && (
              <button onClick={() => { if (window.confirm(`¿Borrar la OC ${oc.numero}? No se puede deshacer.`)) void hacer('borrar', () => borrarOrden(oc.numero)).then(onBorrada) }}
                className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">🗑 Borrar</button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function AvisoAutorizacion({ oc, sug }: { oc: OrdenCompra; sug: { nombres: string[]; resto: string[]; motivo: string | null; horas: number } | null }) {
  if (oc.pedida_at) {
    return (
      <>
        🔔 Pedida por <b className="text-ink">{nombreCorto(oc.pedida_por)}</b> · {fechaHora(oc.pedida_at)}. Le llegó por WhatsApp a <b className="text-ink">{oc.pedida_a?.join(', ')}</b>
        {oc.ampliada_at ? <> · después también a los demás autorizadores</> : sug?.resto.length ? <><br />Si no responde en {sug.horas} h, le llega también a {sug.resto.join(', ')}.</> : null}
      </>
    )
  }
  if (!sug) return <>Todavía no se pidió.</>
  return (
    <>
      Todavía no se pidió. Le va a llegar a <b className="text-ink">{sug.nombres.join(', ') || '(no hay autorizadores)'}</b>
      {sug.motivo && <><br /><span className="text-teal-300">Según el historial: {sug.motivo}.</span></>}
    </>
  )
}
