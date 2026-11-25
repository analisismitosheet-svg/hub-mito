import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, ChevronRight, Loader2 } from 'lucide-react'
import LocalTransferDeposito, { listasDeRenglon, type CambioRenglonDeposito } from '@/components/LocalTransferDeposito'
import { supabase } from '@/lib/supabase'
import { suscribirCambios } from '@/lib/realtime'
import { compararTalles } from '@/lib/ordenPiso'
import { useCajasMapeo } from '@/lib/useCajasMapeo'
import { NOMBRE_DEPOSITO, type DepositoTransfer } from '@/components/TransferenciaDepositoLote'

/** Renglón de transferencia que sale de Depósito Indo (RPC transferencias_deposito_items). */
interface Renglon {
  id: string
  lote_id: string
  lote_nombre: string
  lote_creado: string
  origen: string
  destino: string
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  estado: 'pendiente' | 'hecho' | 'faltante' | 'senado'
  hecho_at: string | null
  /** unidades escaneadas (sql/transferencias_deposito_escaneo.sql); sin ese SQL llega undefined = 0 */
  escaneadas?: number
}

type Estado = 'pendiente' | 'hecho' | 'faltante'
const listasDe = listasDeRenglon

/** Lo que se prepara para un local de un lote (una tarjeta, como una repo del mayorista) */
interface TarjetaLocal {
  clave: string
  loteId: string
  loteNombre: string
  destino: string
  renglones: Renglon[]
  total: number
  listas: number
}

/**
 * Transferencias de Depósito Indo dentro de Mi repo (sql/transferencias_deposito.sql).
 * La ven el rol deposito y los legajos con ubicación Depósito Indo: lotes de los
 * últimos 7 días. Igual que Mi repo del mayorista: una tarjeta por local con su
 * avance; al tocarla se abre ese local con lo que falta preparar ordenado por caja
 * (Mapeo de cajas). Se escanea prenda por prenda (cada lectura suma 1 unidad al
 * renglón; completo = hecho) o se marca a mano ✓ Hecho / Faltante / ✓ Todo.
 * Los marcados hoy quedan a la vista para poder deshacer.
 */
/** `mostrarVacio`: cuando es lo único que tiene Mi repo (rol deposito sin legajo), avisa que no hay nada.
 *  `alAbrir`: avisa si hay un local abierto (Mi repo esconde lo demás, como con una repo abierta). */
export default function TransferenciasDeposito({
  mostrarVacio = false,
  alAbrir,
  deposito = 'INDO',
}: {
  mostrarVacio?: boolean
  alAbrir?: (abierto: boolean) => void
  /** INDO (Mi repo del Depósito, con Mapeo de cajas) o POLO52 (Mi repo de Polo 52, por artículo) */
  deposito?: DepositoTransfer
}) {
  const sinCajas = deposito !== 'INDO'
  const nombreDep = deposito === 'INDO' ? 'Depósito Indo' : NOMBRE_DEPOSITO[deposito]
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Local abierto: `${lote_id}|${destino}` */
  const [sel, setSel] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.rpc('transferencias_deposito_items', { p_deposito: deposito })
    if (e) setError(e.message)
    else { setError(null); setRenglones((data ?? []) as Renglon[]) }
    setCargando(false)
  }, [deposito])

  useEffect(() => {
    void cargar()
    const desuscribir = suscribirCambios(['transfer_items'], () => void cargar())
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => { desuscribir(); window.clearInterval(id) }
  }, [cargar])

  // Cajas del Mapeo de cajas (como las ubicaciones en el armado de pedidos):
  // chip al lado del artículo y recorrido por número de caja. Se actualizan solas.
  const codigos = useMemo(() => (sinCajas ? [] : renglones.map((r) => String(r.articulo ?? ''))), [renglones, sinCajas])
  const cajas = useCajasMapeo(codigos)
  const cajasDe = useCallback(
    (r: { articulo: string | null }) => (sinCajas ? [] : cajas.get(String(r.articulo ?? '').trim().toUpperCase()) ?? []),
    [cajas, sinCajas],
  )

  /** Recorrido: caja → artículo → color → talle; los que no están en ninguna caja, al final */
  const compararRecorrido = useCallback(
    (a: Renglon, b: Renglon) => {
      const ca = cajasDe(a)[0]
      const cb = cajasDe(b)[0]
      const porCaja = ca != null && cb != null ? ca - cb : ca != null ? -1 : cb != null ? 1 : 0
      const t = (v: unknown) => String(v ?? '').trim().toUpperCase()
      return (
        porCaja ||
        t(a.articulo).localeCompare(t(b.articulo), 'es', { numeric: true }) ||
        t(a.color).localeCompare(t(b.color), 'es', { numeric: true }) ||
        compararTalles(a.talle, b.talle)
      )
    },
    [cajasDe],
  )

  // Lote → destino → renglones
  const lotes = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; creado: string; destinos: Map<string, Renglon[]> }>()
    for (const r of renglones) {
      let l = m.get(r.lote_id)
      if (!l) { l = { id: r.lote_id, nombre: r.lote_nombre, creado: r.lote_creado, destinos: new Map() }; m.set(r.lote_id, l) }
      l.destinos.set(r.destino, [...(l.destinos.get(r.destino) ?? []), r])
    }
    for (const l of m.values()) for (const [d, rs] of l.destinos) l.destinos.set(d, [...rs].sort(compararRecorrido))
    return [...m.values()]
  }, [renglones, compararRecorrido])

  async function marcar(ids: string[], estado: Estado) {
    if (!supabase || !ids.length) return
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setRenglones((arr) =>
      arr.map((r) => (ids.includes(r.id) ? { ...r, estado, hecho_at: at, escaneadas: estado === 'pendiente' ? 0 : r.escaneadas } : r)),
    )
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado, p_deposito: deposito })
    if (e) { setError(e.message); await cargar() }
  }

  /** Escaneo / deshacer del panel del local abierto */
  const aplicarCambio = useCallback((c: CambioRenglonDeposito) => {
    setRenglones((arr) => arr.map((r) => (r.id === c.id ? { ...r, escaneadas: c.escaneadas, estado: c.estado, hecho_at: c.hecho_at ?? r.hecho_at } : r)))
  }, [])

  /** Una tarjeta por local (destino) de cada lote, como las repos de Mi repo del mayorista */
  const tarjetas = useMemo(() => {
    const out: TarjetaLocal[] = []
    for (const l of lotes) {
      for (const [destino, rs] of l.destinos) {
        const total = rs.reduce((s, r) => s + r.cantidad, 0)
        const listas = rs.reduce((s, r) => s + listasDe(r), 0)
        out.push({ clave: `${l.id}|${destino}`, loteId: l.id, loteNombre: l.nombre, destino, renglones: rs, total, listas })
      }
    }
    // Primero los que tienen algo por preparar; después, por local
    return out.sort(
      (a, b) => Number(a.listas >= a.total) - Number(b.listas >= b.total) || a.destino.localeCompare(b.destino, 'es'),
    )
  }, [lotes])

  const abierta = sel ? tarjetas.find((t) => t.clave === sel) ?? null : null

  // Avisa a Mi repo para que esconda lo demás mientras hay un local abierto
  useEffect(() => {
    alAbrir?.(!!abierta)
    return () => alAbrir?.(false)
  }, [abierta, alAbrir])

  if (cargando) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando transferencias de {nombreDep}…
      </div>
    )
  }
  if (!tarjetas.length && !error) {
    if (!mostrarVacio) return null
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 px-4 py-14 text-center text-sub">
        <ArrowRightLeft size={28} aria-hidden />
        <p>No hay transferencias pendientes que salgan de {nombreDep}.</p>
        <p className="text-xs">Cuando se cargue una, aparece acá.</p>
      </div>
    )
  }

  /* ---------- Un local abierto: lo que falta agrupado por caja (LocalTransferDeposito) ---------- */
  if (abierta) {
    return (
      <>
        {error && <p role="alert" className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
        <LocalTransferDeposito
          loteId={abierta.loteId}
          loteNombre={abierta.loteNombre}
          destino={abierta.destino}
          renglones={abierta.renglones}
          cajasDe={cajasDe}
          deposito={deposito}
          textoVolver="Mis locales"
          onVolver={() => setSel(null)}
          onMarcar={(ids, estado) => marcar(ids, estado)}
          onCambio={aplicarCambio}
        />
      </>
    )
  }

  /* ---------- Lista: una tarjeta por local ---------- */
  return (
    <section className="mb-5 space-y-2.5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <ArrowRightLeft size={18} className="text-violet-500" aria-hidden /> Transferencias {nombreDep}
      </h2>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      {tarjetas.map((t) => {
        const pct = t.total > 0 ? Math.round((t.listas / t.total) * 100) : 0
        return (
          <button
            key={t.clave}
            onClick={() => setSel(t.clave)}
            className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left shadow-soft transition active:scale-[0.99] hover:bg-surface2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-display font-semibold text-ink">
                <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-500">
                  {t.destino}
                </span>
                <span className="truncate">{t.loteNombre}</span>
              </p>
              <p className="mt-1 text-xs text-sub">
                <span className="tabular-nums">{t.listas} de {t.total} unidades</span>
                {pct === 100 && <span className="ml-2 font-medium text-emerald-400">✓ Listo</span>}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <ChevronRight size={20} aria-hidden className="shrink-0 text-sub" />
          </button>
        )
      })}
    </section>
  )
}
