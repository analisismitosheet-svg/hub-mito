import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle, Check, Clock, Eye, FileText, Loader2, Pencil, Plus,
  RefreshCw, Send, Trash2, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { COLUMNAS_BUSQUEDA, cargarVistas, type VistaDef } from '@/lib/sqlApi'
import {
  DIAS, FUENTES, TIPOS_APP, cuandoLabel, fuenteLabel, normalizarTelefono, resumenInforme,
  telefonoValido, ultimoLabel,
  type ConfigApp, type ConfigTexto, type ConfigVista, type Destinatario, type EnvioInforme,
  type FuenteInforme, type Informe, type ModoInforme,
} from '@/lib/informes'

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const labelCls = 'mb-1 block text-xs font-medium text-sub'

/** POST a /api/informe con el JWT de la sesión. */
async function apiInforme(payload: Record<string, unknown>): Promise<{ texto?: string; detalle?: string; enviados?: number }> {
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
    | { error?: string; texto?: string; detalle?: string; enviados?: number; ok?: boolean }
    | null
  if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`)
  if (body?.error) throw new Error(body.error)
  return body ?? {}
}

export default function Informes() {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('sistemas.informes')
  const [todos, setTodos] = useState<Informe[]>([])
  const [envios, setEnvios] = useState<EnvioInforme[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'lista' | 'form'>('lista')
  const [editando, setEditando] = useState<Informe | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [verEnvios, setVerEnvios] = useState<Informe | null>(null)

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
          <p className="mt-1 text-sm text-sub">Se mandan por WhatsApp: a mano, o solos todos los días a la hora que elijas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void cargar()} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line" title="Actualizar">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
          {puedeCrear && (
            <button onClick={abrirNuevo} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500">
              <Plus size={15} aria-hidden /> Nuevo informe
            </button>
          )}
        </div>
      </div>

      {!puedeCrear && (
        <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Tu usuario puede ver los informes pero no crearlos ni editarlos.
        </p>
      )}

      {cargando ? (
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
                      {i.modo === 'diario'
                        ? <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300"><Clock size={11} aria-hidden /> {cuandoLabel(i)}</span>
                        : <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] font-medium text-sub">A mano</span>}
                      {!i.activo && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sub">Inactivo</span>}
                    </div>
                    <p className="mt-1 truncate text-sm text-sub">{resumenInforme(i)}</p>
                    <p className="mt-1 text-xs text-sub/80">
                      {i.destinatarios?.length || 0} destinatario(s) ·{' '}
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
                      <span className={`rounded-full px-2 py-0.5 font-medium ${e.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-300'}`}>{e.ok ? 'ok' : 'error'}</span>
                    </div>
                    <p className="mt-0.5 text-sub">{e.destino ?? '—'} · {e.origen}{e.detalle ? ` · ${e.detalle}` : ''}</p>
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

  // Fuente texto / app
  const [plantilla, setPlantilla] = useState<string>((inicial?.config as unknown as ConfigTexto)?.plantilla ?? '')
  const [tipoApp, setTipoApp] = useState((inicial?.config as unknown as ConfigApp)?.tipo ?? 'recepcion_indo')

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
  const [probando, setProbando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    void cargarVistas().then(setVistas).catch(() => setVistas([]))
  }, [])

  const config = useMemo<Record<string, unknown>>(() => {
    if (fuente === 'texto') return { plantilla }
    if (fuente === 'app') return { tipo: tipoApp }
    return {
      vista: vistaSel,
      ...(filtroValor.trim() && filtroCol ? { donde: [filtroCol], valor: filtroValor.trim(), coincide } : {}),
      ...(columnas.trim() ? { columnas: columnas.split(',').map((c) => c.trim()).filter(Boolean) } : {}),
      tope: Number(tope) || 50,
    }
  }, [fuente, plantilla, tipoApp, vistaSel, filtroCol, filtroValor, coincide, tope, columnas])

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
    try {
      const r = await apiInforme({ informe: informeActual(), preview: true })
      setPreview(r.texto ?? '(vacío)')
    } catch (e) {
      setPreview(`⚠ ${(e as Error).message}`)
    } finally {
      setProbando(false)
    }
  }

  function agregarDest() {
    setDests((d) => [...d, { nombre: '', telefono: '' }])
  }
  function setDest(idx: number, campo: keyof Destinatario, valor: string) {
    setDests((d) => d.map((x, i) => (i === idx ? { ...x, [campo]: valor } : x)))
  }
  function quitarDest(idx: number) {
    setDests((d) => d.filter((_, i) => i !== idx))
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
            {preview && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface2/60 p-3 text-xs text-ink">{preview}</pre>
            )}
          </div>
        </section>

        {/* Destinatarios */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-ink">Destinatarios de WhatsApp</h2>
            <button type="button" onClick={agregarDest} className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line">
              <Plus size={13} aria-hidden /> Agregar
            </button>
          </div>
          {dests.length === 0 && <p className="text-xs text-sub">Agregá al menos un número. Se guarda en formato internacional (ej. 5491122334455).</p>}
          <div className="flex flex-col gap-2">
            {dests.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input value={d.nombre} onChange={(e) => setDest(idx, 'nombre', e.target.value)} className={`${inputCls} sm:max-w-[40%]`} placeholder="Nombre (opcional)" />
                <input value={d.telefono} onChange={(e) => setDest(idx, 'telefono', e.target.value)} className={inputCls} placeholder="Teléfono" inputMode="tel" />
                <span className="hidden shrink-0 text-[11px] text-sub sm:block" title="Se enviará a este número">{d.telefono ? normalizarTelefono(d.telefono) : ''}</span>
                <button type="button" onClick={() => quitarDest(idx)} className="shrink-0 rounded-lg p-1.5 text-red-300 hover:bg-red-500/10"><X size={14} aria-hidden /></button>
              </div>
            ))}
          </div>
          {dests.some((d) => d.telefono && !telefonoValido(d.telefono)) && (
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} aria-hidden /> Hay teléfonos que no parecen válidos; igual se van a intentar normalizar.</p>
          )}
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
            {modo === 'diario' && (
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${inputCls} w-auto`} />
            )}
          </div>
          {modo === 'diario' && (
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
              <p className="mt-1 text-[11px] text-sub">Se dispara a la hora elegida (hora de Argentina). Como respaldo, también se procesan los que quedaron pendientes al abrir esta pantalla.</p>
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
