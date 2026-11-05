import { useCallback, useEffect, useMemo, useState } from 'react'
import { Inbox, Loader2, CalendarClock, Ban, RotateCcw, CircleCheck, Search, User, ArrowDownWideNarrow, ArrowUpNarrowWide, Wrench } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { FotosVer } from '@/components/FotosRequerimiento'
import { supabase } from '@/lib/supabase'
import { suscribirCambios } from '@/lib/realtime'
import MultiselectFiltro from '@/components/MultiselectFiltro'
import { ZONAS, nombreZona } from '@/config/zonas'
import { avisarRequerimiento } from '@/lib/push'
import {
  useRubros, PRIORIDADES, ESTADOS, CAMPOS_REQ, prioridadDef, fechaCorta, fechaHora, diasAbierto, quienesVan,
  type EstadoReq, type Persona, type Requerimiento,
} from '@/lib/requerimientos'

/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos → Bandeja (requerimientos.gestionar) */
/*  Lo que cargan los locales: se le asigna día, horario y una o más   */
/*  personas de mantenimiento (les aparece en Mis tareas), se marca    */
/*  Terminado o se descarta. El cierre lo da el local (A confirmar →   */
/*  Quedó listo); si dice que no quedó bien, vuelve a Sin programar.   */
/* ------------------------------------------------------------------ */

type Pestana = 'pendiente' | 'programado' | 'en_curso' | 'a_confirmar' | 'cerrados'
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'pendiente', label: 'Sin programar' },
  { id: 'programado', label: 'Programados' },
  { id: 'en_curso', label: 'En curso' },
  { id: 'a_confirmar', label: 'A confirmar' },
  { id: 'cerrados', label: 'Cerrados' },
]
const ABIERTOS: EstadoReq[] = ['pendiente', 'programado', 'en_curso', 'a_confirmar']
const TOPE_CERRADOS = 300

const hoyIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

export default function RequerimientosBandeja() {
  const { todos: RUBROS, rubroDef } = useRubros()
  const [pestana, setPestana] = useState<Pestana>('pendiente')
  const [orden, setOrden] = useState<'desc' | 'asc'>('desc')
  const [abiertos, setAbiertos] = useState<Requerimiento[]>([])
  const [cerrados, setCerrados] = useState<Requerimiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [locales, setLocales] = useState<{ codigo: string; nombre: string; zona: string | null }[]>([])
  const [mantenimiento, setMantenimiento] = useState<Persona[]>([])
  const [fZona, setFZona] = useState('')
  // Varios locales tildados a la vez (vacío = todos)
  const [fLocales, setFLocales] = useState<Set<string>>(new Set())
  const [fRubro, setFRubro] = useState('')
  const [fPrioridad, setFPrioridad] = useState('')
  const [texto, setTexto] = useState('')
  // Panel abierto en una tarjeta: programar / terminar / descartar
  const [panel, setPanel] = useState<{ id: number; tipo: 'programar' | 'descartar' | 'terminar' } | null>(null)
  const [dia, setDia] = useState(hoyIso())
  const [hora, setHora] = useState('09:00')
  const [asignados, setAsignados] = useState<string[]>([])
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.from('locales').select('codigo,nombre,zona').then(({ data }) =>
      setLocales(((data as { codigo: string; nombre: string | null; zona: string | null }[] | null) ?? [])
        .map((l) => ({ codigo: l.codigo, nombre: l.nombre || l.codigo, zona: l.zona }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))))
    void supabase.rpc('requerimientos_personas', { p_ubicacion: 'MANTENIMIENTO' }).then(({ data }) =>
      setMantenimiento((data as Persona[] | null) ?? []))
  }, [])
  const nombreLocal = useCallback((r: Requerimiento) =>
    locales.find((l) => l.codigo === r.local)?.nombre ?? r.local ?? r.local_original ?? 'Sin local', [locales])

  const cargar = useCallback(async () => {
    if (!supabase) return
    const [a, c] = await Promise.all([
      supabase.from('requerimientos').select(CAMPOS_REQ).in('estado', ABIERTOS).order('created_at').limit(1000),
      supabase.from('requerimientos').select(CAMPOS_REQ).in('estado', ['resuelto', 'no_corresponde'])
        .order('created_at', { ascending: orden === 'asc' }).limit(TOPE_CERRADOS),
    ])
    setError(a.error?.message ?? c.error?.message ?? null)
    setAbiertos((a.data as unknown as Requerimiento[] | null) ?? [])
    setCerrados((c.data as unknown as Requerimiento[] | null) ?? [])
    setCargando(false)
  }, [orden])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => suscribirCambios(['requerimientos'], () => void cargar()), [cargar])

  const zonaDe = useMemo(() => new Map(locales.map((l) => [l.codigo, l.zona])), [locales])
  // En el filtro de locales, solo los de la zona elegida
  const opcionesLocal = useMemo(() => locales.filter((l) => !fZona || l.zona === fZona).map((l) => ({ id: l.codigo, label: l.nombre })), [locales, fZona])
  function elegirZona(z: string) {
    setFZona(z)
    // Los locales tildados que no son de la zona nueva se destildan
    if (z) setFLocales((sel) => new Set([...sel].filter((c) => zonaDe.get(c) === z)))
  }

  const filtrar = useCallback((lista: Requerimiento[]) => {
    const t = texto.trim().toLowerCase()
    return lista.filter((r) =>
      (!fZona || (r.local != null && zonaDe.get(r.local) === fZona)) &&
      (fLocales.size === 0 || (r.local != null && fLocales.has(r.local))) &&
      (!fRubro || r.rubro === fRubro) && (!fPrioridad || r.prioridad === fPrioridad) &&
      (!t || `${r.id} ${r.descripcion} ${r.solicitante_nombre ?? ''} ${r.asignados_nombres.join(' ')}`.toLowerCase().includes(t)))
  }, [fZona, zonaDe, fLocales, fRubro, fPrioridad, texto])

  // Todas las pestañas por fecha de carga, en el orden elegido
  const porPestana = useMemo(() => {
    const signo = orden === 'asc' ? 1 : -1
    const porFecha = (l: Requerimiento[]) => [...l].sort((a, b) => signo * a.created_at.localeCompare(b.created_at))
    const f = filtrar(abiertos)
    return {
      pendiente: porFecha(f.filter((r) => r.estado === 'pendiente')),
      programado: porFecha(f.filter((r) => r.estado === 'programado')),
      en_curso: porFecha(f.filter((r) => r.estado === 'en_curso')),
      a_confirmar: porFecha(f.filter((r) => r.estado === 'a_confirmar')),
      cerrados: porFecha(filtrar(cerrados)),
    }
  }, [abiertos, cerrados, filtrar, orden])
  const lista = porPestana[pestana]

  function abrir(r: Requerimiento, tipo: 'programar' | 'descartar' | 'terminar') {
    setPanel({ id: r.id, tipo })
    setNota('')
    if (tipo === 'programar') {
      if (r.programado_para) {
        const d = new Date(r.programado_para)
        setDia(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10))
        setHora(d.toTimeString().slice(0, 5))
      } else { setDia(hoyIso()); setHora('09:00') }
      setAsignados(r.asignados_legajos.length ? r.asignados_legajos : mantenimiento.length === 1 ? [mantenimiento[0].legajo] : [])
      setNota(r.programado_nota ?? '')
    }
  }

  async function confirmar() {
    if (!supabase || !panel) return
    setGuardando(true)
    setError(null)
    const { error: err } = panel.tipo === 'programar'
      ? await supabase.rpc('requerimiento_programar', { p_id: panel.id, p_cuando: new Date(`${dia}T${hora}:00`).toISOString(), p_legajos: asignados, p_nota: nota })
      : panel.tipo === 'terminar'
        // Queda «a confirmar»: el OK final lo da el local
        ? await supabase.rpc('requerimiento_terminar', { p_id: panel.id, p_comentario: nota, p_fotos: [] })
        : await supabase.rpc('requerimiento_descartar', { p_id: panel.id, p_motivo: nota })
    setGuardando(false)
    if (err) { setError(err.message); return }
    // Al local le llega al celular qué arreglo es, el día, el horario y quién va
    if (panel.tipo === 'programar') void avisarRequerimiento(panel.id)
    setPanel(null)
    void cargar()
  }

  async function reabrir(id: number) {
    if (!supabase) return
    const { error: err } = await supabase.rpc('requerimiento_reabrir', { p_id: id })
    if (err) setError(err.message)
    else void cargar()
  }

  const sel = 'h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink'
  const btn = 'btn-press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-60'

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Inbox size={22} className="text-teal-500" aria-hidden /> Bandeja de requerimientos
        </h1>
        <p className="mt-1 text-sm text-sub">Asigná día, horario y quién de mantenimiento va: les aparece como tarea. El local da el OK final.</p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {PESTANAS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPestana(p.id)} aria-pressed={pestana === p.id}
            className={`btn-press inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${pestana === p.id ? 'border-teal-500 bg-teal-500/15 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}>
            {p.label}
            <span className="rounded-full bg-surface2 px-1.5 text-xs tabular-nums">
              {p.id === 'cerrados' && porPestana.cerrados.length >= TOPE_CERRADOS ? `${TOPE_CERRADOS}+` : porPestana[p.id].length}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
        <button type="button" onClick={() => setOrden((o) => (o === 'desc' ? 'asc' : 'desc'))}
          title="Cambiar el orden por fecha de carga"
          className={`${btn} border border-line bg-surface2 text-ink`}>
          {orden === 'desc' ? <ArrowDownWideNarrow size={15} aria-hidden /> : <ArrowUpNarrowWide size={15} aria-hidden />}
          Fecha: {orden === 'desc' ? 'más nuevos primero' : 'más viejos primero'}
        </button>
        <select value={fZona} onChange={(e) => elegirZona(e.target.value)} aria-label="Zona" className={sel}>
          <option value="">Todas las zonas</option>
          {ZONAS.map((z) => <option key={z} value={z}>Zona {nombreZona(z).toLowerCase()}</option>)}
        </select>
        <MultiselectFiltro label="Locales" opciones={opcionesLocal} seleccionadas={fLocales} onChange={setFLocales} />
        <select value={fRubro} onChange={(e) => setFRubro(e.target.value)} aria-label="Rubro" className={sel}>
          <option value="">Todos los rubros</option>
          {RUBROS.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
        </select>
        <select value={fPrioridad} onChange={(e) => setFPrioridad(e.target.value)} aria-label="Prioridad" className={sel}>
          <option value="">Toda prioridad</option>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <label className="relative min-w-[12rem] flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar N°, texto o persona…" aria-label="Buscar"
            className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2 text-sm text-ink" />
        </label>
      </div>

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando…
        </p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-sub">No hay requerimientos acá.</p>
      ) : (
        <ul className="space-y-2.5">
          {lista.map((r) => {
            const rd = rubroDef(r.rubro)
            const dias = diasAbierto(r)
            const abierto = ABIERTOS.includes(r.estado)
            const programable = r.estado === 'pendiente' || r.estado === 'programado' || r.estado === 'en_curso'
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-display text-sm font-semibold text-ink">{nombreLocal(r)}</span>
                  <span className="text-sub">N° {r.id} · {fechaCorta(r.created_at)}</span>
                  <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{r.rubro}</span>
                  <span className={`rounded-full border px-2 py-0.5 ${prioridadDef(r.prioridad).clase}`}>{prioridadDef(r.prioridad).label}</span>
                  <span className={`rounded-full border px-2 py-0.5 ${ESTADOS[r.estado].clase}`}>{ESTADOS[r.estado].label}</span>
                  {dias != null && (
                    <span className={`tabular-nums ${abierto && dias > 7 ? 'font-semibold text-red-500' : 'text-sub'}`}>
                      {abierto ? (dias === 0 ? 'cargado hoy' : `${dias} día${dias === 1 ? '' : 's'} abierto`)
                        : `${r.estado === 'resuelto' ? 'resuelto' : 'cerrado'} ${dias === 0 ? 'en el día' : `en ${dias} día${dias === 1 ? '' : 's'}`}`}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{r.descripcion}</p>
                {r.solicitante_nombre && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-sub"><User size={12} aria-hidden /> Lo pidió {r.solicitante_nombre}</p>
                )}
                <FotosVer fotos={r.fotos} />
                {r.estado === 'pendiente' && r.rechazo_motivo && (
                  <p className="mt-2 rounded-lg border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">
                    El local dijo que no quedó bien{r.rechazos > 1 ? ` (${r.rechazos} veces)` : ''}: {r.rechazo_motivo}
                  </p>
                )}
                {r.programado_para && r.estado !== 'pendiente' && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-sky-500">
                    <CalendarClock size={13} aria-hidden /> {fechaHora(r.programado_para)} · {quienesVan(r)}
                    {r.programado_nota ? <span className="text-sub"> · {r.programado_nota}</span> : null}
                  </p>
                )}
                {r.terminado_at && r.estado !== 'pendiente' && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-sub">
                    <Wrench size={12} aria-hidden /> Lo terminó {r.terminado_por} el {fechaHora(r.terminado_at)}
                    {r.terminado_comentario ? ` · ${r.terminado_comentario}` : ''}
                  </p>
                )}
                {r.estado !== 'pendiente' && <FotosVer fotos={r.terminado_fotos} />}
                {r.resuelto_at && (
                  <p className="mt-1 text-xs text-sub">
                    {r.estado === 'resuelto' ? 'Conformidad del local' : ESTADOS[r.estado].label} el {fechaCorta(r.resuelto_at)}{r.resuelto_por ? ` · ${r.resuelto_por}` : ''}
                    {r.resuelto_comentario ? ` · ${r.resuelto_comentario}` : ''}
                  </p>
                )}

                {panel?.id === r.id ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface2 p-3">
                    {panel.tipo === 'programar' && (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} aria-label="Día" className={sel} />
                          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Horario" className={sel} />
                        </div>
                        <fieldset className="flex flex-wrap gap-2">
                          <legend className="mb-1 text-xs text-sub">¿Quién va? (uno o más)</legend>
                          {mantenimiento.map((p) => {
                            const marcado = asignados.includes(p.legajo)
                            return (
                              <label key={p.legajo}
                                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${marcado ? 'border-teal-500 bg-teal-500/15 text-ink' : 'border-line bg-surface text-sub'}`}>
                                <input type="checkbox" checked={marcado}
                                  onChange={() => setAsignados((a) => (marcado ? a.filter((x) => x !== p.legajo) : [...a, p.legajo]))} />
                                {p.nombre}
                              </label>
                            )
                          })}
                        </fieldset>
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder={panel.tipo === 'programar' ? 'Nota para mantenimiento (opcional)' : panel.tipo === 'terminar' ? 'Qué se hizo (opcional)' : 'Motivo'}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
                      <button type="button" onClick={() => void confirmar()} disabled={guardando || (panel.tipo === 'programar' && asignados.length === 0)}
                        className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}>
                        {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CircleCheck size={15} aria-hidden />} Confirmar
                      </button>
                      <button type="button" onClick={() => setPanel(null)} className={`${btn} border border-line bg-surface text-ink`}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {programable && (
                      <button type="button" onClick={() => abrir(r, 'programar')} className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}>
                        <CalendarClock size={15} aria-hidden /> {r.programado_para ? 'Reprogramar' : 'Programar'}
                      </button>
                    )}
                    {programable && (
                      <button type="button" onClick={() => abrir(r, 'terminar')} title="Queda a confirmar por el local"
                        className={`${btn} border border-emerald-500/40 bg-emerald-500/10 text-emerald-500`}>
                        <CircleCheck size={15} aria-hidden /> Terminado
                      </button>
                    )}
                    {abierto && (
                      <button type="button" onClick={() => abrir(r, 'descartar')} className={`${btn} border border-line bg-surface2 text-sub`}>
                        <Ban size={15} aria-hidden /> No corresponde
                      </button>
                    )}
                    {!abierto && (
                      <button type="button" onClick={() => void reabrir(r.id)} className={`${btn} border border-line bg-surface2 text-sub`}>
                        <RotateCcw size={15} aria-hidden /> Reabrir
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Layout>
  )
}
