import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Loader2, Search, Store, User } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Carga horaria (27/11/2026).                               */
/*  Planilla tipo calendario del horario de cada legajo, día por día:   */
/*  - Por local: filas = empleados del local, columnas = días del mes.  */
/*  - Por legajo: calendario lunes a domingo de una persona.            */
/*  En cada celda se tipea «10-14 17-21», «8», «F» (franco),            */
/*  «V» (vacaciones) o «L» (licencia); vacío = se borra.                */
/*  Se compara con las horas semanales del contrato (empleados.horas).  */
/*  Tabla rrhh_carga_horaria (sql/rrhh_carga_horaria.sql),              */
/*  permisos rrhh.horarios.view / .edit (rol rr_hh).                    */
/* ------------------------------------------------------------------ */

type Tipo = 'trabajo' | 'franco' | 'vacaciones' | 'licencia'
interface Carga { legajo: string; fecha: string; local: string | null; horario: string | null; horas: number; tipo: Tipo }
interface Emp { legajo: string; nombre: string; local: string; horasSem: number | null }
interface Parseo { tipo: Tipo; horario: string | null; horas: number }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS_CORTO = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const LETRA: Record<Exclude<Tipo, 'trabajo'>, string> = { franco: 'F', vacaciones: 'V', licencia: 'L' }
const ESTILO_TIPO: Record<Tipo, string> = {
  trabajo: 'text-ink',
  franco: 'bg-slate-500/15 text-sub',
  vacaciones: 'bg-teal-500/15 text-teal-500',
  licencia: 'bg-amber-500/15 text-amber-500',
}
const LS_LOCAL = 'carga-horaria.local'

/* ---------- fechas (todo en ISO yyyy-mm-dd, sin zonas) ---------- */
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (a: number, m: number, d: number) => `${a}-${pad(m + 1)}-${pad(d)}`
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay()
/** Lunes de la semana de `f` */
const lunesDe = (f: string) => sumarDias(f, -((dow(f) + 6) % 7))
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/* ---------- celdas: texto ↔ dato ---------- */
const fmtH = (h: number) => (Math.round(h * 100) / 100).toString().replace('.', ',')

/** Interpreta lo tipeado. null = vacío (borrar); 'error' = no se entiende. */
export function parsearCelda(txt: string): Parseo | null | 'error' {
  let t = txt.trim().toLowerCase()
  if (!t) return null
  if (['f', 'franco'].includes(t)) return { tipo: 'franco', horario: null, horas: 0 }
  if (['v', 'vac', 'vacaciones'].includes(t)) return { tipo: 'vacaciones', horario: null, horas: 0 }
  if (['l', 'lic', 'licencia'].includes(t)) return { tipo: 'licencia', horario: null, horas: 0 }
  const solo = t.match(/^(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|hs|horas)?$/)
  if (solo) {
    const h = Number(solo[1].replace(',', '.'))
    return h > 0 && h <= 24 ? { tipo: 'trabajo', horario: null, horas: h } : 'error'
  }
  t = t.replace(/hs?\b/g, '').replace(/\s+a\s+/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+y\s+|[;,/]/g, ' ')
  const tramos: string[] = []
  let horas = 0
  for (const tok of t.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\d{1,2})(?:[:.](\d{2}))?-(\d{1,2})(?:[:.](\d{2}))?$/)
    if (!m) return 'error'
    const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3]), Number(m[4] ?? 0)]
    if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return 'error'
    let dur = h2 * 60 + m2 - (h1 * 60 + m1)
    if (dur <= 0) dur += 24 * 60 // pasa la medianoche
    horas += dur / 60
    tramos.push(`${pad(h1)}:${pad(m1)}-${pad(h2)}:${pad(m2)}`)
  }
  if (!tramos.length || horas > 24) return 'error'
  return { tipo: 'trabajo', horario: tramos.join(' '), horas: Math.round(horas * 100) / 100 }
}

/** Texto corto para mostrar en la celda */
function textoCelda(c: Carga | undefined): string {
  if (!c) return ''
  if (c.tipo !== 'trabajo') return LETRA[c.tipo]
  if (c.horario) return c.horario.replace(/:00/g, '').replace(/^0(\d)/, '$1').replace(/ 0(\d)/g, ' $1').replace(/-0(\d)/g, '-$1')
  return fmtH(c.horas)
}

/** Local del legajo: el lugar, o el sector cuando el lugar dice LOCALES */
function localDe(lugar: string | null, sector: string | null): string {
  const l = (lugar || '').trim().toUpperCase()
  if (l && l !== 'LOCALES') return l
  return (sector || '').trim().toUpperCase() || 'SIN LOCAL'
}

/* ------------------------------------------------------------------ */

interface CeldaProps {
  carga: Carga | undefined
  editable: boolean
  r: number
  c: number
  grupo: string
  feriado?: boolean
  finde?: boolean
  onGuardar: (p: Parseo | null) => Promise<boolean>
  ancho?: string
}

/** Celda editable: se tipea y al salir (Enter, Tab o clic afuera) se guarda. */
function Celda({ carga, editable, r, c, grupo, feriado, finde, onGuardar, ancho = 'w-[4.25rem]' }: CeldaProps) {
  const original = textoCelda(carga)
  const [txt, setTxt] = useState(original)
  const [estado, setEstado] = useState<'ok' | 'error' | 'guardando'>('ok')
  useEffect(() => { setTxt(original); setEstado('ok') }, [original])

  async function confirmar() {
    if (txt.trim() === original) { setEstado('ok'); return }
    const p = parsearCelda(txt)
    if (p === 'error') { setEstado('error'); return }
    setEstado('guardando')
    const ok = await onGuardar(p)
    setEstado(ok ? 'ok' : 'error')
  }

  function mover(e: KeyboardEvent<HTMLInputElement>) {
    const destino = (dr: number, dc: number) => {
      const el = document.querySelector<HTMLInputElement>(`input[data-g="${grupo}"][data-r="${r + dr}"][data-c="${c + dc}"]`)
      if (el) { e.preventDefault(); el.focus(); el.select() }
    }
    if (e.key === 'Enter') { e.currentTarget.blur(); destino(0, 1) }
    else if (e.key === 'Escape') { setTxt(original); setEstado('ok'); e.currentTarget.blur() }
    else if (e.key === 'ArrowDown') destino(1, 0)
    else if (e.key === 'ArrowUp') destino(-1, 0)
    else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === txt.length) destino(0, 1)
    else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) destino(0, -1)
  }

  const fondo = carga ? ESTILO_TIPO[carga.tipo] : feriado ? 'bg-orange-500/10' : finde ? 'bg-surface2/60' : ''
  const borde = estado === 'error' ? 'ring-1 ring-red-500' : estado === 'guardando' ? 'opacity-60' : ''
  const titulo = carga
    ? carga.tipo === 'trabajo' ? `${carga.horario ?? 'Sin horario'} · ${fmtH(carga.horas)} h` : carga.tipo
    : estado === 'error' ? 'No se entiende: probá «10-14 17-21», «8», F, V o L' : undefined

  return (
    <input
      value={txt}
      readOnly={!editable}
      onChange={(e) => { setTxt(e.target.value); if (estado === 'error') setEstado('ok') }}
      onBlur={() => void confirmar()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={mover}
      data-g={grupo}
      data-r={r}
      data-c={c}
      title={titulo}
      aria-label={titulo ?? 'Horario'}
      className={`h-8 ${ancho} rounded-md border border-transparent px-1 text-center text-[11px] tabular-nums outline-none transition focus:border-sky-500 focus:bg-surface-solid ${fondo} ${borde} ${editable ? '' : 'cursor-default'}`}
    />
  )
}

/* ------------------------------------------------------------------ */

export default function CargaHoraria() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('rrhh.horarios.edit')
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
  const [vista, setVista] = useState<'local' | 'legajo'>('local')
  const [emps, setEmps] = useState<Emp[]>([])
  const [cargas, setCargas] = useState<Map<string, Carga>>(new Map())
  const [feriados, setFeriados] = useState<Map<string, string>>(new Map())
  const [local, setLocal] = useState<string>(() => { try { return localStorage.getItem(LS_LOCAL) ?? '' } catch { return '' } })
  const [legajo, setLegajo] = useState('')
  const [busca, setBusca] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const desde = iso(anio, mes, 1)
  const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  const hasta = iso(anio, mes, diasMes)
  const dias = useMemo(() => Array.from({ length: diasMes }, (_, i) => iso(anio, mes, i + 1)), [anio, mes, diasMes])
  const hoyIso = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())

  // Empleados activos con legajo
  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('empleados')
      .select('legajo,nombre,lugar,area_sector,horas')
      .not('legajo', 'is', null)
      .or('estado_legajo.in.("NOMINA ACTIVA","PLANES ACTIVOS"),estado_legajo.is.null')
      .order('nombre')
      .range(0, 1999)
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); return }
        const filas = (data as { legajo: string; nombre: string; lugar: string | null; area_sector: string | null; horas: number | string | null }[] | null) ?? []
        setEmps(filas.map((f) => ({
          legajo: String(f.legajo).trim(),
          nombre: f.nombre,
          local: localDe(f.lugar, f.area_sector),
          horasSem: f.horas == null || f.horas === '' ? null : Number(f.horas),
        })))
      })
  }, [])

  // Carga horaria del mes (+ la semana anterior, para «Repetir semana») y feriados
  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const ini = sumarDias(desde, -7)
    const todas: Carga[] = []
    for (let p = 0; ; p += 1000) {
      const { data, error: e } = await sb.from('rrhh_carga_horaria').select('legajo,fecha,local,horario,horas,tipo')
        .gte('fecha', ini).lte('fecha', hasta).order('id').range(p, p + 999)
      if (e) { setError(e.message); break }
      const filas = (data as Carga[] | null) ?? []
      todas.push(...filas.map((f) => ({ ...f, horas: Number(f.horas) })))
      if (filas.length < 1000) break
    }
    setCargas(new Map(todas.map((c) => [`${c.legajo}|${c.fecha}`, c])))
    const { data: fer } = await sb.from('objetivos_feriados').select('fecha,local,motivo').is('local', null).gte('fecha', desde).lte('fecha', hasta)
    setFeriados(new Map(((fer as { fecha: string; motivo: string | null }[] | null) ?? []).map((f) => [f.fecha, f.motivo || 'Feriado'])))
    setCargando(false)
  }, [desde, hasta])
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

  const empsLocal = useMemo(() => emps.filter((e) => e.local === local), [emps, local])
  const empLegajo = useMemo(() => emps.find((e) => e.legajo === legajo), [emps, legajo])

  const guardar = useCallback(async (emp: Emp, fecha: string, p: Parseo | null): Promise<boolean> => {
    if (!supabase) return false
    const k = `${emp.legajo}|${fecha}`
    const { error: e } = p
      ? await supabase.from('rrhh_carga_horaria').upsert(
        { legajo: emp.legajo, fecha, local: emp.local, horario: p.horario, horas: p.horas, tipo: p.tipo, actualizado_at: new Date().toISOString() },
        { onConflict: 'legajo,fecha' },
      )
      : await supabase.from('rrhh_carga_horaria').delete().eq('legajo', emp.legajo).eq('fecha', fecha)
    if (e) { setError(e.message); return false }
    setCargas((prev) => {
      const n = new Map(prev)
      if (p) n.set(k, { legajo: emp.legajo, fecha, local: emp.local, ...p })
      else n.delete(k)
      return n
    })
    return true
  }, [])

  // Semanas (lunes) que tocan el mes
  const semanas = useMemo(() => {
    const out: string[] = []
    for (let l = lunesDe(desde); l <= hasta; l = sumarDias(l, 7)) out.push(l)
    return out
  }, [desde, hasta])

  /** Copia la semana anterior a la semana que empieza en `lunes`, solo en las celdas vacías del mes. */
  async function repetirSemana(lunes: string, personas: Emp[]) {
    if (!supabase || !lunes) return
    const filas: (Carga & { actualizado_at: string })[] = []
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

  function cambiarMes(delta: number) {
    setAviso(null)
    const d = new Date(anio, mes + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth())
  }

  const horasDe = (leg: string, fs: string[]) => fs.reduce((s, f) => s + (cargas.get(`${leg}|${f}`)?.horas ?? 0), 0)
  const esperado = (e: Emp, nDias: number) => (e.horasSem == null ? null : (e.horasSem * nDias) / 7)

  const difClase = (real: number, esp: number | null) => {
    if (esp == null) return 'text-sub'
    const d = real - esp
    if (Math.abs(d) < 0.5) return 'text-emerald-500'
    return d > 0 ? 'text-red-400' : 'text-amber-500'
  }
  const difTexto = (real: number, esp: number | null) => {
    if (esp == null) return '—'
    const d = Math.round((real - esp) * 10) / 10
    return d === 0 ? '0' : `${d > 0 ? '+' : ''}${fmtH(d)}`
  }

  const selectorSemana = (personas: Emp[]) => puedeEditar && (
    <label className="flex items-center gap-1.5 text-xs text-sub">
      <Copy size={14} className="text-violet-500" aria-hidden />
      <select
        value=""
        onChange={(e) => void repetirSemana(e.target.value, personas)}
        className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink"
        aria-label="Repetir la semana anterior"
      >
        <option value="">Repetir semana anterior en…</option>
        {semanas.map((l) => <option key={l} value={l}>Semana del {ddmm(l)} al {ddmm(sumarDias(l, 6))}</option>)}
      </select>
    </label>
  )

  const legajosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return emps.filter((e) => e.nombre.toLowerCase().includes(q) || e.legajo.toLowerCase().includes(q)).slice(0, 12)
  }, [busca, emps])

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <CalendarClock size={22} className="text-sky-500" aria-hidden /> Carga horaria
          </h1>
          <p className="mt-1 text-sm text-sub">
            Horario de cada legajo, día por día. Tipeá <b>10-14 17-21</b>, <b>8</b> (horas), <b>F</b> franco, <b>V</b> vacaciones o <b>L</b> licencia; vacío borra.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          <button onClick={() => cambiarMes(-1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Mes anterior"><ChevronLeft size={18} /></button>
          <span className="min-w-[9.5rem] text-center text-sm font-semibold text-ink">{MESES[mes]} {anio}</span>
          <button onClick={() => cambiarMes(1)} className="btn-press rounded-lg p-1.5 text-sub hover:text-ink" aria-label="Mes siguiente"><ChevronRight size={18} /></button>
        </div>
      </header>

      <div className="mb-3 inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
        {([['local', 'Por local', Store], ['legajo', 'Por legajo', User]] as const).map(([v, t, Icono]) => (
          <button
            key={v}
            role="tab"
            aria-selected={vista === v}
            onClick={() => { setVista(v); setAviso(null) }}
            className={`btn-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${vista === v ? 'bg-sky-500 font-semibold text-white' : 'text-sub hover:text-ink'}`}
          >
            <Icono size={15} aria-hidden /> {t}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      {aviso && <p className="mb-3 text-sm text-emerald-500">{aviso}</p>}

      {vista === 'local' ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {locales.map(([l, n]) => (
              <button
                key={l}
                onClick={() => { setLocal(l); setAviso(null) }}
                aria-pressed={local === l}
                className={`btn-press rounded-lg border px-2.5 py-1 text-xs transition ${local === l ? 'border-sky-500/60 bg-sky-500/15 font-semibold text-sky-500' : 'border-line bg-surface text-sub hover:text-ink'}`}
              >
                {l} <span className="opacity-60">· {n}</span>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">{local} · {empsLocal.length} {empsLocal.length === 1 ? 'persona' : 'personas'}</p>
              {selectorSemana(empsLocal)}
            </div>
            {cargando && !cargas.size ? (
              <p className="flex items-center gap-2 py-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr className="text-sub">
                      <th className="sticky left-0 z-10 min-w-[12rem] bg-surface-solid px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wider">Legajo</th>
                      {dias.map((f) => {
                        const fer = feriados.get(f)
                        const d = dow(f)
                        return (
                          <th key={f} title={fer} className={`px-0.5 py-1 text-center font-medium ${fer ? 'text-orange-500' : d === 0 || d === 6 ? 'text-sub/60' : ''} ${f === hoyIso ? 'rounded-t-md bg-sky-500/15 text-sky-500' : ''}`}>
                            <div className="text-[10px]">{DIAS_CORTO[d]}</div>
                            <div className="tabular-nums">{Number(f.slice(8))}</div>
                          </th>
                        )
                      })}
                      <th className="px-2 py-1 text-right text-[11px] font-medium uppercase tracking-wider">Horas</th>
                      <th className="px-2 py-1 text-right text-[11px] font-medium uppercase tracking-wider" title="Horas semanales del contrato × días del mes ÷ 7">Contrato</th>
                      <th className="px-2 py-1 text-right text-[11px] font-medium uppercase tracking-wider">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empsLocal.map((e, r) => {
                      const real = horasDe(e.legajo, dias)
                      const esp = esperado(e, diasMes)
                      return (
                        <tr key={e.legajo} className="group">
                          <td className="sticky left-0 z-10 max-w-[14rem] truncate border-t border-line bg-surface-solid px-2 py-0.5">
                            <button onClick={() => { setLegajo(e.legajo); setVista('legajo') }} className="text-left hover:underline" title="Ver el calendario de esta persona">
                              <span className="text-sub tabular-nums">{e.legajo}</span> <span className="text-ink">{e.nombre}</span>
                            </button>
                            <div className="text-[10px] text-sub">{e.horasSem != null ? `${fmtH(e.horasSem)} h/sem` : 'sin horas de contrato'}</div>
                          </td>
                          {dias.map((f, c) => {
                            const d = dow(f)
                            return (
                              <td key={f} className="border-t border-line p-px">
                                <Celda
                                  carga={cargas.get(`${e.legajo}|${f}`)}
                                  editable={puedeEditar}
                                  grupo="local" r={r} c={c}
                                  feriado={feriados.has(f)}
                                  finde={d === 0 || d === 6}
                                  onGuardar={(p) => guardar(e, f, p)}
                                />
                              </td>
                            )
                          })}
                          <td className="border-t border-line px-2 text-right font-semibold tabular-nums text-ink">{fmtH(real)}</td>
                          <td className="border-t border-line px-2 text-right tabular-nums text-sub">{esp == null ? '—' : fmtH(Math.round(esp * 10) / 10)}</td>
                          <td className={`border-t border-line px-2 text-right font-semibold tabular-nums ${difClase(real, esp)}`}>{difTexto(real, esp)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {empsLocal.length > 0 && (
                    <tfoot>
                      <tr className="text-sub">
                        <td className="sticky left-0 z-10 border-t-2 border-line bg-surface-solid px-2 py-1 text-[11px] uppercase tracking-wider">Horas del local</td>
                        {dias.map((f) => {
                          const h = empsLocal.reduce((s, e) => s + (cargas.get(`${e.legajo}|${f}`)?.horas ?? 0), 0)
                          const n = empsLocal.filter((e) => cargas.get(`${e.legajo}|${f}`)?.tipo === 'trabajo').length
                          return (
                            <td key={f} className="border-t-2 border-line px-0.5 py-1 text-center tabular-nums" title={`${n} ${n === 1 ? 'persona trabaja' : 'personas trabajan'}`}>
                              <div className="font-semibold text-ink">{h ? fmtH(h) : ''}</div>
                              <div className="text-[10px]">{n ? `${n} p.` : ''}</div>
                            </td>
                          )
                        })}
                        <td className="border-t-2 border-line px-2 text-right font-semibold tabular-nums text-ink">{fmtH(empsLocal.reduce((s, e) => s + horasDe(e.legajo, dias), 0))}</td>
                        <td className="border-t-2 border-line px-2 text-right tabular-nums">{fmtH(Math.round(empsLocal.reduce((s, e) => s + (esperado(e, diasMes) ?? 0), 0) * 10) / 10)}</td>
                        <td className="border-t-2 border-line" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="relative mb-3 max-w-md">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-sub" aria-hidden />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={empLegajo ? `${empLegajo.legajo} · ${empLegajo.nombre}` : 'Buscar por nombre o legajo'}
              aria-label="Buscar empleado"
              className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2 text-sm text-ink"
            />
            {legajosFiltrados.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-solid shadow-lg">
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

          {!empLegajo ? (
            <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Buscá una persona, o tocá un nombre en la vista «Por local».</p>
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{empLegajo.legajo} · {empLegajo.nombre}</p>
                  <p className="text-xs text-sub">
                    {empLegajo.local} · {empLegajo.horasSem != null ? `${fmtH(empLegajo.horasSem)} h semanales de contrato` : 'sin horas de contrato cargadas'}
                    {' · '}en el mes: <b className="text-ink">{fmtH(horasDe(empLegajo.legajo, dias))} h</b>
                    {(() => {
                      const esp = esperado(empLegajo, diasMes)
                      const real = horasDe(empLegajo.legajo, dias)
                      return esp == null ? null : <> de {fmtH(Math.round(esp * 10) / 10)} (<span className={difClase(real, esp)}>{difTexto(real, esp)}</span>)</>
                    })()}
                  </p>
                </div>
                {selectorSemana([empLegajo])}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] border-separate border-spacing-1 text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-sub">
                      {DIAS_SEMANA.map((d) => <th key={d} className="font-medium">{d}</th>)}
                      <th className="font-medium">Semana</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanas.map((lunes, r) => {
                      const fs = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
                      const delMes = fs.filter((f) => f >= desde && f <= hasta)
                      const real = horasDe(empLegajo.legajo, delMes)
                      const esp = esperado(empLegajo, delMes.length)
                      return (
                        <tr key={lunes}>
                          {fs.map((f, c) => {
                            const fuera = f < desde || f > hasta
                            const fer = feriados.get(f)
                            const carga = cargas.get(`${empLegajo.legajo}|${f}`)
                            return (
                              <td key={f} className={`rounded-xl border p-1.5 align-top ${fuera ? 'border-transparent opacity-30' : f === hoyIso ? 'border-sky-500/60' : 'border-line'} ${fer ? 'bg-orange-500/5' : ''}`}>
                                <div className="mb-1 flex items-center justify-between text-[10px] text-sub">
                                  <span className={`tabular-nums ${fer ? 'text-orange-500' : ''}`}>{Number(f.slice(8))}</span>
                                  {fer && <span className="truncate text-orange-500" title={fer}>{fer}</span>}
                                  {carga?.tipo === 'trabajo' && carga.horario && <span className="tabular-nums">{fmtH(carga.horas)} h</span>}
                                </div>
                                {!fuera && (
                                  <Celda
                                    carga={carga}
                                    editable={puedeEditar}
                                    grupo="legajo" r={r} c={c}
                                    feriado={!!fer}
                                    onGuardar={(p) => guardar(empLegajo, f, p)}
                                    ancho="w-full"
                                  />
                                )}
                              </td>
                            )
                          })}
                          <td className="whitespace-nowrap px-2 text-right tabular-nums">
                            <div className="font-semibold text-ink">{fmtH(real)} h</div>
                            <div className={`text-[10px] ${difClase(real, esp)}`}>{esp == null ? '' : `${difTexto(real, esp)} de ${fmtH(Math.round(esp * 10) / 10)}`}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-xs text-sub">
        <span className="text-emerald-500">Verde</span>: cumple el contrato · <span className="text-amber-500">ámbar</span>: faltan horas · <span className="text-red-400">rojo</span>: se pasa.
        Columnas naranjas = feriado de todos los locales.
      </p>
    </Layout>
  )
}
