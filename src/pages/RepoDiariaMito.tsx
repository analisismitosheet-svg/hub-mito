import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, Download, Loader2, PackageCheck, RefreshCw, Search, Send, Store, X, XCircle } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import {
  bajarExcelRepo,
  cargarEnDragon,
  cargarRepoDiaria,
  estadoCargaDragon,
  revisarCargaDragon,
  type CargaDragon,
  type LocalDragon,
  type RepoDiaria as Datos,
} from '@/lib/repoDiaria'

/**
 * Compras > Repo diaria (/compras/repo-diaria).
 *
 * Lo que antes salía de TRANSFER.pbix + repo_diaria.py, ahora en vivo del DWH:
 * venta del día anterior de cada local, repartiendo el stock REAL de MITO
 * (físico - comprometido) por prioridad de local, sin pasarse nunca. Ya no hace
 * falta actualizar el PBIX. El Excel tiene las mismas 4 hojas (IMPORTAR DRAGON incluida).
 *
 * El Puente tarda ~45 s en leer el DWH; después la foto queda 5 minutos y
 * cambiar de día es instantáneo. "Actualizar" saca una foto nueva.
 * (src/pages/RepoDiaria.tsx es otra cosa: un re-export viejo de Transferencias.)
 */

const numero = (n: number) => n.toLocaleString('es-AR')
const pct = (n: number) => `${(n * 100).toFixed(1)} %`
const diaCorto = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })

export default function RepoDiariaMito() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [esperando, setEsperando] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** días elegidos; vacío = el último con venta (lo decide el puente) */
  const [fechas, setFechas] = useState<string[]>([])
  const [local, setLocal] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [dragonAbierto, setDragonAbierto] = useState(false)
  const vivo = useRef(true)
  const pedido = useRef(0)

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  const cargar = useCallback(async (dias: string[], forzar: boolean) => {
    const id = ++pedido.current
    const vigente = () => vivo.current && id === pedido.current
    setCargando(true)
    setEsperando(0)
    try {
      const r = await cargarRepoDiaria(
        dias,
        forzar,
        (s) => {
          if (vigente()) setEsperando(s)
        },
        () => !vigente(),
      )
      if (!vigente()) return
      setDatos(r)
      setFechas(r.dias)
      setError(null)
    } catch (e) {
      if (!vigente()) return
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'cancelado') setError(msg)
    } finally {
      if (vigente()) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar([], false)
  }, [cargar])

  function alternarDia(dia: string) {
    const nuevos = fechas.includes(dia) ? fechas.filter((d) => d !== dia) : [...fechas, dia].sort()
    if (!nuevos.length) return
    setFechas(nuevos)
    setLocal(null)
    void cargar(nuevos, false)
  }

  const total = datos?.resumen.find((r) => r.cliente === 'TOTAL')
  const cantLocales = datos ? datos.resumen.filter((r) => r.cliente !== 'TOTAL' && r.skus > 0).length : 0

  const visibles = useMemo(() => {
    if (!datos) return []
    const q = busqueda.trim().toLowerCase()
    return datos.filas.filter(
      (f) =>
        (!local || f.cliente === local) &&
        (!q || `${f.sku} ${f.desc_adicional} ${f.descripcion} ${f.proveedor}`.toLowerCase().includes(q)),
    )
  }, [datos, local, busqueda])

  const skusConComprometido = useMemo(
    () => (datos ? new Set(datos.filas.filter((f) => f.comprometido > 0).map((f) => f.sku)).size : 0),
    [datos],
  )

  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  const tarjetas = datos
    ? [
        { titulo: 'Unidades a reponer', valor: numero(datos.unidades), pie: `venta ${datos.fecha_str}` },
        { titulo: 'Renglones (SKU x local)', valor: numero(datos.filas.length), pie: `${cantLocales} locales` },
        { titulo: 'Completitud', valor: total ? pct(total.completitud) : '—', pie: 'SKUs vendidos que MITO puede reponer' },
        { titulo: 'SKUs con comprometido', valor: numero(skusConComprometido), pie: 'de los que se reponen' },
      ]
    : []

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <PackageCheck size={22} style={{ color: '#0ea5e9' }} aria-hidden /> Repo diaria
        </h1>
        <span className="text-xs text-sub/70">venta del día anterior · stock MITO real = físico − comprometido</span>
        {datos?.foto && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            datos del DWH de las{' '}
            {new Date(datos.foto).toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => datos && void bajarExcelRepo(datos)}
            disabled={!datos || cargando || datos.filas.length === 0}
            className={btnChico}
            type="button"
          >
            <Download size={13} aria-hidden /> Excel
          </button>
          <button
            onClick={() => setDragonAbierto(true)}
            disabled={!datos || cargando || datos.filas.length === 0}
            className="btn-press inline-flex h-8 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
            type="button"
          >
            <Send size={13} aria-hidden /> Cargar en Dragon
          </button>
          <button onClick={() => void cargar(fechas, true)} disabled={cargando} className={btnChico} type="button">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {/* Días con venta: se pueden sumar varios (ej. el lunes, sábado + domingo) */}
      {datos && datos.dias_disponibles.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <CalendarDays size={15} className="text-sub" aria-hidden />
          {datos.dias_disponibles.map((d) => {
            const on = fechas.includes(d.dia)
            return (
              <button
                key={d.dia}
                type="button"
                disabled={cargando}
                onClick={() => alternarDia(d.dia)}
                title={`${numero(d.unidades)} u. vendidas`}
                className={`btn-press rounded-lg border px-2.5 py-1 text-xs capitalize transition disabled:opacity-60 ${
                  on ? 'border-sky-500/50 bg-sky-500/15 font-semibold text-sky-500' : 'border-line bg-surface text-sub hover:text-ink'
                }`}
              >
                {diaCorto(d.dia)}
              </button>
            )
          })}
          <span className="text-[11px] text-sub/70">tocá varios días para sumarlos</span>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          {esperando > 0
            ? `Leyendo ventas y stock del DWH… ${esperando} s (suele tardar menos de un minuto)`
            : 'Calculando la repo…'}
        </p>
      )}

      {datos && (
        <div className="space-y-4 pb-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tarjetas.map((t) => (
              <div key={t.titulo} className="rounded-2xl border border-line bg-surface p-3">
                <p className="text-xs text-sub">{t.titulo}</p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink">{t.valor}</p>
                <p className="text-[11px] text-sub/70">{t.pie}</p>
              </div>
            ))}
          </div>

          {/* Resumen por local: tocar uno filtra el detalle */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-sub">
                  <th className="px-3 py-2">Local</th>
                  <th className="px-3 py-2 text-right">SKUs</th>
                  <th className="px-3 py-2 text-right">Unidades</th>
                  <th className="px-3 py-2 text-right">% completitud</th>
                </tr>
              </thead>
              <tbody>
                {datos.resumen.map((r) => {
                  const esTotal = r.cliente === 'TOTAL'
                  const activo = local === r.cliente
                  return (
                    <tr
                      key={r.cliente}
                      onClick={() => {
                        if (!esTotal) setLocal(activo ? null : r.cliente)
                      }}
                      className={`border-b border-line/60 text-ink last:border-0 ${esTotal ? 'font-semibold' : 'cursor-pointer hover:bg-surface2'} ${activo ? 'bg-sky-500/10' : ''}`}
                    >
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          {!esTotal && <Store size={13} className="text-sub" aria-hidden />}
                          {r.cliente}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{numero(r.skus)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{numero(r.unidades)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.completitud)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Detalle */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar SKU, descripción o proveedor…"
                className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
              />
            </div>
            {local && (
              <button type="button" onClick={() => setLocal(null)} className={btnChico}>
                <X size={13} aria-hidden /> {local}
              </button>
            )}
            <span className="text-xs text-sub">{numero(visibles.length)} renglones</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-sub">
                  <th className="px-2 py-2">Local</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Descripción</th>
                  <th className="px-2 py-2 text-right" title="Stock real de MITO = físico − comprometido">Stock real</th>
                  <th className="px-2 py-2 text-right">Físico</th>
                  <th className="px-2 py-2 text-right">Comprom.</th>
                  <th className="px-2 py-2 text-right">Venta local</th>
                  <th className="px-2 py-2 text-right">Venta total</th>
                  <th className="px-2 py-2 text-right">A reponer</th>
                  <th className="px-2 py-2">Método</th>
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, 1500).map((f) => (
                  <tr
                    key={`${f.cliente}|${f.sku}`}
                    className={`border-b border-line/60 last:border-0 ${f.metodo === 'PARCIAL' ? 'bg-amber-500/10' : ''}`}
                  >
                    <td className="px-2 py-1 text-ink">{f.cliente}</td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{f.sku}</td>
                    <td className="px-2 py-1 text-sub">{f.desc_adicional}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-ink">{numero(f.stock_mito)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.stock_fisico)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${f.comprometido > 0 ? 'text-amber-500' : 'text-sub/60'}`}>
                      {numero(f.comprometido)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.venta_local)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.venta_total)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{numero(f.a_reponer)}</td>
                    <td className={`px-2 py-1 ${f.metodo === 'PARCIAL' ? 'text-amber-500' : 'text-sub'}`}>{f.metodo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibles.length > 1500 && <p className="p-2 text-xs text-sub">Se muestran 1.500; el resto está en el Excel.</p>}
          </div>
        </div>
      )}

      {dragonAbierto && datos && <CargaDragonModal datos={datos} onCerrar={() => setDragonAbierto(false)} />}
    </Layout>
  )
}

/* ---- Cargar en Dragon: un pedido de venta VTD por local -------------------------------
 * 1) revisar: el Puente arma los pedidos con la MISMA foto que se ve y marca los locales
 *    que ya tienen su pedido VTD con esta observación (no se cargan dos veces).
 * 2) el usuario elige locales y confirma; 3) el Puente los da de alta uno por uno por la
 *    API de Dragon y acá se ve el avance (N° de pedido o el error de cada local).
 */
const ETIQUETA: Record<LocalDragon['estado'], string> = {
  pendiente: 'Para cargar',
  ya_estaba: 'Ya estaba cargado',
  cargando: 'Cargando…',
  cargado: 'Cargado',
  en_seco: 'Prueba (no se cargó)',
  error: 'Error',
}

function CargaDragonModal({ datos, onCerrar }: { datos: Datos; onCerrar: () => void }) {
  const [carga, setCarga] = useState<CargaDragon | null>(null)
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [fase, setFase] = useState<'revisando' | 'confirmar' | 'cargando' | 'listo'>('revisando')
  const [error, setError] = useState<string | null>(null)
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    revisarCargaDragon(datos)
      .then((c) => {
        if (!vivo.current) return
        setCarga(c)
        setElegidos(new Set(c.locales.filter((l) => l.estado === 'pendiente').map((l) => l.cliente)))
        setFase('confirmar')
      })
      .catch((e) => vivo.current && (setError(e instanceof Error ? e.message : String(e)), setFase('listo')))
    return () => {
      vivo.current = false
    }
  }, [datos])

  async function confirmar() {
    if (!carga || !elegidos.size) return
    setFase('cargando')
    setError(null)
    try {
      let c = await cargarEnDragon(datos, carga.obs, [...elegidos])
      setCarga(c)
      while (c.en_curso) {
        await new Promise((r) => setTimeout(r, 2000))
        if (!vivo.current) return
        const e = await estadoCargaDragon()
        if (!e) break
        c = e
        setCarga(c)
      }
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : String(e))
    }
    if (vivo.current) setFase('listo')
  }

  const pendientes = carga?.locales.filter((l) => l.estado === 'pendiente') ?? []
  const aCargar = pendientes.filter((l) => elegidos.has(l.cliente))
  const unidadesACargar = aCargar.reduce((a, l) => a + l.unidades, 0)
  const errores = carga?.locales.filter((l) => l.estado === 'error').length ?? 0

  function alternar(cliente: string) {
    setElegidos((s) => {
      const n = new Set(s)
      if (n.has(cliente)) n.delete(cliente)
      else n.add(cliente)
      return n
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-xl">
        <div className="flex items-start gap-2 border-b border-line p-4">
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold text-ink">Cargar en Dragon</h2>
            <p className="text-xs text-sub">
              Un pedido de venta por local · motivo VTD · obs. «{carga?.obs ?? `REPO DIARIA (${datos.fecha_str})`}»
            </p>
          </div>
          <button type="button" onClick={onCerrar} disabled={fase === 'cargando'} className="text-sub hover:text-ink disabled:opacity-40" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {carga?.en_seco && (
            <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-500">
              El Puente está en modo prueba (PUENTE_DRAGON_EN_SECO): arma los pedidos pero no los carga en Dragon.
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 rounded-lg border border-brand-600/30 bg-brand-600/10 p-2 text-sm text-brand-400">
              {error}
            </p>
          )}
          {fase === 'revisando' && (
            <p className="flex items-center gap-2 text-sm text-sub">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Revisando qué locales ya tienen su pedido en Dragon…
            </p>
          )}
          {carga && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-sub">
                  <th className="w-6 py-1.5" />
                  <th className="py-1.5">Local</th>
                  <th className="py-1.5 text-right">Renglones</th>
                  <th className="py-1.5 text-right">Unid.</th>
                  <th className="py-1.5 pl-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {carga.locales.map((l) => {
                  const elegible = fase === 'confirmar' && l.estado === 'pendiente'
                  return (
                    <tr key={l.cliente} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Cargar ${l.cliente}`}
                          disabled={!elegible}
                          checked={l.estado === 'pendiente' ? elegidos.has(l.cliente) : false}
                          onChange={() => alternar(l.cliente)}
                        />
                      </td>
                      <td className="py-1.5 text-ink">
                        {l.cliente} <span className="text-[10px] text-sub/70">{l.lista}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-sub">{numero(l.renglones)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink">{numero(l.unidades)}</td>
                      <td className="py-1.5 pl-3 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            l.estado === 'cargado' ? 'text-emerald-500'
                            : l.estado === 'error' ? 'text-brand-400'
                            : l.estado === 'ya_estaba' ? 'text-sub'
                            : l.estado === 'en_seco' ? 'text-amber-500'
                            : 'text-ink'
                          }`}
                          title={l.error ?? undefined}
                        >
                          {l.estado === 'cargando' && <Loader2 size={12} className="animate-spin" aria-hidden />}
                          {l.estado === 'cargado' && <CheckCircle2 size={12} aria-hidden />}
                          {l.estado === 'error' && <XCircle size={12} aria-hidden />}
                          {ETIQUETA[l.estado]}
                          {l.numero != null && ` · N° ${l.numero}`}
                        </span>
                        {l.error && <span className="block max-w-[14rem] truncate text-[10px] text-brand-400">{l.error}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {fase === 'confirmar' && carga && !pendientes.length && (
            <p className="mt-3 text-sm text-sub">Todos los locales ya tienen su pedido de esta repo en Dragon.</p>
          )}
          {fase === 'listo' && errores > 0 && (
            <p className="mt-3 text-xs text-sub">Volvé a abrir «Cargar en Dragon» para reintentar los que dieron error: los ya cargados no se repiten.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line p-4">
          {fase === 'confirmar' && (
            <>
              <button type="button" onClick={onCerrar} className="h-9 rounded-lg border border-line bg-surface2 px-3 text-sm text-ink">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={!aCargar.length}
                className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Send size={14} aria-hidden />
                Cargar {aCargar.length} pedido{aCargar.length === 1 ? '' : 's'} ({numero(unidadesACargar)} u.)
              </button>
            </>
          )}
          {fase === 'cargando' && (
            <span className="flex items-center gap-2 text-sm text-sub">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando en Dragon… no cierres esta ventana
            </span>
          )}
          {fase === 'listo' && (
            <button type="button" onClick={onCerrar} className="h-9 rounded-lg border border-line bg-surface2 px-3 text-sm text-ink">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
