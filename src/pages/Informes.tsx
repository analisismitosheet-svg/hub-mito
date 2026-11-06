import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Check, Clock, Eye, FileText, Image as ImageIcon, Loader2, Pencil, Plus,
  RefreshCw, Send, Trash2, Users, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { COLUMNAS_BUSQUEDA, cargarVistas, type VistaDef } from '@/lib/sqlApi'
import InformesContactos, { cargarContactos, crearContacto } from '@/pages/InformesContactos'
import {
  DIAS, FORMATOS, FUENTES, TIPOS_APP, cuandoLabel, formatoDe, fuenteLabel, normalizarTelefono,
  resumenInforme, telefonoValido, ultimoLabel,
  type ConfigApp, type ConfigTexto, type ConfigVista, type ContactoInforme, type Destinatario, type EnvioInforme,
  type FormatoInforme, type FuenteInforme, type Informe, type ModoInforme,
} from '@/lib/informes'

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const labelCls = 'mb-1 block text-xs font-medium text-sub'

/** Estado de entrega que avisa Meta por webhook (informes_envios.estado). */
const ENTREGA: Record<string, { label: string; clase: string }> = {
  sent: { label: 'enviado', clase: 'bg-line text-sub' },
  delivered: { label: 'entregado', clase: 'bg-sky-500/15 text-sky-300' },
  read: { label: 'leído', clase: 'bg-violet-500/15 text-violet-300' },
  failed: { label: 'no llegó', clase: 'bg-red-500/15 text-red-300' },
}

/** POST a /api/informe con el JWT de la sesión. */
async function apiInforme(payload: Record<string, unknown>): Promise<{ texto?: string; imagen?: string; detalle?: string; enviados?: number }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch('/api/informe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as
    | { error?: string; texto?: string; imagen?: string; detalle?: string; enviados?: number; ok?: boolean }
    | null
  if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`)
  if (body?.error) throw new Error(body.error)
  return body ?? {}
}

/** Estado de la conexión con WhatsApp (Meta), lo consulta el servidor con el token de Vercel */
interface EstadoWhatsapp {
  configurado: boolean
  ok: boolean
  numero?: string
  nombre?: string
  calidad?: string
  error?: string
  avisos?: boolean
  /** Con el bot configurado, todo sale por Telegram y WhatsApp no se usa */
  telegram?: boolean
}

async function consultarWhatsapp(): Promise<EstadoWhatsapp> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch('/api/informe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ estado: true }),
  })
  const body = (await res.json().catch(() => null)) as (EstadoWhatsapp & { error?: string }) | null
  if (!res.ok || !body || typeof body.configurado !== 'boolean') throw new Error(body?.error ?? `Error ${res.status}`)
  return body
}

export default function Informes() {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('sistemas.informes')
  const [todos, setTodos] = useState<Informe[]>([])
  const [envios, setEnvios] = useState<EnvioInforme[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'lista' | 'form' | 'contactos'>('lista')
  const [editando, setEditando] = useState<Informe | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [verEnvios, setVerEnvios] = useState<Informe | null>(null)
  // Conexión con WhatsApp: null = consultando
  const [whatsapp, setWhatsapp] = useState<EstadoWhatsapp | null>(null)
  const revisarWhatsapp = useCallback(async () => {
    setWhatsapp(null)
    try {
      setWhatsapp(await consultarWhatsapp())
    } catch (e) {
      setWhatsapp({ configurado: false, ok: false, error: (e as Error).message })
    }
  }, [])
  useEffect(() => { void revisarWhatsapp() }, [revisarWhatsapp])

  const mostrarToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    const [{ data: inf }, { data: env }] = await Promise.all([
      supabase.from('informes').select('*').order('creado_at', { ascending: false }),
      supabase.from('informes_envios').select('*').order('enviado_at', { ascending: false }).limit(200),
    ])
    setTodos((inf as Informe[]) ?? [])
    setEnvios((env as EnvioInforme[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  // Respaldo del cron: al abrir la pantalla se procesan los informes diarios que ya
  // pasaron su hora y no se enviaron hoy. Es idempotente (la base reclama cada uno).
  const procesarVencidos = useCallback(async () => {
    if (!supabase) return
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const res = await fetch('/api/informe', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const body = (await res.json().catch(() => null)) as { procesados?: number } | null
      if (body?.procesados) await cargar()
    } catch {
      /* silencioso: es sólo un respaldo */
    }
  }, [cargar])

  useEffect(() => { void procesarVencidos() }, [procesarVencidos])

  async function alternarActivo(i: Informe) {
    if (!supabase) return
    const { error } = await supabase.from('informes').update({ activo: !i.activo }).eq('id', i.id)
    if (error) { mostrarToast('No se pudo cambiar el estado', false); return }
    await cargar()
  }

  async function eliminar(i: Informe) {
    if (!supabase) return
    const { error } = await supabase.from('informes').delete().eq('id', i.id)
    if (error) { mostrarToast('No se pudo eliminar', false); return }
    await cargar(); mostrarToast('Informe eliminado')
  }

  async function enviarAhora(i: Informe) {
    setEnviando(i.id)
    try {
      const r = await apiInforme({ id: i.id })
      mostrarToast(r.enviados ? `Enviado (${r.enviados} destinatario/s)` : `No se envió: ${r.detalle ?? ''}`, Boolean(r.enviados))
    } catch (e) {
      mostrarToast((e as Error).message, false)
    } finally {
      setEnviando(null)
      await cargar()
    }
  }

  function abrirNuevo() { setEditando(null); setVista('form') }
  function abrirEditar(i: Informe) { setEditando(i); setVista('form') }

  if (vista === 'form') {
    return (
      <InformeForm
        inicial={editando}
        onCancel={() => setVista('lista')}
        onSaved={async () => { setVista('lista'); await cargar(); mostrarToast('Informe guardado') }}
        onError={(m) => mostrarToast(m, false)}
      />
    )
  }

  const enviosDe = (id: string) => envios.filter((e) => e.informe_id === id)

  return (
    <Layout>
      {toast && (
        <div className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-enter rounded-xl border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm ${toast.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {toast.msg}
        </div>
      )}
      <BackButton />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <FileText size={20} className="text-cyan-500" aria-hidden /> Envío informes y reportes
          </h1>
          <p className="mt-1 text-sm text-sub">Se mandan por {whatsapp?.telegram ? 'Telegram' : 'WhatsApp'}: a mano, o solos todos los días a la hora que elijas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void cargar()} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line" title="Actualizar">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
          <button onClick={() => setVista(vista === 'contactos' ? 'lista' : 'contactos')}
            className={`btn-press inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium ${vista === 'contactos' ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : 'border-line bg-surface2 text-ink hover:bg-line'}`}>
            <Users size={15} className="text-violet-400" aria-hidden /> {vista === 'contactos' ? 'Ver informes' : 'Contactos'}
          </button>
          {puedeCrear && vista === 'lista' && (
            <button onClick={abrirNuevo} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500">
              <Plus size={15} aria-hidden /> Nuevo informe
            </button>
          )}
        </div>
      </div>

      {whatsapp?.telegram && (
        <div className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
          <b>Telegram activo</b>: los avisos salen por el bot y WhatsApp no se usa. Quién está vinculado se ve en Contactos.
        </div>
      )}

      {/* Conexión con WhatsApp (Meta) */}
      <div
        className={`mb-3 ${whatsapp?.telegram ? 'hidden' : 'flex'} flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
          whatsapp === null
            ? 'border-line bg-surface2 text-sub'
            : whatsapp.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : whatsapp.configurado
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        }`}
      >
        {whatsapp === null ? (
          <><Loader2 size={14} className="animate-spin" aria-hidden /> Revisando la conexión con WhatsApp…</>
        ) : whatsapp.ok ? (
          <span>
            <b>WhatsApp conectado</b>: {whatsapp.numero ?? '—'}{whatsapp.nombre ? ` (${whatsapp.nombre})` : ''}
            {whatsapp.calidad ? ` · calidad ${whatsapp.calidad}` : ''}
            {whatsapp.avisos === false && (
              <>
                {' · '}
                <button
                  onClick={() => void apiInforme({ activarAvisos: true })
                    .then(() => { mostrarToast('Avisos de WhatsApp activados'); return revisarWhatsapp() })
                    .catch((e: Error) => mostrarToast(e.message, false))}
                  className="font-medium underline underline-offset-2"
                  title="Sin esto Meta no le avisa al hub quién escribió ni qué mensajes se entregaron"
                >
                  Activar avisos
                </button>
              </>
            )}
          </span>
        ) : whatsapp.configurado ? (
          <span><b>WhatsApp con error</b>: {whatsapp.error}</span>
        ) : (
          <span><b>WhatsApp sin configurar</b>: {whatsapp.error}</span>
        )}
        {whatsapp !== null && (
          <button onClick={() => void revisarWhatsapp()} className="ml-auto text-xs font-medium underline-offset-2 hover:underline">
            Volver a revisar
          </button>
        )}
      </div>

      {!puedeCrear && (
        <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Tu usuario puede ver los informes pero no crearlos ni editarlos.
        </p>
      )}

      {vista === 'contactos' ? (
        <InformesContactos informes={todos} puedeCrear={puedeCrear || puedeEditar} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar}
          onCambioInformes={cargar} onMensaje={mostrarToast} />
      ) : cargando ? (
        <div className="flex items-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…</div>
      ) : todos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/50 p-8 text-center">
          <FileText size={28} className="mx-auto mb-2 text-sub/60" aria-hidden />
          <p className="text-sm text-sub">Todavía no hay informes. {puedeCrear ? 'Creá el primero con «Nuevo informe».' : ''}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {todos.map((i) => {
            const ult = enviosDe(i.id)[0]
            return (
              <article key={i.id} className={`overflow-hidden rounded-2xl border bg-surface shadow-soft ${i.activo ? 'border-line' : 'border-line/60 opacity-70'}`}>
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-ink">{i.nombre}</h2>
                      <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] font-medium text-sub">{fuenteLabel(i.fuente)}</span>
                      {formatoDe(i) === 'imagen' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300"><ImageIcon size={11} aria-hidden /> Imagen</span>
                      )}
                      {i.modo === 'diario' || i.modo === 'repo_completa'
                        ? <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300"><Clock size={11} aria-hidden /> {cuandoLabel(i)}</span>
                        : <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] font-medium text-sub">A mano</span>}
                      {!i.activo && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sub">Inactivo</span>}
                    </div>
                    <p className="mt-1 truncate text-sm text-sub">{resumenInforme(i)}</p>
                    <p className="mt-1 text-xs text-sub/80">
                      <span title={(i.destinatarios ?? []).map((d) => d.nombre || d.telefono).join(', ')}>
                        {i.destinatarios?.length ? (i.destinatarios ?? []).map((d) => d.nombre || `+${d.telefono}`).join(', ') : 'Sin destinatarios'}
                      </span>{' · '}
                      <span className={i.ultimo_envio && !i.ultimo_ok ? 'text-red-300' : ''}>{ultimoLabel(i)}</span>
                    </p>
                    {i.ultimo_detalle && !i.ultimo_ok && (
                      <p className="mt-0.5 truncate text-[11px] text-red-300/90" title={i.ultimo_detalle}>⚠ {i.ultimo_detalle}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {puedeEditar && (
                      <button onClick={() => void enviarAhora(i)} disabled={enviando === i.id} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                        {enviando === i.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />} Enviar ahora
                      </button>
                    )}
                    <button onClick={() => setVerEnvios(i)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-line" title="Historial de envíos">
                      <Eye size={14} aria-hidden />
                    </button>
                    {puedeEditar && (
                      <button onClick={() => abrirEditar(i)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-line" title="Editar">
                        <Pencil size={14} aria-hidden />
                      </button>
                    )}
                    {puedeEditar && (
                      <button onClick={() => void alternarActivo(i)} className="btn-press rounded-xl border border-line bg-surface2 px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-line" title={i.activo ? 'Desactivar' : 'Activar'}>
                        <Check size={14} className={i.activo ? 'text-emerald-500' : 'text-sub'} aria-hidden />
                      </button>
                    )}
                    {puedeBorrar && (
                      <button onClick={() => setConfirm({ message: `¿Eliminar el informe «${i.nombre}»?`, onConfirm: () => void eliminar(i) })} className="btn-press rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-red-300 hover:bg-red-500/20" title="Eliminar">
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
                {ult && (
                  <div className="border-t border-line/60 bg-surface2/40 px-4 py-1.5 text-[11px] text-sub">
                    Último intento: {new Date(ult.enviado_at).toLocaleString('es-AR')} · {ult.ok ? 'ok' : 'error'} · {ult.destino}{ult.detalle ? ` · ${ult.detalle}` : ''}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />

      {verEnvios && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="max-h-[80vh] w-[92vw] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-ink">Envíos de «{verEnvios.nombre}»</h3>
              <button onClick={() => setVerEnvios(null)} className="rounded-lg p-1 text-sub hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
            </div>
            {enviosDe(verEnvios.id).length === 0 ? (
              <p className="py-4 text-center text-sm text-sub">Sin envíos todavía.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {enviosDe(verEnvios.id).map((e) => (
                  <li key={e.id} className="rounded-xl border border-line bg-surface2/50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{new Date(e.enviado_at).toLocaleString('es-AR')}</span>
                      <span className="flex items-center gap-1">
                        {/* Lo que avisó Meta después de aceptarlo (webhook): si de verdad llegó */}
                        {e.ok && e.estado && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${ENTREGA[e.estado]?.clase ?? 'bg-line text-sub'}`}
                            title={e.estado_at ? new Date(e.estado_at).toLocaleString('es-AR') : undefined}
                          >
                            {ENTREGA[e.estado]?.label ?? e.estado}
                          </span>
                        )}
                        {e.via === 'telegram' && e.ok && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-300">Telegram</span>}
                        {e.ok && e.via === 'servicio' && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300" title="Salió dentro de las 24 h después de que el contacto escribió: no usa plantilla">gratis</span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 font-medium ${e.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-300'}`}>{e.ok ? 'ok' : 'error'}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-sub">{e.destino ?? '—'} · {e.origen}{e.detalle ? ` · ${e.detalle}` : ''}</p>
                    {e.error_entrega && <p className="mt-0.5 text-red-300/90">⚠ No se entregó: {e.error_entrega}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function InformeForm({
  inicial,
  onCancel,
  onSaved,
  onError,
}: {
  inicial: Informe | null
  onCancel: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [fuente, setFuente] = useState<FuenteInforme>(inicial?.fuente ?? 'texto')
  const [encabezado, setEncabezado] = useState(inicial?.encabezado ?? '')
  const [pie, setPie] = useState(inicial?.pie ?? '')
  const [modo, setModo] = useState<ModoInforme>(inicial?.modo ?? 'manual')
  const [hora, setHora] = useState(inicial?.hora ?? '08:00')
  const [dias, setDias] = useState<string[]>(inicial?.dias ?? [])
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [formato, setFormato] = useState<FormatoInforme>(inicial ? formatoDe(inicial) : 'texto')

  // Fuente texto / app
  const [plantilla, setPlantilla] = useState<string>((inicial?.config as unknown as ConfigTexto)?.plantilla ?? '')
  const [tipoApp, setTipoApp] = useState((inicial?.config as unknown as ConfigApp)?.tipo ?? 'recepcion_indo')
  // Plantilla aprobada en Meta (para que llegue sin ventana de 24 h)
  const [plantillaMeta, setPlantillaMeta] = useState(String((inicial?.config as Record<string, unknown> | undefined)?.plantillaMeta ?? ''))

  // Fuente vista
  const cfgV = (inicial?.config as unknown as ConfigVista) ?? {}
  const [vistaSel, setVistaSel] = useState(cfgV.vista ?? '')
  const [filtroCol, setFiltroCol] = useState(cfgV.donde?.[0] ?? '')
  const [filtroValor, setFiltroValor] = useState(cfgV.valor ?? '')
  const [coincide, setCoincide] = useState<'igual' | 'contiene'>(cfgV.coincide ?? 'contiene')
  const [tope, setTope] = useState(String(cfgV.tope ?? 50))
  const [columnas, setColumnas] = useState((cfgV.columnas ?? []).join(', '))

  // Destinatarios
  const [dests, setDests] = useState<Destinatario[]>(inicial?.destinatarios ?? [])

  const [vistas, setVistas] = useState<VistaDef[]>([])
  const [preview, setPreview] = useState('')
  const [previewImg, setPreviewImg] = useState('')
  const [probando, setProbando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    void cargarVistas().then(setVistas).catch(() => setVistas([]))
  }, [])

  const config = useMemo<Record<string, unknown>>(() => {
    const meta = plantillaMeta.trim() ? { plantillaMeta: plantillaMeta.trim() } : {}
    if (fuente === 'texto') return { formato, plantilla, ...meta }
    if (fuente === 'app') return { formato, tipo: tipoApp, ...meta }
    return {
      ...meta,
      formato,
      vista: vistaSel,
      ...(filtroValor.trim() && filtroCol ? { donde: [filtroCol], valor: filtroValor.trim(), coincide } : {}),
      ...(columnas.trim() ? { columnas: columnas.split(',').map((c) => c.trim()).filter(Boolean) } : {}),
      tope: Number(tope) || 50,
    }
  }, [fuente, formato, plantilla, plantillaMeta, tipoApp, vistaSel, filtroCol, filtroValor, coincide, tope, columnas])

  const informeActual = (): Informe => ({
    id: inicial?.id ?? '',
    nombre: nombre.trim(),
    activo,
    fuente,
    config,
    encabezado: encabezado.trim() || null,
    pie: pie.trim() || null,
    destinatarios: dests,
    modo,
    hora: modo === 'diario' ? hora : null,
    dias,
    ultimo_envio: inicial?.ultimo_envio ?? null,
    ultimo_ok: inicial?.ultimo_ok ?? null,
    ultimo_detalle: inicial?.ultimo_detalle ?? null,
    creado_at: inicial?.creado_at ?? new Date().toISOString(),
  })

  async function verVista() {
    setProbando(true)
    setPreviewImg('')
    try {
      const r = await apiInforme({ informe: informeActual(), preview: true })
      if (r.imagen) { setPreviewImg(r.imagen); setPreview('') }
      else setPreview(r.texto ?? '(vacío)')
    } catch (e) {
      setPreview(`⚠ ${(e as Error).message}`)
    } finally {
      setProbando(false)
    }
  }

  // Agenda de contactos: los destinatarios se eligen de ahí (se puede sumar uno nuevo sin salir)
  const [contactos, setContactos] = useState<ContactoInforme[] | null>(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTel, setNuevoTel] = useState('')
  const [creandoContacto, setCreandoContacto] = useState(false)
  useEffect(() => { void cargarContactos().then(setContactos) }, [])
  const elegido = (c: ContactoInforme) =>
    dests.some((d) => d.contacto_id === c.id || (!d.contacto_id && normalizarTelefono(d.telefono) === c.telefono))
  function alternarContacto(c: ContactoInforme) {
    setDests((d) => elegido(c)
      ? d.filter((x) => !(x.contacto_id === c.id || (!x.contacto_id && normalizarTelefono(x.telefono) === c.telefono)))
      : [...d, { nombre: c.nombre, telefono: c.telefono, contacto_id: c.id }])
  }
  /** Destinatarios cargados a mano antes de la agenda (sin contacto): se muestran para poder sacarlos */
  const sueltos = dests.filter((d) => !d.contacto_id && !contactos?.some((c) => c.telefono === normalizarTelefono(d.telefono)))
  async function agregarContactoNuevo() {
    setCreandoContacto(true)
    const r = await crearContacto(nuevoNombre, nuevoTel)
    setCreandoContacto(false)
    if (r.error || !r.contacto) { onError(r.error ?? 'No se pudo agregar el contacto.'); return }
    const c = r.contacto
    setContactos((l) => [...(l ?? []), c].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setDests((d) => [...d, { nombre: c.nombre, telefono: c.telefono, contacto_id: c.id }])
    setNuevoNombre(''); setNuevoTel('')
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) { onError('Poné un nombre al informe.'); return }
    const validos = dests.filter((d) => telefonoValido(d.telefono))
    if (!validos.length) { onError('Agregá al menos un destinatario con teléfono válido.'); return }
    if (modo === 'diario' && !/^\d{2}:\d{2}$/.test(hora)) { onError('Elegí la hora del envío diario.'); return }
    if (fuente === 'texto' && !plantilla.trim()) { onError('El texto libre está vacío.'); return }
    if (fuente === 'vista' && !vistaSel) { onError('Elegí una vista para el informe.'); return }

    const fila = {
      nombre: nombre.trim(),
      activo,
      fuente,
      config,
      encabezado: encabezado.trim() || null,
      pie: pie.trim() || null,
      destinatarios: validos,
      modo,
      hora: modo === 'diario' ? hora : null,
      dias,
    }
    setGuardando(true)
    const { error } = inicial?.id
      ? await supabase.from('informes').update(fila).eq('id', inicial.id)
      : await supabase.from('informes').insert(fila)
    setGuardando(false)
    if (error) { onError(`No se pudo guardar: ${error.message}`); return }
    onSaved()
  }

  return (
    <Layout>
      <BackButton />
      <h1 className="mb-1 font-display text-xl font-semibold text-ink">{inicial ? 'Editar informe' : 'Nuevo informe'}</h1>
      <p className="mb-5 text-sm text-sub">Definí de dónde sale el contenido, a quién le llega y cuándo.</p>

      <form onSubmit={guardar} className="flex flex-col gap-4">
        {/* Datos básicos */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Nombre</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Ej.: Recepción INDO pendientes" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 accent-cyan-600" /> Activo
              </label>
            </div>
          </div>
        </section>

        {/* Fuente */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">Contenido</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {FUENTES.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => setFuente(f.id)}
                className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${fuente === f.id ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-line bg-surface2 text-sub hover:bg-line'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-sub">{FUENTES.find((f) => f.id === fuente)?.desc}</p>

          {fuente === 'texto' && (
            <div>
              <label className={labelCls}>Mensaje (podés usar {'{fecha}'}, {'{hora}'} y {'{dia}'})</label>
              <textarea value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={4} className={inputCls} placeholder="Recordatorio: hoy {dia} {fecha} vence la carga de…" />
            </div>
          )}

          {fuente === 'app' && (
            <div>
              <label className={labelCls}>Qué datos</label>
              <select value={tipoApp} onChange={(e) => setTipoApp(e.target.value as typeof tipoApp)} className={inputCls}>
                {TIPOS_APP.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          )}

          {fuente === 'vista' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Vista del SQL Server</label>
                <select value={vistaSel} onChange={(e) => setVistaSel(e.target.value)} className={inputCls}>
                  <option value="">— Elegí una vista —</option>
                  {vistas.map((v) => <option key={v.vista} value={v.vista}>{v.label}</option>)}
                </select>
                {vistas.length === 0 && <p className="mt-1 text-[11px] text-sub">No hay vistas habilitadas (se configuran en Datos SQL).</p>}
              </div>
              <div>
                <label className={labelCls}>Filtrar por (opcional)</label>
                <select value={filtroCol} onChange={(e) => setFiltroCol(e.target.value)} className={inputCls}>
                  <option value="">Sin filtro</option>
                  {COLUMNAS_BUSQUEDA.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Texto a buscar</label>
                <input value={filtroValor} onChange={(e) => setFiltroValor(e.target.value)} className={inputCls} disabled={!filtroCol} placeholder="Ej.: reloj" />
              </div>
              <div>
                <label className={labelCls}>Coincidencia</label>
                <select value={coincide} onChange={(e) => setCoincide(e.target.value as 'igual' | 'contiene')} className={inputCls}>
                  <option value="contiene">Contiene</option>
                  <option value="igual">Igual</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Máximo de filas</label>
                <input type="number" min={1} max={1000} value={tope} onChange={(e) => setTope(e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Columnas (opcional, separadas por coma — vacío = todas)</label>
                <input value={columnas} onChange={(e) => setColumnas(e.target.value)} className={inputCls} placeholder="ARTCOD, ARTDES, STOCK" />
              </div>
            </div>
          )}
        </section>

        {/* Formato de entrega */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">Formato</h2>
          <div className="flex flex-wrap gap-2">
            {FORMATOS.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => setFormato(f.id)}
                className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${formato === f.id ? 'border-violet-500/50 bg-violet-500/10 text-violet-300' : 'border-line bg-surface2 text-sub hover:bg-line'}`}
              >
                {formato === f.id && <Check size={13} className="mr-1 inline" aria-hidden />}{f.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-sub">{FORMATOS.find((f) => f.id === formato)?.desc}</p>
          <div className="mt-3">
            <label className={labelCls}>Plantilla de Meta (opcional)</label>
            <input value={plantillaMeta} onChange={(e) => setPlantillaMeta(e.target.value)} className={inputCls} placeholder="Ej.: eficiencia_mayorista" />
            <p className="mt-1 text-[11px] text-sub">Nombre exacto de una plantilla aprobada en WhatsApp Manager. Con plantilla el mensaje llega siempre; sin plantilla, sólo a quien le escribió al número en las últimas 24 h. El cuerpo usa {'{{1}}'} = nombre del destinatario y {'{{2}}'} = fecha.</p>
          </div>
        </section>

        {/* Encabezado / pie */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Encabezado (opcional)</label>
              <input value={encabezado} onChange={(e) => setEncabezado(e.target.value)} className={inputCls} placeholder="Ej.: *Informe del día*" />
            </div>
            <div>
              <label className={labelCls}>Pie (opcional)</label>
              <input value={pie} onChange={(e) => setPie(e.target.value)} className={inputCls} placeholder="Ej.: Generado automáticamente por Mito" />
            </div>
          </div>
          <div className="mt-3">
            <button type="button" onClick={() => void verVista()} disabled={probando} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
              {probando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Eye size={14} aria-hidden />} Ver vista previa
            </button>
            {previewImg ? (
              <img src={previewImg} alt="Vista previa del informe" className="mt-2 max-h-96 w-auto max-w-full rounded-xl border border-line bg-white" />
            ) : preview ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface2/60 p-3 text-xs text-ink">{preview}</pre>
            ) : null}
          </div>
        </section>

        {/* Destinatarios: de la agenda de contactos */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-semibold text-ink">
            <Users size={15} className="text-violet-400" aria-hidden /> Destinatarios de WhatsApp
          </h2>
          <p className="mb-2 text-xs text-sub">Tocá los contactos que reciben este informe. La agenda se maneja desde «Contactos».</p>
          {contactos === null ? (
            <div className="flex items-center gap-2 text-xs text-sub"><Loader2 size={13} className="animate-spin" aria-hidden /> Cargando contactos…</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {contactos.length === 0 && <span className="text-xs text-sub">Todavía no hay contactos: agregá el primero acá abajo.</span>}
              {contactos.map((c) => {
                const si = elegido(c)
                return (
                  <button key={c.id} type="button" onClick={() => alternarContacto(c)} title={`+${c.telefono}${c.activo ? '' : ' · pausado: no recibe informes'}`}
                    className={`btn-press inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${si
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-line bg-surface2 text-sub hover:text-ink'} ${c.activo ? '' : 'opacity-60'}`}>
                    {si ? <Check size={11} aria-hidden /> : <Plus size={11} aria-hidden />} {c.nombre}
                    <span className="font-normal text-sub/80">+{c.telefono}</span>
                  </button>
                )
              })}
            </div>
          )}
          {sueltos.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-sub">
              Cargados a mano:
              {sueltos.map((d) => (
                <span key={d.telefono} className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                  {d.nombre || d.telefono} +{normalizarTelefono(d.telefono)}
                  <button type="button" onClick={() => setDests((l) => l.filter((x) => x !== d))} className="rounded p-0.5 hover:bg-amber-500/20" title="Sacar"><X size={11} aria-hidden /></button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 grid gap-2 border-t border-line/60 pt-3 sm:grid-cols-[1fr_1fr_auto]">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} className={inputCls} placeholder="Contacto nuevo: nombre" aria-label="Nombre del contacto nuevo" />
            <input value={nuevoTel} onChange={(e) => setNuevoTel(e.target.value)} className={inputCls} placeholder="WhatsApp" inputMode="tel" aria-label="WhatsApp del contacto nuevo" />
            <button type="button" onClick={() => void agregarContactoNuevo()} disabled={creandoContacto || !nuevoNombre.trim() || !nuevoTel.trim()}
              className="btn-press inline-flex items-center justify-center gap-1 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
              {creandoContacto ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />} Agregar y asignar
            </button>
          </div>
        </section>

        {/* Programación */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">Programación</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={modo === 'manual'} onChange={() => setModo('manual')} className="accent-cyan-600" /> A mano
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={modo === 'diario'} onChange={() => setModo('diario')} className="accent-cyan-600" /> Todos los días
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink">
              <input type="radio" checked={modo === 'repo_completa'} onChange={() => setModo('repo_completa')} className="accent-cyan-600" /> Al completar la repo del día
            </label>
            {modo === 'diario' && (
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${inputCls} w-auto`} />
            )}
          </div>
          {modo === 'repo_completa' && (
            <p className="mt-2 text-[11px] text-sub">Se manda solo, una vez por día, apenas la venta diaria (VTD) del día queda al 100% (todo mandado o marcado como no mandado). Se revisa cada 5 minutos, de lunes a sábado de 8 a 21.</p>
          )}
          {(modo === 'diario' || modo === 'repo_completa') && (
            <div className="mt-3">
              <label className={labelCls}>Días (vacío = todos)</label>
              <div className="flex flex-wrap gap-2">
                {DIAS.map((d) => {
                  const on = dias.includes(d.id)
                  return (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() => setDias((x) => (on ? x.filter((y) => y !== d.id) : [...x, d.id]))}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${on ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-line bg-surface2 text-sub hover:bg-line'}`}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
              {modo === 'diario' && <p className="mt-1 text-[11px] text-sub">Se dispara a la hora elegida (hora de Argentina). Como respaldo, también se procesan los que quedaron pendientes al abrir esta pantalla.</p>}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
            {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Guardar
          </button>
        </div>
      </form>
    </Layout>
  )
}
