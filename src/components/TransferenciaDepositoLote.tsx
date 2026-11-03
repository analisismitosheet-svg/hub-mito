import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRightLeft, BarChart3, Check, ChevronRight, X } from 'lucide-react'
import { horasHabilesEntre } from '@/lib/horasHabiles'

export type EstadoTransfer = 'pendiente' | 'hecho' | 'faltante' | 'senado'

/** Renglón de transferencia que sale de Indo (RPC deposito_transferencias, sql/deposito_transferencias.sql). */
export interface RenglonTransfer {
  id: string
  lote_id: string
  lote_nombre: string
  lote_motivo: string | null
  lote_creado: string
  destino: string
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  estado: EstadoTransfer
  hecho_at: string | null
  hecho_por: string | null
  hecho_por_nombre: string | null
  hecho_por_legajo: string | null
}

const num2 = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (iso: string) => new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fechaHora = (iso: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

function Celda({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface2 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sub">{label}</div>
      <div className="py-1 text-sm font-medium text-ink">{children}</div>
    </div>
  )
}

/**
 * Un lote de transferencias que sale de Depósito Indo, dentro de Repos Depósito.
 * Estadísticas como la Eficiencia mayorista: horas del primer al último tilde
 * (L-V 9 a 17, como los repos del depósito), personas que marcaron, prendas/hora
 * y una fila por persona. La tabla de Reposición es la misma que la de los repos:
 * artículos en filas, locales en columnas, ✓ / ✕ por celda. Es el mismo dato que Mi repo.
 */
export default function TransferenciaDepositoLote({
  renglones,
  puedeMarcar,
  onMarcar,
}: {
  renglones: RenglonTransfer[]
  puedeMarcar: boolean
  onMarcar: (ids: string[], estado: 'pendiente' | 'hecho' | 'faltante') => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [sub, setSub] = useState<'stats' | 'repo' | null>('repo')
  const r0 = renglones[0]

  const st = useMemo(() => {
    const u = (rs: RenglonTransfer[]) => rs.reduce((s, r) => s + (r.cantidad || 1), 0)
    const total = u(renglones)
    const hechos = renglones.filter((r) => r.estado === 'hecho')
    const faltan = renglones.filter((r) => r.estado === 'faltante')
    const marcados = renglones.filter((r) => r.estado !== 'pendiente' && r.hecho_at)
    const tiempos = marcados.map((r) => new Date(r.hecho_at!).getTime()).sort((a, b) => a - b)
    const hsTotal = tiempos.length > 1 ? horasHabilesEntre(new Date(tiempos[0]).toISOString(), new Date(tiempos[tiempos.length - 1]).toISOString()) : 0

    // Una fila por persona: lo que marcó, del primer al último tilde
    const porPersona = new Map<string, RenglonTransfer[]>()
    for (const r of marcados) {
      const k = r.hecho_por ?? '—'
      porPersona.set(k, [...(porPersona.get(k) ?? []), r])
    }
    const personas = [...porPersona.values()].map((rs) => {
      const ts = rs.map((r) => new Date(r.hecho_at!).getTime()).sort((a, b) => a - b)
      const horas = ts.length > 1 ? horasHabilesEntre(new Date(ts[0]).toISOString(), new Date(ts[ts.length - 1]).toISOString()) : 0
      const unidades = u(rs.filter((r) => r.estado === 'hecho'))
      return {
        nombre: rs[0].hecho_por_nombre ?? 'Sin nombre',
        legajo: rs[0].hecho_por_legajo,
        unidades,
        noMand: u(rs.filter((r) => r.estado === 'faltante')),
        primero: ts[0],
        ultimo: ts[ts.length - 1],
        horas,
        pph: horas > 0 ? unidades / horas : 0,
      }
    }).sort((a, b) => b.unidades - a.unidades)
    const conHoras = personas.filter((p) => p.horas > 0)
    return {
      total,
      hecho: u(hechos),
      faltante: u(faltan),
      destinos: [...new Set(renglones.map((r) => r.destino))].sort((a, b) => a.localeCompare(b, 'es')),
      hsTotal,
      pph: hsTotal > 0 ? u(hechos) / hsTotal : 0,
      personas,
      promHoras: conHoras.length ? conHoras.reduce((s, p) => s + p.horas, 0) / conHoras.length : 0,
      promPph: conHoras.length ? conHoras.reduce((s, p) => s + p.pph, 0) / conHoras.length : 0,
      pendientes: renglones.filter((r) => r.estado === 'pendiente'),
    }
  }, [renglones])

  // Matriz: artículo × destino
  const filas = useMemo(() => {
    const m = new Map<string, { articulo: string; desc: string; color: string; talle: string; porDestino: Map<string, RenglonTransfer> }>()
    for (const r of renglones) {
      const k = [r.articulo, r.descripcion, r.color, r.talle].join('|')
      let f = m.get(k)
      if (!f) { f = { articulo: r.articulo ?? '', desc: r.descripcion ?? '', color: r.color ?? '', talle: r.talle ?? '', porDestino: new Map() }; m.set(k, f) }
      f.porDestino.set(r.destino, r)
    }
    return [...m.values()].sort((a, b) => a.articulo.localeCompare(b.articulo) || a.color.localeCompare(b.color) || a.talle.localeCompare(b.talle, 'es', { numeric: true }))
  }, [renglones])

  if (!r0) return null
  const resueltos = st.hecho + st.faltante
  const pct = st.total ? Math.round((resueltos / st.total) * 100) : 0
  const w = (n: number) => (st.total ? `${(n / st.total) * 100}%` : '0%')
  const todoHecho = st.pendientes.length === 0

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <button
        onClick={() => setAbierto(!abierto)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${todoHecho ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-surface2'}`}
      >
        <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition-transform ${abierto ? 'rotate-90' : ''}`} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 font-medium text-ink">
            <span className="truncate">{r0.lote_nombre}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-500/35 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-400">
              <ArrowRightLeft size={10} aria-hidden /> Transferencia · sale de INDO
            </span>
          </p>
          <p className="truncate text-xs text-sub">
            Cargado {fechaHora(r0.lote_creado)} · {st.destinos.length} locales{r0.lote_motivo ? ` · ${r0.lote_motivo}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface2">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: w(st.hecho) }} />
            <div className="h-full bg-red-500 transition-all duration-300" style={{ width: w(st.faltante) }} />
          </div>
          <span className="text-xs tabular-nums text-sub">{resueltos}/{st.total} · {pct}%</span>
        </div>
      </button>

      {abierto && (
        <div className="border-t border-line">
          {/* Estadísticas, como la Eficiencia mayorista */}
          <div className="border-b border-line">
            <button onClick={() => setSub(sub === 'stats' ? null : 'stats')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-surface2">
              <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${sub === 'stats' ? 'rotate-90' : ''}`} />
              <BarChart3 size={15} aria-hidden className="text-sub" />
              <span className="font-display font-semibold text-ink">Estadísticas</span>
            </button>
            {sub === 'stats' && (
              <div className="space-y-3 px-4 pb-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  <Celda label="Cant repo">{st.total}</Celda>
                  <Celda label="No mand."><span className="text-red-400">{st.faltante}</span></Celda>
                  <Celda label="Locales">{st.destinos.length}</Celda>
                  <Celda label="HS total">{st.hsTotal ? num2(st.hsTotal) : '—'}</Celda>
                  <Celda label="Personas">{st.personas.length || '—'}</Celda>
                  <Celda label="Prend/HS">{st.pph ? num2(st.pph) : '—'}</Celda>
                  <Celda label="Avance">{pct}%</Celda>
                  <Celda label="Estado">
                    {todoHecho
                      ? <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-bold text-emerald-400">Finalizado</span>
                      : <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-500">En curso</span>}
                  </Celda>
                </div>
                <div className="overflow-x-auto">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sub">Por persona</p>
                  {st.personas.length === 0 ? (
                    <p className="text-sm text-sub">Todavía nadie marcó renglones de este lote.</p>
                  ) : (
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-line text-[11px] uppercase text-sub">
                          <th className="py-1.5 text-left">Persona</th>
                          <th className="py-1.5 text-right">Unidades</th>
                          <th className="py-1.5 text-right">No mand.</th>
                          <th className="py-1.5 text-right">Primer tilde</th>
                          <th className="py-1.5 text-right">Último tilde</th>
                          <th className="py-1.5 text-right"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{st.promHoras ? num2(st.promHoras) : '—'}</span>Horas</th>
                          <th className="py-1.5 text-right" title="Unidades hechas ÷ horas del primer al último tilde"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{st.promPph ? num2(st.promPph) : '—'}</span>Prend/HS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.personas.map((p) => (
                          <tr key={`${p.nombre}|${p.legajo ?? ''}`} className="border-b border-line/50 tabular-nums">
                            <td className="py-1.5 text-left text-ink">{p.nombre}{p.legajo ? <span className="text-sub"> #{p.legajo}</span> : null}</td>
                            <td className="py-1.5 text-right">{p.unidades}</td>
                            <td className="py-1.5 text-right text-red-400">{p.noMand}</td>
                            <td className="py-1.5 text-right">{hora(new Date(p.primero).toISOString())}</td>
                            <td className="py-1.5 text-right">{hora(new Date(p.ultimo).toISOString())}</td>
                            <td className="py-1.5 text-right">{p.horas ? num2(p.horas) : '—'}</td>
                            <td className="py-1.5 text-right">{p.pph ? num2(p.pph) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="mt-1.5 text-[11px] text-sub">Horas: del primer al último tilde, solo lunes a viernes de 9 a 17. Prend/HS: unidades hechas ÷ horas.</p>
                </div>
              </div>
            )}
          </div>

          {/* Reposición: artículos × locales */}
          <div className="flex items-center border-b border-line">
            <button onClick={() => setSub(sub === 'repo' ? null : 'repo')} className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left hover:bg-surface2">
              <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${sub === 'repo' ? 'rotate-90' : ''}`} />
              <ArrowRightLeft size={15} aria-hidden className="text-sub" />
              <span className="font-display font-semibold text-ink">Reposición</span>
            </button>
            {puedeMarcar && st.pendientes.length > 0 && (
              <button
                onClick={() => onMarcar(st.pendientes.map((r) => r.id), 'hecho')}
                className="flex shrink-0 items-center gap-1 border-l border-line px-3 py-2.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10"
                title="Marcar todo listo"
              >
                <Check size={14} aria-hidden /> Todo listo
              </button>
            )}
          </div>
          {sub === 'repo' && (
            <div className="overflow-x-auto px-3 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase text-sub">
                    <th className="px-2 py-1.5">Código</th>
                    <th className="px-2 py-1.5">Descripción</th>
                    <th className="px-2 py-1.5">Color</th>
                    <th className="px-2 py-1.5">Talle</th>
                    {st.destinos.map((d) => <th key={d} className="px-2 py-1.5 text-center">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className="border-b border-line/50">
                      <td className="px-2 py-1 font-mono text-xs">{f.articulo}</td>
                      <td className="px-2 py-1 text-xs">{f.desc}</td>
                      <td className="px-2 py-1 text-xs">{f.color}</td>
                      <td className="px-2 py-1 text-xs">{f.talle}</td>
                      {st.destinos.map((d) => {
                        const r = f.porDestino.get(d)
                        if (!r) return <td key={d} className="px-2 py-1 text-center text-sub/30">—</td>
                        const esHecho = r.estado === 'hecho'
                        const esFaltante = r.estado === 'faltante'
                        return (
                          <td key={d} className="px-2 py-1 text-center" title={r.hecho_por_nombre ? `Marcó ${r.hecho_por_nombre}` : undefined}>
                            <div className="flex items-center justify-center gap-0.5">
                              <span className={`tabular-nums ${esHecho ? 'text-emerald-400 line-through' : esFaltante ? 'text-brand-400 line-through' : ''}`}>{r.cantidad}</span>
                              {puedeMarcar && (
                                <>
                                  <button onClick={() => onMarcar([r.id], esHecho ? 'pendiente' : 'hecho')} title="Hecho" className={`rounded p-0.5 transition-colors ${esHecho ? 'bg-emerald-500/20 text-emerald-400' : 'text-sub/40 hover:text-emerald-400'}`}>
                                    <Check size={11} aria-hidden />
                                  </button>
                                  <button onClick={() => onMarcar([r.id], esFaltante ? 'pendiente' : 'faltante')} title="Faltante" className={`rounded p-0.5 transition-colors ${esFaltante ? 'bg-brand-600/20 text-brand-400' : 'text-sub/40 hover:text-brand-400'}`}>
                                    <X size={11} aria-hidden />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
