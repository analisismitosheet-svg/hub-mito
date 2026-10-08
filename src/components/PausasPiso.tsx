import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pause } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { MOTIVOS_PAUSA, nombreMotivoPausa } from '@/components/MotivoPausa'

/* ------------------------------------------------------------------ */
/*  Pausas del piso por empleado y motivo (Eficiencia mayorista).      */
/*  Sale de estadistica_pausas (sql/piso_pausas.sql): repo y armado.   */
/* ------------------------------------------------------------------ */

interface Fila {
  usuario_id: string
  legajo: string | null
  nombre: string | null
  motivo: string
  pausas: number
  segundos: number
  abiertas: number
}

interface PorEmpleado {
  id: string
  legajo: string | null
  nombre: string
  pausas: number
  segundos: number
  abiertas: number
  motivos: { motivo: string; pausas: number; segundos: number }[]
}

function fmtDur(seg: number): string {
  if (seg <= 0) return '—'
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(seg)}s`
}

const icono = (m: string) => MOTIVOS_PAUSA.find((x) => x.id === m)?.icono ?? '⏸'

export default function PausasPiso({ desde, hasta }: { desde: string; hasta: string }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let vivo = true
    setCargando(true)
    const hoy = new Date().toISOString().slice(0, 10)
    const d = desde || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    void supabase.rpc('estadistica_pausas', { p_desde: d, p_hasta: hasta || hoy }).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) setError(e.message)
      else setFilas(((data as Fila[] | null) ?? []).map((f) => ({ ...f, pausas: Number(f.pausas) || 0, segundos: Number(f.segundos) || 0, abiertas: Number(f.abiertas) || 0 })))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [desde, hasta])

  const empleados = useMemo<PorEmpleado[]>(() => {
    const m = new Map<string, PorEmpleado>()
    for (const f of filas) {
      let e = m.get(f.usuario_id)
      if (!e) {
        e = { id: f.usuario_id, legajo: f.legajo, nombre: f.nombre ?? '—', pausas: 0, segundos: 0, abiertas: 0, motivos: [] }
        m.set(f.usuario_id, e)
      }
      e.pausas += f.pausas
      e.segundos += f.segundos
      e.abiertas += f.abiertas
      e.motivos.push({ motivo: f.motivo, pausas: f.pausas, segundos: f.segundos })
    }
    for (const e of m.values()) e.motivos.sort((a, b) => b.segundos - a.segundos)
    return [...m.values()].sort((a, b) => b.segundos - a.segundos)
  }, [filas])

  return (
    <section className="mb-6">
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
        <Pause size={17} className="text-amber-500" aria-hidden /> Pausas en piso
      </h2>
      <p className="mb-2 text-xs text-sub/70">
        Cada pausa en Mi repo (repo o armado) pide un motivo. Tiempo = cuánto duró hasta Reanudar o Finalizar.
        {!desde && ' Últimos 30 días.'}
      </p>
      {error && <p className="mb-2 text-sm text-brand-400">{error}</p>}
      {cargando ? (
        <p className="flex items-center gap-2 py-4 text-sm text-sub"><Loader2 size={15} className="animate-spin" /> Cargando…</p>
      ) : empleados.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay pausas registradas en este período.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <table className="w-full table-fixed border-collapse text-[12px] sm:text-sm">
            <thead>
              <tr className="table-head text-left text-[10px] font-semibold uppercase tracking-wider sm:text-[11px]">
                <th className="w-[34%] px-3 py-2 sm:w-[26%]">Empleado</th>
                <th className="px-2 py-2 text-center">Pausas</th>
                <th className="px-2 py-2 text-center">En pausa</th>
                <th className="hidden px-2 py-2 sm:table-cell sm:w-[44%]">Motivos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50 bg-surface">
              {empleados.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="block truncate font-medium text-ink">{e.legajo ? `#${e.legajo}` : ''} {e.nombre}</span>
                    {/* En celular los motivos van debajo del nombre */}
                    <span className="mt-1 flex flex-wrap gap-1 sm:hidden">
                      {e.motivos.map((m) => (
                        <span key={m.motivo} className="rounded bg-line px-1.5 py-0.5 text-[10px] text-sub" title={nombreMotivoPausa(m.motivo)}>
                          {icono(m.motivo)} {m.pausas} · {fmtDur(m.segundos)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums text-ink">{e.pausas}</td>
                  <td className="px-2 py-2 text-center font-semibold tabular-nums text-amber-500">
                    {fmtDur(e.segundos)}
                    {e.abiertas > 0 && <span className="block text-[10px] font-normal text-brand-400">{e.abiertas} sin reanudar</span>}
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {e.motivos.map((m) => (
                        <span key={m.motivo} className="rounded bg-line px-1.5 py-0.5 text-[11px] text-sub">
                          {icono(m.motivo)} {nombreMotivoPausa(m.motivo)}: {m.pausas} · {fmtDur(m.segundos)}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
