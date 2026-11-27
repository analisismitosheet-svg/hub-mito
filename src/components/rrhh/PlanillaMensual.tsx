import { useCallback, useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRightLeft, Check, ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Search, Store, Trash2, User, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  dow, ddmm, duracion, hhmm, iso, localDe, lunesDe, parsearHora, sumarDias, tramosDe,
  type Apertura, type Carga, type Emp, type Marcacion,
} from '@/lib/horarios'

/* ------------------------------------------------------------------ */
/*  Planilla horaria de RR. HH. (27/11/2026), con el estilo de la       */
/*  planilla de Excel de los locales: tipo (LOCAL 1, 2… o PPP) · legajo */
/*  · lunes a domingo con entrada / salida (dos tramos si es turno      */
/*  cortado) y las horas abajo.                                          */
/*  - modo «carga»: UN horario semanal por mes (el empleado hace lo     */
/*    mismo las 4 semanas). Cada día de la semana se guarda en todas    */
/*    sus fechas del mes (rrhh_carga_horaria sigue siendo por fecha);   */
/*    si alguna semana difiere (vacaciones, cambio) se marca con «•».   */
/*    Editable solo por admin y rol rr_hh.                              */
/*  - modo «marcaciones»: por semana, lo que fichó el reloj             */
/*    (rrhh_marcaciones) contra lo planificado ese día. Solo lectura.   */
/* ------------------------------------------------------------------ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const APERTURA_DEF = { dias: 'lunes a domingos', abre: '10:00', cierra: '21:00' }
const TOLERANCIA = 5 // minutos para marcar tarde / temprano
const LS_LOCAL = 'carga-horaria.local'

type Guardar = (emp: Emp, fecha: string, c: Omit<Carga, 'legajo' | 'fecha' | 'local'> | null) => Promise<boolean>

/* ---------------- celda de Carga horaria (editable) ---------------- */

interface DiaCargaProps { emp: Emp; fecha: string; carga: Carga | undefined; varia?: string; enOtro?: string; apertura: Apertura; editable: boolean; r: number; d: number; onGuardar: Guardar }

function DiaCarga({ emp, fecha, carga, varia, enOtro, apertura, editable, r, d, onGuardar }: DiaCargaProps) {
  const tr = carga?.tipo === 'trabajo' ? tramosDe(carga.horario) : []
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
    if (!editable) return
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
    : franco ? (enOtro ? 'bg-surface2' : emp.plan ? 'bg-emerald-500/10' : 'bg-sky-500/15') : ''
  const pie = especial
    ? carga!.tipo === 'vacaciones' ? 'Vacac.' : 'Licencia'
    : franco ? (estado === 'falta' ? 'falta hora' : enOtro ? `en ${enOtro}` : 'Franco') : hhmm(carga!.horas * 60)
  const ultimaSal = tr.length ? tr[tr.length - 1][1] : ''
  const rojoSal = (s: string) => !!s && s === ultimaSal && s < apertura.cierra
  const input = 'h-7 w-full min-w-0 bg-transparent text-center text-[12px] tabular-nums outline-none focus:bg-surface-solid focus:ring-1 focus:ring-sky-500'
  const anillo = estado === 'error' ? 'ring-1 ring-red-500' : estado === 'falta' ? 'ring-1 ring-amber-500' : ''
  const titulo = estado === 'error' ? 'Hora no válida: probá 10, 10:30 o 17 (o V / L en la entrada)' : estado === 'falta' ? 'Falta la entrada o la salida' : undefined
  const par = (a: string, b: string, setA: (v: string) => void, setB: (v: string) => void, cA: number | null, rojoA: boolean, rojoB: boolean, segundo = false) => (
    <div className={`grid grid-cols-2 divide-x divide-line ${segundo ? 'border-t border-dashed border-line' : ''}`}>
      <input
        value={a} readOnly={!editable} aria-label={`${segundo ? 'Segunda entrada' : 'Entrada'} ${emp.nombre} ${fecha}`} placeholder={editable && (franco || segundo) ? '–' : ''}
        onChange={(e) => { setA(e.target.value); setEstado('ok') }} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => teclas(e, cA)} data-hr={cA != null ? r : undefined} data-hc={cA != null ? cA : undefined}
        className={`${input} ${rojoA ? 'font-semibold text-red-400' : 'text-ink'} placeholder:text-sub/40 ${editable ? '' : 'cursor-default'}`}
      />
      <input
        value={b} readOnly={!editable} aria-label={`${segundo ? 'Segunda salida' : 'Salida'} ${emp.nombre} ${fecha}`} placeholder={editable && (franco || segundo) ? '–' : ''}
        onChange={(e) => { setB(e.target.value); setEstado('ok') }} onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => teclas(e, cA != null ? cA + 1 : null)} data-hr={cA != null ? r : undefined} data-hc={cA != null ? cA + 1 : undefined}
        className={`${input} ${rojoB ? 'font-semibold text-red-400' : 'text-ink'} placeholder:text-sub/40 ${editable ? '' : 'cursor-default'}`}
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
          {par(ent, sal, setEnt, setSal, d * 2, !!e0 && e0 > apertura.abre, rojoSal(s0))}
          {cortado && par(ent2, sal2, setEnt2, setSal2, null, false, rojoSal(s1), true)}
        </>
      )}
      <div className={`flex items-center justify-center gap-1 border-t border-line py-0.5 text-center text-[10px] tabular-nums ${franco || especial ? 'text-sub' : emp.plan ? 'bg-emerald-500/10 text-ink' : 'bg-sky-500/10 text-ink'} ${estado === 'falta' ? 'text-amber-500' : ''}`}>
        {pie}
        {varia && <span className="font-bold text-amber-500" title={varia}>•</span>}
        {editable && !especial && !cortado && (
          <button
            type="button" onClick={() => setCortado(true)} tabIndex={-1}
            className="rounded px-0.5 leading-none text-sub opacity-0 transition hover:text-sky-500 focus:opacity-100 group-hover/dia:opacity-100"
            title="Agregar un segundo tramo (turno cortado)" aria-label="Agregar turno cortado"
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- celda de Marcaciones (solo lectura) ---------------- */

function DiaMarcas({ emp, marca, carga, pasado }: { emp: Emp; marca: Marcacion | undefined; carga: Carga | undefined; pasado: boolean }) {
  const plan = carga?.tipo === 'trabajo' ? tramosDe(carga.horario) : []
  const tr = tramosDe(marca?.horario)
  const sueltas = marca?.incompleta ? (marca.marcas ?? '').split(' ').filter(Boolean).slice(tr.length * 2) : []
  const planTxt = carga
    ? carga.tipo === 'trabajo' ? `Planificado: ${carga.horario ?? `${carga.horas} h`}` : `Planificado: ${carga.tipo}`
    : 'Sin horario planificado'
  const tarde = !!(plan.length && tr.length && aMinSeguro(tr[0][0]) > aMinSeguro(plan[0][0]) + TOLERANCIA)
  const temprano = !!(plan.length && tr.length && aMinSeguro(tr[tr.length - 1][1]) < aMinSeguro(plan[plan.length - 1][1]) - TOLERANCIA)
  const ausente = pasado && plan.length > 0 && !marca
  const sinPlan = !!marca && !plan.length
  const fondo = ausente ? 'bg-red-500/15' : carga?.tipo === 'vacaciones' ? 'bg-teal-500/15' : carga?.tipo === 'licencia' ? 'bg-amber-500/15'
    : !marca ? (emp.plan ? 'bg-emerald-500/10' : 'bg-sky-500/15') : sinPlan ? 'bg-violet-500/10' : ''
  const celda = 'h-7 text-center text-[12px] leading-7 tabular-nums'
  const pie = marca ? hhmm(marca.horas * 60)
    : ausente ? 'Ausente' : carga?.tipo === 'vacaciones' ? 'Vacac.' : carga?.tipo === 'licencia' ? 'Licencia' : plan.length ? plan.map(([a, b]) => `${a}-${b}`.replace(/:00/g, '')).join(' ') : 'Franco'
  const detalle = [planTxt, marca?.marcas ? `Fichadas: ${marca.marcas}` : null, marca?.incompleta ? 'Falta una fichada' : null, tarde ? 'Entró tarde' : null, temprano ? 'Salió temprano' : null]
    .filter(Boolean).join(' · ')

  return (
    <div className={`overflow-hidden rounded-lg border ${marca?.incompleta ? 'border-amber-500/70' : 'border-line'} ${fondo}`} title={detalle}>
      {tr.length || sueltas.length ? (
        [...tr, ...sueltas.map((s) => [s, '?'] as [string, string])].map(([a, b], i) => (
          <div key={i} className={`grid grid-cols-2 divide-x divide-line ${i ? 'border-t border-dashed border-line' : ''}`}>
            <span className={`${celda} ${i === 0 && tarde ? 'font-semibold text-red-400' : 'text-ink'}`}>{a}</span>
            <span className={`${celda} ${b === '?' ? 'font-bold text-amber-500' : i === tr.length - 1 && temprano ? 'font-semibold text-red-400' : 'text-ink'}`}>{b}</span>
          </div>
        ))
      ) : (
        <div className={`${celda} text-sub/50`}>–</div>
      )}
      <div className={`border-t border-line py-0.5 text-center text-[10px] tabular-nums ${ausente ? 'font-semibold text-red-400' : marca ? (emp.plan ? 'bg-emerald-500/10 text-ink' : 'bg-sky-500/10 text-ink') : 'text-sub'}`}>
        {pie}
      </div>
    </div>
  )
}
const aMinSeguro = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/* ------------------------------------------------------------------ */

interface Props {
  modo: 'carga' | 'marcaciones'
  /** Admin o rol rr_hh: puede modificar la carga horaria */
  puedeEditar: boolean
  /** Algo extra a la derecha de la barra (p. ej. «Subir Excel») */
  acciones?: ReactNode
  /** Cambia para volver a leer los datos (después de subir marcaciones) */
  recargar?: number
  /** Para el import de marcaciones: la lista de empleados */
  onEmpleados?: (emps: Emp[]) => void
}

/** Una columna de la planilla: en Carga horaria un día de la semana (todas sus fechas del mes); en Marcaciones una fecha. */
interface Columna { key: string; titulo: string; sub: string; fechas: string[]; fecha?: string }

interface Asig { id: number; legajo: string; local: string; desde: string; hasta: string | null }
const DESDE_SIEMPRE = '2000-01-01'

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const firma = (c: Carga | undefined) => (c ? `${c.tipo}|${c.horario ?? ''}|${c.horas}` : '')

export default function PlanillaMensual({ modo, puedeEditar, acciones, recargar = 0, onEmpleados }: Props) {
  const hoy = new Date()
  const hoyIso = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
  const [lunes, setLunes] = useState(() => lunesDe(hoyIso))
  const [vista, setVista] = useState<'local' | 'legajo'>('local')
  const [emps, setEmps] = useState<Emp[]>([])
  const [cargas, setCargas] = useState<Map<string, Carga>>(new Map())
  const [marcas, setMarcas] = useState<Map<string, Marcacion>>(new Map())
  const [feriados, setFeriados] = useState<Map<string, string>>(new Map())
  const [aperturas, setAperturas] = useState<Map<string, Apertura>>(new Map())
  const [local, setLocal] = useState<string>(() => { try { return localStorage.getItem(LS_LOCAL) ?? '' } catch { return '' } })
  const [legajo, setLegajo] = useState('')
  const [busca, setBusca] = useState('')
  const [editAp, setEditAp] = useState<Apertura | null>(null)
  const [cargando, setCargando] = useState(true)
  const [copiando, setCopiando] = useState(false)
  const [asig, setAsig] = useState<Asig[]>([])
  const [agregando, setAgregando] = useState(false)
  const [buscaAlta, setBuscaAlta] = useState('')
  const [eleccion, setEleccion] = useState<{ emp: Emp; otros: string[] } | null>(null)
  const [accion, setAccion] = useState<{ legajo: string; tipo: 'mover' | 'quitar'; destino?: string } | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const esCarga = modo === 'carga'
  const editable = esCarga && puedeEditar
  // Carga horaria: el mes entero. Marcaciones: la semana.
  const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  const desde = esCarga ? iso(anio, mes, 1) : lunes
  const hasta = esCarga ? iso(anio, mes, diasMes) : sumarDias(lunes, 6)

  const columnas: Columna[] = useMemo(() => {
    if (esCarga) {
      const fechasDe = (i: number) => {
        const out: string[] = []
        for (let d = 1; d <= diasMes; d++) { const f = iso(anio, mes, d); if ((dow(f) + 6) % 7 === i) out.push(f) }
        return out
      }
      return DIAS_SEMANA.map((t, i) => { const fs = fechasDe(i); return { key: t, titulo: t, sub: `×${fs.length}`, fechas: fs } })
    }
    return DIAS_SEMANA.map((t, i) => { const f = sumarDias(lunes, i); return { key: f, titulo: t, sub: ddmm(f), fechas: [f], fecha: f } })
  }, [esCarga, anio, mes, diasMes, lunes])

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
        const base: Emp[] = ((data as Fila[] | null) ?? []).map((f) => ({
          legajo: String(f.legajo).trim(),
          nombre: f.nombre,
          local: localDe(f.lugar, f.area_sector),
          horasSem: f.horas == null || f.horas === '' ? null : Number(f.horas),
          plan: (f.estado_legajo || '').toUpperCase() === 'PLANES ACTIVOS',
          puesto: '',
        }))
        setEmps(base)
        onEmpleados?.(base)
      })
    void leerAsig()
    void supabase.from('rrhh_locales_apertura').select('local,dias,abre,cierra').then(({ data }) => {
      setAperturas(new Map(((data as Apertura[] | null) ?? []).map((a) => [a.local, a])))
    })
  }, [onEmpleados])

  async function leerAsig() {
    if (!supabase) return
    const { data, error: e } = await supabase.from('rrhh_planilla_locales').select('id,legajo,local,desde,hasta').order('id')
    if (e) { setError(e.message); return }
    setAsig((data as Asig[] | null) ?? [])
  }

  async function leerTabla<T>(tabla: string, campos: string, ini: string, fin: string): Promise<T[]> {
    const out: T[] = []
    if (!supabase) return out
    for (let p = 0; ; p += 1000) {
      const { data, error: e } = await supabase.from(tabla).select(campos).gte('fecha', ini).lte('fecha', fin).order('id').range(p, p + 999)
      if (e) { setError(e.message); break }
      const filas = (data as T[] | null) ?? []
      out.push(...filas)
      if (filas.length < 1000) break
    }
    return out
  }

  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const [cs, ms] = await Promise.all([
      leerTabla<Carga>('rrhh_carga_horaria', 'legajo,fecha,local,horario,horas,tipo', desde, hasta),
      esCarga ? Promise.resolve([] as Marcacion[]) : leerTabla<Marcacion>('rrhh_marcaciones', 'legajo,fecha,local,marcas,horario,horas,incompleta', desde, hasta),
    ])
    setCargas(new Map(cs.map((c) => [`${c.legajo}|${c.fecha}`, { ...c, horas: Number(c.horas) }])))
    setMarcas(new Map(ms.map((m) => [`${m.legajo}|${m.fecha}`, { ...m, horas: Number(m.horas) }])))
    const { data: fer } = await sb.from('objetivos_feriados').select('fecha,motivo').is('local', null).gte('fecha', desde).lte('fecha', hasta)
    setFeriados(new Map(((fer as { fecha: string; motivo: string | null }[] | null) ?? []).map((f) => [f.fecha, f.motivo || 'Feriado'])))
    setCargando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, esCarga])
  useEffect(() => { void cargar() }, [cargar, recargar])

  // Mes que manda para saber en qué local está cada legajo (en Marcaciones, el del lunes de la semana)
  const mesIni = esCarga ? iso(anio, mes, 1) : `${lunes.slice(0, 8)}01`
  const asigPorLegajo = useMemo(() => {
    const m = new Map<string, Asig[]>()
    for (const a of asig) m.set(a.legajo, [...(m.get(a.legajo) ?? []), a])
    return m
  }, [asig])
  /** Locales del legajo ese mes: los de rrhh_planilla_locales vigentes, o el de su legajo si nunca se tocó */
  const localesDe = useCallback((e: Emp): string[] => {
    const rs = asigPorLegajo.get(e.legajo)
    if (!rs) return [e.local]
    return [...new Set(rs.filter((a) => a.desde <= mesIni && (!a.hasta || a.hasta >= mesIni)).map((a) => a.local))]
  }, [asigPorLegajo, mesIni])
  /** Una fila por legajo y local (puede estar en dos), con el puesto LOCAL 1, 2… o PPP */
  const filas = useMemo(() => {
    const out: Emp[] = []
    for (const e of emps) for (const l of localesDe(e)) out.push({ ...e, local: l })
    out.sort((a, b) => a.local.localeCompare(b.local) || Number(a.plan) - Number(b.plan) || (b.horasSem ?? 0) - (a.horasSem ?? 0) || a.nombre.localeCompare(b.nombre))
    const n = new Map<string, number>()
    for (const e of out) {
      if (e.plan) { e.puesto = 'PPP'; continue }
      const k = (n.get(e.local) ?? 0) + 1
      n.set(e.local, k)
      e.puesto = `${e.local} ${k}`
    }
    return out
  }, [emps, localesDe])

  const locales = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of filas) m.set(e.local, (m.get(e.local) ?? 0) + 1)
    if (local && !m.has(local) && emps.length) m.set(local, 0)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filas, local, emps.length])
  useEffect(() => {
    if (locales.length && !local) setLocal(locales[0][0])
  }, [locales, local])
  useEffect(() => { try { if (local) localStorage.setItem(LS_LOCAL, local) } catch { /* sin storage */ } }, [local])

  const empLegajo = useMemo(() => filas.find((e) => e.legajo === legajo) ?? emps.find((e) => e.legajo === legajo), [filas, emps, legajo])
  const personas = useMemo(
    () => (vista === 'local' ? filas.filter((e) => e.local === local) : filas.filter((e) => e.legajo === legajo)),
    [vista, filas, local, legajo],
  )
  const localVista = vista === 'local' ? local : empLegajo?.local ?? ''
  const apertura: Apertura = aperturas.get(localVista) ?? { local: localVista, ...APERTURA_DEF }

  /** Horario del mes para un día de la semana: el que más se repite entre sus fechas (y las que difieren) */
  const plantilla = useCallback((emp: Emp, col: Columna): { carga: Carga | undefined; varia: string | undefined; enOtro?: string } => {
    const leg = emp.legajo
    const deOtro = (c: Carga | undefined) => !!c?.local && c.local !== emp.local
    const clave = (c: Carga | undefined) => (deOtro(c) ? `otro:${c!.local}` : firma(c))
    const cuenta = new Map<string, { n: number; c: Carga | undefined }>()
    for (const f of col.fechas) {
      const c = cargas.get(`${leg}|${f}`)
      const k = clave(c)
      const x = cuenta.get(k) ?? { n: 0, c }
      x.n++
      cuenta.set(k, x)
    }
    const top = [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] ? -1 : 1))[0]
    if (!top) return { carga: undefined, varia: undefined }
    const otras = col.fechas.filter((f) => clave(cargas.get(`${leg}|${f}`)) !== top[0])
    const varia = otras.length
      ? `Distinto en ${otras.map((f) => { const c = cargas.get(`${leg}|${f}`); return `${ddmm(f)} (${c ? (deOtro(c) ? `en ${c.local}` : c.tipo === 'trabajo' ? c.horario : c.tipo) : 'franco'})` }).join(', ')}. Si lo cambiás, se pisa en todas las semanas.`
      : undefined
    if (top[0].startsWith('otro:')) return { carga: undefined, varia, enOtro: top[0].slice(5) }
    return { carga: top[1].c, varia }
  }, [cargas])

  /** Guarda el horario de un día de la semana en todas sus fechas del mes */
  const guardarColumna = useCallback(async (emp: Emp, fechas: string[], c: Omit<Carga, 'legajo' | 'fecha' | 'local'> | null): Promise<boolean> => {
    if (!supabase || !fechas.length) return false
    const { error: e } = c
      ? await supabase.from('rrhh_carga_horaria').upsert(
        fechas.map((fecha) => ({ legajo: emp.legajo, fecha, local: emp.local, ...c, actualizado_at: new Date().toISOString() })),
        { onConflict: 'legajo,fecha' },
      )
      : await supabase.from('rrhh_carga_horaria').delete().eq('legajo', emp.legajo).in('fecha', fechas)
    if (e) { setError(e.message); return false }
    setCargas((prev) => {
      const n = new Map(prev)
      for (const fecha of fechas) {
        const k = `${emp.legajo}|${fecha}`
        if (c) n.set(k, { legajo: emp.legajo, fecha, local: emp.local, ...c })
        else n.delete(k)
      }
      return n
    })
    return true
  }, [])

  /** Copia el horario semanal del mes anterior a las personas que este mes no tienen nada cargado */
  async function copiarMesAnterior() {
    if (!supabase) return
    setAviso(null); setCopiando(true)
    const d0 = new Date(anio, mes - 1, 1)
    const pa = d0.getFullYear(), pm = d0.getMonth()
    const pdias = new Date(Date.UTC(pa, pm + 1, 0)).getUTCDate()
    const previas = await leerTabla<Carga>('rrhh_carga_horaria', 'legajo,fecha,local,horario,horas,tipo', iso(pa, pm, 1), iso(pa, pm, pdias))
    // horario más repetido por legajo y día de la semana (sin vacaciones ni licencias puntuales)
    const cuenta = new Map<string, Map<string, { n: number; c: Carga }>>()
    for (const c of previas) {
      if (c.tipo !== 'trabajo') continue
      const k = `${c.legajo}|${(dow(c.fecha) + 6) % 7}`
      const m = cuenta.get(k) ?? new Map()
      const f = firma(c)
      m.set(f, { n: (m.get(f)?.n ?? 0) + 1, c })
      cuenta.set(k, m)
    }
    const filas = []
    for (const emp of personas) {
      if (columnas.some((col) => col.fechas.some((f) => cargas.has(`${emp.legajo}|${f}`)))) continue
      for (let i = 0; i < 7; i++) {
        const m = cuenta.get(`${emp.legajo}|${i}`)
        if (!m) continue
        const top = [...m.values()].sort((a, b) => b.n - a.n)[0].c
        for (const fecha of columnas[i].fechas) {
          filas.push({ legajo: emp.legajo, fecha, local: emp.local, horario: top.horario, horas: Number(top.horas), tipo: top.tipo, actualizado_at: new Date().toISOString() })
        }
      }
    }
    if (!filas.length) { setCopiando(false); setAviso('No había nada para copiar (el mes anterior está vacío o este mes ya tiene horarios).'); return }
    const { error: e } = await supabase.from('rrhh_carga_horaria').upsert(filas, { onConflict: 'legajo,fecha' })
    setCopiando(false)
    if (e) { setError(e.message); return }
    setAviso(`Se copió el horario de ${MESES[pm].toLowerCase()} a ${new Set(filas.map((f) => f.legajo)).size} personas.`)
    await cargar()
  }

  const diaAntes = (f: string) => sumarDias(f, -1)

  /** Si el legajo nunca se tocó, deja escrito que está en el local de su legajo desde siempre */
  async function asegurarBase(e: Emp): Promise<Asig[] | null> {
    const ya = asigPorLegajo.get(e.legajo)
    if (ya) return ya
    const { data, error: er } = await supabase!.from('rrhh_planilla_locales')
      .insert({ legajo: e.legajo, local: emps.find((x) => x.legajo === e.legajo)?.local ?? e.local, desde: DESDE_SIEMPRE }).select('id,legajo,local,desde,hasta')
    if (er) { setError(er.message); return null }
    return (data as Asig[]) ?? []
  }

  /** Saca el legajo del local desde este mes (las filas que empiezan este mes o después se borran) */
  async function cerrar(rs: Asig[], loc: string): Promise<boolean> {
    for (const a of rs.filter((x) => x.local === loc && (!x.hasta || x.hasta >= mesIni))) {
      const { error: er } = a.desde >= mesIni
        ? await supabase!.from('rrhh_planilla_locales').delete().eq('id', a.id)
        : await supabase!.from('rrhh_planilla_locales').update({ hasta: diaAntes(mesIni) }).eq('id', a.id)
      if (er) { setError(er.message); return false }
    }
    return true
  }

  async function agregarA(e: Emp, destino: string, mover: string[] = []) {
    if (!supabase) return
    setTrabajando(true); setError(null); setAviso(null)
    try {
      const rs = await asegurarBase(e)
      if (!rs) return
      for (const o of mover) {
        if (!(await cerrar(rs, o))) return
        // el horario cargado en el local viejo pasa al nuevo desde este mes
        const { error: er } = await supabase.from('rrhh_carga_horaria').update({ local: destino }).eq('legajo', e.legajo).eq('local', o).gte('fecha', mesIni)
        if (er) { setError(er.message); return }
      }
      const { error: er } = await supabase.from('rrhh_planilla_locales').insert({ legajo: e.legajo, local: destino, desde: mesIni })
      if (er) { setError(er.message); return }
      setAviso(mover.length
        ? `${e.nombre} pasó de ${mover.join(' y ')} a ${destino} desde ${MESES[Number(mesIni.slice(5, 7)) - 1].toLowerCase()}.`
        : `${e.nombre} se agregó a ${destino} desde ${MESES[Number(mesIni.slice(5, 7)) - 1].toLowerCase()}.`)
      setEleccion(null); setAgregando(false); setBuscaAlta(''); setAccion(null)
      await leerAsig(); await cargar()
    } finally { setTrabajando(false) }
  }

  async function quitarDe(e: Emp, loc: string) {
    if (!supabase) return
    setTrabajando(true); setError(null); setAviso(null)
    try {
      const rs = await asegurarBase(e)
      if (!rs || !(await cerrar(rs, loc))) return
      const { error: er } = await supabase.from('rrhh_carga_horaria').delete().eq('legajo', e.legajo).eq('local', loc).gte('fecha', mesIni)
      if (er) { setError(er.message); return }
      setAviso(`${e.nombre} ya no está en ${loc} desde ${MESES[Number(mesIni.slice(5, 7)) - 1].toLowerCase()} (se borró su horario en ese local).`)
      setAccion(null)
      await leerAsig(); await cargar()
    } finally { setTrabajando(false) }
  }

  /** Elegir un legajo para el local: si ya está en otro, pregunta mover o agregar */
  function elegirAlta(e: Emp) {
    const actuales = localesDe(e)
    if (actuales.includes(local)) { setAviso(`${e.nombre} ya está en ${local}.`); return }
    if (!actuales.length) { void agregarA(e, local); return }
    setEleccion({ emp: e, otros: actuales })
  }
  const candidatosAlta = useMemo(() => {
    const q = buscaAlta.trim().toLowerCase()
    if (!q) return []
    return emps.filter((e) => e.nombre.toLowerCase().includes(q) || e.legajo.toLowerCase().includes(q)).slice(0, 10)
  }, [buscaAlta, emps])

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

  function mover(delta: number) {
    setAviso(null)
    if (esCarga) {
      const d = new Date(anio, mes + delta, 1)
      setAnio(d.getFullYear()); setMes(d.getMonth())
    } else setLunes(sumarDias(lunes, 7 * delta))
  }
  const enActual = esCarga ? anio === hoy.getFullYear() && mes === hoy.getMonth() : lunes === lunesDe(hoyIso)
  const irActual = () => { setAnio(hoy.getFullYear()); setMes(hoy.getMonth()); setLunes(lunesDe(hoyIso)) }

  // Horas: Carga = semana tipo del mes contra el contrato semanal. Marcaciones = la semana planificada contra lo marcado.
  const horasSemanaTipo = (e: Emp) => columnas.reduce((s, col) => s + (plantilla(e, col).carga?.horas ?? 0), 0)
  const horasCarga = (leg: string) => columnas.reduce((s, col) => s + col.fechas.reduce((t, f) => t + (cargas.get(`${leg}|${f}`)?.horas ?? 0), 0), 0)
  const horasMarcas = (leg: string) => columnas.reduce((s, col) => s + (marcas.get(`${leg}|${col.fecha}`)?.horas ?? 0), 0)
  // «Ausente» solo hasta el último día que trajo el reloj (antes de subir el Excel no hay nada que comparar)
  const hastaMarcado = useMemo(() => [...marcas.values()].reduce((m, x) => (x.fecha > m ? x.fecha : m), ''), [marcas])
  const enHora = (col: Columna, h: string) => personas.filter((e) => {
    const tr = esCarga ? tramosDe(plantilla(e, col).carga?.horario) : tramosDe(marcas.get(`${e.legajo}|${col.fecha}`)?.horario)
    return tr.some(([a, b]) => a <= h && (b >= h || b < a))
  }).length

  const legajosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return emps.filter((e) => e.nombre.toLowerCase().includes(q) || e.legajo.toLowerCase().includes(q)).slice(0, 12)
  }, [busca, emps])

  const hora = (h: string) => (h.endsWith(':00') ? String(Number(h.slice(0, 2))) : h)
  const contratoTotal = personas.reduce((s, e) => s + (e.horasSem ?? 0), 0)
  const totalSemanaTipo = personas.reduce((s, e) => s + horasSemanaTipo(e), 0)
  const totalPlan = personas.reduce((s, e) => s + horasCarga(e.legajo), 0)
  const totalMarcado = personas.reduce((s, e) => s + horasMarcas(e.legajo), 0)
  const periodo = esCarga ? `${MESES[mes]} ${anio}` : `Semana del ${ddmm(lunes)} al ${ddmm(sumarDias(lunes, 6))}`

  return (
    <>
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
          <button onClick={() => mover(-1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label={esCarga ? 'Mes anterior' : 'Semana anterior'}><ChevronLeft size={18} /></button>
          <span className="min-w-[11.5rem] text-center text-sm font-semibold text-ink">{periodo}</span>
          <button onClick={() => mover(1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label={esCarga ? 'Mes siguiente' : 'Semana siguiente'}><ChevronRight size={18} /></button>
        </div>
        {!enActual && <button onClick={irActual} className="text-xs text-sky-500 hover:underline">{esCarga ? 'Ir a este mes' : 'Ir a esta semana'}</button>}
        {editable && personas.length > 0 && (
          <button
            onClick={() => void copiarMesAnterior()} disabled={copiando}
            className="btn-press flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink hover:border-violet-500/50 disabled:opacity-50"
            title="A las personas que este mes no tienen horario les copia el del mes anterior"
          >
            {copiando ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} className="text-violet-500" aria-hidden />} Copiar mes anterior
          </button>
        )}
        {editable && vista === 'local' && (
          <button
            onClick={() => { setAgregando((v) => !v); setEleccion(null); setBuscaAlta('') }}
            className={`btn-press flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition ${agregando ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-500' : 'border-line bg-surface text-ink hover:border-emerald-500/50'}`}
          >
            <UserPlus size={14} className="text-emerald-500" aria-hidden /> Agregar legajo
          </button>
        )}
        {acciones}
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
      {editable && agregando && vista === 'local' && (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="mb-2 text-sm text-ink">Agregar un legajo a <b>{local}</b> desde {MESES[Number(mesIni.slice(5, 7)) - 1].toLowerCase()}</p>
          {eleccion ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink">
                <b>{eleccion.emp.legajo} · {eleccion.emp.nombre}</b> está en <b className="text-amber-500">{eleccion.otros.join(' y ')}</b>.
              </span>
              <button disabled={trabajando} onClick={() => void agregarA(eleccion.emp, local, eleccion.otros)} className="btn-press flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                <ArrowRightLeft size={13} /> Mover a {local}
              </button>
              <button disabled={trabajando} onClick={() => void agregarA(eleccion.emp, local)} className="btn-press flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                <UserPlus size={13} /> Agregar (queda en los dos)
              </button>
              <button onClick={() => setEleccion(null)} className="text-xs text-sub hover:text-ink">Cancelar</button>
              {trabajando && <Loader2 size={14} className="animate-spin text-sub" />}
            </div>
          ) : (
            <div className="relative max-w-md">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-sub" aria-hidden />
              <input
                autoFocus value={buscaAlta} onChange={(e) => setBuscaAlta(e.target.value)} placeholder="Buscar por nombre o legajo"
                aria-label="Buscar legajo para agregar" className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2 text-sm text-ink"
              />
              {candidatosAlta.length > 0 && (
                <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-solid shadow-lg">
                  {candidatosAlta.map((e) => {
                    const ls = localesDe(e)
                    return (
                      <li key={e.legajo}>
                        <button onClick={() => elegirAlta(e)} className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-emerald-500/10">
                          <span><span className="tabular-nums text-sub">{e.legajo}</span> <span className="text-ink">{e.nombre}</span></span>
                          <span className={`text-xs ${ls.includes(local) ? 'text-emerald-500' : 'text-sub'}`}>{ls.length ? ls.join(' · ') : 'sin local'}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {!esCarga && !cargando && !marcas.size && (
        <p className="mb-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-sm text-ink">
          Todavía no hay marcaciones de esta semana.
        </p>
      )}

      {vista === 'legajo' && !empLegajo ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Buscá una persona, o tocá un nombre en la vista «Por local».</p>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-3">
          {/* Cabecera: apertura · local y período · totales */}
          <div className="mb-3 flex flex-wrap items-stretch gap-2">
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-sub/70">Apertura</p>
              {editAp ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                  <input value={editAp.dias} onChange={(e) => setEditAp({ ...editAp, dias: e.target.value })} aria-label="Días que abre" className="h-8 w-44 rounded-lg border border-line bg-surface px-2 text-ink" />
                  <input value={editAp.abre} onChange={(e) => setEditAp({ ...editAp, abre: e.target.value })} aria-label="Abre" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center text-ink" />
                  <span className="text-sub">a</span>
                  <input value={editAp.cierra} onChange={(e) => setEditAp({ ...editAp, cierra: e.target.value })} aria-label="Cierra" className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center text-ink" />
                  <button onClick={() => void guardarApertura()} className="rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-500/10" aria-label="Guardar apertura"><Check size={16} /></button>
                  <button onClick={() => setEditAp(null)} className="rounded-lg p-1.5 text-sub hover:bg-surface" aria-label="Cancelar"><X size={16} /></button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ink">
                  {apertura.dias} · <span className="rounded-md bg-amber-500/15 px-1.5 font-semibold text-amber-500">{hora(apertura.abre)} a {hora(apertura.cierra)} hs</span>
                  {editable && (
                    <button onClick={() => setEditAp({ ...apertura })} className="rounded p-1 text-sub hover:text-ink" aria-label="Cambiar la apertura del local"><Pencil size={13} /></button>
                  )}
                </p>
              )}
            </div>
            <div className="flex min-w-[12rem] flex-1 flex-col items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-center">
              <p className="font-display text-lg font-semibold text-ink">{vista === 'local' ? localVista : `${empLegajo!.nombre} · ${localVista}`}</p>
              <p className="text-xs text-sub">{esCarga ? `${periodo} · el mismo horario todas las semanas` : periodo}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-right">
              {esCarga ? (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-sub/70">Carga total horaria semanal</p>
                  <p className="text-lg font-semibold tabular-nums text-ink">{hhmm(totalSemanaTipo * 60)} <span className="text-xs font-normal text-sub">de {hhmm(contratoTotal * 60)} de contrato</span></p>
                </>
              ) : (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-sub/70">Horas marcadas en la semana</p>
                  <p className="text-lg font-semibold tabular-nums text-ink">{hhmm(totalMarcado * 60)} <span className="text-xs font-normal text-sub">de {hhmm(totalPlan * 60)} planificadas</span></p>
                </>
              )}
            </div>
          </div>

          {cargando && !cargas.size && !marcas.size ? (
            <p className="flex items-center gap-2 py-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
          ) : (
            <div className="overflow-x-auto pb-1">
              <table className="w-full min-w-[60rem] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr className="text-[11px]">
                    <th className="sticky left-0 z-20 w-[15.5rem] bg-surface-solid px-2 py-1.5 text-left font-medium text-sub">
                      <div className="flex items-end justify-between gap-2">
                        <span className="uppercase tracking-wider">Legajo</span>
                        <span className="w-[4.5rem] text-center text-[9px] font-normal normal-case leading-tight">horas semana<br />{esCarga ? 'contrato / cargadas' : 'planif. / marcadas'}</span>
                      </div>
                    </th>
                    {columnas.map((col) => {
                      const fer = col.fecha ? feriados.get(col.fecha) : undefined
                      const esHoy = col.fecha === hoyIso
                      return (
                        <th
                          key={col.key} title={fer}
                          className={`min-w-[6rem] rounded-lg px-1 py-1 font-semibold ${esHoy ? 'bg-sky-500/20 text-sky-500' : fer ? 'bg-orange-500/20 text-orange-500' : 'bg-rose-500/15 text-rose-400'}`}
                        >
                          {col.titulo} <span className="font-normal opacity-70">{col.sub}</span>
                          <div className="grid grid-cols-2 text-[9px] font-normal opacity-70"><span>entrada</span><span>salida</span></div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((e, r) => {
                    const arriba = esCarga ? e.horasSem : horasCarga(e.legajo)
                    const abajo = esCarga ? horasSemanaTipo(e) : horasMarcas(e.legajo)
                    const ok = arriba != null && Math.abs(abajo - arriba) < 0.5
                    return (
                      <tr key={`${e.legajo}|${e.local}`}>
                        <td className="sticky left-0 z-10 bg-surface-solid px-1 align-top">
                          <div className="flex gap-1">
                            <button
                              onClick={() => { setLegajo(e.legajo); setVista('legajo'); setAviso(null) }}
                              className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left leading-tight hover:underline ${e.plan ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}
                              title="Ver solo a esta persona"
                            >
                              <span className={`block text-[10px] font-bold ${e.plan ? 'text-emerald-500' : 'text-sky-500'}`}>{e.puesto}</span>
                              <span className="block text-[12px] font-semibold text-ink">{e.nombre}</span>
                              <span className="block text-[10px] tabular-nums text-sub">{e.legajo}</span>
                            </button>
                            {editable && vista === 'local' && (
                              <div className="flex shrink-0 flex-col gap-0.5 self-start">
                                <button onClick={() => setAccion({ legajo: e.legajo, tipo: 'mover' })} className="rounded p-1 text-sub hover:bg-sky-500/10 hover:text-sky-500" title="Mover a otro local" aria-label={`Mover ${e.nombre} a otro local`}><ArrowRightLeft size={13} /></button>
                                <button onClick={() => setAccion({ legajo: e.legajo, tipo: 'quitar' })} className="rounded p-1 text-sub hover:bg-red-500/10 hover:text-red-400" title={`Quitar de ${e.local}`} aria-label={`Quitar ${e.nombre} de ${e.local}`}><Trash2 size={13} /></button>
                              </div>
                            )}
                            <div className="w-[4.5rem] shrink-0 self-start overflow-hidden rounded-lg border border-line text-center tabular-nums">
                              <div className="py-1 text-[12px] text-ink" title={esCarga ? 'Horas semanales del contrato' : 'Horas planificadas en la semana'}>
                                {arriba == null ? '—' : esCarga ? String(arriba).replace('.', ',') : hhmm(arriba * 60)}
                              </div>
                              <div
                                className={`border-t border-line py-0.5 text-[11px] font-bold ${arriba == null ? 'text-sub' : ok ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-400'}`}
                                title={esCarga ? 'Horas cargadas en la semana' : 'Horas marcadas en la semana'}
                              >
                                {hhmm(abajo * 60)}
                              </div>
                            </div>
                          </div>
                          {accion?.legajo === e.legajo && (
                            <div className="mt-1 rounded-lg border border-line bg-surface2 p-1.5 text-[11px] text-ink">
                              {accion.tipo === 'quitar' ? (
                                <>
                                  <p>¿Quitar de {e.local} desde {MESES[Number(mesIni.slice(5, 7)) - 1].toLowerCase()}? Se borra su horario en este local.</p>
                                  <div className="mt-1 flex gap-1.5">
                                    <button disabled={trabajando} onClick={() => void quitarDe(e, e.local)} className="rounded bg-red-500 px-2 py-0.5 font-semibold text-white disabled:opacity-50">Quitar</button>
                                    <button onClick={() => setAccion(null)} className="rounded px-2 py-0.5 text-sub hover:text-ink">Cancelar</button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={accion.destino ?? ''} onChange={(ev) => setAccion({ ...accion, destino: ev.target.value })}
                                    className="h-7 w-full rounded border border-line bg-surface px-1 text-[11px] text-ink" aria-label="Local de destino"
                                  >
                                    <option value="">Mover a…</option>
                                    {locales.filter(([l]) => l !== e.local).map(([l]) => <option key={l} value={l}>{l}</option>)}
                                  </select>
                                  <div className="mt-1 flex gap-1.5">
                                    <button disabled={trabajando || !accion.destino} onClick={() => void agregarA(e, accion.destino!, [e.local])} className="rounded bg-sky-500 px-2 py-0.5 font-semibold text-white disabled:opacity-50">Mover</button>
                                    <button onClick={() => setAccion(null)} className="rounded px-2 py-0.5 text-sub hover:text-ink">Cancelar</button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                        {columnas.map((col, d) => {
                          if (esCarga) {
                            const { carga, varia, enOtro } = plantilla(e, col)
                            return (
                              <td key={col.key} className="align-top">
                                <DiaCarga
                                  emp={e} fecha={col.titulo} carga={carga} varia={varia} enOtro={enOtro} apertura={apertura} editable={editable} r={r} d={d}
                                  onGuardar={(emp, _f, c) => guardarColumna(emp, col.fechas, c)}
                                />
                              </td>
                            )
                          }
                          return (
                            <td key={col.key} className="align-top">
                              <DiaMarcas emp={e} marca={marcas.get(`${e.legajo}|${col.fecha}`)} carga={cargas.get(`${e.legajo}|${col.fecha}`)} pasado={!!col.fecha && col.fecha <= hastaMarcado} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                {vista === 'local' && personas.length > 0 && (
                  <tfoot>
                    <tr className="text-[11px] text-sub">
                      <td className="sticky left-0 z-10 bg-surface-solid px-2 py-1">Personas al abrir / al cerrar</td>
                      {columnas.map((col) => {
                        const a = enHora(col, apertura.abre), c = enHora(col, apertura.cierra)
                        return <td key={col.key} className={`rounded-lg bg-surface2 py-1 text-center tabular-nums ${!a || !c ? 'font-bold text-red-400' : ''}`}>{a} / {c}</td>
                      })}
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
        {esCarga ? (
          <>
            <span><b className="text-emerald-500">verde</b>: cargadas = contrato semanal · <b className="text-red-400">rojo</b>: no coincide</span>
            <span><b className="text-red-400">hora en rojo</b>: entra después de abrir o sale antes de cerrar</span>
            <span><b className="text-amber-500">•</b>: alguna semana del mes es distinta (pasá el mouse)</span>
            {!puedeEditar && <span>Solo el admin y RR. HH. pueden modificarla.</span>}
          </>
        ) : (
          <>
            <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-red-500/40 align-[-1px]" />ausente (tenía horario y no fichó)</span>
            <span><i className="mr-1 inline-block size-2.5 rounded-sm bg-violet-500/40 align-[-1px]" />fichó sin horario planificado</span>
            <span><b className="text-red-400">hora en rojo</b>: entró tarde o salió temprano (más de {TOLERANCIA} min)</span>
            <span><b className="text-amber-500">?</b>: falta una fichada</span>
          </>
        )}
      </div>
    </>
  )
}
