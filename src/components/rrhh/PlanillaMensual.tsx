import { useCallback, useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Search, Store, User, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  dow, ddmm, duracion, hhmm, iso, localDe, lunesDe, parsearHora, sumarDias, tramosDe,
  type Apertura, type Carga, type Emp, type Marcacion,
} from '@/lib/horarios'

/* ------------------------------------------------------------------ */
/*  Planilla mensual de RR. HH. (27/11/2026), con el estilo de la       */
/*  planilla de Excel de los locales: tipo (LOCAL 1, 2… o PPP) · legajo */
/*  · cada día del mes con entrada / salida (dos tramos si es turno     */
/*  cortado) y las horas abajo · total del mes.                          */
/*  - modo «carga»: Carga horaria, editable por admin y rol rr_hh.      */
/*  - modo «marcaciones»: lo que fichó el reloj (rrhh_marcaciones),     */
/*    solo lectura, comparado contra la carga horaria.                  */
/* ------------------------------------------------------------------ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const APERTURA_DEF = { dias: 'lunes a domingos', abre: '10:00', cierra: '21:00' }
const TOLERANCIA = 5 // minutos para marcar tarde / temprano
const LS_LOCAL = 'carga-horaria.local'

type Guardar = (emp: Emp, fecha: string, c: Omit<Carga, 'legajo' | 'fecha' | 'local'> | null) => Promise<boolean>

/* ---------------- celda de Carga horaria (editable) ---------------- */

interface DiaCargaProps { emp: Emp; fecha: string; carga: Carga | undefined; apertura: Apertura; editable: boolean; r: number; d: number; onGuardar: Guardar }

function DiaCarga({ emp, fecha, carga, apertura, editable, r, d, onGuardar }: DiaCargaProps) {
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
    : franco ? (emp.plan ? 'bg-emerald-500/10' : 'bg-sky-500/15') : ''
  const pie = especial
    ? carga!.tipo === 'vacaciones' ? 'Vacac.' : 'Licencia'
    : franco ? (estado === 'falta' ? 'falta hora' : 'Franco') : hhmm(carga!.horas * 60)
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
    : ausente ? 'Ausente' : carga?.tipo === 'vacaciones' ? 'Vacac.' : carga?.tipo === 'licencia' ? 'Licencia' : plan.length ? '' : 'Franco'
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

export default function PlanillaMensual({ modo, puedeEditar, acciones, recargar = 0, onEmpleados }: Props) {
  const hoy = new Date()
  const hoyIso = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
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
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const desde = iso(anio, mes, 1)
  const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  const hasta = iso(anio, mes, diasMes)
  const dias = useMemo(() => Array.from({ length: diasMes }, (_, i) => iso(anio, mes, i + 1)), [anio, mes, diasMes])
  const editable = modo === 'carga' && puedeEditar

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
        base.sort((a, b) => a.local.localeCompare(b.local) || Number(a.plan) - Number(b.plan) || (b.horasSem ?? 0) - (a.horasSem ?? 0) || a.nombre.localeCompare(b.nombre))
        const n = new Map<string, number>()
        for (const e of base) {
          if (e.plan) { e.puesto = 'PPP'; continue }
          const k = (n.get(e.local) ?? 0) + 1
          n.set(e.local, k)
          e.puesto = `${e.local} ${k}`
        }
        setEmps(base)
        onEmpleados?.(base)
      })
    void supabase.from('rrhh_locales_apertura').select('local,dias,abre,cierra').then(({ data }) => {
      setAperturas(new Map(((data as Apertura[] | null) ?? []).map((a) => [a.local, a])))
    })
  }, [onEmpleados])

  // Mes (+ la semana anterior, para «Repetir semana anterior»), marcaciones y feriados
  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    setCargando(true)
    setError(null)
    async function todo<T>(tabla: string, campos: string, ini: string): Promise<T[]> {
      const out: T[] = []
      for (let p = 0; ; p += 1000) {
        const { data, error: e } = await sb!.from(tabla).select(campos).gte('fecha', ini).lte('fecha', hasta).order('id').range(p, p + 999)
        if (e) { setError(e.message); break }
        const filas = (data as T[] | null) ?? []
        out.push(...filas)
        if (filas.length < 1000) break
      }
      return out
    }
    const [cs, ms] = await Promise.all([
      todo<Carga>('rrhh_carga_horaria', 'legajo,fecha,local,horario,horas,tipo', sumarDias(desde, -7)),
      modo === 'marcaciones' ? todo<Marcacion>('rrhh_marcaciones', 'legajo,fecha,local,marcas,horario,horas,incompleta', desde) : Promise.resolve([] as Marcacion[]),
    ])
    setCargas(new Map(cs.map((c) => [`${c.legajo}|${c.fecha}`, { ...c, horas: Number(c.horas) }])))
    setMarcas(new Map(ms.map((m) => [`${m.legajo}|${m.fecha}`, { ...m, horas: Number(m.horas) }])))
    const { data: fer } = await sb.from('objetivos_feriados').select('fecha,motivo').is('local', null).gte('fecha', desde).lte('fecha', hasta)
    setFeriados(new Map(((fer as { fecha: string; motivo: string | null }[] | null) ?? []).map((f) => [f.fecha, f.motivo || 'Feriado'])))
    setCargando(false)
  }, [desde, hasta, modo])
  useEffect(() => { void cargar() }, [cargar, recargar])

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

  const guardar: Guardar = useCallback(async (emp, fecha, c) => {
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

  const semanas = useMemo(() => {
    const out: string[] = []
    for (let l = lunesDe(desde); l <= hasta; l = sumarDias(l, 7)) out.push(l)
    return out
  }, [desde, hasta])

  /** Copia la semana anterior a la semana que empieza en `lunes`, solo en los días vacíos del mes. */
  async function repetirSemana(lunes: string) {
    if (!supabase || !lunes) return
    setAviso(null)
    const filas = []
    for (const emp of personas) {
      for (let i = 0; i < 7; i++) {
        const f = sumarDias(lunes, i)
        if (f < desde || f > hasta || cargas.has(`${emp.legajo}|${f}`)) continue
        const src = cargas.get(`${emp.legajo}|${sumarDias(f, -7)}`)
        if (src) filas.push({ legajo: emp.legajo, fecha: f, local: emp.local, horario: src.horario, horas: src.horas, tipo: src.tipo, actualizado_at: new Date().toISOString() })
      }
    }
    if (!filas.length) { setAviso('No había nada para copiar (la semana anterior está vacía o esta ya está cargada).'); return }
    const { error: e } = await supabase.from('rrhh_carga_horaria').upsert(filas, { onConflict: 'legajo,fecha' })
    if (e) { setError(e.message); return }
    setAviso(`Se copiaron ${filas.length} días de la semana anterior a la del ${ddmm(lunes)}.`)
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

  function cambiarMes(delta: number) {
    setAviso(null)
    const d = new Date(anio, mes + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth())
  }

  const horasCarga = (leg: string) => dias.reduce((s, f) => s + (cargas.get(`${leg}|${f}`)?.horas ?? 0), 0)
  const horasMarcas = (leg: string) => dias.reduce((s, f) => s + (marcas.get(`${leg}|${f}`)?.horas ?? 0), 0)
  const contratoMes = (e: Emp) => (e.horasSem == null ? null : (e.horasSem * diasMes) / 7)
  const contratoTotal = personas.reduce((s, e) => s + (contratoMes(e) ?? 0), 0)
  const enHora = (f: string, h: string) => personas.filter((e) => {
    const tr = modo === 'carga' ? tramosDe(cargas.get(`${e.legajo}|${f}`)?.horario) : tramosDe(marcas.get(`${e.legajo}|${f}`)?.horario)
    return tr.some(([a, b]) => a <= h && (b >= h || b < a))
  }).length

  const legajosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return emps.filter((e) => e.nombre.toLowerCase().includes(q) || e.legajo.toLowerCase().includes(q)).slice(0, 12)
  }, [busca, emps])

  const hora = (h: string) => (h.endsWith(':00') ? String(Number(h.slice(0, 2))) : h)
  // «Ausente» solo hasta el último día que trajo el reloj (antes de subir el Excel no hay nada que comparar)
  const hastaMarcado = useMemo(() => [...marcas.values()].reduce((m, x) => (x.fecha > m ? x.fecha : m), ''), [marcas])
  const totalMarcado = personas.reduce((s, e) => s + horasMarcas(e.legajo), 0)
  const totalCargado = personas.reduce((s, e) => s + horasCarga(e.legajo), 0)

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
          <button onClick={() => cambiarMes(-1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Mes anterior"><ChevronLeft size={18} /></button>
          <span className="min-w-[9.5rem] text-center text-sm font-semibold text-ink">{MESES[mes]} {anio}</span>
          <button onClick={() => cambiarMes(1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Mes siguiente"><ChevronRight size={18} /></button>
        </div>
        {(anio !== hoy.getFullYear() || mes !== hoy.getMonth()) && (
          <button onClick={() => { setAnio(hoy.getFullYear()); setMes(hoy.getMonth()) }} className="text-xs text-sky-500 hover:underline">Ir a este mes</button>
        )}
        {editable && personas.length > 0 && (
          <label className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1 text-xs text-ink">
            <Copy size={14} className="text-violet-500" aria-hidden />
            <select value="" onChange={(e) => void repetirSemana(e.target.value)} aria-label="Repetir la semana anterior" className="h-7 bg-transparent text-xs text-ink">
              <option value="">Repetir semana anterior en…</option>
              {semanas.map((l) => <option key={l} value={l}>Semana del {ddmm(l)} al {ddmm(sumarDias(l, 6))}</option>)}
            </select>
          </label>
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
      {modo === 'marcaciones' && !cargando && !marcas.size && (
        <p className="mb-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-sm text-ink">
          Todavía no se subieron marcaciones de {MESES[mes].toLowerCase()} {anio}.
        </p>
      )}

      {vista === 'legajo' && !empLegajo ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Buscá una persona, o tocá un nombre en la vista «Por local».</p>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-3">
          {/* Cabecera: apertura · local y mes · totales */}
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
              <p className="text-xs text-sub">{MESES[mes]} {anio}</p>
            </div>
            {modo === 'carga' ? (
              <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-wider text-sub/70">Carga total horaria del mes</p>
                <p className="text-lg font-semibold tabular-nums text-ink">{hhmm(totalCargado * 60)} <span className="text-xs font-normal text-sub">de {hhmm(contratoTotal * 60)} de contrato</span></p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-wider text-sub/70">Horas marcadas del mes</p>
                <p className="text-lg font-semibold tabular-nums text-ink">{hhmm(totalMarcado * 60)} <span className="text-xs font-normal text-sub">de {hhmm(totalCargado * 60)} planificadas</span></p>
              </div>
            )}
          </div>

          {cargando && !cargas.size && !marcas.size ? (
            <p className="flex items-center gap-2 py-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
          ) : (
            <div className="overflow-x-auto pb-1">
              <table className="border-separate border-spacing-1 text-xs">
                <thead>
                  <tr className="text-[11px]">
                    <th className="sticky left-0 z-20 min-w-[15.5rem] bg-surface-solid px-2 py-1.5 text-left font-medium text-sub">
                      <div className="flex items-end justify-between gap-2">
                        <span className="uppercase tracking-wider">Legajo</span>
                        <span className="w-[4.5rem] text-center text-[9px] font-normal normal-case leading-tight">horas del mes<br />{modo === 'carga' ? 'contrato / cargadas' : 'planif. / marcadas'}</span>
                      </div>
                    </th>
                    {dias.map((f) => {
                      const d = dow(f)
                      const fer = feriados.get(f)
                      const finde = d === 0 || d === 6
                      return (
                        <th
                          key={f} title={fer}
                          className={`min-w-[5.25rem] rounded-lg px-1 py-1 font-semibold ${f === hoyIso ? 'bg-sky-500/20 text-sky-500' : fer ? 'bg-orange-500/20 text-orange-500' : finde ? 'bg-rose-500/10 text-rose-400/80' : 'bg-rose-500/15 text-rose-400'}`}
                        >
                          {DIA_CORTO[d]} {Number(f.slice(8))}
                          <div className="grid grid-cols-2 text-[9px] font-normal opacity-70"><span>entrada</span><span>salida</span></div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((e, r) => {
                    const cargadas = horasCarga(e.legajo)
                    const arriba = modo === 'carga' ? contratoMes(e) : cargadas
                    const abajo = modo === 'carga' ? cargadas : horasMarcas(e.legajo)
                    const ok = arriba != null && Math.abs(abajo - arriba) <= Math.max(1, arriba * 0.03) // el mes no tiene semanas justas: 3 % de tolerancia
                    return (
                      <tr key={e.legajo}>
                        <td className="sticky left-0 z-10 bg-surface-solid px-1 align-top">
                          <div className="flex gap-1">
                          <button
                            onClick={() => { setLegajo(e.legajo); setVista('legajo'); setAviso(null) }}
                            className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left leading-tight hover:underline ${e.plan ? 'bg-emerald-500/10' : 'bg-orange-500/10'}`}
                            title="Ver solo a esta persona"
                          >
                            <span className={`block text-[10px] font-bold ${e.plan ? 'text-emerald-500' : 'text-sky-500'}`}>{e.puesto}</span>
                            <span className="block text-[12px] font-semibold text-ink">{e.nombre}</span>
                            <span className="block text-[10px] tabular-nums text-sub">{e.legajo}{e.horasSem != null ? ` · ${String(e.horasSem).replace('.', ',')} h/sem` : ''}</span>
                          </button>
                          <div className="w-[4.5rem] shrink-0 self-start overflow-hidden rounded-lg border border-line text-center tabular-nums">
                            <div className="py-1 text-[12px] text-ink" title={modo === 'carga' ? 'Contrato del mes (horas semanales × días ÷ 7)' : 'Horas planificadas en la carga horaria'}>{arriba == null ? '—' : hhmm(arriba * 60)}</div>
                            <div
                              className={`border-t border-line py-0.5 text-[11px] font-bold ${arriba == null ? 'text-sub' : ok ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-400'}`}
                              title={modo === 'carga' ? 'Horas cargadas en el mes' : 'Horas marcadas en el mes'}
                            >
                              {hhmm(abajo * 60)}
                            </div>
                          </div>
                          </div>
                        </td>
                        {dias.map((f, d) => (
                          <td key={f} className="align-top">
                            {modo === 'carga' ? (
                              <DiaCarga emp={e} fecha={f} carga={cargas.get(`${e.legajo}|${f}`)} apertura={apertura} editable={editable} r={r} d={d} onGuardar={guardar} />
                            ) : (
                              <DiaMarcas emp={e} marca={marcas.get(`${e.legajo}|${f}`)} carga={cargas.get(`${e.legajo}|${f}`)} pasado={f <= hastaMarcado} />
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
                {vista === 'local' && personas.length > 0 && (
                  <tfoot>
                    <tr className="text-[11px] text-sub">
                      <td className="sticky left-0 z-10 bg-surface-solid px-2 py-1">Personas al abrir / al cerrar</td>
                      {dias.map((f) => {
                        const a = enHora(f, apertura.abre), c = enHora(f, apertura.cierra)
                        return <td key={f} className={`rounded-lg bg-surface2 py-1 text-center tabular-nums ${!a || !c ? 'font-bold text-red-400' : ''}`}>{a} / {c}</td>
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
        {modo === 'carga' ? (
          <>
            <span><b className="text-emerald-500">verde</b>: cargadas = contrato del mes (±3 %) · <b className="text-red-400">rojo</b>: no coincide</span>
            <span><b className="text-red-400">hora en rojo</b>: entra después de abrir o sale antes de cerrar</span>
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

