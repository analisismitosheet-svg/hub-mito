import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ChevronRight, Check, AlertTriangle, Timer, Pause, Play, Flag, Camera, CameraOff, PackageCheck,
} from 'lucide-react'
import ScannerCamara from '@/components/ScannerCamara'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { normalizaCodigo } from '@/lib/loginEmpleado'
import { compararUbicaciones, ubicacionesDeArticulos } from '@/lib/mapeo'
import { PRIORIDADES, avanceDe, nroDePedido, COLUMNAS_ITEM_ARMADO, type Armado, type ArmadoItem } from '@/lib/armados'

/* ------------------------------------------------------------------ */
/*  Armado de un pedido (la tarea que el mayorista pidió)              */
/*  Misma mecánica que el repo de siempre: cronómetro, escáner,        */
/*  "Faltan escanear" con ✓ manual, deshacer y finalizar.              */
/*  Escanea con armado_escanear() / armado_marcar_item() (SQL).         */
/* ------------------------------------------------------------------ */

type EstadoSesion = 'inactiva' | 'en_curso' | 'pausada'

interface FilaEscaneo {
  item_linea: number
  item_escaneadas: number
  item_cantidad: number
  item_estado: 'pendiente' | 'hecho' | 'faltante'
  item_articulo: string | null
}

const fmtReloj = (seg: number) =>
  `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(Math.floor(seg % 60)).padStart(2, '0')}`

const etiquetaDe = (i: Pick<ArmadoItem, 'articulo' | 'color' | 'talle' | 'descripcion'>): string =>
  [i.articulo, i.color, i.talle].filter(Boolean).join(' · ') || i.descripcion || 'Artículo'

const filaDe = <T,>(d: unknown): T | null =>
  d == null ? null : ((Array.isArray(d) ? d[0] : d) as T)

interface Props {
  armado: Armado
  alVolver: () => void
  /** Avisá al padre que cambió algo (para que refresque el estado del pedido). */
  alCambiar: () => void
}

export default function ArmadoPedido({ armado, alVolver, alCambiar }: Props) {
  const P = PRIORIDADES[armado.prioridad] ?? PRIORIDADES.normal
  const terminado = armado.estado === 'hecho'

  const [items, setItems] = useState<ArmadoItem[]>([])
  const [cargando, setCargando] = useState(true)
  const [sesion, setSesion] = useState<EstadoSesion>('inactiva')
  const [segundos, setSegundos] = useState(0)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ultimo, setUltimo] = useState<{ linea: number; etiqueta: string } | null>(null)
  const [enViaje, setEnViaje] = useState(0)
  const [camara, setCamara] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [resumen, setResumen] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco tiene que volver siempre.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setSesion('inactiva')
    setSegundos(0)
    setMensaje(null)
    setUltimo(null)
    setResumen(null)
    setCamara(false)
    if (!supabase) {
      setCargando(false)
      return
    }
    void supabase
      .from('mayorista_armados_items')
      .select(COLUMNAS_ITEM_ARMADO)
      .eq('armado_id', armado.id)
      .order('linea', { ascending: true })
      .range(0, 4999)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setMensaje({ ok: false, texto: error.message })
        setItems((data as ArmadoItem[] | null) ?? [])
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [armado.id])

  // Cronómetro (en memoria: el tiempo exacto del armado se guarda al finalizar)
  useEffect(() => {
    if (sesion !== 'en_curso') return
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [sesion])

  // Ubicaciones del Mapeo depósito (como en el repo): chip al lado del código y orden del recorrido
  const [ubicaciones, setUbicaciones] = useState<Map<string, string[]>>(new Map())
  const codigosItems = useMemo(() => [...new Set(items.map((i) => String(i.articulo ?? '').trim().toUpperCase()).filter(Boolean))].sort().join(','), [items])
  useEffect(() => {
    if (!codigosItems) return
    void ubicacionesDeArticulos(codigosItems.split(',')).then(setUbicaciones).catch(() => { /* sin mapeo: sin ubicaciones */ })
  }, [codigosItems])
  const ubicacionesDe = useCallback((i: ArmadoItem) => ubicaciones.get(String(i.articulo ?? '').trim().toUpperCase()) ?? [], [ubicaciones])

  const avance = useMemo(() => avanceDe(items), [items])
  const pendientes = useMemo(
    () => items
      .filter((i) => i.estado !== 'hecho' && i.escaneadas < i.cantidad)
      .sort((a, b) => {
        const ua = ubicacionesDe(a)[0]
        const ub = ubicacionesDe(b)[0]
        return (ua && ub ? compararUbicaciones(ua, ub) : ua ? -1 : ub ? 1 : 0) || a.linea - b.linea
      }),
    [items, ubicacionesDe],
  )
  const listos = useMemo(() => items.filter((i) => i.estado === 'hecho' || i.escaneadas >= i.cantidad), [items])
  const totalFaltan = avance.unidades - avance.unidadesOk
  const todoListo = totalFaltan === 0 && items.length > 0

  /** La base es la fuente de verdad: el renglón queda como lo devolvió la función. */
  const aplicarFila = useCallback((f: FilaEscaneo) => {
    setItems((prev) =>
      prev.map((x) => (x.linea === f.item_linea ? { ...x, escaneadas: f.item_escaneadas, estado: f.item_estado } : x)),
    )
  }, [])

  const alEscanear = useCallback(
    (bruto: string, formato?: string) => {
      const cod = normalizaCodigo(bruto)
      if (!cod) return
      if (!supabase) return
      if (terminado) {
        setMensaje({ ok: false, texto: 'Ese armado ya está finalizado' })
        return
      }
      if (sesion !== 'en_curso') {
        setMensaje({
          ok: false,
          texto: sesion === 'pausada' ? 'Estás en pausa: tocá Reanudar' : 'Tocá Iniciar para empezar a escanear',
        })
        return
      }
      setEnViaje((n) => n + 1)
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('armado_escanear', { p_id: armado.id, p_codigo: cod })
          if (error) throw new Error(error.message)
          const fila = filaDe<FilaEscaneo>(data)
          if (!fila) return
          aplicarFila(fila)
          const it = items.find((x) => x.linea === fila.item_linea)
          const etiqueta = etiquetaDe(it ?? { articulo: fila.item_articulo, color: null, talle: null, descripcion: null })
          setUltimo({ linea: fila.item_linea, etiqueta })
          setMensaje({
            ok: true,
            texto:
              (fila.item_escaneadas >= fila.item_cantidad
                ? `${etiqueta} · completado (${fila.item_cantidad} u.)`
                : `${etiqueta} · ${fila.item_escaneadas} de ${fila.item_cantidad}`) + (formato ? ` · ${formato}` : ''),
          })
          const listas = items.filter(
            (x) => x.linea === fila.item_linea ? fila.item_escaneadas >= fila.item_cantidad : x.escaneadas >= x.cantidad,
          ).length
          if (listas === items.length && items.length > 0) alCambiar()
        } catch (e) {
          setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo registrar el escaneo.' })
        } finally {
          setEnViaje((n) => n - 1)
          enfocar()
        }
      })()
    },
    [aplicarFila, armado.id, enfocar, items, sesion, terminado, alCambiar],
  )

  /** ✓ al lado del artículo: la cámara no lo leyó y no se quiere escribir el código. */
  const marcarLinea = useCallback(
    (item: ArmadoItem) => {
      if (terminado || item.estado === 'hecho' || item.escaneadas >= item.cantidad) return
      if (!supabase) return
      setEnViaje((n) => n + 1)
      void (async () => {
        try {
          const { data, error } = await supabase.rpc('armado_marcar_item', {
            p_id: armado.id,
            p_linea: item.linea,
          })
          if (error) throw new Error(error.message)
          const fila = filaDe<FilaEscaneo>(data)
          if (fila) aplicarFila(fila)
          const etiqueta = etiquetaDe(item)
          setUltimo({ linea: item.linea, etiqueta })
          setMensaje({ ok: true, texto: `${etiqueta} · marcado a mano (${item.cantidad} u.)` })
          if (items.every((x) => (x.linea === item.linea ? true : x.escaneadas >= x.cantidad))) alCambiar()
        } catch (e) {
          setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo marcar el artículo.' })
        } finally {
          enfocar()
        }
      })()
    },
    [aplicarFila, alCambiar, armado.id, enfocar, items, terminado],
  )

  const deshacerUltimo = useCallback(() => {
    if (!ultimo || terminado) return
    if (!supabase) return
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('armado_deshacer', { p_id: armado.id, p_linea: ultimo.linea })
        if (error) throw new Error(error.message)
        const fila = filaDe<FilaEscaneo>(data)
        if (fila) aplicarFila(fila)
        setMensaje({ ok: true, texto: `${ultimo.etiqueta} · escaneo deshecho` })
        alCambiar()
      } catch (e) {
        setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo deshacer.' })
      } finally {
        setUltimo(null)
        enfocar()
      }
    })()
  }, [alCambiar, aplicarFila, armado.id, enfocar, terminado, ultimo])

  const finalizar = useCallback(async () => {
    if (!supabase) return
    setFinalizando(true)
    try {
      const { data, error } = await supabase.rpc('armado_finalizar', { p_id: armado.id })
      if (error) throw new Error(error.message)
      const faltan = typeof data === 'number' ? data : 0
      setResumen(
        faltan > 0
          ? `Armado terminado con ${faltan} faltante${faltan === 1 ? '' : 's'} · ${fmtReloj(segundos)}`
          : `Armado terminado: ${avance.unidadesOk}/${avance.unidades} unidades · ${fmtReloj(segundos)}`,
      )
      setSesion('inactiva')
      setCamara(false)
      setMensaje(null)
      setUltimo(null)
      alCambiar()
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo finalizar el armado.' })
    } finally {
      setFinalizando(false)
      setConfirmando(false)
    }
  }, [alCambiar, armado.id, avance.unidades, avance.unidadesOk, segundos])

  const onSubmitInput = (e: FormEvent) => {
    e.preventDefault()
    const v = inputRef.current?.value ?? ''
    if (v.trim()) alEscanear(v)
    if (inputRef.current) inputRef.current.value = ''
  }

  const pct = avance.unidades > 0 ? Math.round((avance.unidadesOk / avance.unidades) * 100) : 0

  const filaItem = (i: ArmadoItem, escaneado: boolean) => (
    <li key={i.linea} className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-display text-sm font-bold text-ink">{i.articulo || '—'}</span>
          {i.color && <span className="rounded-md bg-sky-500/15 px-1.5 py-px text-[11px] font-semibold text-sky-400">{i.color}</span>}
          {i.talle && <span className="rounded-md bg-violet-500/15 px-1.5 py-px text-[11px] font-semibold text-violet-300">{i.talle}</span>}
          {ubicacionesDe(i).length > 0 && (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-px text-[11px] font-semibold text-amber-500" title="Ubicación en el depósito">
              ({ubicacionesDe(i).join(' · ')})
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-sub" title={i.descripcion ?? ''}>
          {i.descripcion || '—'}
        </span>
      </span>
      {escaneado ? (
        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-bold text-emerald-400">
          <Check size={13} aria-hidden /> {i.cantidad}
        </span>
      ) : (
        <>
          <span
            className={`rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${
              i.escaneadas > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-line text-sub'
            }`}
          >
            {i.escaneadas > 0 ? `${i.escaneadas}/${i.cantidad}` : `×${i.cantidad}`}
          </span>
          <button
            type="button"
            onClick={() => marcarLinea(i)}
            disabled={terminado || sesion !== 'en_curso' || enViaje > 0}
            title="Marcar el artículo sin escanear (si la cámara no lo lee)"
            aria-label={`Marcar ${i.articulo ?? i.linea}`}
            className="btn-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line2 bg-surface2 text-sub transition hover:border-emerald-500/50 hover:bg-emerald-500/15 hover:text-emerald-400 disabled:opacity-40"
          >
            <Check size={16} aria-hidden />
          </button>
        </>
      )}
    </li>
  )

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sub">
        <Timer size={16} className="animate-spin" aria-hidden /> Cargando el armado…
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-4">
      <button
        onClick={alVolver}
        className="-ml-1 inline-flex min-h-[2.5rem] items-center gap-1 px-1 text-sm font-medium text-sub transition hover:text-ink"
      >
        <ChevronRight size={16} aria-hidden className="rotate-180" /> Mis repos
      </button>

      {/* Prioridad del pedido */}
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <PackageCheck size={14} aria-hidden style={{ color: P.color }} />
        <span style={{ color: P.color }}>Armado de pedido</span>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px]"
          style={{ color: P.color, borderColor: `${P.color}66`, backgroundColor: `${P.color}22` }}
        >
          {P.icono} {P.label}
        </span>
      </div>

      {resumen && (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-400">
          <Flag size={16} className="mt-0.5 shrink-0" aria-hidden /> {resumen}
        </div>
      )}

      {/* Panel compacto: pedido · cronómetro · iniciar / pausar */}
      <div className="sticky top-0 z-[5] -mx-4 space-y-2 border-b border-line bg-paper px-4 pb-2.5 pt-1 sm:top-[61px] sm:mx-0 sm:space-y-3 sm:rounded-2xl sm:border sm:bg-surface sm:p-4 sm:shadow-soft">
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-bold text-ink">
              Pedido N° {nroDePedido(armado)}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-sub">
              <span className="truncate">{armado.cliente_nombre || armado.cliente || 'Cliente'}</span>
              {armado.aceptado_nombre && (
                <span className="rounded-md bg-line px-1.5 py-px text-[11px] font-semibold text-ink">
                  {armado.aceptado_legajo ? `#${armado.aceptado_legajo} ` : ''}
                  {armado.aceptado_nombre}
                </span>
              )}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`font-mono text-sm font-bold tabular-nums ${sesion === 'en_curso' ? 'text-ink' : 'text-sub'}`}
              aria-label="Tiempo del armado"
            >
              {fmtReloj(segundos)}
            </span>
            {!terminado &&
              (sesion === 'inactiva' ? (
                <button
                  type="button"
                  onClick={() => { setSesion('en_curso'); enfocar() }}
                  className="btn-press inline-flex h-9 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  <Play size={14} aria-hidden /> Iniciar
                </button>
              ) : sesion === 'en_curso' ? (
                <button
                  type="button"
                  onClick={() => { setSesion('pausada'); setMensaje(null) }}
                  className="btn-press inline-flex h-9 items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-500 transition hover:bg-amber-500/20"
                >
                  <Pause size={14} aria-hidden /> Pausar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSesion('en_curso'); enfocar() }}
                  className="btn-press inline-flex h-9 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  <Play size={14} aria-hidden /> Reanudar
                </button>
              ))}
          </span>
        </div>

        {/* Barra de avance + contador */}
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-display text-sm font-bold tabular-nums text-ink" aria-live="polite">
            {avance.unidadesOk}
            <span className="text-sub">/{avance.unidades}</span>
          </span>
        </div>

        {/* Escáner inalámbrico (Enter) o teclado */}
        {!terminado && sesion === 'en_curso' && (
          <form onSubmit={onSubmitInput} className="flex gap-2">
            <input
              ref={inputRef}
              autoFocus
              autoComplete="off"
              placeholder="Escaneá o escribí el código…"
              aria-label="Código de barra"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              className={`btn-press flex h-11 w-11 items-center justify-center rounded-xl border transition ${
                camara
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-400'
                  : 'border-line bg-surface2 text-ink hover:bg-line'
              }`}
            >
              {camara ? <CameraOff size={18} aria-hidden /> : <Camera size={18} aria-hidden />}
            </button>
          </form>
        )}

        {/* Feedback del último escaneo */}
        {(mensaje || enViaje > 0) && (
          <div aria-live="polite" className="space-y-1.5">
            {mensaje && (
              <div
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium ${
                  mensaje.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {mensaje.ok ? <Check size={16} className="shrink-0" aria-hidden /> : <AlertTriangle size={16} className="shrink-0" aria-hidden />}
                  <span className="truncate">{mensaje.texto}</span>
                </span>
                {mensaje.ok && ultimo && !terminado && (
                  <button
                    type="button"
                    onClick={deshacerUltimo}
                    className="shrink-0 rounded-lg border border-current px-2 py-0.5 text-xs font-semibold opacity-80 hover:opacity-100"
                  >
                    ↺ Deshacer
                  </button>
                )}
              </div>
            )}
            {enViaje > 0 && <p className="text-xs text-sub">Guardando {enViaje} escaneo{enViaje > 1 ? 's' : ''}…</p>}
          </div>
        )}
      </div>

      {/* Cámara: QR + Code 39 + Code 128 + EAN (conQr enciende el QR) */}
      {camara && !terminado && sesion === 'en_curso' && (
        <ScannerCamara
          onLectura={(texto, formato) => alEscanear(texto, formato)}
          onCerrar={() => { setCamara(false); enfocar() }}
          conQr
        />
      )}

      {/* Faltan escanear (con la ✓ manual al lado de cada artículo) */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">Faltan escanear</span>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-500">
            {totalFaltan} u.
          </span>
        </div>
        {pendientes.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-emerald-400">
            <Check size={22} aria-hidden />
            <p className="text-sm font-semibold">¡Está todo escaneado!</p>
            <p className="text-xs text-sub">
              {terminado ? 'El pedido quedó en verde en Pedidos de venta.' : 'Tocá Finalizar para cerrar y avisarle al mayorista.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line/50">
            {pendientes.map((i) => filaItem(i, false))}
          </ul>
        )}
      </div>

      {!terminado && (
        <>
          <p className="text-xs text-sub">Al finalizar le avisa al mayorista: el pedido pasa a verde en su lista.</p>
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            disabled={items.length === 0 || finalizando}
            className={`btn-press flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition disabled:opacity-50 ${
              todoListo
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'border border-brand-600/40 bg-brand-600/10 text-brand-400 hover:bg-brand-600/20'
            }`}
          >
            <Flag size={18} aria-hidden /> {todoListo ? 'Finalizar armado' : 'Finalizar con faltantes'}
          </button>
        </>
      )}

      {/* Escaneados */}
      {listos.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-surface">
          <div className="flex items-center justify-between border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
            <span className="text-sm font-semibold text-emerald-400">✓ Escaneados</span>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-400">
              {listos.reduce((s, i) => s + i.cantidad, 0)} u.
            </span>
          </div>
          <ul className="divide-y divide-line/50">
            {listos.map((i) => filaItem(i, true))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        title={todoListo ? '¿Finalizar el armado?' : '¿Finalizar con faltantes?'}
        message={
          todoListo
            ? `Se marcaron los ${avance.unidadesOk} artículos del pedido N° ${nroDePedido(armado)}.\nTiempo: ${fmtReloj(segundos)}.`
            : `Quedan ${totalFaltan} unidades sin escaneear: se van a marcar como faltantes (✕).\nSe guarda tu tiempo (${fmtReloj(segundos)}).`
        }
        confirmLabel="Finalizar"
        busy={finalizando}
        onCancel={() => setConfirmando(false)}
        onConfirm={() => void finalizar()}
      />
    </div>
  )
}
