import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, CalendarDays, Check, CheckCircle2, Download, Loader2, PackageCheck, RefreshCw, Search, Send, Shuffle, SlidersHorizontal, Store, Timer, X, XCircle } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import ParametrosCascada from '@/components/ParametrosCascada'
import RepoAutomatico from '@/components/RepoAutomatico'
import Transferencias from '@/pages/Transferencias'
import {
  PARAMS_DEFAULT,
  bajarExcelCascada,
  cargarCascadaEnTransferencias,
  guardarConfigAuto,
  nombreLoteCascada,
  recalcularCascada,
  type ParamsCascada,
  bajarExcelRepo,
  cargarEnDragon,
  esCascada,
  type Cascada,
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

/**
 * Dos pantallas con la misma foto del DWH, tarjetas de Reposiciones / Transferencias (TransferenciasHub):
 *   /transferencias/reposicion-diaria    → modo 'repo'    (lo que manda MITO → Dragon)
 *   /transferencias/transferencia-diaria → modo 'cascada' (lo que faltó, entre locales → Transferencias)
 * Cada una con su pestaña «Automático» (solo su parte de la programación).
 */
export default function RepoDiariaMito({ modo = 'repo' }: { modo?: 'repo' | 'cascada' }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [esperando, setEsperando] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** días elegidos; vacío = el último con venta (lo decide el puente) */
  const [fechas, setFechas] = useState<string[]>([])
  const [local, setLocal] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [dragonAbierto, setDragonAbierto] = useState(false)
  /** 'principal' = la repo o la cascada (según la pantalla); 'auto' = su programación */
  const [vistaSel, setVista] = useState<'principal' | 'lotes' | 'auto'>('principal')
  const vista: 'repo' | 'cascada' | 'lotes' | 'auto' = vistaSel === 'principal' ? modo : vistaSel
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
          {modo === 'repo' ? (
            <>
              <PackageCheck size={22} style={{ color: '#0ea5e9' }} aria-hidden /> Reposición diaria
            </>
          ) : (
            <>
              <Shuffle size={22} style={{ color: '#8b5cf6' }} aria-hidden /> Transferencia diaria
            </>
          )}
        </h1>
        <span className="text-xs text-sub/70">
          {modo === 'repo'
            ? 'venta del día anterior · stock MITO real = físico − comprometido'
            : 'cascada entre locales: lo que vendió cada local y MITO no pudo mandar'}
        </span>
        {datos?.foto && (
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] text-sub">
            datos del DWH de las{' '}
            {new Date(datos.foto).toLocaleTimeString('es-AR', { hour12: false, hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {modo === 'repo' && (
          <>
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
          </>
          )}
          <button onClick={() => void cargar(fechas, true)} disabled={cargando} className={btnChico} type="button">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {/* Días con venta: arranca con los que todavía no tienen repo en Dragon (si un lunes no se
          trabajó, el martes trae viernes a lunes); se pueden sumar o sacar a mano */}
      {datos && datos.dias_disponibles.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <CalendarDays size={15} className="text-sub" aria-hidden />
          {datos.dias_disponibles.map((d) => {
            const on = fechas.includes(d.dia)
            const enDragon = datos.dias_en_dragon?.includes(d.dia) ?? false
            return (
              <button
                key={d.dia}
                type="button"
                disabled={cargando}
                onClick={() => alternarDia(d.dia)}
                title={`${numero(d.unidades)} u. vendidas${enDragon ? ' · ya tiene repo en Dragon' : ''}`}
                className={`btn-press rounded-lg border px-2.5 py-1 text-xs capitalize transition disabled:opacity-60 ${
                  on ? 'border-sky-500/50 bg-sky-500/15 font-semibold text-sky-500' : 'border-line bg-surface text-sub hover:text-ink'
                }`}
              >
                {diaCorto(d.dia)}
                {enDragon && <Check size={11} className="ml-0.5 inline align-[-1px] opacity-80" aria-label="ya tiene repo en Dragon" />}
              </button>
            )
          })}
          <span className="text-[11px] text-sub/70">
            marca los días sin repo en Dragon (✓ = ya cargado) · tocá para sumar o sacar
          </span>
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

      <div className="mb-4 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1 text-sm">
        {(
          [
            [
              'principal',
              modo === 'repo'
                ? datos ? `Reposición · ${numero(datos.unidades)} u.` : 'Reposición'
                : 'Transferencia', // las unidades cambian con los parámetros: van en las tarjetas
            ],
            ...(modo === 'cascada' ? ([['lotes', 'Lotes en Transferencias']] as const) : []),
            ['auto', 'Automático'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 transition ${vistaSel === v ? 'bg-sky-500/15 font-semibold text-sky-500' : 'text-sub hover:text-ink'}`}
          >
            {v === 'auto' && <Timer size={14} aria-hidden />}
            {v === 'lotes' && <ArrowRightLeft size={14} aria-hidden />}
            {label}
          </button>
        ))}
      </div>

      {vista === 'auto' && <RepoAutomatico solo={modo} />}
      {vista === 'lotes' && <Transferencias embebido />}
      {datos && vista === 'cascada' && <VistaCascada datos={datos} onVerLotes={() => setVista('lotes')} />}

      {datos && vista === 'repo' && (
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

/* ---- Cascada entre locales: lo que MITO no pudo cubrir (puente-sql/cascada.js) ----------
 * Mismas reglas que cascada_*.py (solo VENTA, sin INDOD): el donante se queda con 1,
 * dona hasta 2 por SKU, mínimo 2 u. por par donante → receptor.
 */
function VistaCascada({ datos, onVerLotes }: { datos: Datos; onVerLotes: () => void }) {
  const [donante, setDonante] = useState<string | null>(null)
  const [receptor, setReceptor] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  // Parámetros: los guardados vienen en la cascada del Puente; los que se editan recalculan
  const delPuente = esCascada(datos.cascada) ? datos.cascada.params ?? PARAMS_DEFAULT : PARAMS_DEFAULT
  const [guardados, setGuardados] = useState<ParamsCascada>(delPuente)
  const [params, setParams] = useState<ParamsCascada>(delPuente)
  const [recalculada, setRecalculada] = useState<Cascada | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [errorCalc, setErrorCalc] = useState<string | null>(null)
  const [verParams, setVerParams] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmarTransf, setConfirmarTransf] = useState(false)
  const [cargandoTransf, setCargandoTransf] = useState(false)
  const [transf, setTransf] = useState<{ ok: boolean; texto: string } | null>(null)
  const [categoria, setCategoria] = useState<string | null>(null)
  const turno = useRef(0)

  const distintos = JSON.stringify(params) !== JSON.stringify(delPuente)
  // Cada cambio de parámetros (o de foto / días) recalcula en el Puente, con un respiro para no pedir de más
  useEffect(() => {
    const id = ++turno.current
    if (!distintos) {
      setRecalculada(null)
      setErrorCalc(null)
      setCalculando(false)
      return
    }
    setCalculando(true)
    const t = setTimeout(() => {
      recalcularCascada(datos, params)
        .then((r) => {
          if (id !== turno.current) return
          setRecalculada(r)
          setErrorCalc(null)
        })
        .catch((e) => {
          if (id === turno.current) setErrorCalc(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (id === turno.current) setCalculando(false)
        })
    }, 450)
    return () => clearTimeout(t)
  }, [datos, params, distintos])

  async function guardarParams() {
    setGuardando(true)
    try {
      await guardarConfigAuto({ cascada_params: params })
      setGuardados(params)
      setErrorCalc(null)
    } catch (e) {
      setErrorCalc(`No se pudieron guardar: ${e instanceof Error ? e.message : String(e)}`)
    }
    setGuardando(false)
  }

  const c = recalculada ?? datos.cascada

  const visibles = useMemo(() => {
    if (!esCascada(c)) return []
    const q = busqueda.trim().toLowerCase()
    return c.filas.filter(
      (f) =>
        (!donante || f.donante === donante) &&
        (!receptor || f.receptor === receptor) &&
        (!q || `${f.sku} ${f.descripcion} ${f.material} ${f.proveedor}`.toLowerCase().includes(q)),
    )
  }, [c, donante, receptor, busqueda])

  if (!c) return <p className="text-sm text-sub">El Puente todavía no calcula la cascada: reiniciá puente-sql.</p>
  if (!esCascada(c)) {
    return (
      <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
        No se pudo calcular la cascada: {c.error}
      </p>
    )
  }
  const cas: Cascada = c
  const nombreLote = nombreLoteCascada(datos.dias)
  async function cargarTransferencias() {
    setCargandoTransf(true)
    try {
      const r = await cargarCascadaEnTransferencias(nombreLote, cas)
      setTransf({
        ok: true,
        texto: r.repetido
          ? `«${nombreLote}» ya estaba en Transferencias (${numero(r.renglones)} renglones, ${numero(r.unidades)} u.): no se repitió.`
          : `«${nombreLote}» cargado en Transferencias: ${numero(r.renglones)} renglones, ${numero(r.unidades)} u.`,
      })
    } catch (e) {
      setTransf({ ok: false, texto: `No se pudo cargar en Transferencias: ${e instanceof Error ? e.message : String(e)}` })
    }
    setCargandoTransf(false)
    setConfirmarTransf(false)
  }
  const sinCubrir = Math.max(0, cas.faltante_despues_mito - cas.unidades)
  const P0 = cas.params ?? params
  const tarjetas = [
    { titulo: 'Unidades en cascada', valor: numero(cas.unidades), pie: `${numero(cas.filas.length)} renglones` },
    { titulo: 'Faltaba después de MITO', valor: numero(cas.faltante_despues_mito), pie: 'venta − repo MITO' },
    { titulo: 'Sigue sin cubrir', valor: numero(sinCubrir), pie: 'sin donante o fuera de las reglas' },
    { titulo: 'Envíos chicos sacados', valor: numero(cas.pares_eliminados), pie: `donante → receptor con < ${P0.min_envio.activo ? P0.min_envio.valor : 1} u.` },
  ]
  const totalDon = (d: string) => cas.receptores.reduce((s, r) => s + (cas.matriz[d]?.[r] ?? 0), 0)
  const totalRec = (r: string) => cas.donantes.reduce((s, d) => s + (cas.matriz[d]?.[r] ?? 0), 0)
  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  const P = cas.params ?? params
  const sugerencias = {
    locales: [...new Set([...PARAMS_DEFAULT.prioridad, ...params.prioridad, 'INDOD'])],
    proveedores: [...new Set([...PARAMS_DEFAULT.restriccion.proveedores, ...cas.filas.map((f) => f.proveedor_id)])].sort(),
    materiales: [...new Set([...PARAMS_DEFAULT.materiales.lista, ...cas.filas.map((f) => f.material)])].sort(),
  }
  const NC = cas.no_cubierto
  const motivos = NC
    ? ([
        ['Nadie tenía para donar', NC.sin_donante, 'bg-red-500'],
        ['El receptor ya tiene', NC.ya_tiene, 'bg-amber-500'],
        ['Le está llegando', NC.transito, 'bg-sky-500'],
        ['Envío menor al mínimo', NC.envio_chico, 'bg-violet-500'],
        ['Restricción de proveedor', NC.restriccion, 'bg-zinc-400'],
      ] as const)
    : []
  const totMotivos = motivos.reduce((s, m) => s + m[1], 0) || 1

  return (
    <div className={`pb-6 ${verParams ? 'grid items-start gap-4 lg:grid-cols-[360px_1fr]' : ''}`}>
      {verParams && (
        <div className="lg:sticky lg:top-2">
          <ParametrosCascada
            params={params}
            guardados={guardados}
            onChange={setParams}
            onGuardar={() => void guardarParams()}
            guardando={guardando}
            calculando={calculando}
            sugerencias={sugerencias}
          />
        </div>
      )}
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-sub">
          Lo que vendió cada local y MITO no pudo mandar, pasado entre locales · el donante se queda con {P.donante_queda},
          dona hasta {P.tope_sku.activo ? P.tope_sku.valor : '∞'} por SKU · mínimo {P.min_envio.activo ? P.min_envio.valor : 1} u. por envío
          {distintos && <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-500">con parámetros cambiados{JSON.stringify(params) !== JSON.stringify(guardados) ? ' (sin guardar)' : ''}</span>}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setVerParams(!verParams)} className={`${btnChico} ${verParams ? 'border-sky-500/50 text-sky-500' : ''}`}>
            <SlidersHorizontal size={13} aria-hidden /> Parámetros
          </button>
          <button type="button" onClick={() => void bajarExcelCascada(datos, cas)} disabled={!cas.filas.length || calculando} className={btnChico}>
            <Download size={13} aria-hidden /> Excel cascada
          </button>
          <button
            type="button"
            onClick={() => setConfirmarTransf(true)}
            disabled={!cas.filas.length || calculando}
            className="btn-press inline-flex h-8 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            <ArrowRightLeft size={13} aria-hidden /> Cargar en Transferencias
          </button>
        </div>
      </div>

      {errorCalc && <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{errorCalc}</p>}
      {transf && (
        <p role="status" className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${transf.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-ink' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
          {transf.ok ? <CheckCircle2 size={15} className="text-emerald-500" aria-hidden /> : <XCircle size={15} aria-hidden />}
          {transf.texto}
          {transf.ok && (
            <button type="button" onClick={onVerLotes} className="font-semibold text-sky-500 hover:underline">
              Ver en Lotes →
            </button>
          )}
        </p>
      )}
      <ConfirmDialog
        open={confirmarTransf}
        title="¿Cargar la cascada en Transferencias?"
        message={`Se crea el lote «${nombreLote}» con ${numero(cas.filas.length)} renglones (${numero(cas.unidades)} u.), igual que subir el Excel.${distintos ? '\nSe carga con los parámetros que estás viendo.' : ''}\nSi ya hay un lote con ese nombre, no se repite.`}
        confirmLabel="Cargar"
        busy={cargandoTransf}
        onCancel={() => setConfirmarTransf(false)}
        onConfirm={() => void cargarTransferencias()}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <div key={t.titulo} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-xs text-sub">{t.titulo}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-ink">{t.valor}</p>
            <p className="text-[11px] text-sub/70">{t.pie}</p>
          </div>
        ))}
      </div>

      {motivos.length > 0 && sinCubrir > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs text-sub">Por qué quedaron {numero(sinCubrir)} u. sin cubrir</p>
          <div className="my-2 flex h-2.5 overflow-hidden rounded-full bg-line">
            {motivos.map(([t, u, col]) => (
              <div key={t} className={col} style={{ width: `${(100 * u) / totMotivos}%` }} title={`${t}: ${u}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sub">
            {motivos.map(([t, u, col]) => (
              <span key={t} className="inline-flex items-center gap-1">
                <i className={`inline-block h-2 w-2 rounded-sm ${col}`} /> {t}: <b className="text-ink">{numero(u)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {cas.ranking_venta && Object.keys(cas.ranking_venta.categorias).length > 0 && (() => {
        const rv = cas.ranking_venta
        // Categorías ordenadas por unidades en la cascada
        const uCat = new Map<string, number>()
        for (const f of cas.filas) if (f.categoria) uCat.set(f.categoria, (uCat.get(f.categoria) ?? 0) + f.cantidad)
        const cats = [...uCat.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
        const sel = categoria && rv.categorias[categoria] ? categoria : cats[0]
        const filas = rv.categorias[sel] ?? []
        const max = Math.max(1, ...filas.map((x) => x[1]))
        const rec = new Map<string, number>()
        const don = new Map<string, number>()
        for (const f of cas.filas) {
          if (f.categoria !== sel) continue
          rec.set(f.receptor, (rec.get(f.receptor) ?? 0) + f.cantidad)
          don.set(f.donante, (don.get(f.donante) ?? 0) + f.cantidad)
        }
        const porTxt = (rv.por_nombre || 'categoría').toLowerCase()
        return (
          <div className="rounded-2xl border border-violet-500/30 bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-sub">
                Venta por {porTxt} de cada local · {rv.dias.length} días ({rv.dias[0]?.slice(8, 10)}/{rv.dias[0]?.slice(5, 7)} al{' '}
                {rv.dias[rv.dias.length - 1]?.slice(8, 10)}/{rv.dias[rv.dias.length - 1]?.slice(5, 7)}) · así se ordenó la cascada
              </p>
              <select value={sel} onChange={(e) => setCategoria(e.target.value)} className="ml-auto h-8 max-w-[280px] rounded-lg border border-line bg-surface px-2 text-xs text-ink">
                {cats.map((k) => (
                  <option key={k} value={k}>
                    {k} · {numero(uCat.get(k) ?? 0)} u. en cascada
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {filas.map(([b, u], i) => (
                <div key={b} className="flex items-center gap-2 text-xs">
                  <span className="w-4 text-right tabular-nums text-sub">{i + 1}</span>
                  <span className="w-20 text-ink">{b}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/60">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${(100 * u) / max}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-ink">{numero(u)}</span>
                  <span className="w-24 text-[11px]">
                    {rec.get(b) ? <span className="text-emerald-500">recibe {rec.get(b)}</span> : null}
                    {rec.get(b) && don.get(b) ? ' · ' : ''}
                    {don.get(b) ? <span className="text-amber-500">dona {don.get(b)}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="flex flex-wrap gap-1.5 text-[11px] text-sub">
        {Object.entries(cas.por_material)
          .sort((a, b) => b[1] - a[1])
          .map(([m, u]) => (
            <span key={m} className="rounded-full border border-line bg-surface2 px-2 py-0.5">
              {m} {numero(u)}
            </span>
          ))}
      </div>

      {/* Matriz donante x receptor: tocar una fila / columna filtra el detalle */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-sub">
              <th className="px-2 py-2 text-left">Donante \ Receptor</th>
              {cas.receptores.map((r) => (
                <th
                  key={r}
                  onClick={() => setReceptor(receptor === r ? null : r)}
                  className={`cursor-pointer px-2 py-2 text-right hover:text-ink ${receptor === r ? 'text-sky-500' : ''}`}
                >
                  {r}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {cas.donantes.map((d) => (
              <tr key={d} className={`border-b border-line/60 ${donante === d ? 'bg-sky-500/10' : ''}`}>
                <td onClick={() => setDonante(donante === d ? null : d)} className="cursor-pointer px-2 py-1 font-medium text-ink hover:text-sky-500">
                  {d}
                </td>
                {cas.receptores.map((r) => {
                  const v = cas.matriz[d]?.[r] ?? 0
                  return (
                    <td
                      key={r}
                      onClick={() => {
                        if (!v) return
                        const igual = donante === d && receptor === r
                        setDonante(igual ? null : d)
                        setReceptor(igual ? null : r)
                      }}
                      className={`px-2 py-1 text-right tabular-nums ${v ? 'cursor-pointer text-ink hover:bg-surface2' : 'text-sub/30'} ${receptor === r ? 'bg-sky-500/5' : ''}`}
                    >
                      {v || '·'}
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{numero(totalDon(d))}</td>
              </tr>
            ))}
            <tr className="font-semibold text-ink">
              <td className="px-2 py-1">Total</td>
              {cas.receptores.map((r) => (
                <td key={r} className="px-2 py-1 text-right tabular-nums">
                  {numero(totalRec(r))}
                </td>
              ))}
              <td className="px-2 py-1 text-right tabular-nums">{numero(cas.unidades)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar SKU, descripción, material…"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-sub/60"
          />
        </div>
        {donante && (
          <button type="button" onClick={() => setDonante(null)} className={btnChico}>
            <X size={13} aria-hidden /> de {donante}
          </button>
        )}
        {receptor && (
          <button type="button" onClick={() => setReceptor(null)} className={btnChico}>
            <X size={13} aria-hidden /> para {receptor}
          </button>
        )}
        <span className="text-xs text-sub">
          {numero(visibles.length)} renglones · {numero(visibles.reduce((s, f) => s + f.cantidad, 0))} u.
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-sub">
              <th className="px-2 py-2">Donante</th>
              <th className="px-2 py-2">Receptor</th>
              <th className="px-2 py-2">SKU</th>
              <th className="px-2 py-2">Descripción</th>
              <th className="px-2 py-2">Material</th>
              <th className="px-2 py-2 text-right" title="Venta del receptor en el día">Venta</th>
              <th className="px-2 py-2 text-right" title="Lo que ya le manda MITO en la repo">MITO</th>
              <th className="px-2 py-2 text-right" title="Stock del donante antes de la cascada">Stock don.</th>
              <th className="px-2 py-2 text-right" title="Stock del receptor antes de la cascada">Stock rec.</th>
              {cas.ranking_venta && (
                <th className="px-2 py-2 text-right" title="Venta de la categoría (material / grupo) del receptor y del donante en los días comparados">
                  Venta cat. rec. / don.
                </th>
              )}
              <th className="px-2 py-2 text-right">Envía</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(0, 1500).map((f) => (
              <tr key={`${f.donante}|${f.receptor}|${f.sku}`} className="border-b border-line/60 last:border-0">
                <td className="px-2 py-1 text-ink">{f.donante}</td>
                <td className="px-2 py-1 text-ink">{f.receptor}</td>
                <td className="whitespace-nowrap px-2 py-1 font-mono text-ink">{f.sku}</td>
                <td className="px-2 py-1 text-sub">{f.descripcion}</td>
                <td className="px-2 py-1 text-sub">{f.material}</td>
                <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.venta)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${f.mito ? 'text-sky-500' : 'text-sub/60'}`}>{numero(f.mito)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.stock_donante)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-sub">{numero(f.stock_receptor)}</td>
                {cas.ranking_venta && (
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-violet-400" title={f.categoria}>
                    {numero(f.venta_cat_receptor ?? 0)} / {numero(f.venta_cat_donante ?? 0)}
                  </td>
                )}
                <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{numero(f.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibles.length > 1500 && <p className="p-2 text-xs text-sub">Se muestran 1.500; el resto está en el Excel.</p>}
      </div>
    </div>
    </div>
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
