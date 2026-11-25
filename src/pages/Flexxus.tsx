import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CalendarRange,
  ChevronDown,
  Database,
  Download,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  Scale,
  Search,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  DIAS_MAX_ASIENTOS,
  TRAMOS,
  cargarAsientos,
  cargarBalance,
  cargarSaldos,
  cargarVentas,
  diasEntre,
  fechaCorta,
  isoLocal,
  nroComprobante,
  numero,
  pesos,
  pesosCorto,
  rubros,
  tramoDe,
  type Asientos,
  type Balance,
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

type Solapa = 'ventas' | 'saldos' | 'asientos' | 'balance'

const [cSky, cEmerald, cRose, cViolet, cAmber, cTeal, cOrange, cIndigo] = coloresUnicos([
  '#0284c7',
  '#10b981',
  '#f43f5e',
  '#8b5cf6',
  '#f59e0b',
  '#14b8a6',
  '#f97316',
  '#6366f1',
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

        {solapa !== 'saldos' && (
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
  const [cuenta, setCuenta] = useState('')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const [mostrar, setMostrar] = useState(TOPE)

  const nombreCuenta = useMemo(() => new Map((datos?.cuentas ?? []).map((c) => [c.cuenta, c.descripcion])), [datos])
  const lineasPor = useMemo(() => {
    const m = new Map<number, Asientos['lineas']>()
    for (const l of datos?.lineas ?? []) {
      const arr = m.get(l[0]) ?? []
      arr.push(l)
      m.set(l[0], arr)
    }
    return m
  }, [datos])
  const cuentasUsadas = useMemo(() => {
    const s = new Set((datos?.lineas ?? []).map((l) => l[1]))
    return [...s].sort().map((c) => ({ cuenta: c, descripcion: nombreCuenta.get(c) ?? '' }))
  }, [datos, nombreCuenta])

  const q = norm(busqueda.trim())
  const lista = useMemo(
    () =>
      (datos?.asientos ?? [])
        .filter((a) => !cuenta || (lineasPor.get(a.asiento) ?? []).some((l) => l[1] === cuenta))
        .filter((a) => !q || norm(`${a.numero} ${a.obs}`).includes(q))
        .reverse(),
    [datos, cuenta, q, lineasPor],
  )

  /* Con una cuenta elegida, el «mayor»: debe, haber y saldo de esa cuenta en el rango. */
  const mayor = useMemo(() => {
    if (!cuenta) return null
    let debe = 0
    let haber = 0
    for (const a of lista) for (const l of lineasPor.get(a.asiento) ?? []) if (l[1] === cuenta) (l[3] ? (debe += l[2]) : (haber += l[2]))
    return { debe, haber }
  }, [cuenta, lista, lineasPor])

  const exportar = () =>
    void bajarExcel(`flexxus_asientos_${desde}_${hasta}`, {
      Asientos: lista.flatMap((a) =>
        (lineasPor.get(a.asiento) ?? []).map((l) => ({
          Fecha: a.fecha,
          Asiento: a.numero,
          Observaciones: a.obs,
          Cuenta: l[1],
          Descripción: nombreCuenta.get(l[1]) ?? '',
          Debe: l[3] ? l[2] : 0,
          Haber: l[3] ? 0 : l[2],
        })),
      ),
    })

  if (largo) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-500">
        El libro diario se mira de a {DIAS_MAX_ASIENTOS} días como máximo (elegiste {numero(dias)}). Achicá el rango o usá «Sumas y
        saldos», que sí toma el año entero.
      </p>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Leyendo los asientos de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Asientos', valor: numero(lista.length), pie: `${numero(datos.lineas.length)} líneas en el rango`, icono: BookOpen, color: cAmber },
              ...(mayor
                ? [
                    { titulo: 'Debe', valor: pesosCorto(mayor.debe), pie: pesos(mayor.debe), icono: TrendingUp, color: cEmerald },
                    { titulo: 'Haber', valor: pesosCorto(mayor.haber), pie: pesos(mayor.haber), icono: FileText, color: cRose },
                    {
                      titulo: 'Saldo del período',
                      valor: pesosCorto(mayor.debe - mayor.haber),
                      pie: `${cuenta} · ${nombreCuenta.get(cuenta) ?? ''}`,
                      icono: Scale,
                      color: cTeal,
                    },
                  ]
                : []),
            ]}
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar número u observación…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
            extra={
              <select
                value={cuenta}
                onChange={(e) => {
                  setCuenta(e.target.value)
                  setMostrar(TOPE)
                }}
                className="h-10 max-w-xs rounded-xl border border-line bg-surface px-2 text-sm text-ink"
                aria-label="Filtrar por cuenta"
              >
                <option value="">Todas las cuentas</option>
                {cuentasUsadas.map((c) => (
                  <option key={c.cuenta} value={c.cuenta}>
                    {c.cuenta} · {c.descripcion}
                  </option>
                ))}
              </select>
            }
          />
          <div className={caja}>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>Fecha</th>
                  <th className={th}>Asiento</th>
                  <th className={th}>Observaciones</th>
                  <th className={thR}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, mostrar).map((a) => {
                  const lin = lineasPor.get(a.asiento) ?? []
                  const importe = lin.reduce((t, l) => t + (l[3] ? l[2] : 0), 0)
                  const ab = abiertos.has(a.asiento)
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
                        <td className={`${tdR} text-ink`}>{pesos(importe)}</td>
                      </tr>
                      {ab && (
                        <tr className="border-b border-line/60 bg-surface2/40">
                          <td colSpan={4} className="px-3 py-2">
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
                                  <tr key={i} className={`border-t border-line/40 ${l[1] === cuenta ? 'bg-teal-500/10' : ''}`}>
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
                {lista.length === 0 && <SinFilas cols={4} />}
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

/* =========================== SUMAS Y SALDOS =========================== */

function SolapaBalance({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, cargando, error, cargar } = useCarga<Balance>((forzar) => cargarBalance(desde, hasta, forzar), [desde, hasta])
  const [busqueda, setBusqueda] = useState('')

  const filas = useMemo(() => {
    if (!datos) return []
    const plan = new Map(datos.cuentas.map((c) => [c.cuenta, c]))
    const rubro = rubros(datos.cuentas)
    const q = norm(busqueda.trim())
    return datos.movimientos
      .map((m) => ({
        ...m,
        descripcion: plan.get(m.cuenta)?.descripcion ?? '',
        rubro: rubro.get(m.cuenta)?.descripcion ?? 'Sin rubro',
        rubroCod: rubro.get(m.cuenta)?.cuenta ?? 'zzz',
        saldo: m.debe - m.haber,
      }))
      .filter((f) => !q || norm(`${f.cuenta} ${f.descripcion} ${f.rubro}`).includes(q))
      .sort((a, b) => a.cuenta.localeCompare(b.cuenta))
  }, [datos, busqueda])

  const grupos = useMemo(() => {
    const m = new Map<string, { rubro: string; cod: string; filas: typeof filas; debe: number; haber: number }>()
    for (const f of filas) {
      const g = m.get(f.rubroCod) ?? { rubro: f.rubro, cod: f.rubroCod, filas: [], debe: 0, haber: 0 }
      g.filas.push(f)
      g.debe += f.debe
      g.haber += f.haber
      m.set(f.rubroCod, g)
    }
    return [...m.values()].sort((a, b) => a.cod.localeCompare(b.cod))
  }, [filas])

  const debe = filas.reduce((t, f) => t + f.debe, 0)
  const haber = filas.reduce((t, f) => t + f.haber, 0)
  const cuadra = Math.abs(debe - haber) < 1

  const exportar = () =>
    void bajarExcel(`flexxus_sumas_y_saldos_${desde}_${hasta}`, {
      'Sumas y saldos': filas.map((f) => ({
        Rubro: f.rubro,
        Cuenta: f.cuenta,
        Descripción: f.descripcion,
        Debe: f.debe,
        Haber: f.haber,
        Saldo: f.saldo,
        Movimientos: f.lineas,
      })),
    })

  return (
    <div className="space-y-4 pb-6">
      <Estado cargando={cargando} error={error} hay={!!datos} texto="Sumando los asientos de Flexxus…" />
      {datos && (
        <>
          <Tarjetas
            items={[
              { titulo: 'Total debe', valor: pesosCorto(debe), pie: pesos(debe), icono: TrendingUp, color: cEmerald },
              { titulo: 'Total haber', valor: pesosCorto(haber), pie: pesos(haber), icono: FileText, color: cRose },
              {
                titulo: cuadra ? 'Cuadra' : 'Diferencia',
                valor: cuadra ? 'OK' : pesosCorto(debe - haber),
                pie: busqueda ? 'con el filtro aplicado' : 'debe − haber del período',
                icono: Scale,
                color: cTeal,
              },
              { titulo: 'Cuentas con movimiento', valor: numero(filas.length), pie: `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`, icono: BookOpen, color: cAmber },
            ]}
          />
          <Barra
            busqueda={busqueda}
            setBusqueda={setBusqueda}
            placeholder="Buscar cuenta o rubro…"
            calculado={datos.calculado}
            cacheado={datos.cacheado}
            cargando={cargando}
            onActualizar={() => void cargar(true)}
            onExcel={exportar}
          />
          <div className={caja}>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={filaHead}>
                  <th className={th}>Cuenta</th>
                  <th className={thR}>Debe</th>
                  <th className={thR}>Haber</th>
                  <th className={thR}>Saldo</th>
                  <th className={thR}>Mov.</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <Fragment key={g.cod}>
                    <tr className="border-b border-line bg-surface2/60">
                      <td className={`${td} text-xs font-semibold uppercase tracking-wide text-ink`}>{g.rubro}</td>
                      <td className={`${tdR} text-xs font-semibold text-ink`}>{pesos(g.debe)}</td>
                      <td className={`${tdR} text-xs font-semibold text-ink`}>{pesos(g.haber)}</td>
                      <td className={`${tdR} text-xs font-semibold text-ink`}>{pesos(g.debe - g.haber)}</td>
                      <td />
                    </tr>
                    {g.filas.map((f) => (
                      <tr key={f.cuenta} className="border-b border-line/60 last:border-0">
                        <td className={td}>
                          <span className="tabular-nums text-xs text-sub">{f.cuenta}</span>{' '}
                          <span className="text-ink">{f.descripcion || '—'}</span>
                        </td>
                        <td className={tdR}>{f.debe ? pesos(f.debe) : '—'}</td>
                        <td className={tdR}>{f.haber ? pesos(f.haber) : '—'}</td>
                        <td className={`${tdR} font-medium ${f.saldo < 0 ? 'text-rose-500' : 'text-ink'}`}>{pesos(f.saldo)}</td>
                        <td className={`${tdR} text-sub`}>{numero(f.lineas)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {filas.length === 0 && <SinFilas cols={5} />}
              </tbody>
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
