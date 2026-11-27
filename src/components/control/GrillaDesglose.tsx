import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Plus, Search, X } from 'lucide-react'
import { compararTalles } from '@/lib/ordenPiso'
import {
  coloresDragon,
  CURVAS_RAPIDAS,
  MOTIVOS_DIFERENCIA,
  n0,
  tallesDragon,
  type Desglose,
  type ItemMaestro,
  type LineaControl,
} from '@/lib/controlFisico'

const esSinColor = (c: string) => ['', '0', '00'].includes(c.trim().toUpperCase())
const esSinTalle = (t: string) => ['', 'U', 'UNICO', 'ÚNICO'].includes(t.trim().toUpperCase())

/**
 * Desglose de un renglón 00 / U en color × talle (siempre se desglosa).
 * Filas = colores y columnas = talles, elegidos solo de los maestros de Dragon Indo.
 * Si el renglón ya trae color (o talle), esa dimensión queda fija.
 */
export default function GrillaDesglose({
  linea,
  onVolver,
  onGuardar,
}: {
  linea: LineaControl
  onVolver: () => void
  onGuardar: (desglose: Desglose[], motivo: string | null) => Promise<void>
}) {
  const colorFijo = !esSinColor(linea.color)
  const talleFijo = !esSinTalle(linea.talle)

  const [colores, setColores] = useState<ItemMaestro[]>(() => {
    if (colorFijo) return [{ codigo: linea.color, descripcion: '' }]
    const vistos = new Map<string, ItemMaestro>()
    for (const d of linea.desglose ?? []) if (!vistos.has(d.color)) vistos.set(d.color, { codigo: d.color, descripcion: d.color_desc ?? '' })
    return [...vistos.values()]
  })
  const [talles, setTalles] = useState<string[]>(() => {
    if (talleFijo) return [linea.talle]
    return [...new Set((linea.desglose ?? []).map((d) => d.talle))].sort(compararTalles)
  })
  const [cant, setCant] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const d of linea.desglose ?? []) m[`${d.color}|${d.talle}`] = String(d.cantidad)
    return m
  })
  const [motivo, setMotivo] = useState(linea.motivo ?? '')
  const [buscar, setBuscar] = useState<'color' | 'talle' | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Descripción de los colores ya cargados (y del color fijo) desde Dragon
  const [maestroColores, setMaestroColores] = useState<ItemMaestro[]>([])
  const [maestroTalles, setMaestroTalles] = useState<ItemMaestro[]>([])
  const [errMaestro, setErrMaestro] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let vivo = true
    setErrMaestro(null)
    Promise.all([coloresDragon(intento > 0), tallesDragon(intento > 0)])
      .then(([c, t]) => { if (vivo) { setMaestroColores(c); setMaestroTalles(t) } })
      .catch((e: Error) => { if (vivo) setErrMaestro(e.message) })
    return () => { vivo = false }
  }, [intento])
  const descColor = (cod: string, fallback: string) => fallback || maestroColores.find((c) => c.codigo === cod)?.descripcion || ''

  const valor = (c: string, t: string) => {
    const v = parseInt(cant[`${c}|${t}`] ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const total = colores.reduce((s, c) => s + talles.reduce((s2, t) => s2 + valor(c.codigo, t), 0), 0)
  const falta = linea.picking - total
  const pideMotivo = total < linea.picking

  function agregarColor(item: ItemMaestro) {
    if (!colores.some((c) => c.codigo === item.codigo)) setColores((cs) => [...cs, item])
    setBuscar(null)
  }
  function agregarTalles(lista: string[]) {
    setTalles((ts) => [...new Set([...ts, ...lista])].sort(compararTalles))
  }
  function quitarColor(cod: string) {
    if (colorFijo) return
    setColores((cs) => cs.filter((c) => c.codigo !== cod))
    setCant((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${cod}|`))))
  }
  function quitarTalle(t: string) {
    if (talleFijo) return
    setTalles((ts) => ts.filter((x) => x !== t))
    setCant((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.endsWith(`|${t}`))))
  }

  async function guardar() {
    setError(null)
    if (pideMotivo && !motivo) { setError(`Faltan ${n0.format(falta)} u.: elegí el motivo.`); return }
    const desglose: Desglose[] = []
    for (const c of colores) {
      for (const t of talles) {
        const v = valor(c.codigo, t)
        if (v > 0) desglose.push({ color: c.codigo, color_desc: descColor(c.codigo, c.descripcion) || null, talle: t, cantidad: v })
      }
    }
    setGuardando(true)
    try {
      await onGuardar(desglose, pideMotivo ? motivo : null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const tallesDisponibles = new Set(maestroTalles.map((t) => t.codigo))
  const barra = total < linea.picking ? 'bg-violet-500' : total === linea.picking ? 'bg-emerald-500' : 'bg-lime-400'

  return (
    <div className="space-y-3 pb-4">
      <button type="button" onClick={onVolver} className="inline-flex items-center gap-1.5 text-sm font-medium text-sub hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Renglones del picking
      </button>
      <div>
        <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-bold text-ink">
          {linea.articulo}
          <span className="rounded-md border border-dashed border-violet-500/50 bg-violet-500/10 px-1.5 text-xs font-bold text-violet-400">
            {linea.color || '—'} · {linea.talle || '—'}
          </span>
        </h2>
        <p className="text-sm text-sub">
          {linea.descripcion || '—'} · el picking dice <b className="text-ink">{n0.format(linea.picking)} u.</b>
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">
          {colorFijo ? `Cargá cuántas hay de cada talle (color ${linea.color})` : talleFijo ? `Cargá cuántas hay de cada color (talle ${linea.talle})` : 'Cargá cuántas hay de cada color y talle'}
        </p>
      </div>

      {errMaestro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">
          No se pudieron traer los colores y talles de Dragon: {errMaestro}{' '}
          <button type="button" onClick={() => setIntento((n) => n + 1)} className="font-semibold underline">Reintentar</button>
        </div>
      )}

      {colores.length > 0 && talles.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-sky-400">Color</th>
                {talles.map((t) => (
                  <th key={t} className="min-w-[3.25rem] text-center text-xs font-semibold text-violet-400">
                    {t}
                    {!talleFijo && (
                      <button type="button" onClick={() => quitarTalle(t)} className="ml-0.5 align-middle text-sub hover:text-red-400" aria-label={`Quitar talle ${t}`}>
                        <X size={11} aria-hidden />
                      </button>
                    )}
                  </th>
                ))}
                <th className="text-center text-xs text-sub">Tot.</th>
              </tr>
            </thead>
            <tbody>
              {colores.map((c) => (
                <tr key={c.codigo}>
                  <th className="max-w-[7.5rem] pr-1 text-left text-xs font-bold text-sky-400">
                    <span className="flex items-center gap-1">
                      <span className="truncate">{c.codigo} {descColor(c.codigo, c.descripcion)}</span>
                      {!colorFijo && (
                        <button type="button" onClick={() => quitarColor(c.codigo)} className="shrink-0 text-sub hover:text-red-400" aria-label={`Quitar color ${c.codigo}`}>
                          <X size={12} aria-hidden />
                        </button>
                      )}
                    </span>
                  </th>
                  {talles.map((t) => {
                    const k = `${c.codigo}|${t}`
                    const lleno = valor(c.codigo, t) > 0
                    return (
                      <td key={t}>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={cant[k] ?? ''}
                          onChange={(e) => setCant((m) => ({ ...m, [k]: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                          aria-label={`Cantidad ${c.codigo} talle ${t}`}
                          className={`h-11 w-full min-w-[3.25rem] rounded-xl border text-center text-base font-bold text-ink outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 ${lleno ? 'border-sky-500/50 bg-sky-500/10' : 'border-line bg-surface2'}`}
                        />
                      </td>
                    )
                  })}
                  <td className="text-center font-bold tabular-nums text-sub">{talles.reduce((s, t) => s + valor(c.codigo, t), 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="text-left text-xs text-sub">Tot.</th>
                {talles.map((t) => (
                  <td key={t} className="text-center font-bold tabular-nums text-sub">{colores.reduce((s, c) => s + valor(c.codigo, t), 0)}</td>
                ))}
                <td className="text-center font-bold tabular-nums text-ink">{total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-sub">
          {colores.length === 0 ? 'Agregá los colores que hay en el piso' : 'Agregá los talles'}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!colorFijo && (
          <button type="button" onClick={() => setBuscar('color')} className="inline-flex items-center gap-1 rounded-xl border border-dashed border-sky-500/60 px-3 py-2 text-sm font-semibold text-sky-400">
            <Plus size={15} aria-hidden /> Color de Dragon
          </button>
        )}
        {!talleFijo && (
          <button type="button" onClick={() => setBuscar('talle')} className="inline-flex items-center gap-1 rounded-xl border border-dashed border-violet-500/60 px-3 py-2 text-sm font-semibold text-violet-400">
            <Plus size={15} aria-hidden /> Talle de Dragon
          </button>
        )}
      </div>
      {!talleFijo && (
        <div className="flex flex-wrap gap-1.5">
          {CURVAS_RAPIDAS.map((cv) => {
            const ok = cv.talles.filter((t) => !maestroTalles.length || tallesDisponibles.has(t))
            return (
              <button key={cv.nombre} type="button" onClick={() => agregarTalles(ok)} disabled={!ok.length}
                className="rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-semibold text-sub hover:text-ink disabled:opacity-40">
                {cv.nombre}
              </button>
            )
          })}
        </div>
      )}

      <div className="sticky bottom-2 space-y-2 rounded-2xl border border-line bg-surface p-3 shadow-soft">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sub">Repartido</span>
          <b className="font-display text-lg tabular-nums text-ink">{n0.format(total)} / {n0.format(linea.picking)}</b>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full ${barra}`} style={{ width: `${Math.min(100, linea.picking ? (total / linea.picking) * 100 : 100)}%` }} />
        </div>
        {total < linea.picking && (
          <div className="space-y-1.5 rounded-xl border border-dashed border-violet-500/50 bg-violet-500/10 p-2 text-xs text-violet-300">
            <p>Faltan repartir <b>{n0.format(falta)}</b>. Si físicamente no están, elegí el motivo:</p>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
              <option value="">Motivo…</option>
              {MOTIVOS_DIFERENCIA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
        {total === linea.picking && total > 0 && (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs font-semibold text-emerald-400">✓ Coincide con el picking.</p>
        )}
        {total > linea.picking && (
          <p className="rounded-xl border border-lime-400/40 bg-lime-400/10 p-2 text-xs text-lime-300">
            Contaste <b>{n0.format(total - linea.picking)}</b> de más que el picking. Se guarda y queda como diferencia.
          </p>
        )}
        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}
        <button type="button" onClick={() => void guardar()} disabled={guardando}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-60">
          {guardando && <Loader2 size={16} className="animate-spin" aria-hidden />} Guardar desglose
        </button>
      </div>

      {buscar && (
        <BuscadorMaestro
          titulo={buscar === 'color' ? 'Agregar color' : 'Agregar talle'}
          items={buscar === 'color' ? maestroColores : maestroTalles}
          error={errMaestro}
          yaElegidos={new Set(buscar === 'color' ? colores.map((c) => c.codigo) : talles)}
          onElegir={(it) => (buscar === 'color' ? agregarColor(it) : (agregarTalles([it.codigo]), setBuscar(null)))}
          onCerrar={() => setBuscar(null)}
        />
      )}
    </div>
  )
}

function BuscadorMaestro({
  titulo,
  items,
  yaElegidos,
  onElegir,
  onCerrar,
  error,
}: {
  titulo: string
  items: ItemMaestro[]
  error: string | null
  yaElegidos: Set<string>
  onElegir: (it: ItemMaestro) => void
  onCerrar: () => void
}) {
  const [q, setQ] = useState('')
  const filtrados = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) return items.slice(0, 60)
    const palabras = t.split(/\s+/)
    const cumple = items.filter((it) => palabras.every((p) => `${it.codigo} ${it.descripcion}`.toUpperCase().includes(p)))
    // primero el código exacto, después los que empiezan igual
    return cumple
      .sort((a, b) => Number(b.codigo === t) - Number(a.codigo === t) || Number(b.codigo.startsWith(t)) - Number(a.codigo.startsWith(t)))
      .slice(0, 80)
  }, [q, items])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onCerrar}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface p-3 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-ink">{titulo}</h3>
          <button type="button" onClick={onCerrar} className="p-1 text-sub hover:text-ink" aria-label="Cerrar"><X size={18} aria-hidden /></button>
        </div>
        <div className="relative mb-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o nombre (ej. 06, verde)"
            className="h-11 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-sm text-ink outline-none focus:border-orange-500" />
        </div>
        <p className="mb-1 text-xs text-sub">{items.length ? `${n0.format(items.length)} en Dragon Indo` : error ? `No se pudo traer de Dragon: ${error}` : 'Cargando de Dragon…'}</p>
        <ul className="min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
          {filtrados.map((it) => {
            const ya = yaElegidos.has(it.codigo)
            return (
              <li key={it.codigo}>
                <button type="button" disabled={ya} onClick={() => onElegir(it)}
                  className="flex w-full items-center gap-2 px-1 py-2.5 text-left text-sm text-ink hover:bg-surface2 disabled:opacity-40">
                  <span className="min-w-[2.5rem] rounded bg-sky-500/15 px-1.5 text-center text-xs font-bold text-sky-400">{it.codigo}</span>
                  <span className="flex-1 truncate">{it.descripcion && it.descripcion !== it.codigo ? it.descripcion : ''}</span>
                  <span className="text-xs font-semibold text-emerald-400">{ya ? 'Ya está' : 'Agregar'}</span>
                </button>
              </li>
            )
          })}
          {!filtrados.length && items.length > 0 && <li className="px-1 py-6 text-center text-sm text-sub">No está en Dragon. Pedile a Compras que lo dé de alta.</li>}
        </ul>
      </div>
    </div>
  )
}
