import { useCallback, useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Search, Store, User, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Carga horaria (27/11/2026).                               */
/*  Planilla semanal por local, como la de Excel que usaban los locales:*/
/*  tipo (puesto: LOCAL 1, 2… o PPP para planes) · legajo · por día     */
/*  entrada y salida con las horas abajo (vacío = franco; V/L en la     */
/*  entrada = vacaciones/licencia) · horas del contrato y cargadas.     */
/*  Apertura del local (días y horario) en rrhh_locales_apertura: en    */
/*  rojo quien entra después de abrir o sale antes de cerrar, y abajo   */
/*  cuántas personas hay al abrir y al cerrar.                          */
/*  Tablas: sql/rrhh_carga_horaria.sql. Permisos rrhh.horarios.view /  */
/*  .edit (rol rr_hh). Maqueta: mockups/carga-horaria.html.             */
/* ------------------------------------------------------------------ */

type Tipo = 'trabajo' | 'franco' | 'vacaciones' | 'licencia'
interface Carga { legajo: string; fecha: string; local: string | null; horario: string | null; horas: number; tipo: Tipo }
interface Emp { legajo: string; nombre: string; local: string; horasSem: number | null; plan: boolean; puesto: string }
interface Apertura { local: string; dias: string; abre: string; cierra: string }

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const APERTURA_DEF = { dias: 'lunes a domingos', abre: '10:00', cierra: '21:00' }
const LS_LOCAL = 'carga-horaria.local'

/* ---------- fechas (ISO yyyy-mm-dd, sin zonas) ---------- */
const pad = (n: number) => String(n).padStart(2, '0')
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay()
const lunesDe = (f: string) => sumarDias(f, -((dow(f) + 6) % 7))
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(Math.round(min % 60))}`
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** «10» → 10:00, «9:30» / «9.30» / «930» → 09:30. null = vacío, 'error' = no se entiende */
export function parsearHora(txt: string): string | null | 'error' {
  const t = txt.trim().toLowerCase().replace(/\s*hs?$/, '')
  if (!t) return null
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?$/) ?? t.match(/^(\d{1,2})(\d{2})$/)
  if (!m) return 'error'
  const h = Number(m[1]), mi = Number(m[2] ?? 0)
  return h <= 24 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : 'error'
}
const duracion = (ent: string, sal: string) => { let d = aMin(sal) - aMin(ent); if (d <= 0) d += 1440; return d }
/** Tramos guardados en `horario` («10:00-14:00 17:00-21:00»); dos = turno cortado */
function tramos(c: Carga | undefined): [string, string][] {
  if (c?.tipo !== 'trabajo' || !c.horario) return []
  return [...c.horario.matchAll(/(\d{2}:\d{2})-(\d{2}:\d{2})/g)].map((m) => [m[1], m[2]] as [string, string])
}

/** Local del legajo: el lugar, o el sector cuando el lugar dice LOCALES */
function localDe(lugar: string | null, sector: string | null): string {
  const l = (lugar || '').trim().toUpperCase()
  if (l && l !== 'LOCALES') return l
  return (sector || '').trim().toUpperCase() || 'SIN LOCAL'
}

/* ------------------------------------------------------------------ */

interface DiaProps {
  emp: Emp
  fecha: string
  carga: Carga | undefined
  apertura: Apertura
  editable: boolean
  r: number
  d: number
  onGuardar: (emp: Emp, fecha: string, c: Omit<Carga, 'legajo' | 'fecha' | 'local'> | null) => Promise<boolean>
}

/** Un día de una persona: entrada | salida (y un segundo tramo si es turno cortado) y las horas abajo. */
function Dia({ emp, fecha, carga, apertura, editable, r, d, onGuardar }: DiaProps) {
  const tr = tramos(carga)
  const [e0, s0] = tr[0] ?? ['', '']
  const [e1, s1] = tr[1] ?? ['', '']
  const marca = carga?.tipo === 'vacaciones' ? 'V' : carga?.tipo === 'licencia' ? 'L' : ''
  const [ent, setEnt] = useState(marca || e0)
  const [sal, setSal] = useState(s0)
  const [ent2, setEnt2] = useState(e1)
  const [sal2, setSal2] = useState(s1)
  const [cortado, setCortado] = useState(!!e1)
  const [estado, setEstado] = useState<'ok' | 'error' | 'falta' | 'guardando'>('ok')
  const reset = useCallback(() => {
    setEnt(marca || e0); setSal(s0); setEnt2(e1); setSal2(s1); setCortado(!!e1); setEstado('ok')
  }, [marca, e0, s0, e1, s1])
  useEffect(() => { reset() }, [reset])

  async function confirmar() {
    const e = ent.trim().toLowerCase()
    if (e === 'v' || e === 'l' || e === 'f') {
      setEstado('guardando')
      const ok = await onGuardar(emp, fecha, e === 'f' ? null : { tipo: e === 'v' ? 'vacaciones' : 'licencia', horario: null, horas: 0 })
      setEstado(ok ? 'ok' : 'error')
      return
    }
    const pares = [[parsearHora(ent), parsearHora(sal)], [parsearHora(ent2), parsearHora(sal2)]]
    if (pares.some(([a, b]) => a === 'error' || b === 'error')) { setEstado('error'); return }
    if (pares.some(([a, b]) => !!a !== !!b)) { setEstado('falta'); return }
    const validos = pares.filter(([a, b]) => a && b) as [string, string][]
    if (!validos.length) {
      if (carga) { setEstado('guardando'); setEstado((await onGuardar(emp, fecha, null)) ? 'ok' : 'error') }
      else { setCortado(false); setEstado('ok') }
      return
    }
    const horario = validos.map(([a, b]) => `${a}-${b}`).join(' ')
    if (horario === carga?.horario) { setEstado('ok'); return }
    setEstado('guardando')
    const min = validos.reduce((t, [a, b]) => t + duracion(a, b), 0)
    const ok = await onGuardar(emp, fecha, { tipo: 'trabajo', horario, horas: Math.round((min / 60) * 100) / 100 })
    setEstado(ok ? 'ok' : 'error')
  }

  function teclas(ev: KeyboardEvent<HTMLInputElement>, c: number | null) {
    const ir = (dr: number, dc: number) => {
      if (c == null) return
      const el = document.querySelector<HTMLInputElement>(`input[data-hr="${r + dr}"][data-hc="${c + dc}"]`)
      if (el) { ev.preventDefault(); el.focus(); el.select() }
    }
    const v = ev.currentTarget.value
    if (ev.key === 'Enter') ir(0, 1)
    else if (ev.key === 'Escape') reset()
    else if (ev.key === 'ArrowDown') ir(1, 0)
    else if (ev.key === 'ArrowUp') ir(-1, 0)
    else if (ev.key === 'ArrowRight' && ev.currentTarget.selectionStart === v.length) ir(0, 1)
    else if (ev.key === 'ArrowLeft' && ev.currentTarget.selectionStart === 0) ir(0, -1)
  }
  // Se guarda cuando el foco sale del día (no al pasar de un casillero a otro del mismo día)
  const salir = (ev: FocusEvent<HTMLDivElement>) => {
    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) void confirmar()
  }

  const franco = !carga || carga.tipo === 'franco'
  const especial = carga?.tipo === 'vacaciones' || carga?.tipo === 'licencia'
  const fondo = especial
    ? carga!.tipo === 'vacaciones' ? 'bg-teal-500/15' : 'bg-amber-500/15'
    : franco ? (emp.plan ? 'bg-emerald-500/10' : 'bg-sky-500/15') : ''
  const pie = especial
    ? carga!.tipo === 'vacaciones' ? 'Vacaciones' : 'Licencia'
    : franco ? (estado === 'falta' ? 'falta un horario' : 'Franco') : hhmm(carga!.horas * 60)
  const ultimaSal = tr.length ? tr[tr.length - 1][1] : ''
  const rojoEnt = !!e0 && e0 > apertura.abre
  const rojoSal = (s: string) => !!s && s === ultimaSal && s < apertura.cierra
  const input = 'h-8 w-full min-w-0 bg-transparent text-center text-[13px] tabular-nums outline-none focus:bg-surface-solid focus:ring-1 focus:ring-sky-500'
  const anillo = estado === 'error' ? 'ring-1 ring-red-500' : estado === 'falta' ? 'ring-1 ring-amber-500' : ''
  const titulo = estado === 'error' ? 'Hora no válida: probá 10, 10:30 o 17 (o V / L en la entrada)' : estado === 'falta' ? 'Falta la entrada o la salida' : undefined
  const par = (
    a: string, b: string, setA: (v: string) => void, setB: (v: string) => void,
    cA: number | null, rojoA: boolean, rojoB: boolean, segundo = false,
  ) => (
    <div className={`grid grid-cols-2 divide-x divide-line ${segundo ? 'border-t border-dashed border-line' : ''}`}>
      <input
        value={a} readOnly={!editable} aria-label={`${segundo ? 'Segunda entrada' : 'Entrada'} ${emp.nombre} ${fecha}`} placeholder={editable && (franco || segundo) ? '–' : ''}
        onChange={(e) => { setA(e.target.value); setEstado('ok') }} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => teclas(e, cA)} data-hr={cA != null ? r : undefined} data-hc={cA != null ? cA : undefined}
        className={`${input} ${rojoA ? 'font-semibold text-red-400' : 'text-ink'} placeholder:text-sub/40`}
      />
      <input
        value={b} readOnly={!editable} aria-label={`${segundo ? 'Segunda salida' : 'Salida'} ${emp.nombre} ${fecha}`} placeholder={editable && (franco || segundo) ? '–' : ''}
        onChange={(e) => { setB(e.target.value); setEstado('ok') }} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => teclas(e, cA != null ? cA + 1 : null)} data-hr={cA != null ? r : undefined} data-hc={cA != null ? cA + 1 : undefined}
        className={`${input} ${rojoB ? 'font-semibold text-red-400' : 'text-ink'} placeholder:text-sub/40`}
      />
    </div>
  )

  return (
    <div onBlur={salir} className={`group/dia overflow-hidden rounded-lg border border-line ${fondo} ${anillo} ${estado === 'guardando' ? 'opacity-60' : ''}`} title={titulo}>
      {especial ? (
        <input
          value={ent} readOnly={!editable} aria-label={`${emp.nombre} ${fecha}`}
          onChange={(e) => { setEnt(e.target.value); setEstado('ok') }} onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => teclas(e, d * 2)} data-hr={r} data-hc={d * 2}
          className={`${input} font-bold ${carga!.tipo === 'vacaciones' ? 'text-teal-500' : 'text-amber-500'}`}
        />
      ) : (
        <>
          {par(ent, sal, setEnt, setSal, d * 2, rojoEnt, rojoSal(s0))}
          {cortado && par(ent2, sal2, setEnt2, setSal2, null, false, rojoSal(s1), true)}
        </>
      )}
      <div className={`flex items-center justify-center gap-1 border-t border-line py-0.5 text-center text-[11px] tabular-nums ${franco || especial ? 'text-sub' : emp.plan ? 'bg-emerald-500/10 text-ink' : 'bg-sky-500/10 text-ink'} ${estado === 'falta' ? 'text-amber-500' : ''}`}>
        {pie}
        {editable && !especial && !cortado && (
          <button
            type="button" onClick={() => setCortado(true)} tabIndex={-1}
            className="rounded px-1 text-[10px] leading-none text-sub opacity-0 transition hover:text-sky-500 focus:opacity-100 group-hover/dia:opacity-100"
            title="Agregar un segundo tramo (turno cortado)" aria-label="Agregar turno cortado"
          >
            + tramo
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export default function CargaHoraria() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('rrhh.horarios.edit')
  const hoy = new Date()
  const hoyIso = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`
  const [lunes, setLunes] = useState(() => lunesDe(hoyIso))
  const [vista, setVista] = useState<'local' | 'legajo'>('local')
  const [emps, setEmps] = useState<Emp[]>([])
  const [cargas, setCargas] = useState<Map<string, Carga>>(new Map())
  const [aperturas, setAperturas] = useState<Map<string, Apertura>>(new Map())
  const [local, setLocal] = useState<string>(() => { try { return localStorage.getItem(LS_LOCAL) ?? '' } catch { return '' } })
  const [legajo, setLegajo] = useState('')
  const [busca, setBusca] = useState('')
  const [editAp, setEditAp] = useState<Apertura | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const fechas = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes])
  const domingo = fechas[6]

  // Empleados activos con legajo; puesto = LOCAL 1, 2… (por horas y nombre) o PPP si es plan
  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('empleados')
      .select('legajo,nombre,lugar,area_sector,horas,estado_legajo')
      .not('legajo', 'is', null)
      .or('estado_legajo.in.("NOMINA ACTIVA","PLANES ACTIVOS"),estado_legajo.is.null')
      .order('nombre')
      .range(0, 1999)
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); return }
        type Fila = { legajo: string; nombre: string; lugar: string | null; area_sector: string | null; horas: number | string | null; estado_legajo: string | null }
        const base = ((data as Fila[] | null) ?? []).map((f) => ({
          legajo: String(f.legajo).trim(),
          nombre: f.nombre,
          local: localDe(f.lugar, f.area_sector),
          horasSem: f.horas == null || f.horas === '' ? null : Number(f.horas),
          plan: (f.estado_legajo || '').toUpperCase() === 'PLANES ACTIVOS',
          puesto: '',
        }))
        base.sort((a, b) => a.local.localeCompare(b.local) || Number(a.plan) - Number(b.plan) || (b.horasSem ?? 0) - (a.horasSem ?? 0) || a.nombre.localeCompare(b.nombre))
        const n = new Map<string, number>()
        for (const e of base) {
          if (e.plan) { e.puesto = 'PPP'; continue }
          const k = (n.get(e.local) ?? 0) + 1
          n.set(e.local, k)
          e.puesto = `${e.local} ${k}`
        }
        setEmps(base)
      })
    void supabase.from('rrhh_locales_apertura').select('local,dias,abre,cierra').then(({ data }) => {
      setAperturas(new Map(((data as Apertura[] | null) ?? []).map((a) => [a.local, a])))
    })
  }, [])

  // Semana mostrada + la anterior (para «Copiar semana anterior»)
  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const todas: Carga[] = []
    for (let p = 0; ; p += 1000) {
      const { data, error: e } = await sb.from('rrhh_carga_horaria').select('legajo,fecha,local,horario,horas,tipo')
        .gte('fecha', sumarDias(lunes, -7)).lte('fecha', domingo).order('id').range(p, p + 999)
      if (e) { setError(e.message); break }
      const filas = (data as Carga[] | null) ?? []
      todas.push(...filas.map((f) => ({ ...f, horas: Number(f.horas) })))
      if (filas.length < 1000) break
    }
    setCargas(new Map(todas.map((c) => [`${c.legajo}|${c.fecha}`, c])))
    setCargando(false)
  }, [lunes, domingo])
  useEffect(() => { void cargar() }, [cargar])

  const locales = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of emps) m.set(e.local, (m.get(e.local) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [emps])
  useEffect(() => {
    if (locales.length && !locales.some(([l]) => l === local)) setLocal(locales[0][0])
  }, [locales, local])
  useEffect(() => { try { if (local) localStorage.setItem(LS_LOCAL, local) } catch { /* sin storage */ } }, [local])

  const empLegajo = useMemo(() => emps.find((e) => e.legajo === legajo), [emps, legajo])
  const personas = useMemo(
    () => (vista === 'local' ? emps.filter((e) => e.local === local) : empLegajo ? [empLegajo] : []),
    [vista, emps, local, empLegajo],
  )
  const localVista = vista === 'local' ? local : empLegajo?.local ?? ''
  const apertura: Apertura = aperturas.get(localVista) ?? { local: localVista, ...APERTURA_DEF }

  const guardar = useCallback(async (emp: Emp, fecha: string, c: Omit<Carga, 'legajo' | 'fecha' | 'local'> | null): Promise<boolean> => {
    if (!supabase) return false
    const { error: e } = c
      ? await supabase.from('rrhh_carga_horaria').upsert(
        { legajo: emp.legajo, fecha, local: emp.local, ...c, actualizado_at: new Date().toISOString() },
        { onConflict: 'legajo,fecha' },
      )
      : await supabase.from('rrhh_carga_horaria').delete().eq('legajo', emp.legajo).eq('fecha', fecha)
    if (e) { setError(e.message); return false }
    setCargas((prev) => {
      const n = new Map(prev)
      const k = `${emp.legajo}|${fecha}`
      if (c) n.set(k, { legajo: emp.legajo, fecha, local: emp.local, ...c })
      else n.delete(k)
      return n
    })
    return true
  }, [])

  async function copiarSemanaAnterior() {
    if (!supabase) return
    setAviso(null)
    const filas = []
    for (const emp of personas) {
      for (const f of fechas) {
        if (cargas.has(`${emp.legajo}|${f}`)) continue
        const src = cargas.get(`${emp.legajo}|${sumarDias(f, -7)}`)
        if (src) filas.push({ legajo: emp.legajo, fecha: f, local: emp.local, horario: src.horario, horas: src.horas, tipo: src.tipo, actualizado_at: new Date().toISOString() })
      }
    }
    if (!filas.length) { setAviso('No había nada para copiar (la semana anterior está vacía o esta ya está cargada).'); return }
    const { error: e } = await supabase.from('rrhh_carga_horaria').upsert(filas, { onConflict: 'legajo,fecha' })
    if (e) { setError(e.message); return }
    setAviso(`Se copiaron ${filas.length} días de la semana anterior.`)
    await cargar()
  }

  async function guardarApertura() {
    if (!supabase || !editAp) return
    const abre = parsearHora(editAp.abre), cierra = parsearHora(editAp.cierra)
    if (!abre || !cierra || abre === 'error' || cierra === 'error') { setError('Horario de apertura no válido (ej.: 10 y 21).'); return }
    const fila = { local: editAp.local, dias: editAp.dias.trim() || APERTURA_DEF.dias, abre, cierra, actualizado_at: new Date().toISOString() }
    const { error: e } = await supabase.from('rrhh_locales_apertura').upsert(fila, { onConflict: 'local' })
    if (e) { setError(e.message); return }
    setAperturas((prev) => new Map(prev).set(fila.local, fila))
    setEditAp(null)
  }

  const minutosDe = (leg: string) => fechas.reduce((s, f) => s + (cargas.get(`${leg}|${f}`)?.horas ?? 0) * 60, 0)
  const contratoTotal = personas.reduce((s, e) => s + (e.horasSem ?? 0), 0)
  const enHora = (f: string, h: string) => personas.filter((e) => {
    return tramos(cargas.get(`${e.legajo}|${f}`)).some(([a, b]) => a <= h && (b >= h || b < a))
  }).length

  const legajosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return emps.filter((e) => e.nombre.toLowerCase().includes(q) || e.legajo.toLowerCase().includes(q)).slice(0, 12)
  }, [busca, emps])

  const hora = (h: string) => (h.endsWith(':00') ? String(Number(h.slice(0, 2))) : h)

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <CalendarClock size={22} className="text-sky-500" aria-hidden /> Carga horaria
        </h1>
        <p className="mt-1 text-sm text-sub">
          Planilla semanal por local. En cada día, <b className="text-ink">entrada</b> y <b className="text-ink">salida</b> (10, 10:30, 17…); vacío = franco.
          En la entrada también va <b className="text-ink">V</b> vacaciones o <b className="text-ink">L</b> licencia.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
          {([['local', 'Por local', Store], ['legajo', 'Por legajo', User]] as const).map(([v, t, Icono]) => (
            <button
              key={v} role="tab" aria-selected={vista === v}
              onClick={() => { setVista(v); setAviso(null) }}
              className={`btn-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${vista === v ? 'bg-sky-500 font-semibold text-white' : 'text-sub hover:text-ink'}`}
            >
              <Icono size={15} aria-hidden /> {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          <button onClick={() => { setLunes(sumarDias(lunes, -7)); setAviso(null) }} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Semana anterior"><ChevronLeft size={18} /></button>
          <span className="min-w-[11.5rem] text-center text-sm font-semibold text-ink">Semana del {ddmm(lunes)} al {ddmm(domingo)}</span>
          <button onClick={() => { setLunes(sumarDias(lunes, 7)); setAviso(null) }} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Semana siguiente"><ChevronRight size={18} /></button>
        </div>
        {lunes !== lunesDe(hoyIso) && (
          <button onClick={() => setLunes(lunesDe(hoyIso))} className="text-xs text-sky-500 hover:underline">Ir a esta semana</button>
        )}
        {puedeEditar && personas.length > 0 && (
          <button onClick={() => void copiarSemanaAnterior()} className="btn-press flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink hover:border-violet-500/50">
            <Copy size={14} className="text-violet-500" aria-hidden /> Copiar semana anterior
          </button>
        )}
      </div>

      {vista === 'local' ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {locales.map(([l, n]) => (
            <button
              key={l} onClick={() => { setLocal(l); setAviso(null) }} aria-pressed={local === l}
              className={`btn-press rounded-lg border px-2.5 py-1 text-xs transition ${local === l ? 'border-sky-500/60 bg-sky-500/15 font-semibold text-sky-500' : 'border-line bg-surface text-sub hover:text-ink'}`}
            >
              {l} <span className="opacity-60">· {n}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="relative mb-3 max-w-md">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-sub" aria-hidden />
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder={empLegajo ? `${empLegajo.legajo} · ${empLegajo.nombre}` : 'Buscar por nombre o legajo'}
            aria-label="Buscar empleado"
            className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2 text-sm text-ink"
          />
          {legajosFiltrados.length > 0 && (
            <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-solid shadow-lg">
              {legajosFiltrados.map((e) => (
                <li key={e.legajo}>
                  <button onClick={() => { setLegajo(e.legajo); setBusca(''); setAviso(null) }} className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-sky-500/10">
                    <span><span className="tabular-nums text-sub">{e.legajo}</span> <span className="text-ink">{e.nombre}</span></span>
                    <span className="text-xs text-sub">{e.local}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      {aviso && <p className="mb-3 text-sm text-emerald-500">{aviso}</p>}

      {vista === 'legajo' && !empLegajo ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Buscá una persona, o tocá un nombre en la vista «Por local».</p>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-3">
          {/* Cabecera: apertura · local y semana · carga total */}
          <div className="mb-3 flex flex-wrap items-stretch gap-2">
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-sub/70">Apertura</p>
              {editAp ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                  <input value={editAp.dias} onChange={(e) => setEditAp({ ...editAp, dias: e.target.value })} aria-label="Días que abre" className="h-8 w-36 rounded-lg border border-line bg-surface px-2 text-ink" />
                  <input value={editAp.abre} onChange={(e) => setEditAp({ ...editAp, abre: e.target.value })} aria-label="Abre" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center text-ink" />
                  <span className="text-sub">a</span>
                  <input value={editAp.cierra} onChange={(e) => setEditAp({ ...editAp, cierra: e.target.value })} aria-label="Cierra" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center text-ink" />
                  <button onClick={() => void guardarApertura()} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10" aria-label="Guardar apertura"><Check size={16} /></button>
                  <button onClick={() => setEditAp(null)} className="rounded-lg p-1.5 text-sub hover:bg-surface" aria-label="Cancelar"><X size={16} /></button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ink">
                  {apertura.dias} · <span className="rounded-md bg-amber-500/15 px-1.5 font-semibold text-amber-500">{hora(apertura.abre)} a {hora(apertura.cierra)} hs</span>
                  {puedeEditar && (
                    <button onClick={() => setEditAp({ ...apertura })} className="rounded p-1 text-sub hover:text-ink" aria-label="Cambiar la apertura del local"><Pencil size={13} /></button>
                  )}
                </p>
              )}
            </div>
            <div className="flex min-w-[12rem] flex-1 flex-col items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-center">
              <p className="font-display text-lg font-semibold text-ink">{vista === 'local' ? localVista : `${empLegajo!.nombre} · ${localVista}`}</p>
              <p className="text-xs text-sub">semana del {ddmm(lunes)}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-right">
              <p className="text-[11px] uppercase tracking-wider text-sub/70">Carga total horaria</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{hhmm(contratoTotal * 60)}</p>
            </div>
          </div>

          {cargando && !cargas.size ? (
            <p className="flex items-center gap-2 py-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[68rem] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider">
                    <th className="sticky left-0 z-10 w-28 bg-surface-solid px-2 py-1.5 text-left font-medium text-sub">Tipo</th>
                    <th className="sticky left-28 z-10 w-40 bg-surface-solid px-2 py-1.5 text-left font-medium text-sub">Legajo</th>
                    {fechas.map((f, i) => (
                      <th key={f} className={`rounded-lg px-1 py-1.5 font-semibold ${f === hoyIso ? 'bg-sky-500/20 text-sky-500' : 'bg-rose-500/15 text-rose-400'}`}>
                        {DIAS[i]} <span className="font-normal opacity-70">{ddmm(f)}</span>
                        <div className="mt-0.5 grid grid-cols-2 text-[9px] font-normal normal-case tracking-normal opacity-70"><span>entrada</span><span>salida</span></div>
                      </th>
                    ))}
                    <th className="w-24 rounded-lg bg-rose-500/15 px-2 py-1.5 font-semibold text-rose-400">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((e, r) => {
                    const cargadas = minutosDe(e.legajo)
                    const contrato = e.horasSem == null ? null : e.horasSem * 60
                    const cumple = contrato != null && Math.abs(cargadas - contrato) < 1
                    return (
                      <tr key={e.legajo}>
                        <td className={`sticky left-0 z-10 bg-surface-solid px-2 text-center text-[11px] font-bold ${e.plan ? 'text-emerald-500' : 'text-sky-500'}`}>{e.puesto}</td>
                        <td className="sticky left-28 z-10 bg-surface-solid px-1">
                          <button
                            onClick={() => { setLegajo(e.legajo); setVista('legajo'); setAviso(null) }}
                            className={`w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold leading-tight text-ink hover:underline ${e.plan ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}
                            title="Ver solo a esta persona"
                          >
                            {e.nombre}
                            <span className="block text-[10px] font-normal text-sub tabular-nums">{e.legajo}</span>
                          </button>
                        </td>
                        {fechas.map((f, d) => (
                          <td key={f} className="align-top">
                            <Dia emp={e} fecha={f} carga={cargas.get(`${e.legajo}|${f}`)} apertura={apertura} editable={puedeEditar} r={r} d={d} onGuardar={guardar} />
                          </td>
                        ))}
                        <td className="align-top">
                          <div className="overflow-hidden rounded-lg border border-line text-center tabular-nums">
                            <div className="h-8 py-1.5 text-[13px] text-ink" title="Horas semanales del contrato">{e.horasSem == null ? '—' : String(e.horasSem).replace('.', ',')}</div>
                            <div
                              className={`border-t border-line py-0.5 text-[11px] font-bold ${contrato == null ? 'text-sub' : cumple ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-400'}`}
                              title="Horas cargadas en la semana"
                            >
                              {hhmm(cargadas)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {vista === 'local' && personas.length > 0 && (
                  <tfoot>
                    <tr className="text-[11px] text-sub">
                      <td colSpan={2} className="sticky left-0 z-10 bg-surface-solid px-2 py-1">Personas al abrir / al cerrar</td>
                      {fechas.map((f) => {
                        const a = enHora(f, apertura.abre), c = enHora(f, apertura.cierra)
                        return (
                          <td key={f} className={`rounded-lg bg-surface2 py-1 text-center tabular-nums ${!a || !c ? 'font-bold text-red-400' : ''}`}>{a} / {c}</td>
                        )
                      })}
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-sky-500/40 align-[-1px]" />franco</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-teal-500/40 align-[-1px]" />vacaciones</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-amber-500/40 align-[-1px]" />licencia</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-500/40 align-[-1px]" />PPP / plan</span>
        <span><b className="text-emerald-500">verde</b>: cargadas = contrato · <b className="text-red-400">rojo</b>: no coincide</span>
        <span><b className="text-red-400">hora en rojo</b>: entra después de abrir o sale antes de cerrar</span>
      </div>
    </Layout>
  )
}
