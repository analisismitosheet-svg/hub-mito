import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { suscribirCambios } from '@/lib/realtime'
import TransferenciaDepositoLote, { type RenglonTransfer } from '@/components/TransferenciaDepositoLote'
import AvisosCelular from '@/components/AvisosCelular'

/**
 * Polo 52 → Transferencias (25/11/2026): el mismo proceso que Repos Depósito con
 * Indo, para los renglones que SALEN de Polo 52 (lotes de 30 días). Estadísticas,
 * «Por local», escaneo, ✓ Hecho / ✕ Faltante. Sin Mapeo de cajas: el recorrido
 * va por artículo. SQL: sql/transferencias_polo52.sql (p_deposito = 'POLO52').
 */
export default function TransferenciasPolo52() {
  const { can, perfil, isAdmin, avisosPolo52 } = useAuth()
  const puedeMarcar = isAdmin || can('polo52.transferencias.mark')
  const [transfer, setTransfer] = useState<RenglonTransfer[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error: e } = await supabase.rpc('deposito_transferencias', { p_deposito: 'POLO52' })
    if (e) setError(e.message)
    else { setError(null); setTransfer((data ?? []) as RenglonTransfer[]) }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
    const desuscribir = suscribirCambios(['transfer_items'], () => void cargar())
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => { desuscribir(); window.clearInterval(id) }
  }, [cargar])

  const porLote = useMemo(() => {
    const m = new Map<string, RenglonTransfer[]>()
    for (const r of transfer) m.set(r.lote_id, [...(m.get(r.lote_id) ?? []), r])
    return [...m.values()]
  }, [transfer])

  async function marcar(ids: string[], estado: 'pendiente' | 'hecho' | 'faltante') {
    if (!supabase || !ids.length) return
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setTransfer((arr) => arr.map((r) => (ids.includes(r.id)
      ? { ...r, estado, hecho_at: at, escaneadas: estado === 'pendiente' ? 0 : r.escaneadas, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null, hecho_por_nombre: estado === 'pendiente' ? null : perfil?.nombre ?? null, hecho_por_legajo: estado === 'pendiente' ? null : perfil?.legajo ?? null }
      : r)))
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado, p_deposito: 'POLO52' })
    if (e) { setError(e.message); await cargar() }
  }

  return (
    <Layout>
      <BackButton />

      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-xl border p-3" style={{ color: '#0891b2', backgroundColor: '#0891b224', borderColor: '#0891b240' }}>
          <ArrowRightLeft size={26} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Transferencias Polo 52</h1>
          <p className="text-sm text-sub">Lo que sale de Polo 52: preparar por local y marcar hecho o faltante.</p>
        </div>
      </div>

      {/* Quien tiene el permiso asignado: que suene cuando carguen una transferencia que sale de Polo 52 */}
      {avisosPolo52 && <AvisosCelular texto="Activá los avisos para que suene cuando carguen una transferencia que sale de Polo 52, aunque la pantalla esté bloqueada o la app cerrada." />}

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : porLote.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <ArrowRightLeft size={28} aria-hidden />
          <p>No hay transferencias que salgan de Polo 52 en los últimos 30 días.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {porLote.map((rs) => (
            <TransferenciaDepositoLote
              key={rs[0].lote_id}
              renglones={rs}
              deposito="POLO52"
              puedeMarcar={puedeMarcar}
              onMarcar={(ids, estado) => marcar(ids, estado)}
              onCambio={(c) => setTransfer((arr) => arr.map((r) => (r.id === c.id
                ? { ...r, escaneadas: c.escaneadas, estado: c.estado, hecho_at: c.hecho_at ?? r.hecho_at, hecho_por: c.estado === 'hecho' ? perfil?.id ?? r.hecho_por : r.hecho_por, hecho_por_nombre: c.estado === 'hecho' ? perfil?.nombre ?? r.hecho_por_nombre : r.hecho_por_nombre }
                : r)))}
            />
          ))}
        </div>
      )}
    </Layout>
  )
}
