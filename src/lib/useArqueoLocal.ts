/* ------------------------------------------------------------------ */
/*  Arqueos de hoy del local de la cuenta (usuarios.local), compartido  */
/*  entre el cartel del Layout, la tarjeta del menú y la campana: una   */
/*  sola consulta por minuto, y solo con la pestaña visible (con la     */
/*  pestaña oculta el aviso llega por push: /api/push?tipo=arqueo).     */
/* ------------------------------------------------------------------ */
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { ahoraCordoba, estadoHorarios, type Horario } from '@/lib/arqueos'

export interface EstadoArqueoLocal {
  /** el local arquea (tiene arqueos en las últimas 2 semanas) y no está excluido */
  activo: boolean
  horarios: Horario[]
  /** horario que se está avisando ahora (o null) */
  falta: Horario | null
  /** última hora de arqueo de hoy */
  ultima: string | null
  /** cuándo se leyó */
  leido: number
}

const VACIO: EstadoArqueoLocal = { activo: false, horarios: [], falta: null, ultima: null, leido: 0 }
let estado = VACIO
let localActual: string | null = null
let horasHoy: string[] = []
let marcadosHoy: number[] = []
let activo = false
let timer: ReturnType<typeof setInterval> | null = null
const oyentes = new Set<() => void>()

function recalcular() {
  const { min } = ahoraCordoba()
  const horarios = estadoHorarios(horasHoy, min, marcadosHoy)
  estado = {
    activo,
    horarios,
    falta: activo ? horarios.find((h) => h.estado === 'avisando') ?? null : null,
    ultima: horasHoy.length ? horasHoy[horasHoy.length - 1].slice(0, 5) : null,
    leido: Date.now(),
  }
  oyentes.forEach((f) => f())
}

export async function releerArqueos(): Promise<void> {
  const local = localActual
  if (!supabase || !local) return
  const { fecha } = ahoraCordoba()
  const desde = new Date(`${fecha}T12:00:00Z`)
  desde.setUTCDate(desde.getUTCDate() - 14)
  const [hoy, antes, fuera, marc] = await Promise.all([
    supabase.from('arqueos_locales').select('hora').eq('local', local).eq('fecha', fecha).order('hora'),
    supabase.from('arqueos_locales').select('fecha').eq('local', local).gte('fecha', desde.toISOString().slice(0, 10)).limit(1),
    supabase.from('arqueos_excluidos').select('local').eq('local', local),
    supabase.from('arqueos_marcados').select('horario').eq('local', local).eq('fecha', fecha),
  ])
  if (local !== localActual || hoy.error || antes.error) return
  horasHoy = ((hoy.data ?? []) as { hora: string }[]).map((x) => x.hora)
  marcadosHoy = ((marc.data ?? []) as { horario: number }[]).map((x) => x.horario)
  activo = (antes.data ?? []).length > 0 && !(fuera.data ?? []).length
  recalcular()
}

function arrancar(local: string) {
  if (localActual === local && timer) return
  localActual = local
  horasHoy = []
  marcadosHoy = []
  activo = false
  if (timer) clearInterval(timer)
  void releerArqueos()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void releerArqueos()
    else recalcular()
  }, 60_000)
  document.addEventListener('visibilitychange', alVolver)
}
function alVolver() {
  if (document.visibilityState === 'visible') void releerArqueos()
}
function parar() {
  if (timer) clearInterval(timer)
  timer = null
  localActual = null
  estado = VACIO
  document.removeEventListener('visibilitychange', alVolver)
}

const suscribir = (f: () => void) => {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
    if (!oyentes.size) parar()
  }
}

/** Estado del arqueo de hoy del local (null = la cuenta no es de un local) */
export function useArqueoLocal(local: string | null | undefined): EstadoArqueoLocal | null {
  const e = useSyncExternalStore(suscribir, () => estado)
  useEffect(() => {
    if (local) arrancar(local.toUpperCase())
  }, [local])
  return local ? e : null
}
