/* ------------------------------------------------------------------ */
/*  Arqueos de caja de los locales (sql/arqueos_locales.sql).           */
/*  El puente copia DWH.dbo.vw_FACT_ARQUEO cada 2 min. Horarios fijos   */
/*  10, 14, 19 y 22: un arqueo vale si se hace desde 1 h 30 antes hasta */
/*  1 h después; 15 min después del horario sin arqueo se avisa al      */
/*  local cada 15 min hasta que arquee o se cierre el horario.          */
/*  La misma regla está en arqueos_avisos_tomar() (push): cambiar las   */
/*  dos juntas.                                                          */
/* ------------------------------------------------------------------ */
import { supabase } from '@/lib/supabase'

export const HORARIOS_ARQUEO = [10, 14, 19, 22]
const ANTES = 90
const DESPUES = 60
const AVISO = 15
const ZONA_HORARIA = 'America/Argentina/Cordoba'

export interface Billete { tipo: 'Billete' | 'Moneda' | string; valor: number; cant: number; tot: number }
export interface Arqueo {
  local: string
  caja: number
  arqueo: number
  fecha: string // aaaa-mm-dd
  hora: string // hh:mm:ss
  vendedor: string | null
  total: number
  billetes: Billete[]
}

/** ok: arqueó en horario · tarde: después, antes del próximo · marcado: el local tocó «Ya lo hice» y el
 *  arqueo todavía no llegó de Dragon (tarda hasta 1 h) · avisando: falta y se está avisando ·
 *  no: se cerró sin arqueo · pendiente: todavía no llegó la hora del aviso */
export type EstadoHorario = 'ok' | 'tarde' | 'marcado' | 'avisando' | 'no' | 'pendiente'
export interface Horario { horario: number; estado: EstadoHorario; hora?: string }

/** Fecha y minutos del día de ahora en Córdoba */
export function ahoraCordoba(d = new Date()): { fecha: string; min: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return { fecha: `${v('year')}-${v('month')}-${v('day')}`, min: (Number(v('hour')) % 24) * 60 + Number(v('minute')) }
}

export const minutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const hhmm = (hora: string) => hora.slice(0, 5)
export const etiquetaHorario = (h: number) => `${String(h).padStart(2, '0')}:00`

/**
 * Estado de cada horario según las horas de arqueo del día. `ahoraMin` = minutos del día de ahora
 * (si el día ya pasó, 24 × 60 + 1: todos cerrados).
 */
export function estadoHorarios(horas: string[], ahoraMin: number, marcados: number[] = []): Horario[] {
  const mins = horas.map((h) => ({ h: hhmm(h), m: minutos(h) })).sort((a, b) => a.m - b.m)
  return HORARIOS_ARQUEO.map((hh, i) => {
    const h = hh * 60
    const dentro = mins.find((x) => x.m >= h - ANTES && x.m <= h + DESPUES)
    if (dentro) return { horario: hh, estado: 'ok', hora: dentro.h }
    if (marcados.includes(hh)) return { horario: hh, estado: 'marcado' }
    if (ahoraMin < h + AVISO) return { horario: hh, estado: 'pendiente' }
    const proximo = (HORARIOS_ARQUEO[i + 1] ?? 24) * 60
    const tarde = mins.find((x) => x.m > h + DESPUES && x.m < proximo - ANTES)
    if (tarde) return { horario: hh, estado: 'tarde', hora: tarde.h }
    return { horario: hh, estado: ahoraMin <= h + DESPUES ? 'avisando' : 'no' }
  })
}

/** Próximo horario que todavía no llegó (para «Próximo: 14:00 · en 3 h 30 min») */
export function proximoHorario(ahoraMin: number): { horario: number; faltan: number } | null {
  const h = HORARIOS_ARQUEO.find((x) => x * 60 > ahoraMin)
  return h === undefined ? null : { horario: h, faltan: h * 60 - ahoraMin }
}

export function enCuanto(min: number): string {
  if (min < 60) return `en ${min} min`
  const h = Math.floor(min / 60)
  return `en ${h} h${min % 60 ? ` ${min % 60} min` : ''}`
}

/** Arqueos de un día (Tesorería ve todos; un local, los suyos por RLS) */
export async function arqueosDelDia(fecha: string, local?: string): Promise<Arqueo[]> {
  if (!supabase) return []
  let q = supabase.from('arqueos_locales').select('local,caja,arqueo,fecha,hora,vendedor,total,billetes').eq('fecha', fecha)
  if (local) q = q.eq('local', local)
  const { data, error } = await q.order('hora', { ascending: true }).limit(1000)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Arqueo[]).map((a) => ({ ...a, total: Number(a.total) || 0, billetes: a.billetes ?? [] }))
}

/** Último arqueo de cada local que arqueó alguna vez en los últimos 14 días (para «Sin arqueo hoy») */
export async function ultimosArqueos(hasta: string): Promise<Arqueo[]> {
  if (!supabase) return []
  const desde = new Date(`${hasta}T12:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - 14)
  const { data, error } = await supabase
    .from('arqueos_locales')
    .select('local,caja,arqueo,fecha,hora,vendedor,total,billetes')
    .gte('fecha', desde.toISOString().slice(0, 10))
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('hora', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  const vistos = new Map<string, Arqueo>()
  for (const a of (data ?? []) as Arqueo[]) {
    if (!vistos.has(a.local)) vistos.set(a.local, { ...a, total: Number(a.total) || 0, billetes: a.billetes ?? [] })
  }
  return [...vistos.values()]
}

/** Horarios marcados con «Ya lo hice» en un día: local → horarios */
export async function arqueosMarcados(fecha: string, local?: string): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>()
  if (!supabase) return m
  let q = supabase.from('arqueos_marcados').select('local,horario').eq('fecha', fecha)
  if (local) q = q.eq('local', local)
  const { data } = await q
  for (const x of (data ?? []) as { local: string; horario: number }[]) m.set(x.local, [...(m.get(x.local) ?? []), x.horario])
  return m
}

/** El local de la cuenta marca que ya hizo el arqueo de ese horario (corta el aviso) */
export async function marcarArqueo(horario: number): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('arqueos_marcar', { p_horario: horario })
  if (error) throw new Error(error.message)
}

export async function excluidos(): Promise<Set<string>> {
  if (!supabase) return new Set()
  const { data } = await supabase.from('arqueos_excluidos').select('local')
  return new Set(((data ?? []) as { local: string }[]).map((x) => x.local))
}

export async function excluirLocal(local: string, excluir: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('arqueos_excluir', { p_local: local, p_excluir: excluir })
  if (error) throw new Error(error.message)
}

export async function ultimoSync(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.from('arqueos_sync_estado').select('ultimo_at').eq('id', 1).maybeSingle()
  return (data as { ultimo_at: string | null } | null)?.ultimo_at ?? null
}

/** Un color por billete y por zona, sin repetir tonos entre los dos */
export const COLOR_BILLETE: Record<number, string> = {
  20000: '#10b981', 10000: '#38bdf8', 2000: '#a78bfa', 1000: '#f59e0b', 500: '#f472b6', 200: '#fb923c', 100: '#94a3b8',
}
export const colorBillete = (v: number) => COLOR_BILLETE[v] ?? '#475569'
export const COLOR_ZONA: Record<string, string> = {
  CENTRO: '#e879f9', NORTE: '#22d3ee', SUR: '#facc15', OESTE: '#f87171', 'CARLOS PAZ': '#4ade80', 'RIO CUARTO': '#818cf8',
}
export const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
export const numero = (n: number) => Math.round(n).toLocaleString('es-AR')
