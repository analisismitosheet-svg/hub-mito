import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { ArrowLeft, ArrowRight, CircleCheck, Clock, KanbanSquare, Lightbulb, Play, Plus, Trash2, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Organizador de tareas tipo Trello.                                  */
/*  Tres columnas: Ideas → En marcha → Hechas. Al mover una tarjeta se  */
/*  ponen solas las fechas (inicio al arrancar, fin al terminar) y se   */
/*  pueden corregir tocando la tarjeta. Cada uno ve lo suyo; el admin   */
/*  ve todo con selector de persona. Tabla tareas_tablero              */
/*  (sql/tareas_tablero.sql), permiso tareas.view.                      */
/* ------------------------------------------------------------------ */

type Estado = 'idea' | 'marcha' | 'hecha'
interface Tarea {
  id: number
  usuario_id: string
  titulo: string
  nota: string | null
  etiqueta: string
  estado: Estado
  fecha_idea: string
  fecha_inicio: string | null
  fecha_fin: string | null
}

const COLUMNAS: { k: Estado; n: string; icon: typeof Lightbulb; color: string; boton: string }[] = [
  { k: 'idea', n: 'Ideas', icon: Lightbulb, color: '#8b5cf6', boton: 'Arrancar' },
  { k: 'marcha', n: 'En marcha', icon: Play, color: '#f59e0b', boton: 'Terminar' },
  { k: 'hecha', n: 'Hechas', icon: CircleCheck, color: '#10b981', boton: '' },
]
const ETIQUETAS: Record<string, string> = {
  General: 'border-slate-400/40 bg-slate-400/15 text-slate-500',
  Local: 'border-sky-500/40 bg-sky-500/15 text-sky-500',
  Depósito: 'border-pink-500/40 bg-pink-500/15 text-pink-500',
  Marketing: 'border-orange-500/40 bg-orange-500/15 text-orange-500',
  Compras: 'border-lime-500/40 bg-lime-500/15 text-lime-600',
  Sistemas: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-500',
  RR_HH: 'border-violet-500/40 bg-violet-500/15 text-violet-500',
}
const nombreEtiqueta = (e: string) => e.replace('_', '. ') + (e === 'RR_HH' ? '.' : '')

type Filtro = 'todo' | 'semana' | 'atrasadas'

/** Hoy en Córdoba, como 'aaaa-mm-dd' */
function hoyIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba' }).format(new Date())
}
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)
function lunesIso(hoy: string) {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export default function TareasTablero() {
  const { isAdmin, user } = useAuth()
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todo')
  const [duenos, setDuenos] = useState<{ id: string; nombre: string }[]>([])
  // el admin arranca viendo las de todos; al resto la RLS ya le trae solo las suyas
  const [dueno, setDueno] = useState<string>('todos')
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<Estado | null>(null)
  const [nueva, setNueva] = useState('')
  const [etiquetaNueva, setEtiquetaNueva] = useState('General')
  const [errNueva, setErrNueva] = useState(false)
  const [editando, setEditando] = useState<Tarea | null>(null)
  const hoy = hoyIso()

  const cargar = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase
      .from('tareas_tablero')
      .select('id,usuario_id,titulo,nota,etiqueta,estado,fecha_idea,fecha_inicio,fecha_fin')
      .order('fecha_idea', { ascending: false })
      .order('id', { ascending: false })
      .limit(1000)
    if (e) setError(e.message)
    setTareas((data as Tarea[] | null) ?? [])
    setCargando(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    if (isAdmin && supabase) void supabase.rpc('tareas_tablero_duenos').then(({ data }) => setDuenos((data as { id: string; nombre: string }[] | null) ?? []))
  }, [isAdmin, tareas.length])

  const lunes = lunesIso(hoy)
  const visibles = useMemo(() => tareas.filter((t) => {
    if (dueno === 'yo' && t.usuario_id !== user?.id) return false
    if (dueno !== 'yo' && dueno !== 'todos' && t.usuario_id !== dueno) return false
    if (filtro === 'semana') return [t.fecha_idea, t.fecha_inicio, t.fecha_fin].some((f) => f && f >= lunes)
    if (filtro === 'atrasadas') return t.estado !== 'hecha' && dias(t.fecha_idea, hoy) > 7
    return true
  }), [tareas, dueno, filtro, lunes, hoy, user?.id])

  const nombreDueno = useCallback((id: string) => duenos.find((d) => d.id === id)?.nombre ?? '', [duenos])

  async function guardar(id: number, cambios: Partial<Tarea>) {
    if (!supabase) return
    setTareas((ts) => ts.map((t) => (t.id === id ? { ...t, ...cambios } : t)))
    const { error: e } = await supabase.from('tareas_tablero').update(cambios).eq('id', id)
    if (e) { setError(e.message); void cargar() }
  }

  function mover(t: Tarea, estado: Estado) {
    if (t.estado === estado) return
    const c: Partial<Tarea> = { estado }
    if (estado === 'idea') { c.fecha_inicio = null; c.fecha_fin = null }
    if (estado === 'marcha') { c.fecha_inicio = t.fecha_inicio ?? hoy; c.fecha_fin = null }
    if (estado === 'hecha') { c.fecha_inicio = t.fecha_inicio ?? hoy; c.fecha_fin = hoy }
    void guardar(t.id, c)
  }

  async function agregar() {
    if (!supabase) return
    const titulo = nueva.trim()
    if (!titulo) { setErrNueva(true); return }
    const { data, error: e } = await supabase
      .from('tareas_tablero')
      .insert({ titulo, etiqueta: etiquetaNueva, fecha_idea: hoy })
      .select('id,usuario_id,titulo,nota,etiqueta,estado,fecha_idea,fecha_inicio,fecha_fin')
      .single()
    if (e) { setError(e.message); return }
    setTareas((ts) => [data as Tarea, ...ts])
    setNueva('')
  }

  async function borrar(id: number) {
    if (!supabase || !window.confirm('¿Borrar esta tarjeta?')) return
    const { error: e } = await supabase.from('tareas_tablero').delete().eq('id', id)
    if (e) { setError(e.message); return }
    setTareas((ts) => ts.filter((t) => t.id !== id))
    setEditando(null)
  }

  function soltar(ev: DragEvent, estado: Estado) {
    ev.preventDefault()
    setSobre(null)
    const t = tareas.find((x) => x.id === arrastrando)
    if (t) mover(t, estado)
    setArrastrando(null)
  }

  const hechas = visibles.filter((t) => t.estado === 'hecha' && t.fecha_fin)
  const promedio = hechas.length ? Math.round(hechas.reduce((a, t) => a + dias(t.fecha_idea, t.fecha_fin!), 0) / hechas.length) : 0
  const verDueno = isAdmin && dueno === 'todos'

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <KanbanSquare size={22} className="text-violet-500" aria-hidden /> Organizador de tareas
        </h1>
        <p className="mt-1 text-sm text-sub">Arrastrá las tarjetas de una columna a otra. Las fechas se ponen solas; tocá una tarjeta para corregirlas.</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['todo', 'Todo'], ['semana', 'Esta semana'], ['atrasadas', 'Atrasadas +7 días']] as [Filtro, string][]).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`btn-press rounded-lg border px-2.5 py-1 text-xs transition ${filtro === k ? 'border-violet-500/60 bg-violet-500/15 font-semibold text-violet-500' : 'border-line bg-surface text-sub hover:text-ink'}`}>
            {n}
          </button>
        ))}
        {isAdmin && (
          <select value={dueno} onChange={(e) => setDueno(e.target.value)} aria-label="De quién"
            className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
            <option value="todos">Todas las personas</option>
            <option value="yo">Mis tarjetas</option>
            {duenos.filter((d) => d.id !== user?.id).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs text-sub">
          {hechas.length} hechas{hechas.length ? ` · promedio ${promedio} días de idea a terminada` : ''}
        </span>
      </div>

      {error && <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {COLUMNAS.map((col, ix) => {
          const lista = visibles.filter((t) => t.estado === col.k)
          const Icono = col.icon
          return (
            <section key={col.k}
              onDragOver={(e) => { e.preventDefault(); setSobre(col.k) }}
              onDragLeave={() => setSobre((s) => (s === col.k ? null : s))}
              onDrop={(e) => soltar(e, col.k)}
              className={`flex min-h-[240px] flex-col gap-2 rounded-2xl border-2 border-dashed bg-surface p-3 transition ${sobre === col.k ? 'border-violet-500/60' : 'border-transparent'}`}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icono size={18} style={{ color: col.color }} aria-hidden /> {col.n}
                <span className="ml-auto rounded-full bg-surface2 px-2 text-xs font-normal text-sub">{lista.length}</span>
              </h2>

              {col.k === 'idea' && (
                <div className="rounded-xl border border-line bg-surface2 p-2">
                  <div className="flex gap-2">
                    <input value={nueva} onChange={(e) => { setNueva(e.target.value); setErrNueva(false) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void agregar() }}
                      placeholder="Escribí la idea y Enter" aria-label="Nueva idea"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
                    <button type="button" onClick={() => void agregar()} aria-label="Agregar idea"
                      className="btn-press flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500 text-white"><Plus size={18} /></button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.keys(ETIQUETAS).map((e) => (
                      <button key={e} type="button" onClick={() => setEtiquetaNueva(e)} aria-pressed={etiquetaNueva === e}
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] transition ${etiquetaNueva === e ? ETIQUETAS[e] + ' font-semibold' : 'border-line text-sub'}`}>
                        {nombreEtiqueta(e)}
                      </button>
                    ))}
                  </div>
                  {errNueva && <p className="mt-1 text-xs text-red-500">Escribí algo primero</p>}
                </div>
              )}

              {cargando && <p className="text-xs text-sub">Cargando…</p>}
              {!cargando && !lista.length && <p className="py-4 text-center text-xs text-sub/70">Sin tarjetas</p>}

              {lista.map((t) => {
                const atraso = t.estado !== 'hecha' ? dias(t.fecha_idea, hoy) : 0
                return (
                  <article key={t.id} draggable
                    onDragStart={() => setArrastrando(t.id)} onDragEnd={() => { setArrastrando(null); setSobre(null) }}
                    onClick={() => setEditando(t)}
                    className={`cursor-grab rounded-xl border border-line bg-surface2 p-2.5 text-sm text-ink transition hover:border-violet-500/40 active:cursor-grabbing ${arrastrando === t.id ? 'opacity-40' : ''}`}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className={`rounded-md border px-1.5 text-[11px] ${ETIQUETAS[t.etiqueta] ?? ETIQUETAS.General}`}>{nombreEtiqueta(t.etiqueta)}</span>
                      {verDueno && <span className="truncate text-[11px] text-sub">{nombreDueno(t.usuario_id)}</span>}
                    </div>
                    <p className={t.estado === 'hecha' ? 'text-sub' : ''}>{t.titulo}</p>
                    {t.nota && <p className="mt-0.5 line-clamp-2 text-xs text-sub">{t.nota}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sub">
                      <span className="flex items-center gap-1"><Lightbulb size={12} style={{ color: COLUMNAS[0].color }} /> {ddmm(t.fecha_idea)}</span>
                      {t.fecha_inicio && <span className="flex items-center gap-1"><Play size={12} style={{ color: COLUMNAS[1].color }} /> {ddmm(t.fecha_inicio)}</span>}
                      {t.fecha_fin
                        ? <span className="flex items-center gap-1"><CircleCheck size={12} style={{ color: COLUMNAS[2].color }} /> {ddmm(t.fecha_fin)} · {dias(t.fecha_idea, t.fecha_fin)} días</span>
                        : <span className={`flex items-center gap-1 ${atraso > 7 ? 'font-semibold text-red-500' : ''}`}><Clock size={12} /> hace {atraso} días</span>}
                    </div>
                    <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {ix > 0 && (
                        <button type="button" onClick={() => mover(t, COLUMNAS[ix - 1].k)} aria-label="Volver a la columna anterior"
                          className="btn-press flex h-7 items-center rounded-md border border-line px-2 text-sub hover:text-ink"><ArrowLeft size={14} /></button>
                      )}
                      {col.boton && (
                        <button type="button" onClick={() => mover(t, COLUMNAS[ix + 1].k)}
                          className="btn-press flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink hover:border-violet-500/40">
                          {col.boton} <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>

      {editando && (
        <Editor tarea={editando} onCerrar={() => setEditando(null)} onBorrar={() => void borrar(editando.id)}
          onGuardar={(c) => { void guardar(editando.id, c); setEditando(null) }} />
      )}
    </Layout>
  )
}

function Editor({ tarea, onCerrar, onGuardar, onBorrar }: {
  tarea: Tarea
  onCerrar: () => void
  onGuardar: (c: Partial<Tarea>) => void
  onBorrar: () => void
}) {
  const [titulo, setTitulo] = useState(tarea.titulo)
  const [nota, setNota] = useState(tarea.nota ?? '')
  const [etiqueta, setEtiqueta] = useState(tarea.etiqueta)
  const [fIdea, setFIdea] = useState(tarea.fecha_idea)
  const [fIni, setFIni] = useState(tarea.fecha_inicio ?? '')
  const [fFin, setFFin] = useState(tarea.fecha_fin ?? '')
  const [err, setErr] = useState<string | null>(null)

  function aceptar() {
    if (!titulo.trim()) { setErr('El título no puede quedar vacío'); return }
    if (!fIdea) { setErr('Falta la fecha de la idea'); return }
    if (fIni && fIni < fIdea) { setErr('El inicio no puede ser antes de la idea'); return }
    if (fFin && fFin < (fIni || fIdea)) { setErr('El fin no puede ser antes del inicio'); return }
    const estado: Estado = fFin ? 'hecha' : fIni ? 'marcha' : 'idea'
    onGuardar({
      titulo: titulo.trim(), nota: nota.trim() || null, etiqueta, estado,
      fecha_idea: fIdea, fecha_inicio: fIni || (fFin ? fIdea : null), fecha_fin: fFin || null,
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-line bg-surface2 px-2 text-sm text-ink'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onCerrar}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-[var(--surface-solid)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Editar tarjeta</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-sub hover:text-ink"><X size={20} /></button>
        </div>
        <label className="mb-1 block text-xs text-sub">Título</label>
        <input value={titulo} onChange={(e) => { setTitulo(e.target.value); setErr(null) }} className={campo} />
        <label className="mb-1 mt-3 block text-xs text-sub">Nota</label>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3}
          className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink" />
        <p className="mb-1 mt-3 text-xs text-sub">Etiqueta</p>
        <div className="flex flex-wrap gap-1">
          {Object.keys(ETIQUETAS).map((e) => (
            <button key={e} type="button" onClick={() => setEtiqueta(e)} aria-pressed={etiqueta === e}
              className={`rounded-md border px-1.5 py-0.5 text-xs ${etiqueta === e ? ETIQUETAS[e] + ' font-semibold' : 'border-line text-sub'}`}>
              {nombreEtiqueta(e)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div><label className="mb-1 block text-xs text-sub">Idea</label>
            <input type="date" value={fIdea} onChange={(e) => { setFIdea(e.target.value); setErr(null) }} className={campo} /></div>
          <div><label className="mb-1 block text-xs text-sub">Arrancó</label>
            <input type="date" value={fIni} onChange={(e) => { setFIni(e.target.value); setErr(null) }} className={campo} /></div>
          <div><label className="mb-1 block text-xs text-sub">Terminada</label>
            <input type="date" value={fFin} onChange={(e) => { setFFin(e.target.value); setErr(null) }} className={campo} /></div>
        </div>
        <p className="mt-1 text-[11px] text-sub/70">Sin fechas de inicio ni fin queda en Ideas; con inicio, En marcha; con fin, Hechas.</p>
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onBorrar} className="btn-press flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-500">
            <Trash2 size={15} /> Borrar
          </button>
          <button type="button" onClick={onCerrar} className="btn-press ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-sub">Cancelar</button>
          <button type="button" onClick={aceptar} className="btn-press rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white">Guardar</button>
        </div>
      </div>
    </div>
  )
}
