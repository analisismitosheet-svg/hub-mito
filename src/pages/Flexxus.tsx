import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Building2,
  CalendarRange,
  ChevronDown,
  Database,
  Download,
  FileText,
  History,
  Landmark,
  Loader2,
  PencilLine,
  ReceiptText,
  RefreshCw,
  Scale,
  Search,
  Tags,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import MultiselectFiltro from '@/components/MultiselectFiltro'
import { useAuth } from '@/context/AuthContext'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  CUENTA_RNA,
  DIAS_MAX_ASIENTOS,
  TRAMOS,
  armarBalance,
  arrastraSaldo,
  cargarAsientos,
  cargarBalance,
  cargarCentros,
  cargarClasificacion,
  cargarMayor,
  cargarSaldos,
  cargarVentas,
  diasEntre,
  fechaCorta,
  guardarClasificacion,
  isoLocal,
  nroComprobante,
  numero,
  pesos,
  pesosCorto,
  rubros,
  tramoDe,
  type Asientos,
  type Balance,
  type Centros,
  type Clasificacion,
  type Mayor,
  type Saldos,
  type Tramo,
  type Ventas,
} from '@/lib/flexxus'

/**
 * Administración > Flexxus.
 *
 * Ventas, saldos de clientes y asientos contables leídos en vivo de la base
 * Firebird de Flexxus (M1T0O1) por el Puente SQL (servidor vinculado FLEXXUS,
 * solo lectura). Ver src/lib/flexxus.ts y puente-sql/flexxus.js.
 */

type Solapa = 'ventas' | 'saldos' | 'asientos' | 'balance' | 'centros' | 'clasificacion'

const [cSky, cEmerald, cRose, cViolet, cAmber, cTeal, cOrange, cIndigo, cPink, cLima] = coloresUnicos([
  '#0284c7',
  '#10b981',
  '#f43f5e',
  '#8b5cf6',
  '#f59e0b',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#ec4899',
  '#84cc16',
])

const btnChico =
  'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'
const inputFecha = 'h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink'
const TOPE = 300

function hoyIso() {
  return isoLocal(new Date())
}
function inicioMes(d = new Date()) {
  return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** Normaliza para buscar sin tildes ni mayúsculas. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

async function bajarExcel(nombre: string, hojas: Record<string, Record<string, unknown>[]>) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [hoja, filas] of Object.entries(hojas)) {
    if (filas.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), hoja.slice(0, 31))
  }
  XLSX.writeFile(wb, `${nombre}_${hoyIso()}.xlsx`)
}

/* ====================================================================== */

export default function Flexxus() {
  const [solapa, setSolapa] = useState<Solapa>('ventas')
  const [desde, setDesde] = useState(inicioMes())
  const [hasta, setHasta] = useState(hoyIso())

  const solapas = [
    { id: 'ventas', texto: 'Ventas', icono: TrendingUp, color: cEmerald },
    { id: 'saldos', texto: 'Saldos de clientes', icono: Users, color: cViolet },
    { id: 'asientos', texto: 'Asientos', icono: BookOpen, color: cAmber },
    { id: 'balance', texto: 'Sumas y saldos', icono: Scale, color: cTeal },
    { id: 'centros', texto: 'Centros de costo', icono: Building2, color: cPink },
    { id: 'clasificacion', texto: 'Clasificación de cuentas', icono: Tags, color: cLima },
  ] as const

  const presets = [
    { texto: 'Este mes', d: inicioMes(), h: hoyIso() },
    (() => {
      const n = new Date()
      const ini = new Date(n.getFullYear(), n.getMonth() - 1, 1)
      const fin = new Date(n.getFullYear(), n.getMonth(), 0)
      return { texto: 'Mes anterior', d: isoLocal(ini), h: isoLocal(fin) }
    })(),
    { texto: 'Este año', d: `${new Date().getFullYear()}-01-01`, h: hoyIso() },
  ]

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Database size={22} style={{ color: cSky }} aria-hidden /> Flexxus
        </h1>
        <span className="text-xs text-sub/70">en vivo desde la base de Flexxus · solo lectura</span>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {solapas.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSolapa(t.id)}
              className={`btn-press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition ${
                solapa === t.id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'
              }`}
            >
              <t.icono size={15} style={{ color: solapa === t.id ? t.color : undefined }} aria-hidden />
              {t.texto}
            </button>
          ))}
        </div>

        {solapa !== 'saldos' && solapa !== 'clasificacion' && (
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange size={16} className="text-sub" aria-hidden />
            <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className={inputFecha} aria-label="Desde" />
            <span className="text-xs text-sub">a</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className={inputFecha} aria-label="Hasta" />
            {presets.map((p) => (
              <button
                key={p.texto}
                type="button"
                onClick={() => {
                  setDesde(p.d)
                  setHasta(p.h)
                }}
                className={`${btnChico} ${desde === p.d && hasta === p.h ? 'border-sky-500/50 text-sky-500' : ''}`}
              >
                {p.texto}
              </button>
            ))}
          </div>
        )}
      </div>

      {solapa === 'ventas' && <SolapaVentas desde={desde} hasta={hasta} />}
      {solapa === 'saldos' && <SolapaSaldos />}
      {solapa === 'asientos' && <SolapaAsientos desde={desde} hasta={hasta} />}
      {solapa === 'balance' && <SolapaBalance desde={desde} hasta={hasta} />}
      {solapa === 'centros' && <SolapaCentros desde={desde} hasta={hasta} />}
      {solapa === 'clasificacion' && <SolapaClasificacion />}
    </Layout>
  )
}

/* --------------------------- piezas comunes --------------------------- */

function useCarga<T>(fn: (forzar: boolean) => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cargar = useCallback(async (forzar = false) => {
    setCargando(true)
    try {
      setDatos(await fn(forzar))
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

function Estado({ cargando, error, hay, texto }: { cargando: boolean; error: string | null; hay: boolean; texto: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}
      {cargando && !hay && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden /> {texto}
        </p>
      )}
    </>
  )
}

function Barra({
  busqueda,
  setBusqueda,
  placeholder,
  calculado,
  cacheado,
  cargando,
  onActualizar,
  onExcel,
  extra,
}: {
  busqueda: string
  setBusqueda: (v: string) => void
  placeholder: string
  calculado?: string | null
  cacheado?: boolean
  cargando: boolean
  onActualizar: () => void
  onExcel?: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative max-w-xs flex-1">
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
        />
      </div>
      {extra}
      <div className="ml-auto flex items-center gap-2">
        {calculado && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            {new Date(calculado).toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit' })}
            {cacheado ? ' (cache)' : ''}
          </span>
        )}
        {onExcel && (
          <button type="button" onClick={onExcel} className={btnChico}>
            <Download size={13} aria-hidden /> Excel
          </button>
        )}
        <button type="button" onClick={onActualizar} disabled={cargando} className={btnChico}>
          <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </div>
    </div>
  )
}

function Tarjetas({ items }: { items: { titulo: string; valor: string; pie: string; icono: typeof Wallet; color: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((t) => (
        <div key={t.titulo} className="rounded-2xl border border-line bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs text-sub">
            <t.icono size={14} style={{ color: t.color }} aria-hidden /> {t.titulo}
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-ink">{t.valor}</p>
          <p className="text-[11px] text-sub/70">{t.pie}</p>
        </div>
      ))}
    </div>
  )
}

/* Encabezado fijo: la tabla scrollea dentro de su caja y los títulos quedan arriba */
const fijo = 'sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_rgba(127,127,127,0.3)]'
const th = `px-3 py-2 font-medium ${fijo}`
const thR = `px-3 py-2 text-right font-medium ${fijo}`
const td = 'px-3 py-2'
const tdR = 'px-3 py-2 text-right tabular-nums'
const filaHead = 'border-b border-line text-left text-xs uppercase tracking-wide text-sub'
const caja = 'max-h-[calc(100dvh-13rem)] overflow-auto rounded-2xl border border-line bg-surface'

/* =============================== VENTAS =============================== */

function SolapaVentas({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, cargando, error, cargar } = useCarga<Ventas>((forzar) => cargarVentas(desde, hasta, forzar), [desde, hasta])
  const [busqueda, setBusqueda] = useState('')
  const [vista, setVista] = useState<'cliente' | 'comprobante' | 'mes'>('cliente')

  const comps = datos?.comprobantes ?? []
  const q = norm(busqueda.trim())
  const filtrados = useMemo(
    () =>
      q
        ? comps.filter((c) => norm(`${c.razon} ${c.cliente} ${c.tipo} ${nroComprobante(c.pv, c.numero)}`).includes(q))
        : comps,
    [comps, q],
  )

  const total = filtrados.reduce((t, c) => t + c.pesos, 0)
  const notas = filtrados.filter((c) => c.pesos < 0)
  const facturas = filtrados.filter((c) => c.pesos >= 0)
  const clientes = new Set(filtrados.map((c) => c.cliente)).size

  const porCliente = useMemo(() => {
    const m = new Map<string, { cliente: string; razon: string; comps: number; facturado: number; notas: number; total: number }>()
    for (const c of filtrados) {
      const x = m.get(c.cliente) ?? { cliente: c.cliente, razon: c.razon, comps: 0, facturado: 0, notas: 0, total: 0 }
      x.comps++
      if (c.pesos >= 0) x.facturado += c.pesos
      else x.notas += c.pesos
      x.total += c.pesos
      m.set(c.cliente, x)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [filtrados])

  const porMes = useMemo(() => {
    const m = new Map<string, { mes: string; comps: number; facturado: number; notas: number; total: number }>()
    for (const c of filtrados) {
      const k = c.fecha.slice(0, 7)
      const x = m.get(k) ?? { mes: k, comps: 0, facturado: 0, notas: 0, total: 0 }
      x.comps++
      if (c.pesos >= 0) x.facturado += c.pesos
      else x.notas += c.pesos
      x.total += c.pesos
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes))
  }, [filtrados])
  const maxMes = Math.max(1, ...porMes.map((m) => Math.abs(m.total)))

  const exportar = () =>
    void bajarExcel(`flexxus_ventas_${desde}_${hasta}`, {
      'Por cliente': porCliente.map((c) => ({
        Cliente: c.cliente,
        'Razón social': c.razon,
        Comprobantes: c.comps,
        Facturado: Math.round(c.facturado),
        'Notas de crédito': Math.round(c.notas),
        Total: Math.round(c.total),
      })),
      Comprobantes: filtrados.map((c) => ({
        Fecha: c.fecha,
        Tipo: c.tipo,
        Número: nroComprobante(c.pv, c.numero),
        Cliente: c.cliente,
        'Razón social': c.razon,
        Moneda: c.moneda,
        Total: c.total,
        IVA: c.iva,
        'Total en pesos': c.pesos,
      })),
    })

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Leyendo las ventas de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Ventas netas', valor: pesosCorto(total), pie: `${pesos(total)} con IVA`, icono: Wallet, color: cEmerald },
              { titulo: 'Facturas y ND', valor: numero(facturas.length), pie: pesos(facturas.reduce((t, c) => t + c.pesos, 0)), icono: ReceiptText, color: cSky },
              { titulo: 'Notas de crédito', valor: numero(notas.length), pie: pesos(notas.reduce((t, c) => t + c.pesos, 0)), icono: FileText, color: cRose },
              { titulo: 'Clientes', valor: numero(clientes), pie: `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`, icono: Users, color: cViolet },
            ]}
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar cliente o comprobante…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
            extra={
              <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                {([
                  ['cliente', 'Por cliente'],
                  ['mes', 'Por mes'],
                  ['comprobante', 'Comprobantes'],
                ] as const).map(([id, t]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVista(id)}
                    className={`btn-press h-8 rounded-lg px-2.5 text-xs font-medium ${vista === id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            }
          />

          {vista === 'cliente' && (
            <div className={caja}>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className={filaHead}>
                    <th className={th}>Cliente</th>
                    <th className={thR}>Comp.</th>
                    <th className={thR}>Facturado</th>
                    <th className={thR}>Notas de crédito</th>
                    <th className={thR}>Total</th>
                    <th className={th}>% del total</th>
                  </tr>
                </thead>
                <tbody>
                  {porCliente.slice(0, TOPE).map((c) => (
                    <tr key={c.cliente} className="border-b border-line/60 last:border-0">
                      <td className={td}>
                        <span className="font-medium text-ink">{c.razon || '—'}</span>
                        <span className="ml-1.5 text-xs text-sub">{c.cliente}</span>
                      </td>
                      <td className={tdR}>{numero(c.comps)}</td>
                      <td className={tdR}>{pesos(c.facturado)}</td>
                      <td className={`${tdR} ${c.notas ? 'text-rose-500' : 'text-sub/50'}`}>{c.notas ? pesos(c.notas) : '—'}</td>
                      <td className={`${tdR} font-semibold text-ink`}>{pesos(c.total)}</td>
                      <td className={td}>
                        <Porcentaje valor={c.total} total={total} color={cEmerald} />
                      </td>
                    </tr>
                  ))}
                  {porCliente.length === 0 && <SinFilas cols={6} />}
                </tbody>
              </table>
            </div>
          )}

          {vista === 'mes' && (
            <div className={caja}>
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className={filaHead}>
                    <th className={th}>Mes</th>
                    <th className={thR}>Comp.</th>
                    <th className={thR}>Facturado</th>
                    <th className={thR}>Notas de crédito</th>
                    <th className={thR}>Total</th>
                    <th className={`${th} w-1/3`} />
                  </tr>
                </thead>
                <tbody>
                  {porMes.map((m) => (
                    <tr key={m.mes} className="border-b border-line/60 last:border-0">
                      <td className={`${td} font-medium capitalize text-ink`}>
                        {new Date(`${m.mes}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className={tdR}>{numero(m.comps)}</td>
                      <td className={tdR}>{pesos(m.facturado)}</td>
                      <td className={`${tdR} text-rose-500`}>{m.notas ? pesos(m.notas) : '—'}</td>
                      <td className={`${tdR} font-semibold text-ink`}>{pesos(m.total)}</td>
                      <td className={td}>
                        <div className="h-2 rounded-full bg-surface2">
                          <div className="h-2 rounded-full" style={{ width: `${(Math.abs(m.total) / maxMes) * 100}%`, background: cEmerald }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {porMes.length === 0 && <SinFilas cols={6} />}
                </tbody>
              </table>
            </div>
          )}

          {vista === 'comprobante' && (
            <div className={caja}>
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className={filaHead}>
                    <th className={th}>Fecha</th>
                    <th className={th}>Comprobante</th>
                    <th className={th}>Cliente</th>
                    <th className={thR}>IVA</th>
                    <th className={thR}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtrados]
                    .reverse()
                    .slice(0, TOPE)
                    .map((c) => (
                      <tr key={`${c.tipo}-${c.pv}-${c.numero}`} className="border-b border-line/60 last:border-0">
                        <td className={`${td} whitespace-nowrap text-sub`}>{fechaCorta(c.fecha)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className="mr-1.5 rounded bg-surface2 px-1.5 py-0.5 text-[11px] font-semibold text-ink">{c.tipo}</span>
                          <span className="tabular-nums text-sub">{nroComprobante(c.pv, c.numero)}</span>
                        </td>
                        <td className={td}>{c.razon}</td>
                        <td className={`${tdR} text-sub`}>{pesos(c.iva)}</td>
                        <td className={`${tdR} font-medium ${c.pesos < 0 ? 'text-rose-500' : 'text-ink'}`}>
                          {pesos(c.pesos)}
                          {c.moneda !== 'PESOS' && <span className="ml-1 text-[10px] text-sub">{c.moneda}</span>}
                        </td>
                      </tr>
                    ))}
                  {filtrados.length === 0 && <SinFilas cols={5} />}
                </tbody>
              </table>
              {filtrados.length > TOPE && <MasFilas mostradas={TOPE} total={filtrados.length} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* =============================== SALDOS =============================== */

function SolapaSaldos() {
  const { datos, cargando, error, cargar } = useCarga<Saldos>((forzar) => cargarSaldos(forzar), [])
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [soloVencido, setSoloVencido] = useState(false)

  const hoy = datos?.hoy ?? hoyIso()
  const q = norm(busqueda.trim())

  const clientes = useMemo(() => {
    const m = new Map<
      string,
      {
        cliente: string
        razon: string
        cuit: string
        limite: number
        saldo: number
        tramos: Record<Tramo, number>
        comps: Saldos['deuda']
        /** vencimiento más viejo que sigue impago (después de descontar el crédito) */
        vence: string
        /** próximo vencimiento de hoy en adelante */
        proximo: string
      }
    >()
    for (const d of datos?.deuda ?? []) {
      const x =
        m.get(d.cliente) ??
        {
          cliente: d.cliente,
          razon: d.razon,
          cuit: d.cuit,
          limite: d.limite,
          saldo: 0,
          tramos: { a_vencer: 0, d30: 0, d60: 0, d90: 0, mas90: 0 },
          comps: [],
          vence: '',
          proximo: '',
        }
      x.saldo += d.saldo
      x.comps.push(d)
      m.set(d.cliente, x)
    }
    /* Antigüedad: las notas de crédito y pagos sin aplicar (saldo negativo) se
       descuentan de la deuda más vieja primero; si sobra crédito, queda «a favor»
       en A vencer. Así los tramos suman el saldo y no aparecen tramos negativos. */
    for (const c of m.values()) {
      let credito = -c.comps.filter((d) => d.saldo < 0).reduce((t, d) => t + d.saldo, 0)
      const deudas = c.comps.filter((d) => d.saldo > 0).sort((a, b) => (a.vence || a.fecha).localeCompare(b.vence || b.fecha))
      for (const d of deudas) {
        const usa = Math.min(credito, d.saldo)
        credito -= usa
        const queda = d.saldo - usa
        c.tramos[tramoDe(d.vence, hoy)] += queda
        if (queda > 0.5 && d.vence) {
          if (!c.vence) c.vence = d.vence
          if (!c.proximo && d.vence >= hoy) c.proximo = d.vence
        }
      }
      if (credito > 0) c.tramos.a_vencer -= credito
    }
    return [...m.values()]
      .filter((c) => Math.abs(c.saldo) >= 0.5)
      .filter((c) => !q || norm(`${c.razon} ${c.cliente} ${c.cuit}`).includes(q))
      .filter((c) => !soloVencido || c.saldo - c.tramos.a_vencer > 0.5)
      .sort((a, b) => b.saldo - a.saldo)
  }, [datos, hoy, q, soloVencido])

  const tot = clientes.reduce(
    (t, c) => {
      t.saldo += c.saldo
      for (const k of Object.keys(c.tramos) as Tramo[]) t.tramos[k] += c.tramos[k]
      return t
    },
    { saldo: 0, tramos: { a_vencer: 0, d30: 0, d60: 0, d90: 0, mas90: 0 } as Record<Tramo, number> },
  )
  const vencido = tot.saldo - tot.tramos.a_vencer

  const exportar = () =>
    void bajarExcel('flexxus_saldos_clientes', {
      'Por cliente': clientes.map((c) => ({
        Cliente: c.cliente,
        'Razón social': c.razon,
        CUIT: c.cuit,
        Saldo: Math.round(c.saldo),
        'Vencimiento más viejo': c.vence,
        'Días vencido': c.vence && c.vence < hoy ? diasEntre(c.vence, hoy) - 1 : 0,
        'Próximo vencimiento': c.proximo,
        ...Object.fromEntries(TRAMOS.map((t) => [t.texto, Math.round(c.tramos[t.id])])),
      })),
      Comprobantes: clientes.flatMap((c) =>
        c.comps.map((d) => ({
          Cliente: c.cliente,
          'Razón social': c.razon,
          Tipo: d.tipo,
          Número: nroComprobante(0, d.numero),
          Fecha: d.fecha,
          Vence: d.vence,
          Saldo: d.saldo,
          Moneda: d.moneda,
        })),
      ),
    })

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Leyendo la deuda de clientes de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Saldo a cobrar', valor: pesosCorto(tot.saldo), pie: pesos(tot.saldo), icono: Wallet, color: cViolet },
              {
                titulo: 'Vencido',
                valor: pesosCorto(vencido),
                pie: tot.saldo > 0 ? `${((vencido / tot.saldo) * 100).toFixed(1)} % del saldo` : '—',
                icono: TriangleAlert,
                color: cOrange,
              },
              { titulo: 'Más de 90 días', valor: pesosCorto(tot.tramos.mas90), pie: pesos(tot.tramos.mas90), icono: CalendarRange, color: cRose },
              { titulo: 'Clientes con saldo', valor: numero(clientes.length), pie: `al ${fechaCorta(hoy)}`, icono: Users, color: cIndigo },
            ]}
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar cliente o CUIT…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
            extra={
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                <input type="checkbox" checked={soloVencido} onChange={(e) => setSoloVencido(e.target.checked)} /> Solo con deuda vencida
                <span className="text-sub/60" title="Las notas de crédito y pagos sin aplicar se descuentan de la deuda más vieja de cada cliente">
                  · NC sin aplicar descontadas de lo más viejo
                </span>
              </label>
            }
          />
          <div className={caja}>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>Cliente</th>
                  <th className={thR}>Saldo</th>
                  <th className={th}>Vencimiento</th>
                  {TRAMOS.map((t) => (
                    <th key={t.id} className={thR}>
                      {t.texto}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientes.slice(0, TOPE).map((c) => {
                  const atraso = c.vence && c.vence < hoy ? diasEntre(c.vence, hoy) - 1 : 0
                  const ab = abierto === c.cliente
                  return (
                    <Fragment key={c.cliente}>
                      <tr
                        className="cursor-pointer border-b border-line/60 transition hover:bg-surface2/60"
                        onClick={() => setAbierto(ab ? null : c.cliente)}
                      >
                        <td className={td}>
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronDown size={14} className={`text-sub transition ${ab ? '' : '-rotate-90'}`} aria-hidden />
                            <span className="font-medium text-ink">{c.razon || '—'}</span>
                            <span className="text-xs text-sub">{c.cliente}</span>
                          </span>
                          {c.cuit && <span className="ml-5 block text-[11px] text-sub/70">CUIT {c.cuit}</span>}
                        </td>
                        <td className={`${tdR} font-semibold text-ink`}>{pesos(c.saldo)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {c.vence ? (
                            <>
                              <span className={`tabular-nums ${atraso > 90 ? 'text-rose-500' : atraso > 0 ? 'text-amber-500' : 'text-ink'}`}>
                                {fechaCorta(c.vence)}
                              </span>
                              <span className="block text-[11px] text-sub/70">
                                {atraso > 0 ? `vencido hace ${numero(atraso)} d` : 'al día'}
                                {atraso > 0 && c.proximo ? ` · próx. ${fechaCorta(c.proximo)}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-sub/40">—</span>
                          )}
                        </td>
                        {TRAMOS.map((t) => (
                          <td
                            key={t.id}
                            className={`${tdR} ${
                              Math.abs(c.tramos[t.id]) < 0.5 ? 'text-sub/40' : t.id === 'mas90' ? 'text-rose-500' : t.id === 'a_vencer' ? 'text-ink' : 'text-amber-500'
                            }`}
                          >
                            {Math.abs(c.tramos[t.id]) < 0.5 ? '—' : pesos(c.tramos[t.id])}
                          </td>
                        ))}
                      </tr>
                      {ab && (
                        <tr className="border-b border-line/60 bg-surface2/40">
                          <td colSpan={3 + TRAMOS.length} className="px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-sub">
                                  <th className="py-1 font-medium">Comprobante</th>
                                  <th className="py-1 font-medium">Fecha</th>
                                  <th className="py-1 font-medium">Vence</th>
                                  <th className="py-1 text-right font-medium">Días vencido</th>
                                  <th className="py-1 text-right font-medium">Saldo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.comps.map((d) => {
                                  const dias = d.vence ? diasEntre(d.vence, hoy) - 1 : 0
                                  return (
                                    <tr key={`${d.tipo}-${d.numero}`} className="border-t border-line/40">
                                      <td className="py-1">
                                        <span className="mr-1 font-semibold text-ink">{d.tipo}</span>
                                        <span className="tabular-nums text-sub">{nroComprobante(0, d.numero)}</span>
                                      </td>
                                      <td className="py-1 text-sub">{fechaCorta(d.fecha)}</td>
                                      <td className="py-1 text-sub">{fechaCorta(d.vence)}</td>
                                      <td className={`py-1 text-right tabular-nums ${dias > 90 ? 'text-rose-500' : dias > 0 ? 'text-amber-500' : 'text-sub'}`}>
                                        {dias > 0 ? numero(dias) : '—'}
                                      </td>
                                      <td className={`py-1 text-right tabular-nums ${d.saldo < 0 ? 'text-emerald-500' : 'text-ink'}`}>{pesos(d.saldo)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {clientes.length === 0 && <SinFilas cols={3 + TRAMOS.length} />}
              </tbody>
              {clientes.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink">
                    <td className={td}>Total</td>
                    <td className={tdR}>{pesos(tot.saldo)}</td>
                    <td />
                    {TRAMOS.map((t) => (
                      <td key={t.id} className={tdR}>
                        {pesos(tot.tramos[t.id])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
            {clientes.length > TOPE && <MasFilas mostradas={TOPE} total={clientes.length} />}
          </div>
        </>
      )}
    </div>
  )
}

/* ============================== ASIENTOS ============================== */

function SolapaAsientos({ desde, hasta }: { desde: string; hasta: string }) {
  const dias = diasEntre(desde, hasta)
  const largo = dias > DIAS_MAX_ASIENTOS
  const { datos, cargando, error, cargar } = useCarga<Asientos | null>(
    (forzar) => (largo ? Promise.resolve(null) : cargarAsientos(desde, hasta, forzar)),
    [desde, hasta, largo],
  )
  const [busqueda, setBusqueda] = useState('')
  const [cuentasSel, setCuentasSel] = useState<Set<string>>(new Set())
  const [usuariosSel, setUsuariosSel] = useState<Set<string>>(new Set())
  const [tiposSel, setTiposSel] = useState<Set<string>>(new Set())
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const [mostrar, setMostrar] = useState(TOPE)

  const nombreCuenta = useMemo(() => new Map((datos?.cuentas ?? []).map((c) => [c.cuenta, c.descripcion])), [datos])
  const usuarioDe = useMemo(() => new Map((datos?.usuarios ?? []).map((u) => [u.asiento, u])), [datos])
  const lineasPor = useMemo(() => {
    const m = new Map<number, Asientos['lineas']>()
    for (const l of datos?.lineas ?? []) {
      const arr = m.get(l[0]) ?? []
      arr.push(l)
      m.set(l[0], arr)
    }
    return m
  }, [datos])

  const opcionesCuentas = useMemo(() => {
    const s = new Set((datos?.lineas ?? []).map((l) => l[1]))
    return [...s].sort().map((c) => ({ id: c, label: `${c} · ${nombreCuenta.get(c) ?? ''}` }))
  }, [datos, nombreCuenta])
  const SIN_USUARIO = '(sin usuario)'
  const opcionesUsuarios = useMemo(() => {
    const s = new Set<string>()
    for (const a of datos?.asientos ?? []) {
      const u = usuarioDe.get(a.asiento)
      s.add(u?.creo || SIN_USUARIO)
      if (u?.edito) s.add(u.edito)
    }
    return [...s].sort().map((u) => ({ id: u, label: u }))
  }, [datos, usuarioDe])
  const opcionesTipos = [
    { id: 'manual', label: 'Manuales' },
    { id: 'auto', label: 'Automáticos (de un comprobante)' },
    { id: 'editado', label: 'Editados después de cargarlos' },
  ]

  const q = norm(busqueda.trim())
  const lista = useMemo(
    () =>
      (datos?.asientos ?? [])
        .filter((a) => cuentasSel.size === 0 || (lineasPor.get(a.asiento) ?? []).some((l) => cuentasSel.has(l[1])))
        .filter((a) => {
          if (usuariosSel.size === 0) return true
          const u = usuarioDe.get(a.asiento)
          return usuariosSel.has(u?.creo || SIN_USUARIO) || (!!u?.edito && usuariosSel.has(u.edito))
        })
        .filter((a) => {
          if (tiposSel.size === 0) return true
          const u = usuarioDe.get(a.asiento)
          return (
            (tiposSel.has('manual') && !!u?.manual) ||
            (tiposSel.has('auto') && !u?.manual) ||
            (tiposSel.has('editado') && (u?.ediciones ?? 0) > 0)
          )
        })
        .filter((a) => {
          if (!q) return true
          const u = usuarioDe.get(a.asiento)
          return norm(`${a.numero} ${a.obs} ${u?.creo ?? ''} ${u?.edito ?? ''}`).includes(q)
        })
        .reverse(),
    [datos, cuentasSel, usuariosSel, tiposSel, q, lineasPor, usuarioDe],
  )

  /* Con cuentas elegidas: debe, haber y saldo de ESAS cuentas en el rango. */
  const mayor = useMemo(() => {
    if (cuentasSel.size === 0) return null
    let debe = 0
    let haber = 0
    for (const a of lista) for (const l of lineasPor.get(a.asiento) ?? []) if (cuentasSel.has(l[1])) (l[3] ? (debe += l[2]) : (haber += l[2]))
    return { debe, haber }
  }, [cuentasSel, lista, lineasPor])

  const manuales = lista.filter((a) => usuarioDe.get(a.asiento)?.manual).length
  const editados = lista.filter((a) => (usuarioDe.get(a.asiento)?.ediciones ?? 0) > 0).length

  const exportar = () =>
    void bajarExcel(`flexxus_asientos_${desde}_${hasta}`, {
      Asientos: lista.flatMap((a) => {
        const u = usuarioDe.get(a.asiento)
        return (lineasPor.get(a.asiento) ?? []).map((l) => ({
          Fecha: a.fecha,
          Asiento: a.numero,
          Observaciones: a.obs,
          Tipo: u?.manual ? 'Manual' : 'Automático',
          'Creó': u?.creo ?? '',
          'Creado el': u?.creo_en ?? '',
          'Editó': u?.edito ?? '',
          'Editado el': u?.edito_en ?? '',
          Cuenta: l[1],
          Descripción: nombreCuenta.get(l[1]) ?? '',
          Debe: l[3] ? l[2] : 0,
          Haber: l[3] ? 0 : l[2],
        }))
      }),
    })

  if (largo) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-500">
        El libro diario se mira de a {DIAS_MAX_ASIENTOS} días como máximo (elegiste {numero(dias)}). Achicá el rango o usá «Sumas y
        saldos», que sí toma el año entero.
      </p>
    )
  }

  const nombresSel = [...cuentasSel].map((c) => nombreCuenta.get(c) ?? c)

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Leyendo los asientos de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={
              mayor
                ? [
                    { titulo: 'Asientos', valor: numero(lista.length), pie: `${numero(manuales)} manuales · ${numero(editados)} editados`, icono: BookOpen, color: cAmber },
                    { titulo: 'Debe', valor: pesosCorto(mayor.debe), pie: pesos(mayor.debe), icono: TrendingUp, color: cEmerald },
                    { titulo: 'Haber', valor: pesosCorto(mayor.haber), pie: pesos(mayor.haber), icono: FileText, color: cRose },
                    {
                      titulo: 'Saldo del período',
                      valor: pesosCorto(mayor.debe - mayor.haber),
                      pie: nombresSel.length === 1 ? nombresSel[0] : `${nombresSel.length} cuentas`,
                      icono: Scale,
                      color: cTeal,
                    },
                  ]
                : [
                    { titulo: 'Asientos', valor: numero(lista.length), pie: `${numero(datos.lineas.length)} líneas en el rango`, icono: BookOpen, color: cAmber },
                    { titulo: 'Manuales', valor: numero(manuales), pie: 'cargados a mano en Flexxus', icono: PencilLine, color: cViolet },
                    { titulo: 'Editados', valor: numero(editados), pie: 'modificados después de cargarlos', icono: History, color: cOrange },
                    {
                      titulo: 'Automáticos',
                      valor: numero(lista.length - manuales),
                      pie: 'salen de un comprobante',
                      icono: ReceiptText,
                      color: cSky,
                    },
                  ]
            }
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar número, observación o usuario…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
            extra={
              <>
                <MultiselectFiltro label="Cuentas" opciones={opcionesCuentas} seleccionadas={cuentasSel} onChange={(s) => { setCuentasSel(s); setMostrar(TOPE) }} />
                <MultiselectFiltro label="Usuario" opciones={opcionesUsuarios} seleccionadas={usuariosSel} onChange={(s) => { setUsuariosSel(s); setMostrar(TOPE) }} />
                <MultiselectFiltro label="Tipo" opciones={opcionesTipos} seleccionadas={tiposSel} onChange={(s) => { setTiposSel(s); setMostrar(TOPE) }} />
              </>
            }
          />
          <div className={caja}>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>Fecha</th>
                  <th className={th}>Asiento</th>
                  <th className={th}>Observaciones</th>
                  <th className={th}>Creó</th>
                  <th className={th}>Editó</th>
                  <th className={thR}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, mostrar).map((a) => {
                  const lin = lineasPor.get(a.asiento) ?? []
                  const importe = lin.reduce((t, l) => t + (l[3] ? l[2] : 0), 0)
                  const ab = abiertos.has(a.asiento)
                  const u = usuarioDe.get(a.asiento)
                  return (
                    <Fragment key={a.asiento}>
                      <tr
                        className="cursor-pointer border-b border-line/60 transition hover:bg-surface2/60"
                        onClick={() =>
                          setAbiertos((s) => {
                            const n = new Set(s)
                            if (n.has(a.asiento)) n.delete(a.asiento)
                            else n.add(a.asiento)
                            return n
                          })
                        }
                      >
                        <td className={`${td} whitespace-nowrap text-sub`}>{fechaCorta(a.fecha)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className="inline-flex items-center gap-1">
                            <ChevronDown size={14} className={`text-sub transition ${ab ? '' : '-rotate-90'}`} aria-hidden />
                            <span className="tabular-nums font-medium text-ink">{numero(a.numero)}</span>
                          </span>
                        </td>
                        <td className={td}>{a.obs || '—'}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <span className="text-ink">{u?.creo || <span className="text-sub/50">—</span>}</span>
                          <span className="block text-[11px] text-sub/70">
                            {u?.manual ? `manual · ${fechaHora(u.creo_en)}` : `automático${u?.origen ? ` · ${u.origen}` : ''}`}
                          </span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {u?.edito ? (
                            <>
                              <span className="text-orange-500">{u.edito}</span>
                              <span className="block text-[11px] text-sub/70">
                                {fechaHora(u.edito_en)}
                                {u.ediciones > 1 ? ` · ${u.ediciones} veces` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-sub/40">—</span>
                          )}
                        </td>
                        <td className={`${tdR} text-ink`}>{pesos(importe)}</td>
                      </tr>
                      {ab && (
                        <tr className="border-b border-line/60 bg-surface2/40">
                          <td colSpan={6} className="px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-sub">
                                  <th className="py-1 font-medium">Cuenta</th>
                                  <th className="py-1 text-right font-medium">Debe</th>
                                  <th className="py-1 text-right font-medium">Haber</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lin.map((l, i) => (
                                  <tr key={i} className={`border-t border-line/40 ${cuentasSel.has(l[1]) ? 'bg-teal-500/10' : ''}`}>
                                    <td className={`py-1 ${l[3] ? '' : 'pl-6'}`}>
                                      <span className="tabular-nums text-sub">{l[1]}</span>{' '}
                                      <span className="text-ink">{nombreCuenta.get(l[1]) ?? ''}</span>
                                    </td>
                                    <td className="py-1 text-right tabular-nums text-ink">{l[3] ? pesos(l[2]) : ''}</td>
                                    <td className="py-1 text-right tabular-nums text-ink">{l[3] ? '' : pesos(l[2])}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {lista.length === 0 && <SinFilas cols={6} />}
              </tbody>
            </table>
            {lista.length > mostrar && (
              <div className="border-t border-line p-2 text-center">
                <button type="button" onClick={() => setMostrar((m) => m + TOPE)} className={btnChico}>
                  Ver {numero(Math.min(TOPE, lista.length - mostrar))} más (quedan {numero(lista.length - mostrar)})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** "2026-11-11 13:03" → "11/11 13:03" */
function fechaHora(s: string): string {
  if (!s) return ''
  const [f, h = ''] = s.split(' ')
  const [, m, d] = f.split('-')
  return `${d}/${m} ${h}`.trim()
}

/* =========================== SUMAS Y SALDOS =========================== */

/** Columnas que se pueden mostrar u ocultar en Sumas y saldos (se recuerda en este navegador). */
const COLUMNAS_SYS = [
  { id: 'inicial', label: 'Saldo inicial' },
  { id: 'debe', label: 'Debe' },
  { id: 'haber', label: 'Haber' },
  { id: 'final', label: 'Saldo final' },
  { id: 'mov', label: 'Movimientos' },
] as const
type ColSys = (typeof COLUMNAS_SYS)[number]['id']
const CLAVE_COLUMNAS = 'flexxus.sys.columnas'
const SIN_CLASIF = 'Sin clasificar'

function leerColumnas(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_COLUMNAS) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function SolapaBalance({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, cargando, error, cargar } = useCarga<Balance>((forzar) => cargarBalance(desde, hasta, forzar), [desde, hasta])
  const clasif = useCarga<Map<string, Clasificacion>>(() => cargarClasificacion(), [])
  const [busqueda, setBusqueda] = useState('')
  const [rubrosSel, setRubrosSel] = useState<Set<string>>(new Set())
  const [cuentasSel, setCuentasSel] = useState<Set<string>>(new Set())
  const [ocultarCero, setOcultarCero] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [mayores, setMayores] = useState<Record<string, Mayor | { error: string } | 'cargando'>>({})
  /** Columnas tildadas (vacío = todas), recordadas en el navegador. */
  const [columnasSel, setColumnasSel] = useState<Set<string>>(leerColumnas)
  /** Agrupar por el plan de Flexxus o por la clasificación propia del contador. */
  const [agrupar, setAgrupar] = useState<'plan' | 'clasif'>(() => (localStorage.getItem('flexxus.sys.agrupar') === 'clasif' ? 'clasif' : 'plan'))
  const [verCuentas, setVerCuentas] = useState(true)

  useEffect(() => {
    localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify([...columnasSel]))
  }, [columnasSel])
  useEffect(() => {
    localStorage.setItem('flexxus.sys.agrupar', agrupar)
  }, [agrupar])

  const ver = (c: ColSys) => columnasSel.size === 0 || columnasSel.has(c)
  const cols = COLUMNAS_SYS.filter((c) => ver(c.id))

  // Si cambia el rango, los detalles abiertos ya no sirven
  useEffect(() => {
    setMayores({})
    setAbierta(null)
  }, [desde, hasta])

  const base = useMemo(() => {
    if (!datos) return []
    const plan = new Map(datos.cuentas.map((c) => [c.cuenta, c]))
    const rubro = rubros(datos.cuentas)
    const cl = clasif.datos ?? new Map<string, Clasificacion>()
    return armarBalance(datos.movimientos).map((m) => {
      const c = cl.get(m.cuenta)
      return {
        ...m,
        descripcion: plan.get(m.cuenta)?.descripcion ?? '',
        rubro: rubro.get(m.cuenta)?.descripcion ?? 'Sin rubro',
        rubroCod: rubro.get(m.cuenta)?.cuenta ?? 'zzz',
        cClasif: c?.clasificacion || SIN_CLASIF,
        cRubro: c?.rubro || '—',
        cNota: c?.nota || '—',
      }
    })
  }, [datos, clasif.datos])

  const opcionesRubros = useMemo(() => {
    if (agrupar === 'clasif') {
      return [...new Set(base.map((f) => f.cClasif))].sort().map((x) => ({ id: x, label: x }))
    }
    const m = new Map(base.map((f) => [f.rubroCod, f.rubro]))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, label]) => ({ id, label }))
  }, [base, agrupar])
  const opcionesCuentas = useMemo(
    () => [...base].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((f) => ({ id: f.cuenta, label: `${f.cuenta} · ${f.descripcion}` })),
    [base],
  )

  const q = norm(busqueda.trim())
  const filas = useMemo(
    () =>
      base
        .filter((f) => rubrosSel.size === 0 || rubrosSel.has(agrupar === 'clasif' ? f.cClasif : f.rubroCod))
        .filter((f) => cuentasSel.size === 0 || cuentasSel.has(f.cuenta))
        .filter((f) => !ocultarCero || Math.abs(f.final) >= 0.5 || f.debe || f.haber)
        .filter((f) => !q || norm(`${f.cuenta} ${f.descripcion} ${f.rubro} ${f.cClasif} ${f.cRubro} ${f.cNota}`).includes(q))
        .sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    [base, rubrosSel, cuentasSel, ocultarCero, q, agrupar],
  )
  type Fila = (typeof filas)[number]
  type Suma = { inicial: number; debe: number; haber: number; final: number; lineas: number }
  const sumar = (fs: Fila[]): Suma =>
    fs.reduce((t, f) => ({ inicial: t.inicial + f.inicial, debe: t.debe + f.debe, haber: t.haber + f.haber, final: t.final + f.final, lineas: t.lineas + f.lineas }), {
      inicial: 0,
      debe: 0,
      haber: 0,
      final: 0,
      lineas: 0,
    })

  /* Agrupado por el plan de Flexxus: un nivel (rubro de primer nivel). */
  const grupos = useMemo(() => {
    const m = new Map<string, { titulo: string; cod: string; filas: Fila[] }>()
    for (const f of filas) {
      const g = m.get(f.rubroCod) ?? { titulo: f.rubro, cod: f.rubroCod, filas: [] }
      g.filas.push(f)
      m.set(f.rubroCod, g)
    }
    return [...m.values()].sort((a, b) => a.cod.localeCompare(b.cod))
  }, [filas])

  /* Agrupado por la clasificación propia: Clasificación → Rubro → Nota (como la planilla). */
  const arbol = useMemo(() => {
    const orden = (a: string, b: string) => (a === SIN_CLASIF ? 1 : b === SIN_CLASIF ? -1 : a.localeCompare(b, 'es', { numeric: true }))
    const m = new Map<string, Map<string, Map<string, Fila[]>>>()
    for (const f of filas) {
      const r = m.get(f.cClasif) ?? new Map<string, Map<string, Fila[]>>()
      const n = r.get(f.cRubro) ?? new Map<string, Fila[]>()
      n.set(f.cNota, [...(n.get(f.cNota) ?? []), f])
      r.set(f.cRubro, n)
      m.set(f.cClasif, r)
    }
    return [...m.entries()].sort((a, b) => orden(a[0], b[0])).map(([clasificacion, r]) => ({
      clasificacion,
      rubros: [...r.entries()].sort((a, b) => orden(a[0], b[0])).map(([rubro, n]) => ({
        rubro,
        notas: [...n.entries()].sort((a, b) => orden(a[0], b[0])).map(([nota, fs]) => ({ nota, filas: fs })),
      })),
    }))
  }, [filas])

  /* Tarjetas sobre TODO el balance (no sobre lo filtrado): activo, pasivo + PN, resultado del período y control. */
  const porRubro = (r: string) => base.filter((f) => f.cuenta.startsWith(r)).reduce((t, f) => t + f.final, 0)
  const activo = porRubro('1')
  const pasivoPn = -(porRubro('2') + porRubro('3'))
  const resultado = -base.filter((f) => !arrastraSaldo(f.cuenta)).reduce((t, f) => t + f.final, 0)
  const control = base.reduce((t, f) => t + f.final, 0)
  const cuadra = Math.abs(control) < 1
  const sinClasificar = base.filter((f) => f.cClasif === SIN_CLASIF).length

  async function abrir(cuenta: string) {
    if (abierta === cuenta) return setAbierta(null)
    setAbierta(cuenta)
    if (mayores[cuenta] && mayores[cuenta] !== 'cargando' && !('error' in (mayores[cuenta] as object))) return
    setMayores((m) => ({ ...m, [cuenta]: 'cargando' }))
    try {
      const r = await cargarMayor(desde, hasta, cuenta)
      setMayores((m) => ({ ...m, [cuenta]: r }))
    } catch (e) {
      setMayores((m) => ({ ...m, [cuenta]: { error: e instanceof Error ? e.message : String(e) } }))
    }
  }

  const exportar = () =>
    void bajarExcel(`flexxus_sumas_y_saldos_${desde}_${hasta}`, {
      'Sumas y saldos': filas.map((f) => ({
        ...(agrupar === 'clasif' ? { Clasificación: f.cClasif, 'Rubro (propio)': f.cRubro, Nota: f.cNota } : { Rubro: f.rubro }),
        Cuenta: f.cuenta,
        Descripción: f.descripcion,
        ...(ver('inicial') ? { 'Saldo inicial': f.inicial } : {}),
        ...(ver('debe') ? { Debe: f.debe } : {}),
        ...(ver('haber') ? { Haber: f.haber } : {}),
        ...(ver('final') ? { 'Saldo final': f.final } : {}),
        ...(ver('mov') ? { Movimientos: f.lineas } : {}),
      })),
    })

  const ej = datos?.ejercicio
  const diaAnterior = isoLocal(new Date(new Date(`${desde}T12:00:00`).getTime() - 86_400_000))
  const nCols = 1 + cols.length

  /** Celdas de números según las columnas elegidas. */
  const celdas = (s: Suma, clase: string, esCuenta = false) => (
    <>
      {ver('inicial') && (
        <td className={`${tdR} ${clase} ${esCuenta && Math.abs(s.inicial) < 0.5 ? 'text-sub/40' : ''}`}>
          {esCuenta && Math.abs(s.inicial) < 0.5 ? '—' : pesos(s.inicial)}
        </td>
      )}
      {ver('debe') && <td className={`${tdR} ${clase}`}>{esCuenta && !s.debe ? '—' : pesos(s.debe)}</td>}
      {ver('haber') && <td className={`${tdR} ${clase}`}>{esCuenta && !s.haber ? '—' : pesos(s.haber)}</td>}
      {ver('final') && <td className={`${tdR} ${clase} font-semibold text-ink`}>{pesos(s.final)}</td>}
      {ver('mov') && <td className={`${tdR} ${clase} text-sub`}>{esCuenta ? numero(s.lineas) : ''}</td>}
    </>
  )

  const filaCuenta = (f: Fila, sangria = '') => {
    const ab = abierta === f.cuenta
    return (
      <Fragment key={f.cuenta}>
        <tr className="cursor-pointer border-b border-line/60 transition hover:bg-surface2/60" onClick={() => void abrir(f.cuenta)}>
          <td className={`${td} ${sangria}`}>
            <span className="inline-flex items-center gap-1.5">
              <ChevronDown size={14} className={`text-sub transition ${ab ? '' : '-rotate-90'}`} aria-hidden />
              <span className="tabular-nums text-xs text-sub">{f.cuenta}</span>
              <span className="text-ink">{f.descripcion || '—'}</span>
              {f.cuenta === CUENTA_RNA && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">+ resultado previo</span>
              )}
            </span>
          </td>
          {celdas(f, '', true)}
        </tr>
        {ab && (
          <tr className="border-b border-line/60 bg-surface2/40">
            <td colSpan={nCols} className="px-3 py-2">
              <DetalleCuenta det={mayores[f.cuenta]} inicial={f.inicial} />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Sumando los asientos de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Activo', valor: pesosCorto(activo), pie: `${pesos(activo)} al ${fechaCorta(hasta)}`, icono: Wallet, color: cEmerald },
              { titulo: 'Pasivo + Patrimonio neto', valor: pesosCorto(pasivoPn), pie: pesos(pasivoPn), icono: Landmark, color: cIndigo },
              {
                titulo: 'Resultado del período',
                valor: pesosCorto(resultado),
                pie: resultado >= 0 ? 'ganancia (ingresos − costos − gastos)' : 'pérdida (ingresos − costos − gastos)',
                icono: TrendingUp,
                color: cAmber,
              },
              {
                titulo: cuadra ? 'Balance cuadra' : 'No cuadra',
                valor: cuadra ? 'OK' : pesosCorto(control),
                pie: cuadra ? 'saldos deudores = acreedores' : 'diferencia entre deudores y acreedores',
                icono: Scale,
                color: cuadra ? cTeal : cRose,
              },
            ]}
          />
          {ej && (
            <p className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-sub">
              Ejercicio <b className="text-ink">{ej.descripcion}</b>. Las cuentas 1, 2 y 3 arrastran saldo (apertura + movimientos del{' '}
              {fechaCorta(ej.inicio)} {desde > ej.inicio ? `al ${fechaCorta(diaAnterior)}` : ''}). Las de resultado arrancan en cero y lo que
              acumularon {desde > ej.inicio ? `del ${fechaCorta(ej.inicio)} al ${fechaCorta(diaAnterior)}` : 'antes del rango'} se suma al
              saldo inicial de <b className="text-ink">Resultados no asignados</b>. Apertura y cierre automáticos no cuentan como movimiento.
            </p>
          )}
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar cuenta, rubro o clasificación…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => {
              void cargar(true)
              void clasif.cargar()
            }}
            onExcel={exportar}
            extra={
              <>
                <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                  {([
                    ['plan', 'Plan Flexxus'],
                    ['clasif', 'Clasificación'],
                  ] as const).map(([id, t]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setAgrupar(id)
                        setRubrosSel(new Set())
                      }}
                      className={`btn-press h-8 rounded-lg px-2.5 text-xs font-medium ${agrupar === id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'}`}
                      title={id === 'clasif' ? 'Agrupa por Clasificación → Rubro → Nota (solapa Clasificación de cuentas)' : 'Agrupa por el plan de cuentas de Flexxus'}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <MultiselectFiltro label={agrupar === 'clasif' ? 'Clasificación' : 'Rubro'} opciones={opcionesRubros} seleccionadas={rubrosSel} onChange={setRubrosSel} />
                <MultiselectFiltro label="Cuentas" opciones={opcionesCuentas} seleccionadas={cuentasSel} onChange={setCuentasSel} />
                <MultiselectFiltro label="Columnas" opciones={COLUMNAS_SYS.map((c) => ({ id: c.id, label: c.label }))} seleccionadas={columnasSel} onChange={setColumnasSel} arrancaTodo />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                  <input type="checkbox" checked={ocultarCero} onChange={(e) => setOcultarCero(e.target.checked)} /> Ocultar en cero
                </label>
                {agrupar === 'clasif' && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                    <input type="checkbox" checked={verCuentas} onChange={(e) => setVerCuentas(e.target.checked)} /> Ver cuentas
                  </label>
                )}
              </>
            }
          />
          {agrupar === 'clasif' && sinClasificar > 0 && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
              {numero(sinClasificar)} cuenta{sinClasificar > 1 ? 's' : ''} con movimiento todavía sin clasificar: van al final, en «{SIN_CLASIF}». Se
              asignan en la solapa <b>Clasificación de cuentas</b>.
            </p>
          )}
          <div className={caja}>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>{agrupar === 'clasif' ? 'Clasificación / Rubro / Nota' : 'Cuenta'}</th>
                  {cols.map((c) => (
                    <th key={c.id} className={thR}>
                      {c.id === 'mov' ? 'Mov.' : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agrupar === 'plan' &&
                  grupos.map((g) => (
                    <Fragment key={g.cod}>
                      <tr className="border-b border-line bg-surface2/60">
                        <td className={`${td} text-xs font-semibold uppercase tracking-wide text-ink`}>{g.titulo}</td>
                        {celdas(sumar(g.filas), 'text-xs font-semibold text-ink')}
                      </tr>
                      {g.filas.map((f) => filaCuenta(f))}
                    </Fragment>
                  ))}

                {agrupar === 'clasif' &&
                  arbol.map((c) => {
                    const fc = c.rubros.flatMap((r) => r.notas.flatMap((n) => n.filas))
                    return (
                      <Fragment key={c.clasificacion}>
                        <tr className="border-b border-line bg-sky-500/10">
                          <td className={`${td} text-xs font-bold uppercase tracking-wide ${c.clasificacion === SIN_CLASIF ? 'text-amber-500' : 'text-ink'}`}>
                            {c.clasificacion}
                          </td>
                          {celdas(sumar(fc), 'text-xs font-bold text-ink')}
                        </tr>
                        {c.rubros.map((r) => {
                          const fr = r.notas.flatMap((n) => n.filas)
                          return (
                            <Fragment key={`${c.clasificacion}|${r.rubro}`}>
                              <tr className="border-b border-line/80 bg-surface2/60">
                                <td className={`${td} pl-6 text-xs font-semibold text-ink`}>{r.rubro}</td>
                                {celdas(sumar(fr), 'text-xs font-semibold text-ink')}
                              </tr>
                              {r.notas.map((n) => (
                                <Fragment key={`${c.clasificacion}|${r.rubro}|${n.nota}`}>
                                  <tr className="border-b border-line/60">
                                    <td className={`${td} pl-10 font-medium text-ink`}>{n.nota}</td>
                                    {celdas(sumar(n.filas), 'font-medium')}
                                  </tr>
                                  {verCuentas && n.filas.map((f) => filaCuenta(f, 'pl-14'))}
                                </Fragment>
                              ))}
                            </Fragment>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                {filas.length === 0 && <SinFilas cols={nCols} />}
              </tbody>
              {filas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink">
                    <td className={td}>Total{rubrosSel.size || cuentasSel.size || q ? ' (filtrado)' : ''}</td>
                    {celdas(sumar(filas), '')}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ====================== CLASIFICACIÓN DE CUENTAS ====================== */

/**
 * El contador asigna a cada cuenta una Clasificación, un Rubro y una Nota (los
 * tres niveles de su planilla). Se guarda en flexxus_clasificacion (Supabase);
 * Sumas y saldos agrupa por acá con «Clasificación».
 */
function SolapaClasificacion() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('flexxus.clasificar')
  // El plan de cuentas viene con cualquier consulta contable: se usa la del mes (queda en cache del puente)
  const plan = useCarga<Balance>((forzar) => cargarBalance(inicioMes(), hoyIso(), forzar), [])
  const clasif = useCarga<Map<string, Clasificacion>>(() => cargarClasificacion(), [])
  const [busqueda, setBusqueda] = useState('')
  const [rubrosSel, setRubrosSel] = useState<Set<string>>(new Set())
  const [soloSin, setSoloSin] = useState(false)
  const [soloImputables, setSoloImputables] = useState(true)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [masivo, setMasivo] = useState({ clasificacion: '', rubro: '', nota: '' })
  const [guardando, setGuardando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [locales, setLocales] = useState<Map<string, Clasificacion>>(new Map())

  // Copia editable: arranca con lo guardado y se actualiza al guardar
  useEffect(() => {
    if (clasif.datos) setLocales(new Map(clasif.datos))
  }, [clasif.datos])

  const cuentas = useMemo(() => {
    if (!plan.datos) return []
    const rubro = rubros(plan.datos.cuentas)
    const porCodigo = new Map(plan.datos.cuentas.map((c) => [c.cuenta, c]))
    return plan.datos.cuentas
      .map((c) => {
        // Rubro de primer nivel + la cuenta madre directa (ej. «ACTIVO › CAJA»), para ubicarla rápido
        const top = rubro.get(c.cuenta)?.descripcion ?? ''
        const madre = porCodigo.get(c.madre)
        const rubroFx = madre && madre.descripcion !== top ? `${top} › ${madre.descripcion}` : top
        return { ...c, rubroFx, rubroCod: rubro.get(c.cuenta)?.cuenta ?? '' }
      })
      .sort((a, b) => a.cuenta.localeCompare(b.cuenta))
  }, [plan.datos])

  const sugerencias = useMemo(() => {
    const s = { clasificacion: new Set<string>(), rubro: new Set<string>(), nota: new Set<string>() }
    for (const c of locales.values()) {
      if (c.clasificacion) s.clasificacion.add(c.clasificacion)
      if (c.rubro) s.rubro.add(c.rubro)
      if (c.nota) s.nota.add(c.nota)
    }
    const orden = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    return { clasificacion: orden(s.clasificacion), rubro: orden(s.rubro), nota: orden(s.nota) }
  }, [locales])

  const opcionesRubros = useMemo(() => {
    const m = new Map(cuentas.map((c) => [c.rubroCod, c.rubroFx.split(' › ')[0]]))
    return [...m.entries()].filter(([id]) => id).sort((a, b) => a[0].localeCompare(b[0])).map(([id, label]) => ({ id, label }))
  }, [cuentas])

  const q = norm(busqueda.trim())
  const lista = cuentas
    .filter((c) => !soloImputables || c.imputable)
    .filter((c) => rubrosSel.size === 0 || rubrosSel.has(c.rubroCod))
    .filter((c) => !soloSin || !locales.get(c.cuenta)?.clasificacion)
    .filter((c) => {
      if (!q) return true
      const l = locales.get(c.cuenta)
      return norm(`${c.cuenta} ${c.descripcion} ${l?.clasificacion ?? ''} ${l?.rubro ?? ''} ${l?.nota ?? ''}`).includes(q)
    })
  const clasificadas = cuentas.filter((c) => c.imputable && locales.get(c.cuenta)?.clasificacion).length
  const imputables = cuentas.filter((c) => c.imputable).length

  async function guardar(c: Clasificacion) {
    const antes = clasif.datos?.get(c.cuenta)
    if (antes && antes.clasificacion === c.clasificacion.trim() && antes.rubro === c.rubro.trim() && antes.nota === c.nota.trim()) return
    if (!antes && !c.clasificacion.trim() && !c.rubro.trim() && !c.nota.trim()) return
    setGuardando(c.cuenta)
    try {
      await guardarClasificacion(c)
      setAviso(null)
      await clasif.cargar()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(null)
    }
  }

  async function aplicarMasivo() {
    if (elegidas.size === 0) return
    setGuardando('masivo')
    try {
      for (const cuenta of elegidas) {
        const l = locales.get(cuenta) ?? { cuenta, clasificacion: '', rubro: '', nota: '' }
        await guardarClasificacion({
          cuenta,
          clasificacion: masivo.clasificacion || l.clasificacion,
          rubro: masivo.rubro || l.rubro,
          nota: masivo.nota || l.nota,
        })
      }
      setElegidas(new Set())
      setAviso(null)
      await clasif.cargar()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(null)
    }
  }

  const editar = (cuenta: string, campo: 'clasificacion' | 'rubro' | 'nota', valor: string) =>
    setLocales((m) => {
      const n = new Map(m)
      n.set(cuenta, { ...(n.get(cuenta) ?? { cuenta, clasificacion: '', rubro: '', nota: '' }), [campo]: valor })
      return n
    })

  const exportar = () =>
    void bajarExcel('flexxus_clasificacion_cuentas', {
      Clasificación: lista.map((c) => {
        const l = locales.get(c.cuenta)
        return {
          Cuenta: c.cuenta,
          Descripción: c.descripcion,
          'Rubro Flexxus': c.rubroFx,
          Imputable: c.imputable ? 'Sí' : 'No',
          Clasificación: l?.clasificacion ?? '',
          Rubro: l?.rubro ?? '',
          Nota: l?.nota ?? '',
        }
      }),
    })

  const inputCelda = 'h-8 w-full min-w-[9rem] rounded-lg border border-line bg-surface px-2 text-xs text-ink placeholder:text-sub/50 disabled:opacity-60'

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={plan.cargando || clasif.cargando} error={plan.error ?? clasif.error} hay={!!plan.datos} texto="Trayendo el plan de cuentas…" />
      {aviso && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-500">{aviso}</p>}
      {plan.datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Cuentas imputables', valor: numero(imputables), pie: `${numero(cuentas.length)} en el plan de Flexxus`, icono: BookOpen, color: cAmber },
              { titulo: 'Clasificadas', valor: numero(clasificadas), pie: imputables ? `${((clasificadas / imputables) * 100).toFixed(0)} % del plan` : '—', icono: Tags, color: cEmerald },
              { titulo: 'Sin clasificar', valor: numero(imputables - clasificadas), pie: 'van a «Sin clasificar» en Sumas y saldos', icono: TriangleAlert, color: cOrange },
              {
                titulo: 'Clasificaciones',
                valor: numero(sugerencias.clasificacion.length),
                pie: `${numero(sugerencias.rubro.length)} rubros · ${numero(sugerencias.nota.length)} notas`,
                icono: Scale,
                color: cTeal,
              },
            ]}
          />
          <p className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-sub">
            Asigná a cada cuenta su <b className="text-ink">Clasificación</b> (ej. «01. Activo Corriente»), <b className="text-ink">Rubro</b> (ej. «01. Caja y
            Bancos») y <b className="text-ink">Nota</b> (ej. «Bancos»). Numerarlos define el orden. Se guarda solo al salir de la casilla y no toca Flexxus.
            {!puedeEditar && ' Para editar hace falta el permiso «Flexxus · Clasificar cuentas».'}
          </p>
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar cuenta o clasificación…"
            cargando={plan.cargando || clasif.cargando}
            onActualizar={() => void clasif.cargar()}
            onExcel={exportar}
            extra={
              <>
                <MultiselectFiltro label="Rubro Flexxus" opciones={opcionesRubros} seleccionadas={rubrosSel} onChange={setRubrosSel} />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                  <input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} /> Solo sin clasificar
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-sub">
                  <input type="checkbox" checked={soloImputables} onChange={(e) => setSoloImputables(e.target.checked)} /> Solo imputables
                </label>
              </>
            }
          />

          {puedeEditar && elegidas.size > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
              <span className="w-full text-xs font-medium text-sky-500">
                Asignar a las {numero(elegidas.size)} cuentas tildadas (lo que dejes vacío no se cambia):
              </span>
              {(['clasificacion', 'rubro', 'nota'] as const).map((campo) => (
                <input
                  key={campo}
                  list={`fx-sug-${campo}`}
                  value={masivo[campo]}
                  onChange={(e) => setMasivo((m) => ({ ...m, [campo]: e.target.value }))}
                  placeholder={campo === 'clasificacion' ? 'Clasificación' : campo === 'rubro' ? 'Rubro' : 'Nota'}
                  className={`${inputCelda} max-w-xs`}
                />
              ))}
              <button type="button" onClick={() => void aplicarMasivo()} disabled={guardando === 'masivo'} className={btnChico}>
                {guardando === 'masivo' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Tags size={13} aria-hidden />} Asignar
              </button>
              <button type="button" onClick={() => setElegidas(new Set())} className={btnChico}>
                Destildar
              </button>
            </div>
          )}

          {(['clasificacion', 'rubro', 'nota'] as const).map((campo) => (
            <datalist key={campo} id={`fx-sug-${campo}`}>
              {sugerencias[campo].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ))}

          <div className={caja}>
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className={filaHead}>
                  {puedeEditar && (
                    <th className={`${th} w-8`}>
                      <input
                        type="checkbox"
                        aria-label="Tildar todas las visibles"
                        checked={lista.length > 0 && lista.every((c) => elegidas.has(c.cuenta))}
                        onChange={(e) => setElegidas(e.target.checked ? new Set(lista.map((c) => c.cuenta)) : new Set())}
                      />
                    </th>
                  )}
                  <th className={th}>Cuenta</th>
                  <th className={th}>Rubro Flexxus</th>
                  <th className={th}>Clasificación</th>
                  <th className={th}>Rubro</th>
                  <th className={th}>Nota</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const l = locales.get(c.cuenta) ?? { cuenta: c.cuenta, clasificacion: '', rubro: '', nota: '' }
                  return (
                    <tr key={c.cuenta} className={`border-b border-line/60 ${c.imputable ? '' : 'opacity-60'}`}>
                      {puedeEditar && (
                        <td className={td}>
                          <input
                            type="checkbox"
                            aria-label={`Tildar ${c.cuenta}`}
                            checked={elegidas.has(c.cuenta)}
                            onChange={(e) =>
                              setElegidas((s) => {
                                const n = new Set(s)
                                if (e.target.checked) n.add(c.cuenta)
                                else n.delete(c.cuenta)
                                return n
                              })
                            }
                          />
                        </td>
                      )}
                      <td className={td}>
                        <span className="tabular-nums text-xs text-sub">{c.cuenta}</span> <span className="text-ink">{c.descripcion}</span>
                        {guardando === c.cuenta && <Loader2 size={12} className="ml-1 inline animate-spin text-sub" aria-hidden />}
                      </td>
                      <td className={`${td} text-xs text-sub`}>{c.rubroFx}</td>
                      {(['clasificacion', 'rubro', 'nota'] as const).map((campo) => (
                        <td key={campo} className="px-2 py-1">
                          <input
                            list={`fx-sug-${campo}`}
                            value={l[campo]}
                            disabled={!puedeEditar}
                            onChange={(e) => editar(c.cuenta, campo, e.target.value)}
                            onBlur={() => void guardar(locales.get(c.cuenta) ?? l)}
                            placeholder="—"
                            className={inputCelda}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {lista.length === 0 && <SinFilas cols={puedeEditar ? 6 : 5} />}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** Los asientos de una cuenta en el rango, con el saldo corrido desde el saldo inicial. */
function DetalleCuenta({ det, inicial }: { det: Mayor | { error: string } | 'cargando' | undefined; inicial: number }) {
  if (!det || det === 'cargando') {
    return (
      <p className="flex items-center gap-2 py-2 text-xs text-sub">
        <Loader2 size={13} className="animate-spin" aria-hidden /> Trayendo los asientos de la cuenta…
      </p>
    )
  }
  if ('error' in det) return <p className="py-2 text-xs text-rose-500">{det.error}</p>
  let saldo = inicial
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-sub">
            <th className="sticky top-0 bg-surface2 py-1 font-medium">Fecha</th>
            <th className="sticky top-0 bg-surface2 py-1 font-medium">Asiento</th>
            <th className="sticky top-0 bg-surface2 py-1 font-medium">Observaciones</th>
            <th className="sticky top-0 bg-surface2 py-1 text-right font-medium">Debe</th>
            <th className="sticky top-0 bg-surface2 py-1 text-right font-medium">Haber</th>
            <th className="sticky top-0 bg-surface2 py-1 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line/40 text-sub">
            <td className="py-1" colSpan={5}>
              Saldo inicial
            </td>
            <td className="py-1 text-right tabular-nums">{pesos(inicial)}</td>
          </tr>
          {det.lineas.map((l, i) => {
            saldo += l.debe - l.haber
            return (
              <tr key={i} className="border-t border-line/40">
                <td className="whitespace-nowrap py-1 text-sub">{fechaCorta(l.fecha)}</td>
                <td className="py-1 tabular-nums text-ink">{numero(l.numero)}</td>
                <td className="py-1 text-ink">{l.obs || '—'}</td>
                <td className="py-1 text-right tabular-nums text-ink">{l.debe ? pesos(l.debe) : ''}</td>
                <td className="py-1 text-right tabular-nums text-ink">{l.haber ? pesos(l.haber) : ''}</td>
                <td className="py-1 text-right tabular-nums font-medium text-ink">{pesos(saldo)}</td>
              </tr>
            )
          })}
          {det.lineas.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-center text-sub">
                Sin movimientos en el rango.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {det.recortado && <p className="py-1 text-center text-[11px] text-amber-500">Se muestran los primeros 5.000 movimientos: achicá el rango para ver todo.</p>}
    </div>
  )
}

/* =========================== CENTROS DE COSTO =========================== */

/** Clasificación de las cuentas de resultado del plan de Flexxus. */
function claseResultado(cuenta: string): 'ingresos' | 'costos' | 'gastos' | null {
  if (cuenta.startsWith('51')) return 'ingresos'
  if (cuenta.startsWith('4')) return 'costos'
  if (cuenta.startsWith('5')) return 'gastos'
  return null
}

function SolapaCentros({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, cargando, error, cargar } = useCarga<Centros>((forzar) => cargarCentros(desde, hasta, forzar), [desde, hasta])
  const [busqueda, setBusqueda] = useState('')
  const [centrosSel, setCentrosSel] = useState<Set<string>>(new Set())
  const [rubrosSel, setRubrosSel] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<string | null>(null)

  const SIN = '__sin__'
  const filasTodas = useMemo(() => {
    if (!datos) return []
    const info = new Map(datos.centros.map((c) => [c.centro, c]))
    type Fila = { centro: string; descripcion: string; rubro: string; ingresos: number; costos: number; gastos: number; cuentas: Map<string, number> }
    const m = new Map<string, Fila>()
    const fila = (id: string): Fila => {
      if (!m.has(id)) {
        const c = info.get(id)
        m.set(id, {
          centro: id,
          descripcion: id === SIN ? 'Sin centro de costo asignado' : c?.descripcion ?? `Centro ${id}`,
          rubro: id === SIN ? '—' : c?.rubro ?? 'Sin rubro',
          ingresos: 0,
          costos: 0,
          gastos: 0,
          cuentas: new Map(),
        })
      }
      return m.get(id)!
    }
    const asignado = new Map<string, number>()
    for (const a of datos.apropiado) {
      const clase = claseResultado(a.cuenta)
      if (!clase) continue
      const f = fila(a.centro)
      // neto = debe − haber: los ingresos son haber (negativos) → se muestran en positivo
      if (clase === 'ingresos') f.ingresos += -a.neto
      else f[clase] += a.neto
      f.cuentas.set(a.cuenta, (f.cuentas.get(a.cuenta) ?? 0) + a.neto)
      asignado.set(a.cuenta, (asignado.get(a.cuenta) ?? 0) + a.neto)
    }
    // Lo que quedó sin apropiar a ningún centro
    for (const t of datos.totales) {
      const clase = claseResultado(t.cuenta)
      const resto = t.neto - (asignado.get(t.cuenta) ?? 0)
      if (!clase || Math.abs(resto) < 1) continue
      const f = fila(SIN)
      if (clase === 'ingresos') f.ingresos += -resto
      else f[clase] += resto
      f.cuentas.set(t.cuenta, (f.cuentas.get(t.cuenta) ?? 0) + resto)
    }
    return [...m.values()].map((f) => ({ ...f, resultado: f.ingresos - f.costos - f.gastos }))
  }, [datos])

  const nombreCuenta = useMemo(() => new Map((datos?.cuentas ?? []).map((c) => [c.cuenta, c.descripcion])), [datos])
  const opcionesCentros = useMemo(
    () => [...filasTodas].sort((a, b) => a.descripcion.localeCompare(b.descripcion)).map((f) => ({ id: f.centro, label: f.descripcion })),
    [filasTodas],
  )
  const opcionesRubros = useMemo(() => [...new Set(filasTodas.map((f) => f.rubro))].sort().map((r) => ({ id: r, label: r })), [filasTodas])

  const q = norm(busqueda.trim())
  const filas = filasTodas
    .filter((f) => centrosSel.size === 0 || centrosSel.has(f.centro))
    .filter((f) => rubrosSel.size === 0 || rubrosSel.has(f.rubro))
    .filter((f) => !q || norm(`${f.descripcion} ${f.rubro}`).includes(q))
    .sort((a, b) => b.ingresos - a.ingresos || b.resultado - a.resultado)

  const tot = filas.reduce(
    (t, f) => ({ ingresos: t.ingresos + f.ingresos, costos: t.costos + f.costos, gastos: t.gastos + f.gastos, resultado: t.resultado + f.resultado }),
    { ingresos: 0, costos: 0, gastos: 0, resultado: 0 },
  )
  const margen = (f: { ingresos: number; resultado: number }) => (f.ingresos > 0 ? `${((f.resultado / f.ingresos) * 100).toFixed(1)} %` : '—')

  const exportar = () =>
    void bajarExcel(`flexxus_centros_costo_${desde}_${hasta}`, {
      'Por centro': filas.map((f) => ({
        Centro: f.descripcion,
        Rubro: f.rubro,
        Ingresos: Math.round(f.ingresos),
        Costos: Math.round(f.costos),
        Gastos: Math.round(f.gastos),
        Resultado: Math.round(f.resultado),
        'Margen %': f.ingresos > 0 ? Math.round((f.resultado / f.ingresos) * 1000) / 10 : '',
      })),
      'Centro x cuenta': filas.flatMap((f) =>
        [...f.cuentas.entries()].map(([cta, neto]) => ({
          Centro: f.descripcion,
          Cuenta: cta,
          Descripción: nombreCuenta.get(cta) ?? '',
          'Debe − Haber': Math.round(neto),
        })),
      ),
    })

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Repartiendo el resultado por centro de costo…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Ingresos', valor: pesosCorto(tot.ingresos), pie: pesos(tot.ingresos), icono: TrendingUp, color: cEmerald },
              { titulo: 'Costos + gastos', valor: pesosCorto(tot.costos + tot.gastos), pie: `costos ${pesosCorto(tot.costos)} · gastos ${pesosCorto(tot.gastos)}`, icono: FileText, color: cRose },
              { titulo: 'Resultado', valor: pesosCorto(tot.resultado), pie: `margen ${margen(tot)}`, icono: Scale, color: cTeal },
              { titulo: 'Centros con movimiento', valor: numero(filas.length), pie: `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`, icono: Building2, color: cPink },
            ]}
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar centro o rubro…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
            extra={
              <>
                <MultiselectFiltro label="Centros" opciones={opcionesCentros} seleccionadas={centrosSel} onChange={setCentrosSel} />
                <MultiselectFiltro label="Rubro" opciones={opcionesRubros} seleccionadas={rubrosSel} onChange={setRubrosSel} />
              </>
            }
          />
          <div className={caja}>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>Centro de costo</th>
                  <th className={thR}>Ingresos</th>
                  <th className={thR}>Costos</th>
                  <th className={thR}>Gastos</th>
                  <th className={thR}>Resultado</th>
                  <th className={thR}>Margen</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const ab = abierto === f.centro
                  return (
                    <Fragment key={f.centro}>
                      <tr className="cursor-pointer border-b border-line/60 transition hover:bg-surface2/60" onClick={() => setAbierto(ab ? null : f.centro)}>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronDown size={14} className={`text-sub transition ${ab ? '' : '-rotate-90'}`} aria-hidden />
                            <span className={`font-medium ${f.centro === SIN ? 'text-amber-500' : 'text-ink'}`}>{f.descripcion}</span>
                            <span className="text-xs text-sub">{f.rubro}</span>
                          </span>
                        </td>
                        <td className={tdR}>{f.ingresos ? pesos(f.ingresos) : '—'}</td>
                        <td className={tdR}>{f.costos ? pesos(f.costos) : '—'}</td>
                        <td className={tdR}>{f.gastos ? pesos(f.gastos) : '—'}</td>
                        <td className={`${tdR} font-semibold ${f.resultado < 0 ? 'text-rose-500' : 'text-ink'}`}>{pesos(f.resultado)}</td>
                        <td className={`${tdR} text-sub`}>{margen(f)}</td>
                      </tr>
                      {ab && (
                        <tr className="border-b border-line/60 bg-surface2/40">
                          <td colSpan={6} className="px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-sub">
                                  <th className="py-1 font-medium">Cuenta</th>
                                  <th className="py-1 text-right font-medium">Importe</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...f.cuentas.entries()]
                                  .sort((a, b) => a[0].localeCompare(b[0]))
                                  .map(([cta, neto]) => (
                                    <tr key={cta} className="border-t border-line/40">
                                      <td className="py-1">
                                        <span className="tabular-nums text-sub">{cta}</span>{' '}
                                        <span className="text-ink">{nombreCuenta.get(cta) ?? ''}</span>
                                      </td>
                                      <td className="py-1 text-right tabular-nums text-ink">
                                        {pesos(claseResultado(cta) === 'ingresos' ? -neto : neto)}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filas.length === 0 && <SinFilas cols={6} />}
              </tbody>
              {filas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink">
                    <td className={td}>Total</td>
                    <td className={tdR}>{pesos(tot.ingresos)}</td>
                    <td className={tdR}>{pesos(tot.costos)}</td>
                    <td className={tdR}>{pesos(tot.gastos)}</td>
                    <td className={tdR}>{pesos(tot.resultado)}</td>
                    <td className={tdR}>{margen(tot)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------ chiquitos ------------------------------ */

function Porcentaje({ valor, total, color }: { valor: number; total: number; color: string }) {
  const p = total > 0 ? Math.max(0, (valor / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-surface2">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, p)}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums text-sub">{p.toFixed(1)} %</span>
    </div>
  )
}

function SinFilas({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-6 text-center text-sm text-sub">
        No hay nada para mostrar.
      </td>
    </tr>
  )
}

function MasFilas({ mostradas, total }: { mostradas: number; total: number }) {
  return (
    <p className="border-t border-line px-3 py-2 text-center text-xs text-sub">
      Se muestran {numero(mostradas)} de {numero(total)}. Buscá para acotar o bajá el Excel con todo.
    </p>
  )
}
