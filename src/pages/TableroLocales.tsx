/* ------------------------------------------------------------------ */
/*  Administración > Tablero locales (/administracion/tablero-locales) */
/*  Las hojas Caja y Errores de caja del Tablero del local             */
/*  (TableroLocal.exe), para uno o varios locales a la vez. En vivo    */
/*  desde la base Dragonfish de cada local por el Puente SQL.          */
/*  Maqueta aprobada: mockups/tablero-locales.html. Solo lectura.      */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Banknote, CalendarRange, Loader2, RefreshCw, TriangleAlert, Wallet, Receipt, Target, Scale, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import MultiselectFiltro from '@/components/MultiselectFiltro'
import { useLocalesPublicos } from '@/lib/localesPublicos'
import { isoLocal } from '@/lib/flexxus'
import {
  cargarArticulos,
  cargarBilletes,
  cargarCaja,
  cargarErrores,
  esCaptain,
  type ArticuloComp,
  type Billete,
  type CajaLocal,
  type Cobro,
  type RespCaja,
  type RespErrores,
} from '@/lib/tableroLocales'

const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const pesos = (v: number | null | undefined) => (v == null ? '—' : PESOS.format(Math.abs(v) < 0.5 ? 0 : v))
const numero = (v: number) => v.toLocaleString('es-AR')
const fechaAr = (f: string) => (f ? f.split('-').reverse().join('/') : '')
const hhmm = (h: string | null | undefined) => (h ?? '').slice(0, 5)
const ult = <T,>(a: T[]): T | undefined => a[a.length - 1]

const btnChico =
  'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'
const inputFecha = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink'
const tarjeta = 'min-w-0 rounded-2xl border border-line bg-surface p-3'
const tituloTarjeta = 'mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-ink'

function sumarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

/* ------------------------- tabla ordenable ------------------------- */

interface Col<T> {
  t: string
  /** valor para ordenar (y lo que se muestra si no hay r) */
  v: (f: T) => number | string
  r?: (f: T) => ReactNode
  n?: boolean
  suma?: (fs: T[]) => ReactNode
  cls?: (f: T) => string
}

/** Tocar un encabezado ordena: ascendente → descendente → orden original. */
function Tabla<T>({ cols, filas, total, onFila, sel, alto = 'max-h-[26rem]', vacio = 'Sin datos' }: {
  cols: Col<T>[]
  filas: T[]
  total?: boolean
  onFila?: (f: T) => void
  sel?: (f: T) => boolean
  alto?: string
  vacio?: string
}) {
  const [orden, setOrden] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const ordenadas = useMemo(() => {
    if (!orden || !cols[orden.col]) return filas
    const c = cols[orden.col]
    return [...filas].sort((a, b) => {
      const x = c.v(a)
      const y = c.v(b)
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })
      return r * orden.dir
    })
  }, [filas, orden, cols])
  const tocar = (j: number) =>
    setOrden((o) => (!o || o.col !== j ? { col: j, dir: 1 } : o.dir === 1 ? { col: j, dir: -1 } : null))

  if (!filas.length) return <p className="py-6 text-center text-xs text-sub">{vacio}</p>
  const fijo = 'sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_rgba(127,127,127,0.3)]'
  return (
    <div className={`${alto} overflow-auto`}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-sub">
            {cols.map((c, j) => {
              const activa = orden?.col === j
              const Flecha = activa ? (orden!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th key={j} className={`${fijo} whitespace-nowrap px-2.5 py-2 font-medium ${c.n ? 'text-right' : ''}`}>
                  <button
                    type="button"
                    onClick={() => tocar(j)}
                    title="Ordenar"
                    className={`group inline-flex items-center gap-1 uppercase hover:text-ink ${activa ? 'text-sky-500' : ''}`}
                  >
                    {c.t}
                    <Flecha size={11} className={activa ? '' : 'opacity-30 group-hover:opacity-80'} aria-hidden />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f, i) => (
            <tr
              key={i}
              onClick={onFila ? () => onFila(f) : undefined}
              className={`border-b border-line/50 last:border-0 ${onFila ? 'cursor-pointer hover:bg-surface2' : ''} ${sel?.(f) ? 'bg-sky-500/10' : ''}`}
            >
              {cols.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-2.5 py-1.5 ${c.n ? 'text-right tabular-nums' : ''} ${c.cls?.(f) ?? ''}`}>
                  {c.r ? c.r(f) : c.v(f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t-2 border-line font-semibold text-ink">
              {cols.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-2.5 py-2 ${c.n ? 'text-right tabular-nums' : ''}`}>
                  {j === 0 ? 'Total' : c.suma?.(filas) ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const sumaPesos = <T,>(fn: (f: T) => number) => (fs: T[]) => pesos(fs.reduce((s, f) => s + fn(f), 0))
const sumaNum = <T,>(fn: (f: T) => number) => (fs: T[]) => numero(fs.reduce((s, f) => s + fn(f), 0))
const colorDif = (v: number) => (Math.abs(v) < 0.5 ? 'text-sub' : v > 0 ? 'text-emerald-500' : 'text-rose-500')

function Kpi({ titulo, valor, pie, icono: Icono, color, valorCls = '' }: { titulo: string; valor: string; pie?: ReactNode; icono: typeof Wallet; color: string; valorCls?: string }) {
  return (
    <div className={tarjeta}>
      <p className="flex items-center gap-1.5 text-xs text-sub">
        <Icono size={14} style={{ color }} aria-hidden /> {titulo}
      </p>
      <p className={`mt-1 font-display text-2xl font-semibold ${valorCls || 'text-ink'}`}>{valor}</p>
      {pie && <p className="text-[11px] text-sub/80">{pie}</p>}
    </div>
  )
}

function useCarga<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setDatos(await fn())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, deps)
  useEffect(() => {
    void cargar()
  }, [cargar])
  return { datos, cargando, error, cargar }
}

/* ============================== pantalla ============================== */

type Hoja = 'caja' | 'errores'

export default function TableroLocales() {
  const locales = useLocalesPublicos()
  const nombre = useCallback((cod: string) => locales.find((l) => l.codigo === cod)?.nombre ?? cod, [locales])
  const [hoja, setHoja] = useState<Hoja>('caja')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set()) // vacío = todos
  const hoy = isoLocal(new Date())
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)

  const opciones = useMemo(
    () =>
      [...locales]
        .sort((a, b) => Number(esCaptain(a.codigo)) - Number(esCaptain(b.codigo)) || a.nombre.localeCompare(b.nombre))
        .map((l) => ({ id: l.codigo, label: l.nombre })),
    [locales],
  )
  const lista = useMemo(() => [...elegidos].sort(), [elegidos])
  const marca = (captain: boolean) => setElegidos(new Set(locales.filter((l) => esCaptain(l.codigo) === captain).map((l) => l.codigo)))

  const ayer = sumarDias(hoy, -1)
  const presets = [
    { texto: 'Hoy', d: hoy, h: hoy },
    { texto: 'Ayer', d: ayer, h: ayer },
    { texto: '7 días', d: sumarDias(hoy, -6), h: hoy },
    { texto: 'Este mes', d: `${hoy.slice(0, 8)}01`, h: hoy },
  ]

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Banknote size={22} className="text-teal-500" aria-hidden /> Tablero locales
        </h1>
        <span className="text-xs text-sub/70">caja y errores de caja, en vivo desde Dragon · solo lectura</span>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {([
            { id: 'caja', texto: 'Caja', icono: Wallet, color: '#10b981' },
            { id: 'errores', texto: 'Errores de caja', icono: AlertTriangle, color: '#f59e0b' },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setHoja(t.id)}
              className={`btn-press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${hoja === t.id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'}`}
            >
              <t.icono size={15} style={{ color: hoja === t.id ? t.color : undefined }} aria-hidden />
              {t.texto}
            </button>
          ))}
        </div>
        <div className="w-56">
          <MultiselectFiltro label="Locales" opciones={opciones} seleccionadas={elegidos} onChange={setElegidos} />
        </div>
        <button type="button" className={btnChico} onClick={() => marca(false)}>Solo Mito</button>
        <button type="button" className={btnChico} onClick={() => marca(true)}>Solo Captain Fin</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarRange size={16} className="text-sub" aria-hidden />
        <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={inputFecha} aria-label="Desde" />
        <span className="text-xs text-sub">a</span>
        <input type="date" value={hasta} min={desde} max={hoy} onChange={(e) => e.target.value && setHasta(e.target.value)} className={inputFecha} aria-label="Hasta" />
        {presets.map((p) => (
          <button
            key={p.texto}
            type="button"
            onClick={() => { setDesde(p.d); setHasta(p.h) }}
            className={`${btnChico} ${desde === p.d && hasta === p.h ? 'border-sky-500/50 text-sky-500' : ''}`}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {elegidos.size > 0 && elegidos.size < locales.length && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {lista.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-500">
              {nombre(c)}
              <button
                type="button"
                aria-label={`Sacar ${nombre(c)}`}
                onClick={() => setElegidos((s) => { const n = new Set(s); n.delete(c); return n })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {hoja === 'caja' ? (
        <HojaCaja desde={desde} hasta={hasta} locales={lista} nombre={nombre} />
      ) : (
        <HojaErrores desde={desde} hasta={hasta} locales={lista} nombre={nombre} />
      )}
    </Layout>
  )
}

function Estado({ cargando, error, onRecargar }: { cargando: boolean; error: string | null; onRecargar: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className={btnChico} onClick={onRecargar} disabled={cargando}>
        {cargando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Actualizar
      </button>
      {cargando && <span className="text-xs text-sub">Leyendo las bases de los locales…</span>}
      {error && (
        <span className="inline-flex items-center gap-1 text-xs text-rose-500">
          <TriangleAlert size={13} /> {error}
        </span>
      )}
    </div>
  )
}

/* ================================ CAJA ================================ */

interface FilaLocal {
  cod: string
  datos: CajaLocal
  venta: number
  tickets: number
  objetivo: number | null
  efectivo: number
  difArqueos: number
  arqueos: number
  cierre: string
}

function HojaCaja({ desde, hasta, locales, nombre }: { desde: string; hasta: string; locales: string[]; nombre: (c: string) => string }) {
  const { datos, cargando, error, cargar } = useCarga<RespCaja>(() => cargarCaja(desde, hasta, locales), [desde, hasta, locales.join(',')])
  const [detalle, setDetalle] = useState<string | null>(null)
  const [concepto, setConcepto] = useState('')

  const filas = useMemo<FilaLocal[]>(() => {
    if (!datos) return []
    const objs = new Map<string, number>()
    for (const o of datos.objetivos ?? []) if (o.objetivo != null) objs.set(o.local, (objs.get(o.local) ?? 0) + o.objetivo)
    return datos.locales
      .filter((l) => l.ok)
      .map((l) => ({
        cod: l.local,
        datos: l,
        venta: l.dias.reduce((s, d) => s + d.monto, 0),
        tickets: l.dias.reduce((s, d) => s + d.tickets, 0),
        objetivo: objs.get(l.local) ?? null,
        efectivo: l.valores.filter((v) => /PESOS|EFECTIVO/i.test(`${v.grupo} ${v.nombre}`)).reduce((s, v) => s + v.monto, 0),
        difArqueos: l.arqueos.reduce((s, a) => s + a.diferencia, 0),
        arqueos: l.arqueos.length,
        cierre: hhmm(ult(l.cierres)?.hora),
      }))
  }, [datos])
  const fallidos = datos?.locales.filter((l) => !l.ok) ?? []

  useEffect(() => {
    if (detalle && !filas.some((f) => f.cod === detalle)) setDetalle(null)
  }, [filas, detalle])

  const venta = filas.reduce((s, f) => s + f.venta, 0)
  const objetivo = filas.reduce((s, f) => s + (f.objetivo ?? 0), 0)
  const tickets = filas.reduce((s, f) => s + f.tickets, 0)
  const difArq = filas.reduce((s, f) => s + f.difArqueos, 0)
  const conDif = filas.filter((f) => f.datos.arqueos.some((a) => Math.abs(a.diferencia) >= 0.5)).length
  const det = filas.find((f) => f.cod === detalle) ?? (filas.length === 1 ? filas[0] : null)

  // valores y grupos sumados entre los locales elegidos
  const valores = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; grupo: string; recargo: number; monto: number }>()
    for (const f of filas)
      for (const v of f.datos.valores) {
        const clave = `${v.id}|${v.nombre}`
        const x = m.get(clave) ?? { id: v.id, nombre: v.nombre, grupo: v.grupo, recargo: 0, monto: 0 }
        x.recargo += v.recargo
        x.monto += v.monto
        m.set(clave, x)
      }
    return [...m.values()].sort((a, b) => b.monto - a.monto)
  }, [filas])
  const grupos = useMemo(() => {
    const m = new Map<string, { grupo: string; recargo: number; monto: number }>()
    for (const v of valores) {
      const x = m.get(v.grupo) ?? { grupo: v.grupo || '—', recargo: 0, monto: 0 }
      x.recargo += v.recargo
      x.monto += v.monto
      m.set(v.grupo, x)
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto)
  }, [valores])
  const conceptos = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of filas) for (const c of f.datos.comprobantes) m.set(c.concepto, c.conceptoDesc ?? '')
    return [...m.entries()].sort()
  }, [filas])

  const varios = filas.length > 1
  return (
    <>
      <Estado cargando={cargando} error={error} onRecargar={() => void cargar()} />
      {fallidos.length > 0 && (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          No se pudo leer: {fallidos.map((f) => `${nombre(f.local)} (${f.error})`).join(' · ')}
        </p>
      )}
      {datos && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Venta" valor={pesos(venta)} pie={`${filas.length} local${filas.length === 1 ? '' : 'es'}`} icono={Wallet} color="#10b981" />
            <Kpi
              titulo="Objetivo"
              valor={objetivo ? pesos(objetivo) : '—'}
              pie={objetivo ? <span className={colorDif(venta - objetivo)}>{venta >= objetivo ? 'SOBRÓ' : 'FALTÓ'} {pesos(venta - objetivo)}</span> : 'sin objetivo cargado'}
              icono={Target}
              color="#8b5cf6"
            />
            <Kpi titulo="Ticket promedio" valor={tickets ? pesos(venta / tickets) : '—'} pie={`${numero(tickets)} tickets`} icono={Receipt} color="#0ea5e9" />
            <Kpi titulo="Diferencia de arqueos" valor={pesos(difArq)} valorCls={colorDif(difArq)} pie={`${conDif} de ${filas.length} con diferencia`} icono={Scale} color="#f43f5e" />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {varios && (
              <div className={`${tarjeta} lg:col-span-2`}>
                <h3 className={tituloTarjeta}>
                  Por local <span className="text-xs font-normal text-sub">tocá un local para ver su caja completa</span>
                </h3>
                <Tabla<FilaLocal>
                  filas={filas}
                  total
                  onFila={(f) => setDetalle((d) => (d === f.cod ? null : f.cod))}
                  sel={(f) => f.cod === detalle}
                  cols={[
                    { t: 'Local', v: (f) => nombre(f.cod), r: (f) => <span className="font-medium text-ink">{nombre(f.cod)}</span> },
                    { t: 'Venta', n: true, v: (f) => f.venta, r: (f) => pesos(f.venta), suma: sumaPesos((f) => f.venta) },
                    { t: 'Objetivo', n: true, v: (f) => f.objetivo ?? 0, r: (f) => pesos(f.objetivo), suma: sumaPesos((f) => f.objetivo ?? 0) },
                    { t: 'Diferencia', n: true, v: (f) => (f.objetivo ? f.venta - f.objetivo : 0), r: (f) => (f.objetivo ? pesos(f.venta - f.objetivo) : '—'), cls: (f) => (f.objetivo ? colorDif(f.venta - f.objetivo) : '') },
                    { t: '%', n: true, v: (f) => (f.objetivo ? f.venta / f.objetivo - 1 : 0), r: (f) => (f.objetivo ? `${((f.venta / f.objetivo - 1) * 100).toFixed(1)}%` : '') },
                    {
                      t: 'Estado',
                      v: (f) => (f.objetivo == null ? '' : f.venta >= f.objetivo ? 'SOBRÓ' : 'FALTÓ'),
                      r: (f) =>
                        f.objetivo == null ? '' : (
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${f.venta >= f.objetivo ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}`}>
                            {f.venta >= f.objetivo ? 'SOBRÓ' : 'FALTÓ'}
                          </span>
                        ),
                    },
                    { t: 'Tickets', n: true, v: (f) => f.tickets, r: (f) => numero(f.tickets), suma: sumaNum((f) => f.tickets) },
                    { t: 'Efectivo', n: true, v: (f) => f.efectivo, r: (f) => pesos(f.efectivo), suma: sumaPesos((f) => f.efectivo) },
                    { t: 'Arqueos', n: true, v: (f) => f.arqueos, r: (f) => numero(f.arqueos), suma: sumaNum((f) => f.arqueos) },
                    { t: 'Dif. arqueos', n: true, v: (f) => f.difArqueos, r: (f) => pesos(f.difArqueos), cls: (f) => colorDif(f.difArqueos), suma: sumaPesos((f) => f.difArqueos) },
                    { t: 'Cierre', v: (f) => f.cierre, r: (f) => f.cierre || '—' },
                  ]}
                />
              </div>
            )}

            {det && (
              <DetalleLocal
                key={det.cod}
                fila={det}
                nombre={nombre}
                objetivos={datos.objetivos.filter((o) => o.local === det.cod)}
                concepto={concepto}
                setConcepto={setConcepto}
                conceptos={conceptos}
                onCerrar={varios ? () => setDetalle(null) : undefined}
              />
            )}

            <div className={tarjeta}>
              <h3 className={tituloTarjeta}>
                Venta por valores {varios && <span className="text-xs font-normal text-sub">suma de los locales elegidos</span>}
              </h3>
              <Tabla
                filas={valores}
                total
                cols={[
                  { t: 'Valor', v: (v) => `${v.id} - ${v.nombre}` },
                  { t: 'Recargo', n: true, v: (v) => v.recargo, r: (v) => pesos(v.recargo), suma: sumaPesos((v) => v.recargo) },
                  { t: 'Monto', n: true, v: (v) => v.monto, r: (v) => pesos(v.monto), suma: sumaPesos((v) => v.monto) },
                ]}
              />
            </div>
            <div className={tarjeta}>
              <h3 className={tituloTarjeta}>Venta por grupo de valor</h3>
              <Tabla
                filas={grupos}
                total
                cols={[
                  { t: 'Grupo', v: (g) => g.grupo },
                  { t: 'Recargo', n: true, v: (g) => g.recargo, r: (g) => pesos(g.recargo), suma: sumaPesos((g) => g.recargo) },
                  { t: 'Total', n: true, v: (g) => g.monto, r: (g) => pesos(g.monto), suma: sumaPesos((g) => g.monto) },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}

function DetalleLocal({ fila, nombre, objetivos, concepto, setConcepto, conceptos, onCerrar }: {
  fila: FilaLocal
  nombre: (c: string) => string
  objetivos: Array<{ fecha: string; objetivo: number | null }>
  concepto: string
  setConcepto: (c: string) => void
  conceptos: Array<[string, string]>
  onCerrar?: () => void
}) {
  const d = fila.datos
  const [arqueo, setArqueo] = useState(ult(d.arqueos)?.codigo ?? '')
  const [billetes, setBilletes] = useState<Billete[] | null>(null)
  const [errBil, setErrBil] = useState<string | null>(null)
  const unDia = new Set(d.dias.map((x) => x.fecha)).size <= 1 && new Set(d.arqueos.map((a) => a.fecha)).size <= 1

  useEffect(() => {
    if (!arqueo) return setBilletes([])
    let vivo = true
    setBilletes(null)
    setErrBil(null)
    cargarBilletes(d.local, arqueo)
      .then((r) => vivo && setBilletes(r.billetes))
      .catch((e: unknown) => vivo && setErrBil(e instanceof Error ? e.message : String(e)))
    return () => { vivo = false }
  }, [d.local, arqueo])

  const arq = d.arqueos.find((a) => a.codigo === arqueo)
  const objPorDia = new Map(objetivos.map((o) => [o.fecha, o.objetivo]))
  const filasVT = d.dias.map((x) => {
    const o = objPorDia.get(x.fecha) ?? null
    return { fecha: x.fecha, monto: x.monto, objetivo: o, dif: o ? x.monto - o : null }
  })
  const comps = concepto ? d.comprobantes.filter((c) => c.concepto === concepto) : d.comprobantes
  const conVenta = d.vendedores.filter((v) => v.monto > 0)
  const primero = conVenta.reduce<(typeof conVenta)[number] | null>((a, b) => (!a || b.monto > a.monto ? b : a), null)
  const ultimo = conVenta.reduce<(typeof conVenta)[number] | null>((a, b) => (!a || b.monto < a.monto ? b : a), null)

  return (
    <div className={`${tarjeta} border-sky-500/50 lg:col-span-2`}>
      <h3 className={tituloTarjeta}>
        <span>Caja de <span className="text-sky-500">{nombre(d.local)}</span></span>
        {onCerrar && (
          <button type="button" className={btnChico} onClick={onCerrar}>
            <X size={13} /> Cerrar
          </button>
        )}
      </h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={tarjeta}>
          <h3 className={tituloTarjeta}>Venta total</h3>
          <Tabla
            filas={filasVT}
            total={filasVT.length > 1}
            alto="max-h-60"
            cols={[
              { t: 'Fecha', v: (f) => f.fecha, r: (f) => fechaAr(f.fecha) },
              { t: 'Venta', n: true, v: (f) => f.monto, r: (f) => pesos(f.monto), suma: sumaPesos((f) => f.monto) },
              { t: 'Objetivo', n: true, v: (f) => f.objetivo ?? 0, r: (f) => pesos(f.objetivo), suma: sumaPesos((f) => f.objetivo ?? 0) },
              { t: 'Dif.', n: true, v: (f) => f.dif ?? 0, r: (f) => pesos(f.dif), cls: (f) => (f.dif == null ? '' : colorDif(f.dif)) },
            ]}
          />
        </div>
        <div className={tarjeta}>
          <h3 className={tituloTarjeta}>
            Arqueo de caja
            {d.arqueos.length > 0 && (
              <select value={arqueo} onChange={(e) => setArqueo(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" aria-label="Número de arqueo">
                {d.arqueos.map((a) => (
                  <option key={a.codigo} value={a.codigo}>
                    Nº {a.numero} · {unDia ? '' : `${fechaAr(a.fecha).slice(0, 5)} `}{hhmm(a.hora)}
                  </option>
                ))}
              </select>
            )}
          </h3>
          {arq ? (
            <>
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sub">
                <span>Contado <b className="text-ink">{pesos(arq.arqueado)}</b></span>
                <span>Sistema <b className="text-ink">{pesos(arq.sistema)}</b></span>
                <span>Dif. <b className={colorDif(arq.diferencia)}>{pesos(arq.diferencia)}</b></span>
                <span>{arq.vendedor}</span>
              </div>
              {errBil ? (
                <p className="text-xs text-rose-500">{errBil}</p>
              ) : !billetes ? (
                <p className="text-xs text-sub"><Loader2 size={12} className="inline animate-spin" /> Cargando billetes…</p>
              ) : (
                <Tabla
                  filas={billetes}
                  total
                  alto="max-h-60"
                  vacio="Sin billetes en este arqueo"
                  cols={[
                    { t: 'Valor', v: (b) => b.billete.replace(/^Billete de /i, '') },
                    { t: 'Cant.', n: true, v: (b) => b.cantidad, r: (b) => numero(b.cantidad), suma: sumaNum((b) => b.cantidad) },
                    { t: 'Total', n: true, v: (b) => b.total, r: (b) => pesos(b.total), suma: sumaPesos((b) => b.total) },
                  ]}
                />
              )}
            </>
          ) : (
            <p className="py-6 text-center text-xs text-sub">Sin arqueos en el período</p>
          )}
        </div>
        <div className="grid min-w-0 content-start gap-3">
          <Kpi titulo="Primer vendedor" valor={primero ? `${primero.id} - ${primero.nombre ?? ''}` : '—'} valorCls="text-base text-ink" pie={primero ? `${pesos(primero.monto)}${unDia ? ` · desde ${primero.primeraVenta.slice(11, 16)}` : ''}` : undefined} icono={ArrowUp} color="#10b981" />
          <Kpi titulo="Último vendedor" valor={ultimo ? `${ultimo.id} - ${ultimo.nombre ?? ''}` : '—'} valorCls="text-base text-ink" pie={ultimo ? `${pesos(ultimo.monto)}${unDia ? ` · hasta ${ultimo.ultimaVenta.slice(11, 16)}` : ''}` : undefined} icono={ArrowDown} color="#f97316" />
          <Kpi titulo={unDia || !d.cierres.length ? 'Cierre de caja' : `Cierre del ${fechaAr(ult(d.cierres)!.fecha).slice(0, 5)}`} valor={fila.cierre || '—'} pie={`Arqueos: ${d.arqueos.length}`} icono={Banknote} color="#14b8a6" />
        </div>

        <div className={`${tarjeta} lg:col-span-3`}>
          <h3 className={tituloTarjeta}>
            Comprobantes de caja
            <select value={concepto} onChange={(e) => setConcepto(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" aria-label="Concepto">
              <option value="">Todos los conceptos</option>
              {conceptos.map(([c, desc]) => (
                <option key={c} value={c}>{c}{desc ? ` - ${desc}` : ''}</option>
              ))}
            </select>
          </h3>
          <Tabla
            filas={comps}
            total
            alto="max-h-72"
            cols={[
              { t: 'Fecha', v: (c) => c.fecha, r: (c) => fechaAr(c.fecha) },
              { t: 'Hora', v: (c) => c.hora, r: (c) => hhmm(c.hora) },
              { t: 'Nro', n: true, v: (c) => c.numero },
              { t: 'Orig/Dest', v: (c) => c.origdest },
              { t: 'Vendedor', v: (c) => c.vendedor },
              { t: 'Concepto', v: (c) => c.concepto },
              { t: 'Descripción', v: (c) => c.conceptoDesc ?? '' },
              { t: 'Tipo', v: (c) => c.tipo, cls: (c) => (c.tipo === 'SALIDA' ? 'text-rose-500' : 'text-emerald-500') },
              { t: 'Observaciones', v: (c) => c.observaciones ?? '', r: (c) => <span className="inline-block max-w-[16rem] truncate align-bottom" title={c.observaciones ?? ''}>{c.observaciones}</span> },
              { t: 'Total', n: true, v: (c) => c.total, r: (c) => pesos(c.total), suma: sumaPesos((c) => c.total) },
            ]}
          />
        </div>
        <div className={`${tarjeta} lg:col-span-3`}>
          <h3 className={tituloTarjeta}>Ventas por vendedor</h3>
          <Tabla
            filas={d.vendedores}
            total
            alto="max-h-72"
            cols={[
              { t: 'Vendedor', v: (v) => `${v.id} - ${v.nombre ?? ''}` },
              { t: 'Tickets', n: true, v: (v) => v.tickets, r: (v) => numero(v.tickets), suma: sumaNum((v) => v.tickets) },
              { t: 'Artículos', n: true, v: (v) => v.unidades, r: (v) => numero(v.unidades), suma: sumaNum((v) => v.unidades) },
              { t: 'Monto', n: true, v: (v) => v.monto, r: (v) => pesos(v.monto), suma: sumaPesos((v) => v.monto) },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

/* =========================== ERRORES DE CAJA =========================== */

function HojaErrores({ desde, hasta, locales, nombre }: { desde: string; hasta: string; locales: string[]; nombre: (c: string) => string }) {
  const { datos, cargando, error, cargar } = useCarga<RespErrores>(() => cargarErrores(desde, hasta, locales), [desde, hasta, locales.join(',')])
  const [valor, setValor] = useState('')
  const [buscar, setBuscar] = useState('')
  const [elegido, setElegido] = useState<Cobro | null>(null)
  const [arts, setArts] = useState<ArticuloComp[] | null>(null)
  const [errArts, setErrArts] = useState<string | null>(null)

  const todas = useMemo(() => datos?.filas ?? [], [datos])
  const valores = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of todas) m.set(f.valor, f.valorDesc ?? '')
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
  }, [todas])
  const q = buscar.trim().toUpperCase()
  const filas = todas.filter((f) => (!valor || f.valor === valor) && (!q || f.factura.toUpperCase().includes(q)))
  const varios = new Set(todas.map((f) => f.local)).size > 1 || locales.length !== 1

  useEffect(() => {
    if (!elegido) return
    let vivo = true
    setArts(null)
    setErrArts(null)
    cargarArticulos(elegido.local, elegido.codigo)
      .then((r) => vivo && setArts(r.articulos))
      .catch((e: unknown) => vivo && setErrArts(e instanceof Error ? e.message : String(e)))
    return () => { vivo = false }
  }, [elegido])
  useEffect(() => setElegido(null), [datos])

  const cols: Col<Cobro>[] = [
    ...(varios ? [{ t: 'Local', v: (f: Cobro) => nombre(f.local), r: (f: Cobro) => <span className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 text-[11px] text-sub">{nombre(f.local)}</span> }] : []),
    { t: 'Fecha', v: (f) => f.fecha, r: (f) => fechaAr(f.fecha) },
    { t: 'Hora', v: (f) => f.hora, r: (f) => hhmm(f.hora) },
    { t: 'Comprobante', v: (f) => f.factura },
    { t: 'Valor', v: (f) => `${f.valor} - ${f.valorDesc ?? ''}` },
    { t: 'Recibido', n: true, v: (f) => f.recibi, r: (f) => pesos(f.recibi), suma: sumaPesos((f) => f.recibi) },
    { t: 'Recargo', n: true, v: (f) => f.recargo, r: (f) => pesos(f.recargo), suma: sumaPesos((f) => f.recargo) },
    { t: 'Total factura', n: true, v: (f) => f.totalFactura, r: (f) => pesos(f.totalFactura) },
    { t: 'Vend.', v: (f) => f.vendedor },
  ]

  return (
    <>
      <Estado cargando={cargando} error={error} onRecargar={() => void cargar()} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={valor} onChange={(e) => setValor(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" aria-label="Valor">
          <option value="">Todos los valores</option>
          {valores.map(([v, d]) => (
            <option key={v} value={v}>{v} - {d}</option>
          ))}
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Comprobante…" className="h-9 w-44 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
      </div>
      {datos && datos.fallidos.length > 0 && (
        <p className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          No se pudo leer: {datos.fallidos.map((f) => `${nombre(f.local)} (${f.error})`).join(' · ')}
        </p>
      )}
      {datos && (
        <div className="grid grid-cols-1 gap-3">
          <div className={tarjeta}>
            <h3 className={tituloTarjeta}>
              Cobros por comprobante
              <span className="text-xs font-normal text-sub">tocá uno para ver sus artículos · {numero(filas.length)} cobros{datos.recortado ? ' (recortado)' : ''}</span>
            </h3>
            <Tabla<Cobro>
              filas={filas}
              total
              alto="max-h-[calc(100dvh-20rem)]"
              onFila={(f) => setElegido((e) => (e === f ? null : f))}
              sel={(f) => f === elegido}
              cols={cols}
            />
          </div>
          {elegido && (
            <div className={tarjeta}>
              <h3 className={tituloTarjeta}>
                Artículos del comprobante
                <span className="text-xs font-normal text-sub">{elegido.factura} · {nombre(elegido.local)}</span>
              </h3>
              {errArts ? (
                <p className="text-xs text-rose-500">{errArts}</p>
              ) : !arts ? (
                <p className="text-xs text-sub"><Loader2 size={12} className="inline animate-spin" /> Cargando…</p>
              ) : (
                <Tabla
                  filas={arts}
                  total
                  cols={[
                    { t: 'Artículo', v: (a) => a.articulo },
                    { t: 'Descripción', v: (a) => a.descripcion ?? '' },
                    { t: 'Color', v: (a) => a.color },
                    { t: 'Talle', v: (a) => a.talle },
                    { t: 'Unid.', n: true, v: (a) => a.unidades, r: (a) => numero(a.unidades), suma: sumaNum((a) => a.unidades) },
                    { t: 'Precio lista', n: true, v: (a) => a.precio, r: (a) => pesos(a.precio) },
                    { t: 'Dto. promo', n: true, v: (a) => a.dtoPromo, r: (a) => pesos(a.dtoPromo), suma: sumaPesos((a) => a.dtoPromo) },
                    { t: 'Cobrado', n: true, v: (a) => a.monto, r: (a) => pesos(a.monto), suma: sumaPesos((a) => a.monto) },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
