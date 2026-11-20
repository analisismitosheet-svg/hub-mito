import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, Check, Loader2, Plus, ShieldAlert, Trash2, X, ImageOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { comprimirImagen } from '@/lib/comprimirImagen'

/**
 * Tasa de conversión → pestaña «Personas no gratas».
 * Lista de personas cargadas por los locales (fotos en el bucket privado `no-gratas`),
 * alta con 1 a 5 fotos y avisos de la cámara (los inserta la PC contadora cuando
 * reconoce la cara en una puerta). SQL: sql/no_gratas.sql.
 */

const BUCKET = 'no-gratas'

export interface NoGrata {
  id: number
  created_at: string
  local: string
  cargado_email: string | null
  fecha_hecho: string
  motivo: string
  descripcion: string
  fotos: string[]
  vence: string
  activa: boolean
  huellas_at: string | null
}
export interface AvisoNoGrata {
  id: number
  created_at: string
  no_grata_id: number
  local: string
  camara: string | null
  parecido: number | null
  captura: string | null
  estado: 'pendiente' | 'confirmado' | 'falsa_alarma'
  resuelto_email: string | null
}

export const MOTIVOS: Record<string, string> = {
  hurto: 'Hurto',
  intento_hurto: 'Intento de hurto',
  agresion: 'Agresión al personal',
  otro: 'Otro',
}

const fecha = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const hoyIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** URLs firmadas (1 h) de varias rutas del bucket privado */
function useFotos(rutas: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const clave = rutas.join('|')
  useEffect(() => {
    const faltan = rutas.filter((r) => r && !urls[r])
    if (!faltan.length) return
    let vivo = true
    void sb().storage.from(BUCKET).createSignedUrls(faltan, 3600).then(({ data }) => {
      if (!vivo || !data) return
      setUrls((prev) => {
        const n = { ...prev }
        for (const d of data) if (d.path && d.signedUrl) n[d.path] = d.signedUrl
        return n
      })
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])
  return urls
}

function Foto({ url, className }: { url?: string; className?: string }) {
  return url ? (
    <img src={url} alt="" className={'object-cover ' + (className ?? '')} />
  ) : (
    <div className={'flex items-center justify-center bg-black/40 text-sub ' + (className ?? '')}><ImageOff size={20} aria-hidden /></div>
  )
}

/** Avisos pendientes de hoy (para el cartel rojo de la pestaña Conversión) */
export function useAvisosPendientes() {
  const [avisos, setAvisos] = useState<AvisoNoGrata[]>([])
  const cargar = useCallback(async () => {
    const { data } = await sb().from('no_gratas_avisos').select('*').eq('estado', 'pendiente')
      .gte('created_at', hoyIso() + 'T00:00:00').order('created_at', { ascending: false }).limit(10)
    setAvisos((data as AvisoNoGrata[]) ?? [])
  }, [])
  useEffect(() => {
    void cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 30000)
    return () => clearInterval(t)
  }, [cargar])
  return { avisos, recargar: cargar }
}

/** Cartel rojo «PERSONA NO GRATA EN EL LOCAL» con la foto cargada vs la de la cámara */
export function CartelAviso({ aviso, persona, nombres, onResuelto }: {
  aviso: AvisoNoGrata
  persona?: NoGrata
  nombres: Record<string, string>
  onResuelto: () => void
}) {
  const urls = useFotos([persona?.fotos[0] ?? '', aviso.captura ?? ''].filter(Boolean))
  const [guardando, setGuardando] = useState(false)
  const resolver = async (estado: AvisoNoGrata['estado']) => {
    setGuardando(true)
    const { error } = await sb().rpc('no_grata_aviso_resolver', { p_id: aviso.id, p_estado: estado })
    setGuardando(false)
    if (error) alert(error.message)
    else onResuelto()
  }
  return (
    <div role="alert" className="rounded-2xl border border-red-500/50 bg-gradient-to-b from-red-500/15 to-red-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={22} className="text-red-400" aria-hidden />
        <strong className="text-lg tracking-wide text-red-200">PERSONA NO GRATA EN EL LOCAL</strong>
        {aviso.parecido != null && (
          <span className="rounded-full border border-red-500/50 bg-red-500/20 px-2.5 py-0.5 text-[11px] font-bold text-red-200">
            Parecido {Math.round(aviso.parecido)} %
          </span>
        )}
        <span className="ml-auto text-xs text-red-300">{fechaHora(aviso.created_at)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-[160px_160px_1fr]">
        <figure className="relative overflow-hidden rounded-xl border border-line">
          <Foto url={persona ? urls[persona.fotos[0]] : undefined} className="aspect-[3/4] w-full" />
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 px-2 py-1 text-[11px] text-white">Foto cargada</figcaption>
        </figure>
        <figure className="relative overflow-hidden rounded-xl border border-line">
          <Foto url={aviso.captura ? urls[aviso.captura] : undefined} className="aspect-[3/4] w-full" />
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 px-2 py-1 text-[11px] text-white">Cámara {aviso.camara ?? ''}</figcaption>
        </figure>
        <dl className="col-span-2 grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-1.5 text-sm md:col-span-1">
          <dt className="text-sub">Local</dt><dd className="font-medium text-ink">{aviso.local} {nombres[aviso.local] && <span className="text-sub">· {nombres[aviso.local]}</span>}</dd>
          {persona && <>
            <dt className="text-sub">Motivo</dt><dd className="font-medium text-ink">{MOTIVOS[persona.motivo] ?? persona.motivo} · la cargó {persona.local} el {fecha(persona.fecha_hecho)}</dd>
            {persona.descripcion && <><dt className="text-sub">Señas</dt><dd className="text-ink">{persona.descripcion}</dd></>}
          </>}
        </dl>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={guardando} onClick={() => void resolver('confirmado')} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
          <Check size={15} aria-hidden /> Sí, es ella — avisé al personal
        </button>
        <button disabled={guardando} onClick={() => void resolver('falsa_alarma')} className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-200 disabled:opacity-60">
          <X size={15} aria-hidden /> No es (falsa alarma)
        </button>
      </div>
      <p className="mt-2 text-[11px] text-sub">
        Es una <b>posible coincidencia</b> por parecido de cara: confirmalo mirando antes de actuar. Nunca increpar ni negar el ingreso solo por este aviso.
      </p>
    </div>
  )
}

export default function PersonasNoGratas({ nombres }: { nombres: Record<string, string> }) {
  const { isAdmin, can, perfil } = useAuth()
  const veTodo = isAdmin || can('contador.ver_todo')
  const miLocal = (perfil?.local ?? '').toUpperCase()
  const [vista, setVista] = useState<'avisos' | 'lista' | 'cargar'>('lista')
  const [personas, setPersonas] = useState<NoGrata[] | null>(null)
  const [avisos, setAvisos] = useState<AvisoNoGrata[]>([])
  const [error, setError] = useState<string | null>(null)
  const [verBajas, setVerBajas] = useState(false)
  const [busca, setBusca] = useState('')

  const cargar = useCallback(async () => {
    const [p, a] = await Promise.all([
      sb().from('no_gratas').select('id,created_at,local,cargado_email,fecha_hecho,motivo,descripcion,fotos,vence,activa,huellas_at')
        .order('created_at', { ascending: false }).limit(500),
      sb().from('no_gratas_avisos').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    if (p.error) setError(p.error.message)
    else { setError(null); setPersonas(p.data as NoGrata[]) }
    setAvisos((a.data as AvisoNoGrata[]) ?? [])
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const porId = useMemo(() => new Map((personas ?? []).map((p) => [p.id, p])), [personas])
  const hoy = hoyIso()
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (personas ?? []).filter((p) => {
      const vigente = p.activa && p.vence >= hoy
      if (verBajas ? vigente : !vigente) return false
      if (!q) return true
      return [p.local, nombres[p.local] ?? '', MOTIVOS[p.motivo] ?? '', p.descripcion].join(' ').toLowerCase().includes(q)
    })
  }, [personas, busca, verBajas, hoy, nombres])
  const avisosDe = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of avisos) if (a.estado !== 'falsa_alarma') m.set(a.no_grata_id, (m.get(a.no_grata_id) ?? 0) + 1)
    return m
  }, [avisos])
  const pendientes = avisos.filter((a) => a.estado === 'pendiente')

  const urls = useFotos([
    ...visibles.map((p) => p.fotos[0]),
    ...avisos.slice(0, 30).flatMap((a) => [a.captura ?? '', porId.get(a.no_grata_id)?.fotos[0] ?? '']),
  ].filter(Boolean))

  const darBaja = async (p: NoGrata) => {
    if (!confirm('¿Dar de baja esta persona? Deja de avisar en todos los locales.')) return
    const { error: e } = await sb().rpc('no_grata_baja', { p_id: p.id })
    if (e) alert(e.message)
    else void cargar()
  }

  const tab = (id: typeof vista, label: React.ReactNode) => (
    <button onClick={() => setVista(id)}
      className={'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium ' +
        (vista === id ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub hover:text-ink')}>
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {tab('lista', 'Lista')}
        {tab('avisos', <>Avisos {pendientes.length > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{pendientes.length}</span>}</>)}
        {tab('cargar', <><Plus size={13} aria-hidden /> Cargar foto</>)}
      </div>

      {error && <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {vista === 'lista' && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[180px] flex-1">
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Buscar</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Motivo, señas, local…"
                className="h-9 w-full rounded-lg border border-line bg-surface2 px-3 text-sm text-ink" />
            </label>
            <button onClick={() => setVerBajas((v) => !v)}
              className="h-9 rounded-lg border border-line bg-surface2 px-3 text-xs font-medium text-sub hover:text-ink">
              {verBajas ? 'Ver activas' : 'Ver vencidas y dadas de baja'}
            </button>
          </div>
          {!personas ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
          ) : visibles.length === 0 ? (
            <div className="py-8 text-center text-sm text-sub">
              {verBajas ? 'No hay vencidas ni dadas de baja.' : 'Todavía no hay personas cargadas.'}
              {!verBajas && <button onClick={() => setVista('cargar')} className="ml-1 font-medium text-brand-400 hover:underline">Cargar la primera</button>}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {visibles.map((p) => {
                const n = avisosDe.get(p.id) ?? 0
                const puede = veTodo || p.local.toUpperCase() === miLocal
                return (
                  <div key={p.id} className="overflow-hidden rounded-2xl border border-line bg-surface2/40">
                    <div className="relative">
                      <Foto url={urls[p.fotos[0]]} className="aspect-square w-full" />
                      <span className={'absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[11px] font-bold ' +
                        (n > 0 ? 'border-red-500/50 bg-red-500/25 text-red-100' : 'border-line bg-black/50 text-white/80')}>
                        {n > 0 ? `${n} aviso${n > 1 ? 's' : ''}` : 'Sin avisos'}
                      </span>
                      {p.fotos.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{p.fotos.length} fotos</span>}
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-semibold text-ink">{MOTIVOS[p.motivo] ?? p.motivo}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-sub">
                        Cargó {p.local}{nombres[p.local] ? ` (${nombres[p.local]})` : ''} · {fecha(p.fecha_hecho)}<br />
                        {p.activa ? `Vence ${fecha(p.vence)}` : 'Dada de baja'}
                        {p.descripcion && <><br /><span className="text-ink/80">{p.descripcion}</span></>}
                      </div>
                      {!p.huellas_at && p.activa && <div className="mt-1 text-[11px] text-amber-400">Esperando que la cámara procese la cara</div>}
                    </div>
                    {p.activa && puede && (
                      <div className="px-3 pb-3">
                        <button onClick={() => void darBaja(p)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface2 px-2 text-xs text-sub hover:text-ink">
                          <Trash2 size={12} aria-hidden /> Dar de baja
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {vista === 'avisos' && (
        <div className="flex flex-col gap-3">
          {pendientes.map((a) => (
            <CartelAviso key={a.id} aviso={a} persona={porId.get(a.no_grata_id)} nombres={nombres} onResuelto={() => void cargar()} />
          ))}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="mb-2 text-sm font-semibold text-ink">Últimos avisos {veTodo && <span className="font-normal text-sub">· todos los locales</span>}</div>
            {avisos.length === 0 ? (
              <p className="flex gap-2 text-sm text-sub">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                Todavía no hubo avisos. Cuando la cámara de la puerta reconozca a una persona de la lista, aparece acá y arriba de Tasa de conversión.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {avisos.map((a) => {
                  const p = porId.get(a.no_grata_id)
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <Foto url={a.captura ? urls[a.captura] : p ? urls[p.fotos[0]] : undefined} className="h-12 w-9 shrink-0 rounded-md border border-line" />
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{a.local} {nombres[a.local] && <span className="text-xs font-normal text-sub">{nombres[a.local]}</span>}</div>
                        <div className="text-xs text-sub">{a.parecido != null ? `${Math.round(a.parecido)} %` : ''}{p ? ` · ${MOTIVOS[p.motivo] ?? p.motivo}` : ''}{a.resuelto_email ? ` · ${a.resuelto_email}` : ''}</div>
                      </div>
                      <span className={'ml-auto rounded-full border px-2 py-0.5 text-[11px] font-bold ' + (
                        a.estado === 'pendiente' ? 'border-amber-500/45 bg-amber-500/15 text-amber-200'
                          : a.estado === 'confirmado' ? 'border-red-500/50 bg-red-500/20 text-red-200'
                            : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200')}>
                        {a.estado === 'pendiente' ? 'Pendiente' : a.estado === 'confirmado' ? 'Era ella' : 'Falsa alarma'}
                      </span>
                      <span className="w-20 text-right text-xs text-sub">{fechaHora(a.created_at)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {vista === 'cargar' && <Cargar veTodo={veTodo} nombres={nombres} onListo={() => { void cargar(); setVista('lista') }} />}

      <p className="text-[11px] text-sub/80">
        Fotos de caras: datos sensibles (Ley 25.326). Solo para prevención interna: no se comparten fuera de MITO y vencen solas.
      </p>
    </div>
  )
}

function Cargar({ veTodo, nombres, onListo }: { veTodo: boolean; nombres: Record<string, string>; onListo: () => void }) {
  const { perfil } = useAuth()
  const miLocal = perfil?.local ?? ''
  const [local, setLocal] = useState(miLocal)
  const [archivos, setArchivos] = useState<File[]>([])
  const [previas, setPrevias] = useState<string[]>([])
  const [motivo, setMotivo] = useState('hurto')
  const [fechaHecho, setFechaHecho] = useState(hoyIso())
  const [meses, setMeses] = useState(6)
  const [descripcion, setDescripcion] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const u = archivos.map((f) => URL.createObjectURL(f))
    setPrevias(u)
    return () => u.forEach((x) => URL.revokeObjectURL(x))
  }, [archivos])

  const guardar = async () => {
    setError(null)
    if (!archivos.length) return setError('Subí al menos una foto.')
    if (veTodo && !local) return setError('Elegí el local que la carga.')
    if (!confirmo) return setError('Marcá la confirmación de abajo.')
    setGuardando(true)
    try {
      const carpeta = `${(local || miLocal || 'sin-local').toUpperCase()}/${Date.now()}`
      const rutas: string[] = []
      for (const original of archivos) {
        const f = await comprimirImagen(original, 1600, 0.9)
        const ruta = `${carpeta}/${Math.random().toString(36).slice(2, 10)}.jpg`
        const { error: e } = await sb().storage.from(BUCKET).upload(ruta, f, { upsert: false, contentType: 'image/jpeg' })
        if (e) throw new Error(`No se pudo subir la foto: ${e.message}`)
        rutas.push(ruta)
      }
      const { error: e } = await sb().rpc('no_grata_crear', {
        p_motivo: motivo, p_descripcion: descripcion, p_fotos: rutas, p_fecha_hecho: fechaHecho, p_meses: meses, p_local: veTodo ? local : null,
      })
      if (e) throw new Error(e.message)
      onListo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const campo = 'h-9 w-full rounded-lg border border-line bg-surface2 px-3 text-sm text-ink'
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Cargar persona no grata</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        <div>
          <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-sub/35 p-3 text-center text-sm text-sub hover:border-sub/60">
            {previas[0] ? <img src={previas[0]} alt="" className="h-full w-full rounded-xl object-cover" /> : <>
              <Camera size={30} aria-hidden />
              Sacá o subí la foto
              <span className="text-xs">De frente y con la cara visible. Hasta 5 fotos.</span>
            </>}
            <input type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => setArchivos(Array.from(e.target.files ?? []).slice(0, 5))} />
          </label>
          {previas.length > 1 && (
            <div className="mt-2 flex gap-1.5">
              {previas.slice(1).map((u) => <img key={u} src={u} alt="" className="h-14 w-11 rounded-md border border-line object-cover" />)}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {veTodo && (
              <label>
                <span className="mb-0.5 block text-[11px] font-medium text-sub">Local que la carga</span>
                <select value={local} onChange={(e) => setLocal(e.target.value)} className={campo}>
                  <option value="">Elegí…</option>
                  {Object.keys(nombres).sort().map((c) => <option key={c} value={c}>{c}{nombres[c] ? ` · ${nombres[c]}` : ''}</option>)}
                </select>
              </label>
            )}
            <label>
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Fecha del hecho</span>
              <input type="date" value={fechaHecho} max={hoyIso()} onChange={(e) => setFechaHecho(e.target.value)} className={campo} />
            </label>
            <label>
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Motivo</span>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo}>
                {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-[11px] font-medium text-sub">Vence en</span>
              <select value={meses} onChange={(e) => setMeses(Number(e.target.value))} className={campo}>
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>1 año</option>
              </select>
            </label>
          </div>
          <label>
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Qué pasó / señas (sin nombre ni DNI)</span>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3}
              placeholder="Ej.: se llevó 2 camperas en un bolso grande; vino con un hombre que distraía a la vendedora."
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink" />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink/90">
            <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} className="mt-1" />
            Confirmo que la vi en el hecho (cámara o personal) y que es para prevención interna.
          </label>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <div>
            <button disabled={guardando} onClick={() => void guardar()}
              className="btn-press inline-flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {guardando && <Loader2 size={15} className="animate-spin" aria-hidden />} Guardar y avisar a todos los locales
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
