import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wrench, Loader2, Play, CircleCheck, CalendarClock, MessageSquare, User } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { FotosElegir, FotosVer } from '@/components/FotosRequerimiento'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { suscribirCambios } from '@/lib/realtime'
import {
  CAMPOS_REQ, useRubros, prioridadDef, subirFotos, quienesVan, type Requerimiento,
} from '@/lib/requerimientos'

/* ------------------------------------------------------------------ */
/*  Mantenimiento → Mis tareas (requerimientos.tareas).                */
/*  Lo que Arquitectura programó en la Bandeja, por día y hora, estilo */
/*  Mi repo: Empezar → Terminar con comentario y foto del arreglo.     */
/*  Terminar no cierra: queda «a confirmar» hasta el OK del local.     */
/*  Si la cuenta tiene legajo, arranca mostrando solo lo suyo.         */
/* ------------------------------------------------------------------ */

const diaClave = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hoyClave = () => diaClave(new Date().toISOString())
const nombreDia = (clave: string) => {
  const hoy = hoyClave()
  const manana = diaClave(new Date(Date.now() + 86400000).toISOString())
  if (clave === hoy) return 'Hoy'
  if (clave === manana) return 'Mañana'
  const t = new Date(`${clave}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })

export default function TareasMantenimiento() {
  const { rubroDef } = useRubros()
  const { perfil } = useAuth()
  const miLegajo = perfil?.legajo ?? null
  const [tareas, setTareas] = useState<Requerimiento[]>([])
  const [locales, setLocales] = useState<Record<string, string>>({})
  const [soloMias, setSoloMias] = useState(Boolean(miLegajo))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [cerrando, setCerrando] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const [fotos, setFotos] = useState<File[]>([])

  useEffect(() => {
    if (!supabase) return
    void supabase.from('locales').select('codigo,nombre').then(({ data }) =>
      setLocales(Object.fromEntries(((data as { codigo: string; nombre: string | null }[] | null) ?? []).map((l) => [l.codigo, l.nombre || l.codigo]))))
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('requerimientos').select(CAMPOS_REQ)
      .in('estado', ['programado', 'en_curso']).order('programado_para').limit(1000)
    setError(e?.message ?? null)
    setTareas((data as unknown as Requerimiento[] | null) ?? [])
    setCargando(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    const cortar = suscribirCambios(['requerimientos'], () => void cargar())
    const respaldo = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60000)
    return () => { cortar(); clearInterval(respaldo) }
  }, [cargar])

  const visibles = useMemo(() => tareas.filter((t) => !soloMias || (miLegajo != null && t.asignados_legajos.includes(miLegajo))), [tareas, soloMias, miLegajo])

  // En curso arriba; después atrasadas, hoy y los próximos días
  const grupos = useMemo(() => {
    const hoy = hoyClave()
    const g: { titulo: string; tono: string; filas: Requerimiento[] }[] = []
    const enCurso = visibles.filter((t) => t.estado === 'en_curso')
    if (enCurso.length) g.push({ titulo: 'En curso', tono: 'text-violet-500', filas: enCurso })
    const prog = visibles.filter((t) => t.estado === 'programado' && t.programado_para)
    const atrasadas = prog.filter((t) => diaClave(t.programado_para!) < hoy)
    if (atrasadas.length) g.push({ titulo: 'Atrasadas', tono: 'text-red-500', filas: atrasadas })
    const porDia = new Map<string, Requerimiento[]>()
    for (const t of prog.filter((x) => diaClave(x.programado_para!) >= hoy)) {
      const k = diaClave(t.programado_para!)
      porDia.set(k, [...(porDia.get(k) ?? []), t])
    }
    for (const [k, filas] of [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      g.push({ titulo: nombreDia(k), tono: k === hoy ? 'text-teal-500' : 'text-ink', filas })
    }
    return g
  }, [visibles])

  async function empezar(id: number) {
    if (!supabase) return
    setOcupado(id)
    const { error: e } = await supabase.rpc('requerimiento_iniciar', { p_id: id })
    setOcupado(null)
    if (e) setError(e.message)
    else void cargar()
  }

  async function terminar(t: Requerimiento) {
    if (!supabase) return
    setOcupado(t.id)
    setError(null)
    try {
      const rutas = await subirFotos(fotos, `${t.local ?? 'sin-local'}/cierre-${t.id}`)
      const { error: e } = await supabase.rpc('requerimiento_terminar', { p_id: t.id, p_comentario: comentario, p_fotos: rutas })
      if (e) throw new Error(e.message)
      setCerrando(null); setComentario(''); setFotos([])
      void cargar()
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
    } finally {
      setOcupado(null)
    }
  }

  const btn = 'btn-press inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-soft transition disabled:opacity-60'

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Wrench size={22} className="text-slate-400" aria-hidden /> Mis tareas
        </h1>
        <p className="mt-1 text-sm text-sub">Los arreglos que Arquitectura te programó en los locales.</p>
      </header>

      {miLegajo && (
        <div className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
          {[{ v: true, l: 'Mías' }, { v: false, l: 'Todo el equipo' }].map((o) => (
            <button key={o.l} type="button" onClick={() => setSoloMias(o.v)} aria-pressed={soloMias === o.v}
              className={`rounded-lg px-3 py-1.5 font-semibold ${soloMias === o.v ? 'bg-teal-600 text-white' : 'text-sub hover:text-ink'}`}>{o.l}</button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando…
        </p>
      ) : grupos.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sub">
          <CircleCheck size={28} className="mx-auto mb-2 text-emerald-500" aria-hidden />
          No tenés tareas programadas.
        </p>
      ) : grupos.map((g) => (
        <section key={g.titulo} className="mb-5">
          <h2 className={`mb-2 font-display text-lg font-semibold ${g.tono}`}>{g.titulo} <span className="text-sm text-sub">({g.filas.length})</span></h2>
          <ul className="space-y-2.5">
            {g.filas.map((t) => {
              const rd = rubroDef(t.rubro)
              return (
                <li key={t.id} className={`rounded-2xl border bg-surface p-4 shadow-soft ${t.estado === 'en_curso' ? 'border-violet-500/50' : 'border-line'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg font-semibold text-ink">{(t.local && locales[t.local]) || t.local || t.local_original}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        {t.programado_para && (
                          <span className="inline-flex items-center gap-1 font-semibold text-sky-500">
                            <CalendarClock size={13} aria-hidden /> {g.titulo === 'Atrasadas' ? nombreDia(diaClave(t.programado_para)) + ' ' : ''}{hora(t.programado_para)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{t.rubro}</span>
                        <span className={`rounded-full border px-2 py-0.5 ${prioridadDef(t.prioridad).clase}`}>{prioridadDef(t.prioridad).label}</span>
                        <span className="text-sub">N° {t.id}</span>
                      </div>
                    </div>
                    {!soloMias && t.asignados_nombres.length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-sub"><User size={12} aria-hidden />{quienesVan(t)}</span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink">{t.descripcion}</p>
                  {t.solicitante_nombre && <p className="mt-1 text-xs text-sub">Lo pidió {t.solicitante_nombre}</p>}
                  {t.programado_nota && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface2 p-2 text-xs text-ink">
                      <MessageSquare size={13} className="mt-0.5 shrink-0 text-teal-500" aria-hidden /> {t.programado_nota}
                    </p>
                  )}
                  <FotosVer fotos={t.fotos} />

                  {cerrando === t.id ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface2 p-3">
                      <textarea autoFocus value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2}
                        placeholder="Qué se hizo (opcional)"
                        className="w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" />
                      <FotosElegir archivos={fotos} onCambio={setFotos} texto="Foto del arreglo" />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void terminar(t)} disabled={ocupado === t.id}
                          className={`${btn} flex-1 bg-emerald-600 text-white hover:bg-emerald-700`}>
                          {ocupado === t.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CircleCheck size={16} aria-hidden />} Listo, terminado
                        </button>
                        <button type="button" onClick={() => { setCerrando(null); setFotos([]) }} className={`${btn} border border-line bg-surface text-ink`}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      {t.estado === 'programado' ? (
                        <button type="button" onClick={() => void empezar(t.id)} disabled={ocupado === t.id}
                          className={`${btn} flex-1 bg-teal-600 text-white hover:bg-teal-700`}>
                          {ocupado === t.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />} Empezar
                        </button>
                      ) : null}
                      <button type="button" onClick={() => { setCerrando(t.id); setComentario(''); setFotos([]) }}
                        className={`${btn} flex-1 ${t.estado === 'en_curso' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-500'}`}>
                        <CircleCheck size={16} aria-hidden /> Terminar
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </Layout>
  )
}
