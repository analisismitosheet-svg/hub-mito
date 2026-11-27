import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ClipboardCheck, Loader2, RefreshCw, Search, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AvisosCelular from '@/components/AvisosCelular'
import GrillaDesglose from '@/components/control/GrillaDesglose'
import DesgloseChips from '@/components/control/DesgloseChips'
import { useAuth } from '@/context/AuthContext'
import {
  claveLinea,
  estadoLinea,
  fechaHora,
  guardarLinea,
  lineasControl,
  listarControles,
  MOTIVOS_DIFERENCIA,
  n0,
  terminarControl,
  type ControlResumen,
  type Desglose,
  type LineaControl,
} from '@/lib/controlFisico'

type Pestana = 'pendientes' | 'en_curso' | 'hechos'
type FiltroLinea = 'todos' | 'faltan' | 'desglosar' | 'dif'

/**
 * Depósito → Control físico (27/11/2026), pensado para el celular.
 * Lista las facturas con picking hecho («LISTO PARA CONTROLAR»); el operario
 * cuenta cada renglón y desglosa en color × talle los que vienen 00 / U.
 * Lo hace cualquiera con rol deposito (o legajo de Depósito Indo) y el admin.
 */
export default function ControlFisico() {
  const { veMiRepoDeposito, isAdmin } = useAuth()
  const puedeContar = veMiRepoDeposito || isAdmin
  const [params, setParams] = useSearchParams()
  const factura = params.get('f')

  const [controles, setControles] = useState<ControlResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('pendientes')

  const cargar = useCallback(async () => {
    try {
      setError(null)
      setControles(await listarControles())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const elegido = controles?.find((c) => c.factura_clave === factura) ?? null

  if (factura) {
    return (
      <Layout>
        <DetalleFactura
          factura={factura}
          resumen={elegido}
          puedeContar={puedeContar}
          onVolver={() => { setParams({}); void cargar() }}
          onCambio={() => void cargar()}
        />
      </Layout>
    )
  }

  const grupos: Record<Pestana, ControlResumen[]> = {
    pendientes: (controles ?? []).filter((c) => c.estado === 'pendiente'),
    en_curso: (controles ?? []).filter((c) => c.estado === 'en_curso'),
    hechos: (controles ?? []).filter((c) => c.estado === 'terminado'),
  }
  const lista = grupos[pestana]

  return (
    <Layout>
      <BackButton />
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-xl border p-2.5" style={{ color: '#0d9488', backgroundColor: '#0d948824', borderColor: '#0d948840' }}>
          <ClipboardCheck size={24} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Control físico</h1>
          <p className="truncate text-sm text-sub">Facturas con picking hecho, para contar en el depósito</p>
        </div>
        <button type="button" onClick={() => void cargar()} className="rounded-xl border border-line p-2 text-sub hover:text-ink" aria-label="Actualizar">
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>
      {puedeContar && <AvisosCelular texto="Activá los avisos para enterarte cuando terminan un control físico, aunque el celular esté bloqueado." />}
      <Link to="/deposito/controles-fisicos" className="mb-3 inline-block text-sm font-semibold text-orange-400 hover:underline">
        Ver todos los controles con detalle y precios →
      </Link>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {([['pendientes', 'Pendientes'], ['en_curso', 'En curso'], ['hechos', 'Hechos']] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setPestana(k)}
            className={`rounded-xl border px-2 py-2 text-sm font-bold ${pestana === k ? 'border-orange-600 bg-orange-600 text-white' : 'border-line bg-surface2 text-sub'}`}>
            {t} · {grupos[k].length}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</div>}
      {!controles && !error && (
        <div className="flex items-center gap-2 text-sm text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
      )}
      {controles && !lista.length && (
        <div className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-sub">
          {pestana === 'pendientes' ? 'No hay facturas para controlar. Aparecen cuando Compras registra el picking.' : 'Nada por acá.'}
        </div>
      )}
      <div className="space-y-2.5 pb-4">
        {lista.map((c) => {
          const pct = c.renglones ? Math.round((c.controlados / c.renglones) * 100) : 0
          return (
            <button key={c.factura_clave} type="button" onClick={() => setParams({ f: c.factura_clave })}
              className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-soft transition hover:bg-surface2 active:scale-[0.99]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-display text-base font-bold text-ink">{c.proveedor}</span>
                {c.estado === 'terminado' ? (
                  c.con_diferencias
                    ? <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 text-xs font-bold text-red-400">Con diferencias</span>
                    : <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 text-xs font-bold text-emerald-400">OK</span>
                ) : c.estado === 'en_curso' ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 text-xs font-bold text-amber-400">{pct}%</span>
                ) : (
                  <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 text-xs font-bold text-sky-400">Nuevo</span>
                )}
              </div>
              <p className="text-xs text-sub">Fact. {c.n_factura} · OC {c.n_oc || '—'}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sub">
                <span><b className="text-ink">{c.renglones}</b> renglones · <b className="text-ink">{n0.format(c.unidades_picking)}</b> u.</span>
                {c.para_desglosar > 0 && c.estado !== 'terminado' && (
                  <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 font-bold text-violet-400">
                    {c.para_desglosar - c.desglosados} para desglosar
                  </span>
                )}
                {c.estado === 'en_curso' && c.iniciado_nombre && <span className="text-amber-300">{c.iniciado_nombre}</span>}
                {c.estado === 'terminado' && <span className="text-emerald-300">{c.terminado_nombre} · {fechaHora(c.terminado_at)}</span>}
              </div>
              {c.estado === 'en_curso' && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full bg-orange-500" style={{ width: `${pct}%` }} /></div>
              )}
            </button>
          )
        })}
      </div>
    </Layout>
  )
}

function DetalleFactura({
  factura,
  resumen,
  puedeContar,
  onVolver,
  onCambio,
}: {
  factura: string
  resumen: ControlResumen | null
  puedeContar: boolean
  onVolver: () => void
  onCambio: () => void
}) {
  const [lineas, setLineas] = useState<LineaControl[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroLinea>('todos')
  const [q, setQ] = useState('')
  const [desglosando, setDesglosando] = useState<string | null>(null)
  const [terminando, setTerminando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setError(null)
      setLineas(await lineasControl(factura))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [factura])
  useEffect(() => { void cargar() }, [cargar])

  const terminado = resumen?.estado === 'terminado'
  const editable = puedeContar && !terminado

  async function guardar(l: LineaControl, contado: number | null, motivo: string | null, desglose: Desglose[] | null) {
    await guardarLinea(factura, l, contado, motivo, desglose)
    await cargar()
    onCambio()
  }

  const visibles = useMemo(() => {
    const t = q.trim().toUpperCase()
    return (lineas ?? []).filter((l) => {
      if (t && ![l.articulo, l.descripcion ?? '', l.color, l.talle].some((v) => v.toUpperCase().includes(t))) return false
      if (filtro === 'faltan') return l.contado == null
      if (filtro === 'desglosar') return l.requiere_desglose
      if (filtro === 'dif') return l.contado != null && l.contado !== l.picking
      return true
    })
  }, [lineas, q, filtro])

  const enDesglose = desglosando ? (lineas ?? []).find((l) => claveLinea(l) === desglosando) : null
  if (enDesglose) {
    return (
      <GrillaDesglose
        linea={enDesglose}
        onVolver={() => setDesglosando(null)}
        onGuardar={async (d, motivo) => {
          await guardar(enDesglose, null, motivo, d)
          setDesglosando(null)
        }}
      />
    )
  }

  const total = lineas?.length ?? 0
  const hechos = (lineas ?? []).filter((l) => l.contado != null).length
  const paraDesglosar = (lineas ?? []).filter((l) => l.requiere_desglose && l.contado == null).length
  const faltan = (lineas ?? []).reduce((s, l) => s + (l.contado != null && l.contado < l.picking ? l.picking - l.contado : 0), 0)
  const sobran = (lineas ?? []).reduce((s, l) => s + (l.contado != null && l.contado > l.picking ? l.contado - l.picking : 0), 0)
  const completo = total > 0 && hechos === total

  async function terminar() {
    if (!completo) return
    const dif = faltan || sobran ? `\n\nQueda con diferencias: ${faltan ? `faltan ${faltan} u.` : ''}${faltan && sobran ? ' · ' : ''}${sobran ? `sobran ${sobran} u.` : ''}` : ''
    if (!window.confirm(`¿Terminar el control físico?\nSe marca «Controlada» en Recepción INDO y se avisa al depósito.${dif}`)) return
    setTerminando(true)
    setError(null)
    try {
      await terminarControl(factura)
      setAviso('✓ Control físico terminado. Se avisó al depósito.')
      onCambio()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTerminando(false)
    }
  }

  return (
    <div className="space-y-3 pb-6">
      <button type="button" onClick={onVolver} className="inline-flex items-center gap-1.5 text-sm font-medium text-sub hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Control físico
      </button>
      <div>
        <h1 className="font-display text-xl font-bold text-ink">{resumen?.proveedor ?? 'Factura'}</h1>
        <p className="text-sm text-sub">Fact. {resumen?.n_factura ?? factura.split('|')[1]} · OC {resumen?.n_oc || '—'}</p>
        {terminado && (
          <p className={`mt-1 text-sm font-semibold ${resumen?.con_diferencias ? 'text-red-400' : 'text-emerald-400'}`}>
            Terminado por {resumen?.terminado_nombre} · {fechaHora(resumen?.terminado_at)} {resumen?.con_diferencias ? '· con diferencias' : '· OK'}
          </p>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className={`h-full ${completo ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${total ? (hechos / total) * 100 : 0}%` }} />
      </div>
      <p className="text-xs text-sub">
        <b className="text-ink">{hechos} de {total}</b> controlados
        {paraDesglosar > 0 && <> · <b className="text-violet-400">{paraDesglosar} para desglosar</b></>}
      </p>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo"
          className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-orange-500" />
      </div>
      <div className="grid grid-cols-4 gap-1">
        {([['todos', 'Todos'], ['faltan', 'Faltan'], ['desglosar', 'Desglosar'], ['dif', 'Con dif.']] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-lg border px-1 py-1.5 text-xs font-bold ${filtro === k ? 'border-orange-600 bg-orange-600 text-white' : 'border-line bg-surface2 text-sub'}`}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</div>}
      {aviso && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center text-sm font-semibold text-emerald-400">{aviso}</div>}
      {!lineas && !error && <div className="flex items-center gap-2 text-sm text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>}
      {lineas && !lineas.length && (
        <div className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-sub">Esta factura no tiene picking vivo.</div>
      )}

      <div className="space-y-2">
        {visibles.map((l) => (
          <TarjetaLinea key={claveLinea(l)} l={l} editable={editable} onDesglosar={() => setDesglosando(claveLinea(l))} onGuardar={guardar} />
        ))}
      </div>

      {editable && lineas && lineas.length > 0 && (
        <div className="sticky bottom-2 rounded-2xl border border-line bg-surface p-3 shadow-soft">
          {!completo ? (
            <p className="text-center text-sm text-sub">Faltan <b className="text-ink">{total - hechos}</b> renglón(es) para poder terminar.</p>
          ) : (
            <>
              {(faltan > 0 || sobran > 0) && (
                <p className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                  Hay diferencias: {faltan > 0 && <>faltan <b>{faltan}</b> u.</>}{faltan > 0 && sobran > 0 && ' · '}{sobran > 0 && <>sobran <b>{sobran}</b> u.</>}
                </p>
              )}
              <button type="button" onClick={() => void terminar()} disabled={terminando}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-60">
                {terminando && <Loader2 size={16} className="animate-spin" aria-hidden />} Terminar control físico
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TarjetaLinea({
  l,
  editable,
  onDesglosar,
  onGuardar,
}: {
  l: LineaControl
  editable: boolean
  onDesglosar: () => void
  onGuardar: (l: LineaControl, contado: number | null, motivo: string | null, desglose: Desglose[] | null) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(String(l.contado ?? l.picking))
  const [motivo, setMotivo] = useState(l.motivo ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const est = estadoLinea(l)

  async function guardar(contado: number | null, mot: string | null) {
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(l, contado, mot, null)
      setAbierto(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const n = parseInt(valor, 10)
  const nValido = Number.isFinite(n) && n >= 0
  const borde =
    l.requiere_desglose && est === 'sin' ? 'border-violet-500/60 shadow-[inset_3px_0_0_#8b5cf6]'
      : est === 'ok' ? 'border-emerald-500/40'
        : est === 'falta' ? 'border-red-500/50'
          : est === 'sobra' ? 'border-lime-400/50'
            : 'border-line'

  return (
    <div className={`rounded-2xl border bg-surface p-3 ${borde}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-display text-base font-bold text-ink">{l.articulo}</span>
        <span className={`rounded px-1.5 text-xs font-bold ${l.requiere_desglose && ['', '0', '00'].includes(l.color) ? 'border border-dashed border-violet-500/50 text-violet-300' : 'bg-sky-500/15 text-sky-400'}`}>{l.color || '—'}</span>
        <span className={`rounded px-1.5 text-xs font-bold ${l.requiere_desglose && ['', 'U', 'UNICO'].includes(l.talle.toUpperCase()) ? 'border border-dashed border-violet-500/50 text-violet-300' : 'bg-violet-500/15 text-violet-400'}`}>{l.talle || '—'}</span>
        <span className="ml-auto font-display text-lg font-bold tabular-nums text-ink">{n0.format(l.picking)}</span>
      </div>
      <p className="truncate text-xs text-sub">{l.descripcion || '—'}{l.numero ? ` · OC ${l.numero}` : ''}</p>

      {l.requiere_desglose ? (
        <div className="mt-2 space-y-1.5">
          {l.contado != null && l.desglose && <DesgloseChips desglose={l.desglose} />}
          <div className="flex items-center gap-2">
            <span className="text-xs text-sub">
              {l.contado == null ? 'Sin color/talle: cargá lo que hay en el piso' : <>Contado <b className={est === 'ok' ? 'text-emerald-400' : est === 'falta' ? 'text-red-400' : 'text-lime-300'}>{n0.format(l.contado)}</b>{l.motivo ? ` · ${l.motivo}` : ''}</>}
            </span>
            {editable && (
              <button type="button" onClick={onDesglosar} className="ml-auto rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-bold text-white">
                {l.contado == null ? 'Desglosar →' : 'Editar'}
              </button>
            )}
          </div>
        </div>
      ) : abierto && editable ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-sub">Contado</span>
            <button type="button" onClick={() => setValor(String(Math.max(0, (nValido ? n : 0) - 1)))} className="h-9 w-9 rounded-lg border border-line bg-surface2 text-lg font-bold text-ink">−</button>
            <input inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value.replace(/\D/g, '').slice(0, 5))}
              className="h-9 w-16 rounded-lg border border-line bg-surface2 text-center font-bold text-ink" aria-label="Unidades contadas" />
            <button type="button" onClick={() => setValor(String((nValido ? n : 0) + 1))} className="h-9 w-9 rounded-lg border border-line bg-surface2 text-lg font-bold text-ink">+</button>
          </div>
          {nValido && n < l.picking && (
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-9 w-full rounded-lg border border-red-500/40 bg-surface2 px-2 text-sm text-ink">
              <option value="">Faltan {l.picking - n}: motivo…</option>
              {MOTIVOS_DIFERENCIA.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="flex-1 rounded-xl border border-line py-2 text-sm font-semibold text-sub">Cancelar</button>
            <button type="button" disabled={!nValido || guardando || (n < l.picking && !motivo)} onClick={() => void guardar(n, n < l.picking ? motivo : null)}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white disabled:opacity-50">
              {guardando && <Loader2 size={14} className="animate-spin" aria-hidden />} Guardar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-sub">
            {l.contado == null ? 'Sin contar' : <>Contado <b className={est === 'ok' ? 'text-emerald-400' : est === 'falta' ? 'text-red-400' : 'text-lime-300'}>{n0.format(l.contado)}</b>{est === 'falta' ? ` · faltan ${l.picking - l.contado}` : est === 'sobra' ? ` · sobran ${l.contado - l.picking}` : ''}{l.motivo ? ` · ${l.motivo}` : ''}</>}
          </span>
          {editable && (
            <div className="ml-auto flex items-center gap-1.5">
              {l.contado != null && (
                <button type="button" onClick={() => void guardar(null, null)} className="rounded-lg p-1.5 text-sub hover:text-red-400" aria-label="Sacar lo contado"><X size={15} aria-hidden /></button>
              )}
              <button type="button" onClick={() => { setValor(String(l.contado ?? l.picking)); setAbierto(true) }} className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink">Contar</button>
              {est !== 'ok' && (
                <button type="button" disabled={guardando} onClick={() => void guardar(l.picking, null)}
                  className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" title="Está todo lo del picking">
                  {guardando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />} Está todo
                </button>
              )}
              {est === 'ok' && <span className="rounded-lg bg-emerald-500/15 p-1.5 text-emerald-400"><Check size={15} aria-hidden /></span>}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-xs text-red-400">{error}</p>}
    </div>
  )
}
