import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, ChevronDown, Download, Layers, Loader2, RefreshCw, Search, TriangleAlert, Wallet } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  cargarStockValorizado,
  costoUnitario,
  nombreBase,
  numero,
  pesos,
  pesosCorto,
  totalDe,
  type StockValorizado as Datos,
} from '@/lib/stockValorizado'

/**
 * Administradores > Stock valorizado.
 *
 * Qué tengo en stock y cuánta plata es, a COSTO, sucursal por sucursal.
 * Los números salen de /api/sql/stock-valorizado → Puente SQL →
 * puente-sql/sql/stock-valorizado.sql: stock por SKU de cada base
 * DRAGONFISH_* (ZooLogic.COMB) por el costo de la lista "Compra" (LISTA0)
 * de Dragon, que está cargada por artículo.
 *
 * El cálculo recorre ~40 bases y tarda unos 12 s, así que el puente lo cachea
 * 10 minutos; "Actualizar" recalcula de cero (forzar=1).
 */

/** Filas que se dibujan en la tabla de artículos sin costo (el resto, al Excel). */
const TOPE_TABLA = 300

export default function StockValorizado() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [verArticulos, setVerArticulos] = useState(false)
  const [incluirSinValor, setIncluirSinValor] = useState(false)
  const [verSinCosto, setVerSinCosto] = useState(false)

  const cargar = useCallback(async (forzar = false) => {
    setCargando(true)
    try {
      setDatos(await cargarStockValorizado(forzar))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const todas = datos?.bases ?? []

  /* Hay bases que no son de mercadería de venta (insumos, descartes) y no tienen
     ningún costo cargado: suman cientos de miles de unidades y $0, así que de
     entrada quedan afuera para que el total no engañe. Se ven con el botón. */
  const sinValor = useMemo(() => todas.filter((b) => b.valorizado <= 0), [todas])
  const bases = useMemo(
    () => (incluirSinValor ? todas : todas.filter((b) => b.valorizado > 0)),
    [todas, incluirSinValor],
  )
  const total = useMemo(() => totalDe(bases), [bases])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return bases
    return bases.filter((b) => `${nombreBase(b.base)} ${b.base}`.toLowerCase().includes(q))
  }, [bases, busqueda])

  const articulos = datos?.articulos ?? []
  /* Mismo criterio que el total: con el botón ámbar apagado se muestran solo
     los artículos que están en sucursales que valorizan (si no, el listado
     arranca con miles de avíos de NOMED). */
  const sinCosto = useMemo(() => {
    const lista = datos?.sin_costo ?? []
    return incluirSinValor ? lista : lista.filter((a) => a.unidades_val > 0)
  }, [datos, incluirSinValor])
  const unidadesSinCosto = (a: { unidades: number; unidades_val: number }) =>
    incluirSinValor ? a.unidades : a.unidades_val

  // Íconos de las tarjetas: sin tonos repetidos en la pantalla
  const [cEmerald, cBlue, cViolet, cAmber] = coloresUnicos(['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'])

  async function exportar() {
    if (bases.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        bases.map((b) => ({
          Sucursal: nombreBase(b.base),
          Base: b.base,
          Unidades: b.unidades,
          'Costo promedio': Math.round(costoUnitario(b)),
          Valorizado: Math.round(b.valorizado),
          'Unidades sin costo': b.unidades_sin_costo,
          SKUs: b.skus,
        })),
      ),
      'Por sucursal',
    )
    if (articulos.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          articulos.map((a) => ({
            Artículo: a.articulo,
            Descripción: a.descripcion,
            Unidades: a.unidades,
            Costo: a.costo ?? '',
            Valorizado: Math.round(a.valorizado),
          })),
        ),
        'Top artículos',
      )
    }
    if (sinCosto.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          sinCosto.map((a) => ({
            Artículo: a.articulo,
            Descripción: a.descripcion,
            Unidades: unidadesSinCosto(a),
            Sucursales: a.sucursales,
            'En qué sucursales': a.bases,
          })),
        ),
        'Sin costo',
      )
    }
    XLSX.writeFile(wb, `stock_valorizado_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  const tarjetas = [
    { titulo: 'Valorizado total', valor: pesosCorto(total.valorizado), pie: pesos(total.valorizado), icono: Wallet, color: cEmerald },
    { titulo: 'Unidades', valor: numero(total.unidades), pie: `${numero(total.skus)} SKUs con stock`, icono: Boxes, color: cBlue },
    { titulo: 'Sucursales', valor: numero(total.sucursales), pie: 'bases con stock cargado', icono: Layers, color: cViolet },
    {
      titulo: 'Unidades sin costo',
      valor: numero(total.unidades_sin_costo),
      pie:
        total.unidades > 0
          ? `${((total.unidades_sin_costo / total.unidades) * 100).toFixed(1)} % del stock, valen 0`
          : 'sin stock',
      icono: TriangleAlert,
      color: cAmber,
    },
  ]

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Wallet size={22} style={{ color: cEmerald }} aria-hidden /> Stock valorizado
        </h1>
        <span className="text-xs text-sub/70">
          a costo · lista «{datos?.costo.lista_nombre ?? 'Compra'}» de Dragon
          {datos?.costo.articulos_con_costo ? ` · ${numero(datos.costo.articulos_con_costo)} artículos con costo` : ''}
        </span>
        {datos?.calculado && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            calculado {new Date(datos.calculado).toLocaleString('es-AR', { hour12: false })}
            {datos.cacheado ? ' (cache)' : datos.segundos ? ` en ${datos.segundos} s` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void exportar()} disabled={bases.length === 0} className={btnChico} type="button">
            <Download size={13} aria-hidden /> Excel
          </button>
          <button onClick={() => void cargar(true)} disabled={cargando} className={btnChico} type="button">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando && !datos && (
        <p className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Recorriendo las bases y valorizando el stock…
        </p>
      )}

      {datos && (
        <div className="space-y-4 pb-6">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tarjetas.map((t) => (
              <div key={t.titulo} className="rounded-2xl border border-line bg-surface p-3">
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <t.icono size={14} style={{ color: t.color }} aria-hidden /> {t.titulo}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink">{t.valor}</p>
                <p className="text-[11px] text-sub/70">{t.pie}</p>
              </div>
            ))}
          </div>

          {/* Buscador + bases sin costo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar sucursal…"
              className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
              />
            </div>
            {sinValor.length > 0 && (
              <button
                type="button"
                onClick={() => setIncluirSinValor((v) => !v)}
                className={`btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition ${
                  incluirSinValor
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                    : 'border-line bg-surface text-sub hover:bg-surface2'
                }`}
                title={sinValor.map((b) => `${nombreBase(b.base)} · ${numero(b.unidades)} u.`).join(' · ')}
              >
                <TriangleAlert size={13} aria-hidden />
                {incluirSinValor ? 'Ocultar' : 'Sumar'} {sinValor.length} base{sinValor.length > 1 ? 's' : ''} sin costo
                cargado ({numero(sinValor.reduce((t, b) => t + b.unidades, 0))} u.)
              </button>
            )}
          </div>

          {/* Por sucursal */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-sub">
                  <th className="px-3 py-2 font-medium">Sucursal</th>
                  <th className="px-3 py-2 text-right font-medium">Unidades</th>
                  <th className="px-3 py-2 text-right font-medium">Costo prom.</th>
                  <th className="px-3 py-2 text-right font-medium">Valorizado</th>
                  <th className="px-3 py-2 font-medium">% del total</th>
                  <th className="px-3 py-2 text-right font-medium">Sin costo</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((b) => {
                  const parte = total.valorizado > 0 ? (b.valorizado / total.valorizado) * 100 : 0
                  return (
                    <tr key={b.base} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{nombreBase(b.base)}</span>
                        <span className="ml-2 font-mono text-[11px] text-sub/70">{b.base}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(b.unidades)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-sub">{pesos(costoUnitario(b))}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{pesos(b.valorizado)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface2">
                            <div className="h-full rounded-full" style={{ width: `${parte}%`, backgroundColor: cEmerald }} />
                          </div>
                          <span className="tabular-nums text-xs text-sub">{parte.toFixed(1)} %</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-amber-500">
                        {b.unidades_sin_costo > 0 ? numero(b.unidades_sin_costo) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-sub">
                      No hay sucursales que coincidan.
                    </td>
                  </tr>
                )}
              </tbody>
              {visibles.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line bg-surface2/50 font-semibold text-ink">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{numero(total.unidades)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sub">{pesos(costoUnitario(total))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pesos(total.valorizado)}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right tabular-nums text-amber-500">
                      {total.unidades_sin_costo > 0 ? numero(total.unidades_sin_costo) : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Top artículos */}
          {articulos.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => setVerArticulos((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-ink"
              >
                <ChevronDown size={16} className={`transition ${verArticulos ? '' : '-rotate-90'}`} aria-hidden />
                Artículos que más plata tienen ({articulos.length})
                <span className="ml-auto text-xs font-normal text-sub/70">todas las sucursales juntas</span>
              </button>
              {verArticulos && (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-sub">
                        <th className="px-3 py-2 font-medium">Artículo</th>
                        <th className="px-3 py-2 font-medium">Descripción</th>
                        <th className="px-3 py-2 text-right font-medium">Unidades</th>
                        <th className="px-3 py-2 text-right font-medium">Costo</th>
                        <th className="px-3 py-2 text-right font-medium">Valorizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articulos.map((a) => (
                        <tr key={a.articulo} className="border-b border-line/60 last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-ink">{a.articulo}</td>
                          <td className="px-3 py-2 text-sub">{a.descripcion || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(a.unidades)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sub">
                            {a.costo == null ? '—' : pesos(a.costo)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{pesos(a.valorizado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Artículos sin costo cargado */}
          {sinCosto.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5">
              <button
                type="button"
                onClick={() => setVerSinCosto((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-ink"
              >
                <ChevronDown size={16} className={`transition ${verSinCosto ? '' : '-rotate-90'}`} aria-hidden />
                <TriangleAlert size={15} style={{ color: cAmber }} aria-hidden />
                Artículos sin costo cargado ({sinCosto.length})
                <span className="ml-auto text-xs font-normal text-sub/70">
                  {numero(sinCosto.reduce((t, a) => t + unidadesSinCosto(a), 0))} unidades que hoy valen $0
                </span>
              </button>
              {verSinCosto && (
                <div className="overflow-x-auto border-t border-amber-500/20">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-amber-500/20 text-left text-xs uppercase tracking-wide text-sub">
                        <th className="px-3 py-2 font-medium">Artículo</th>
                        <th className="px-3 py-2 font-medium">Descripción</th>
                        <th className="px-3 py-2 text-right font-medium">Unidades</th>
                        <th className="px-3 py-2 font-medium">Sucursales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sinCosto.slice(0, TOPE_TABLA).map((a) => (
                        <tr key={a.articulo} className="border-b border-amber-500/10 last:border-0">
                          <td className="px-3 py-2 font-mono text-xs text-ink">{a.articulo}</td>
                          <td className="px-3 py-2 text-sub">{a.descripcion || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(unidadesSinCosto(a))}</td>
                          <td className="px-3 py-2 text-xs text-sub/80" title={a.bases}>
                            {a.sucursales > 3 ? `${a.sucursales} sucursales` : a.bases || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sinCosto.length > TOPE_TABLA && (
                    <p className="px-3 py-2 text-[11px] text-sub/70">
                      Se muestran los {numero(TOPE_TABLA)} de más unidades. Los {numero(sinCosto.length)} están
                      completos en el Excel, hoja «Sin costo».
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <p className="text-[11px] leading-relaxed text-sub/70">
            El costo es el de la lista «{datos.costo.lista_nombre}» ({datos.costo.lista}) cargada en Dragon, tomando la
            vigencia más nueva de cada artículo. Las unidades de artículos sin costo cargado se cuentan en «Unidades»
            pero suman $0 al valorizado. Stock por SKU de cada base <span className="font-mono">DRAGONFISH_*</span>{' '}
            {datos.servidor ? `del servidor ${datos.servidor}` : ''}.
          </p>
        </div>
      )}
    </Layout>
  )
}
