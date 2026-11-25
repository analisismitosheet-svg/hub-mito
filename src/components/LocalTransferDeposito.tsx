import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Camera, CameraOff, Check, ChevronRight, Loader2, Package, Undo2, X } from 'lucide-react'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'

export type EstadoRenglonDeposito = 'pendiente' | 'hecho' | 'faltante' | 'senado'

/** Lo mínimo de un renglón de transferencia que sale de Indo para prepararlo */
export interface RenglonLocalDeposito {
  id: string
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  estado: EstadoRenglonDeposito
  hecho_at: string | null
  /** unidades escaneadas (transfer_escaneos_deposito) */
  escaneadas?: number
}

/** Cambio de un renglón después de escanear o deshacer (el padre lo aplica a su lista) */
export interface CambioRenglonDeposito {
  id: string
  escaneadas: number
  estado: EstadoRenglonDeposito
  hecho_at: string | null
}

/** Lo que devuelve transferencia_escanear_deposito() */
interface FilaEscaneo {
  item_id: string
  articulo: string | null
  color: string | null
  talle: string | null
  escaneadas: number
  cantidad: number
  estado: EstadoRenglonDeposito
}

/** Unidades ya preparadas de un renglón: todo si está marcado, si no lo escaneado */
export const listasDeRenglon = (r: RenglonLocalDeposito) =>
  r.estado !== 'pendiente' ? r.cantidad : Math.min(r.escaneadas ?? 0, r.cantidad)

const etiquetaDe = (r: { articulo: string | null; color: string | null; talle: string | null }) =>
  [r.articulo, r.color, r.talle].filter(Boolean).join(' · ') || 'Artículo'

/**
 * Depósito · un local abierto de una transferencia que sale de Indo: lo que hay
 * que preparar AGRUPADO POR CAJA (Mapeo de cajas, de menor a mayor; «Sin caja»
 * al final). Como Mi repo del mayorista: se escanea con el lector, se escribe el
 * código o se usa la cámara (cada lectura suma 1 unidad; completo = hecho), o se
 * tilda ✓ Hecho / ✕ Faltante / ✓ Todo. Lo usan Mi repo del Depósito y Repos
 * Depósito (solo pantallas del área Depósito). Los renglones llegan ya ordenados.
 */
export default function LocalTransferDeposito({
  loteId,
  loteNombre,
  destino,
  renglones,
  cajasDe,
  deposito = 'INDO',
  puedeMarcar = true,
  textoVolver,
  onVolver,
  onMarcar,
  onCambio,
}: {
  loteId: string
  loteNombre: string
  destino: string
  renglones: RenglonLocalDeposito[]
  cajasDe: (r: RenglonLocalDeposito) => number[]
  /** INDO (con Mapeo de cajas) o POLO52 (sin cajas) */
  deposito?: 'INDO' | 'POLO52'
  puedeMarcar?: boolean
  textoVolver: string
  onVolver: () => void
  onMarcar: (ids: string[], estado: 'pendiente' | 'hecho' | 'faltante') => void | Promise<void>
  onCambio: (c: CambioRenglonDeposito) => void
}) {
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ultimo, setUltimo] = useState<{ id: string; texto: string } | null>(null)
  const [enViaje, setEnViaje] = useState(0)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [camara, setCamara] = useState(false)
  const [enviando, setEnviando] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const enfocar = useCallback(() => {
    // El lector inalámbrico escribe como teclado: el foco vuelve al casillero
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  // Al abrir otro local: casillero limpio y con foco
  useEffect(() => {
    setMensaje(null)
    setUltimo(null)
    setCamara(false)
    enfocar()
  }, [loteId, destino, enfocar])

  async function marcar(ids: string[], estado: 'pendiente' | 'hecho' | 'faltante') {
    if (!ids.length) return
    setEnviando((s) => new Set([...s, ...ids]))
    if (estado === 'pendiente' && ultimo && ids.includes(ultimo.id)) setUltimo(null)
    try {
      await onMarcar(ids, estado)
    } finally {
      setEnviando((s) => { const n = new Set(s); for (const i of ids) n.delete(i); return n })
    }
  }

  /** Escanea (o se escribió) 1 unidad en este local */
  async function escanear(codigo: string) {
    const bruto = codigo.trim()
    if (!bruto || !supabase) return
    setEnViaje((n) => n + 1)
    try {
      const { data, error: e } = await supabase.rpc('transferencia_escanear_deposito', {
        p_lote: loteId,
        p_destino: destino,
        p_codigo: bruto,
        p_deposito: deposito,
      })
      if (e) throw new Error(e.message)
      const f = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneo | null
      if (!f) throw new Error('Sin respuesta del servidor.')
      onCambio({ id: f.item_id, escaneadas: f.escaneadas, estado: f.estado, hecho_at: f.estado === 'hecho' ? new Date().toISOString() : null })
      const texto = etiquetaDe(f)
      setUltimo({ id: f.item_id, texto })
      setMensaje({
        ok: true,
        texto: f.escaneadas >= f.cantidad ? `✓ Completo: ${texto} (${f.cantidad}/${f.cantidad})` : `${texto} · ${f.escaneadas}/${f.cantidad}`,
      })
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo guardar el escaneo.' })
    } finally {
      setEnViaje((n) => n - 1)
    }
  }

  /** Resta la última unidad escaneada (si estaba completo, vuelve a pendiente) */
  async function deshacerUltimo() {
    if (!ultimo || !supabase) return
    setDeshaciendo(true)
    const { data, error: e } = await supabase.rpc('transferencia_desescanear_deposito', { p_item: ultimo.id, p_deposito: deposito })
    setDeshaciendo(false)
    if (e) {
      setMensaje({ ok: false, texto: e.message })
      return
    }
    const r = renglones.find((x) => x.id === ultimo.id)
    onCambio({
      id: ultimo.id,
      escaneadas: Number(data ?? 0),
      estado: r?.estado === 'hecho' ? 'pendiente' : r?.estado ?? 'pendiente',
      hecho_at: r?.estado === 'hecho' ? null : r?.hecho_at ?? null,
    })
    setMensaje({ ok: true, texto: `Deshecho: ${ultimo.texto}` })
    setUltimo(null)
    enfocar()
  }

  /** Un renglón: artículo, unidades y ✓ / ✕ (o el estado con Deshacer) */
  function fila(r: RenglonLocalDeposito, verCaja: boolean) {
    const ocupado = enviando.has(r.id)
    const cs = cajasDe(r)
    const esc = r.escaneadas ?? 0
    return (
      <li key={r.id} className={'flex items-center gap-2 px-3 py-2 ' + (r.estado !== 'pendiente' ? 'opacity-60' : '')}>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
            <span className="truncate">{etiquetaDe(r)}</span>
            {verCaja && cs.length > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-orange-500">
                <Package size={11} aria-hidden />
                {cs.length === 1 ? `Caja ${cs[0]}` : `Cajas ${cs.join(' · ')}`}
              </span>
            )}
            {!verCaja && cs.length > 1 && (
              <span className="shrink-0 text-[11px] font-medium text-sub">también en caja {cs.slice(1).join(' · ')}</span>
            )}
          </p>
          {r.descripcion && <p className="truncate text-xs text-sub">{r.descripcion}</p>}
        </div>
        <span
          className={`shrink-0 text-sm font-semibold tabular-nums ${r.estado === 'pendiente' && esc > 0 ? 'text-orange-500' : 'text-ink'}`}
          title="Escaneadas / pedidas"
        >
          {r.estado === 'pendiente' && esc > 0 ? `${esc}/${r.cantidad}` : `${r.cantidad} u.`}
        </span>
        {!puedeMarcar ? null : r.estado === 'pendiente' ? (
          <>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'hecho')} title="Hecho" aria-label="Marcar hecho" className="btn-press rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={16} aria-hidden />
            </button>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'faltante')} title="Faltante" aria-label="Marcar faltante" className="btn-press rounded-lg bg-red-600 p-2 text-white hover:bg-red-700 disabled:opacity-50">
              <X size={16} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <span className={'shrink-0 text-xs font-medium ' + (r.estado === 'hecho' ? 'text-emerald-500' : 'text-red-500')}>
              {r.estado === 'hecho' ? 'Hecho' : r.estado === 'faltante' ? 'Faltante' : 'Señado'}
            </span>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'pendiente')} title="Deshacer" aria-label="Deshacer" className="btn-press rounded-lg border border-line p-2 text-sub hover:bg-line disabled:opacity-50">
              <Undo2 size={16} aria-hidden />
            </button>
          </>
        )}
      </li>
    )
  }

  const pendientes = renglones.filter((r) => r.estado === 'pendiente')
  const listos = renglones.filter((r) => r.estado !== 'pendiente')
  const total = renglones.reduce((s, r) => s + r.cantidad, 0)
  const hechas = renglones.reduce((s, r) => s + listasDeRenglon(r), 0)
  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0

  // Lo que falta, agrupado por la primera caja (de menor a mayor); sin caja al final
  const grupos: { caja: number | null; renglones: RenglonLocalDeposito[] }[] = []
  for (const r of pendientes) {
    const caja = cajasDe(r)[0] ?? null
    const g = grupos.find((x) => x.caja === caja)
    if (g) g.renglones.push(r)
    else grupos.push({ caja, renglones: [r] })
  }
  grupos.sort((a, b) => (a.caja === null ? 1 : b.caja === null ? -1 : a.caja - b.caja))

  return (
    <div className="space-y-3 pb-4">
      <button
        onClick={onVolver}
        className="-ml-1 inline-flex min-h-[2.5rem] items-center gap-1 px-1 text-sm font-medium text-sub transition hover:text-ink"
      >
        <ChevronRight size={16} aria-hidden className="rotate-180" /> {textoVolver}
      </button>

      <div className="sticky top-0 z-[5] -mx-4 space-y-2 border-b border-line bg-paper px-4 pb-2.5 pt-1 sm:top-[61px] sm:mx-0 sm:rounded-2xl sm:border sm:bg-surface sm:p-4 sm:shadow-soft">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-bold leading-tight text-ink sm:text-base">{loteNombre}</p>
            <p className="flex items-center gap-1.5 text-xs leading-tight text-sub">
              <span className="font-semibold text-orange-500">{destino}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{hechas} de {total} unidades</span>
              <span aria-hidden>·</span>
              <span>{deposito === 'INDO' ? 'recorrido por caja' : 'por artículo'}</span>
            </p>
          </div>
          {puedeMarcar && pendientes.length > 0 && (
            <button
              type="button"
              onClick={() => void marcar(pendientes.map((r) => r.id), 'hecho')}
              className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700"
            >
              <Check size={16} aria-hidden /> Todo
            </button>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
        </div>

        {/* Escáner inalámbrico (escribe + Enter), teclado o cámara: 1 lectura = 1 unidad */}
        {puedeMarcar && (
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault()
              const input = inputRef.current
              if (!input) return
              const v = input.value
              input.value = ''
              void escanear(v)
              enfocar()
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="Escaneá o escribí el código…"
              aria-label="Código de barra de la prenda"
              className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={19} aria-hidden /> : <Camera size={19} aria-hidden />}
            </button>
          </form>
        )}

        {(mensaje || enViaje > 0) && (
          <div aria-live="polite" className="space-y-1">
            {mensaje && (
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium ${
                  mensaje.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                }`}
              >
                {mensaje.ok ? <Check size={15} className="shrink-0" aria-hidden /> : <AlertTriangle size={15} className="shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{mensaje.texto}</span>
                {mensaje.ok && ultimo && (
                  <button
                    type="button"
                    onClick={() => void deshacerUltimo()}
                    disabled={deshaciendo}
                    className="btn-press inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs font-semibold text-ink hover:bg-line disabled:opacity-60"
                  >
                    {deshaciendo ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Undo2 size={12} aria-hidden />} Deshacer
                  </button>
                )}
              </div>
            )}
            {enViaje > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-sub">
                <Loader2 size={12} className="animate-spin" aria-hidden /> Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
              </p>
            )}
          </div>
        )}
      </div>

      {camara && (
        <ScannerCamara
          onLectura={(t) => void escanear(t)}
          onCerrar={() => {
            setCamara(false)
            enfocar()
          }}
        />
      )}

      {pendientes.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">
            Faltan preparar <span className="font-normal text-sub">({pendientes.length})</span>
          </h3>
          {grupos.map((g) => (
            <div key={g.caja ?? 'sin'} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${g.caja === null ? 'bg-surface2' : 'bg-orange-500/10'}`}>
                <span className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                  {g.caja === null ? (deposito === 'INDO' ? 'Sin caja' : 'Artículos') : (<><Package size={16} className="text-orange-500" aria-hidden /> Caja {g.caja}</>)}
                </span>
                <span className="text-xs tabular-nums text-sub">
                  {g.renglones.reduce((s, r) => s + r.cantidad, 0)} u.{g.caja === null && deposito === 'INDO' ? ' · no están en el Mapeo de cajas' : ''}
                </span>
              </div>
              <ul className="divide-y divide-line/40">{g.renglones.map((r) => fila(r, false))}</ul>
            </div>
          ))}
        </section>
      ) : (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
          ✓ {destino} está completo
        </p>
      )}

      {listos.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-sub">Listos ({listos.length})</h3>
          <ul className="divide-y divide-line/40 overflow-hidden rounded-xl border border-line bg-surface">{listos.map((r) => fila(r, true))}</ul>
        </section>
      )}
    </div>
  )
}
