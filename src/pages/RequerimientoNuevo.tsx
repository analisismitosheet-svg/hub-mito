import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ClipboardList, Loader2, Send, CalendarClock, CircleCheck, ThumbsUp, ThumbsDown, Wrench } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import SelectorEmpleado from '@/components/SelectorEmpleado'
import AvisosCelular from '@/components/AvisosCelular'
import { FotosElegir, FotosVer } from '@/components/FotosRequerimiento'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { suscribirCambios } from '@/lib/realtime'
import {
  useRubros, PRIORIDADES, ESTADOS, CAMPOS_REQ, prioridadDef, subirFotos, fechaCorta, fechaHora, quienesVan,
  type Persona, type Prioridad, type Requerimiento,
} from '@/lib/requerimientos'

/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos → Nuevo requerimiento.               */
/*  Lo carga el local (requerimientos.cargar): el local sale SIEMPRE   */
/*  de la cuenta. Quién lo solicita = nómina activa de RR. HH.         */
/*  Arriba, los arreglos que mantenimiento terminó y esperan la        */
/*  conformidad del local (Quedó listo / No quedó bien); abajo, los    */
/*  últimos del local con su estado.                                   */
/* ------------------------------------------------------------------ */

/** Cómo figura cada local en empleados.area_sector (la nómina de RR. HH.; `lugar` dice LOCALES). */
const SECTORES_DEL_LOCAL: Record<string, string[]> = {
  NVOCED: ['NVO CENTRO', 'NUEVO CENTRO'],
  LIBERD: ['HIPER', 'LIBERTAD'],
  ESPINOD: ['ESPINOSA', 'JOCKEY'],
  GPAZD: ['GRAL PAZ', 'GENERAL PAZ', 'GPAZ'],
  VCPD: ['VCP', 'CARLOS PAZ'],
  DINOD: ['DINO'],
  BUSTOD: ['BUSTOS'],
  MUNOZ: ['MUNOZ'],
  RIVERAD: ['RIVERA'],
  RUTA9D2: ['RUTA 9'],
  WALMARTD: ['WALMART'],
  '9DEJULIO': ['9 DE JULIO'],
  CFD: ['CF BUSTOS'],
  CFRA: ['CF RIVERA'],
  CFPO: ['CF OLMOS'],
  CFR9: ['CF RUTA 9'],
  CFR4: ['CF RIO IV', 'CF RIO 4'],
}
/** "NVO. CENTRO" = "Nvo Centro" = "NVOCENTRO" */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export default function RequerimientoNuevo() {
  const { rubros: RUBROS, rubroDef } = useRubros()
  const { perfil } = useAuth()
  const local = perfil?.local ?? ''
  const [locales, setLocales] = useState<{ codigo: string; nombre: string }[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [solicitante, setSolicitante] = useState<string | null>(null)
  const [rubro, setRubro] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('')
  const [descripcion, setDescripcion] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [yaResuelto, setYaResuelto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<number | null>(null)
  const [ultimos, setUltimos] = useState<Requerimiento[]>([])
  const [paraConfirmar, setParaConfirmar] = useState<Requerimiento[]>([])
  const [devolviendo, setDevolviendo] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState<number | null>(null)

  useEffect(() => {
    if (!supabase) return
    void supabase.from('locales').select('codigo,nombre').eq('activo', true).then(({ data }) =>
      setLocales(((data as { codigo: string; nombre: string | null }[] | null) ?? [])
        .map((l) => ({ codigo: l.codigo, nombre: l.nombre || l.codigo }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))))
    void supabase.rpc('requerimientos_personas').then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setPersonas((data as Persona[] | null) ?? [])
    })
  }, [])

  const nombreLocal = (c: string | null) => locales.find((l) => l.codigo === c)?.nombre ?? c ?? ''

  // Primero la gente de este local, después el resto de la nómina activa
  const opciones = useMemo(() => {
    const sectores = new Set((SECTORES_DEL_LOCAL[local] ?? [nombreLocal(local)]).map(norm))
    const delLocal = (p: Persona) => sectores.has(norm(p.sector ?? ''))
    return [...personas]
      .sort((a, b) => Number(delLocal(b)) - Number(delLocal(a)) || a.nombre.localeCompare(b.nombre))
      .map((p) => ({ id: p.legajo, nombre: p.nombre, legajo: p.legajo }))
  }, [personas, local, locales])

  const cargarUltimos = useCallback(async () => {
    if (!supabase || !local) { setUltimos([]); setParaConfirmar([]); return }
    const [u, c] = await Promise.all([
      supabase.from('requerimientos').select(CAMPOS_REQ).eq('local', local).order('created_at', { ascending: false }).limit(30),
      supabase.from('requerimientos').select(CAMPOS_REQ).eq('local', local).eq('estado', 'a_confirmar').order('terminado_at'),
    ])
    setUltimos((u.data as unknown as Requerimiento[] | null) ?? [])
    setParaConfirmar((c.data as unknown as Requerimiento[] | null) ?? [])
  }, [local])
  useEffect(() => { void cargarUltimos() }, [cargarUltimos])
  useEffect(() => suscribirCambios(['requerimientos'], () => void cargarUltimos()), [cargarUltimos])

  const falta = !local ? 'Tu usuario no tiene un local asignado' : !solicitante ? 'Elegí quién lo solicita' : !rubro ? 'Elegí el rubro'
    : !prioridad ? 'Elegí la prioridad' : descripcion.trim().length < 3 ? 'Contá qué pasa' : null

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || falta) { setError(falta); return }
    setEnviando(true)
    setError(null)
    try {
      const rutas = await subirFotos(fotos, local)
      const { data, error: err } = await supabase.rpc('requerimiento_crear', {
        p_rubro: rubro, p_prioridad: prioridad, p_solicitante_legajo: solicitante,
        p_descripcion: descripcion.trim(), p_fotos: rutas, p_ya_resuelto: yaResuelto,
      })
      if (err) throw new Error(err.message)
      setListo(data as number)
      setRubro(''); setPrioridad(''); setDescripcion(''); setFotos([]); setYaResuelto(false)
      void cargarUltimos()
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
    } finally {
      setEnviando(false)
    }
  }

  async function confirmar(id: number) {
    if (!supabase) return
    setOcupado(id)
    setError(null)
    const { error: err } = await supabase.rpc('requerimiento_confirmar', { p_id: id })
    setOcupado(null)
    if (err) setError(err.message)
    else void cargarUltimos()
  }

  async function noQuedo(id: number) {
    if (!supabase) return
    setOcupado(id)
    setError(null)
    const { error: err } = await supabase.rpc('requerimiento_no_quedo', { p_id: id, p_motivo: motivo })
    setOcupado(null)
    if (err) { setError(err.message); return }
    setDevolviendo(null); setMotivo('')
    void cargarUltimos()
  }

  const caja = 'rounded-2xl border border-line bg-surface p-4'
  const titulo = 'mb-2 text-xs font-semibold uppercase tracking-wider text-sub/80'

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <ClipboardList size={22} className="text-teal-500" aria-hidden /> Nuevo requerimiento
        </h1>
        <p className="mt-1 text-sm text-sub">Contale a Arquitectura qué hay que arreglar en el local. Te avisamos el día y horario en que va mantenimiento.</p>
      </header>

      <AvisosCelular texto="Activá los avisos para que te llegue al celular qué día y a qué hora va mantenimiento." />

      {listo != null && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          <CircleCheck size={16} aria-hidden /> Requerimiento N° {listo} cargado. Lo ves abajo con su estado.
        </p>
      )}

      {paraConfirmar.length > 0 && (
        <section className="mb-5 rounded-2xl border border-lime-500/40 bg-lime-500/5 p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Wrench size={18} className="text-lime-500" aria-hidden /> Para confirmar ({paraConfirmar.length})
          </h2>
          <p className="mb-3 text-sm text-sub">Mantenimiento dice que ya lo arregló. Fijate y confirmá si quedó bien.</p>
          <ul className="space-y-2.5">
            {paraConfirmar.map((r) => {
              const rd = rubroDef(r.rubro)
              return (
                <li key={r.id} className="rounded-xl border border-line bg-surface p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-sub">N° {r.id} · {fechaCorta(r.created_at)}</span>
                    <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{r.rubro}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink">{r.descripcion}</p>
                  <p className="mt-2 text-xs text-sub">
                    Lo terminó {r.terminado_por ?? 'mantenimiento'}{r.terminado_at ? ` el ${fechaHora(r.terminado_at)}` : ''}
                    {r.terminado_comentario ? <span className="text-ink"> · {r.terminado_comentario}</span> : null}
                  </p>
                  <FotosVer fotos={r.terminado_fotos} />
                  {devolviendo === r.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Qué quedó mal?"
                        className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink" />
                      <button type="button" onClick={() => void noQuedo(r.id)} disabled={ocupado === r.id}
                        className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
                        {ocupado === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ThumbsDown size={15} aria-hidden />} Devolver
                      </button>
                      <button type="button" onClick={() => setDevolviendo(null)} className="btn-press h-10 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink">Cancelar</button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void confirmar(r.id)} disabled={ocupado === r.id}
                        className="btn-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-soft hover:bg-emerald-700 disabled:opacity-60">
                        {ocupado === r.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ThumbsUp size={16} aria-hidden />} Quedó listo
                      </button>
                      <button type="button" onClick={() => { setDevolviendo(r.id); setMotivo('') }}
                        className="btn-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-brand-600/40 bg-brand-600/10 text-sm font-semibold text-brand-400">
                        <ThumbsDown size={16} aria-hidden /> No quedó bien
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <div className={`${caja} grid gap-3 sm:grid-cols-2`}>
          <div>
            <p className={titulo}>Local</p>
            <p className="flex h-10 items-center rounded-xl border border-line bg-surface2 px-3 text-sm font-semibold text-ink">
              {local ? nombreLocal(local) : 'Tu usuario no tiene local asignado'}
            </p>
          </div>
          <div>
            <p className={titulo}>¿Quién lo solicita?</p>
            <SelectorEmpleado empleados={opciones} valor={solicitante} onElegir={setSolicitante}
              placeholder="Buscá tu nombre o legajo…" className="h-10 w-full !max-w-none justify-between rounded-xl bg-surface2 px-3 !text-sm" />
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>Rubro</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {RUBROS.map((r) => {
              const activo = rubro === r.id
              return (
                <button key={r.id} type="button" onClick={() => setRubro(r.id)} aria-pressed={activo}
                  className={`btn-press flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${activo ? 'text-ink' : 'border-line bg-surface2 text-sub hover:text-ink'}`}
                  style={activo ? { borderColor: r.color, backgroundColor: `${r.color}22` } : undefined}>
                  <r.icon size={17} style={{ color: r.color }} aria-hidden /> {r.id}
                </button>
              )
            })}
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>Prioridad</p>
          <div className="flex gap-2">
            {PRIORIDADES.map((p) => (
              <button key={p.id} type="button" onClick={() => setPrioridad(p.id)} aria-pressed={prioridad === p.id}
                className={`btn-press h-10 flex-1 rounded-xl border text-sm font-semibold transition ${prioridad === p.id ? p.clase : 'border-line bg-surface2 text-sub hover:text-ink'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>¿Qué pasa?</p>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4}
            placeholder="Ej.: se quemó un reflector de la vidriera, el de la izquierda."
            className="w-full rounded-xl border border-line bg-surface2 p-3 text-sm text-ink outline-none placeholder:text-sub/60 focus-visible:border-brand-500" />
          <p className={`${titulo} mt-3`}>Fotos de lo roto o del problema</p>
          <FotosElegir archivos={fotos} onCambio={setFotos} />
          <label className="mt-4 flex items-start gap-2 text-sm text-sub">
            <input type="checkbox" checked={yaResuelto} onChange={(e) => setYaResuelto(e.target.checked)} className="mt-0.5" />
            <span>Ya está resuelto, solo dejo constancia <span className="text-sub/70">(ej.: «hoy Marcos cambió una AR111»).</span></span>
          </label>
        </div>

        {error && <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

        <button type="submit" disabled={enviando}
          className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-base font-semibold text-white shadow-soft hover:bg-teal-700 disabled:opacity-60">
          {enviando ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
          {enviando ? 'Enviando…' : yaResuelto ? 'Guardar constancia' : 'Enviar requerimiento'}
        </button>
      </form>

      {local && (
        <section className="mt-8">
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">Últimos de {nombreLocal(local)}</h2>
          {ultimos.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay requerimientos cargados.</p>
          ) : (
            <ul className="space-y-2">
              {ultimos.map((r) => {
                const rd = rubroDef(r.rubro)
                return (
                  <li key={r.id} className="rounded-2xl border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-sub">N° {r.id} · {fechaCorta(r.created_at)}</span>
                      <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{r.rubro}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${prioridadDef(r.prioridad).clase}`}>{prioridadDef(r.prioridad).label}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${ESTADOS[r.estado].clase}`}>{ESTADOS[r.estado].label}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink">{r.descripcion}</p>
                    {r.programado_para && (r.estado === 'programado' || r.estado === 'en_curso') && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-sky-500">
                        <CalendarClock size={13} aria-hidden /> Va {quienesVan(r) || 'mantenimiento'} el {fechaHora(r.programado_para)}
                      </p>
                    )}
                    {r.estado === 'pendiente' && r.rechazo_motivo && (
                      <p className="mt-1 text-xs text-brand-400">Lo devolvieron: {r.rechazo_motivo}</p>
                    )}
                    {r.resuelto_at && (
                      <p className="mt-1 text-xs text-sub">
                        {r.estado === 'resuelto' ? 'Resuelto' : 'Cerrado'} el {fechaCorta(r.resuelto_at)}{r.resuelto_comentario ? ` · ${r.resuelto_comentario}` : ''}
                      </p>
                    )}
                    <FotosVer fotos={r.fotos} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </Layout>
  )
}
