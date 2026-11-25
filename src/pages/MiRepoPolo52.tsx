import { useState } from 'react'
import { ScanLine } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AvisosCelular from '@/components/AvisosCelular'
import TransferenciasDeposito from '@/components/TransferenciasDeposito'
import { useAuth } from '@/context/AuthContext'

/**
 * Polo 52 → Mi repo (25/11/2026): lo mismo que Mi repo del Depósito con Indo, para
 * el piso de Polo 52. Una tarjeta por local de cada lote de 7 días con renglones
 * que SALEN de Polo 52; al abrirla se escanea prenda por prenda o se marca
 * ✓ Hecho / ✕ Faltante / ✓ Todo. Sin Mapeo de cajas: va por artículo.
 * Datos: transferencias_deposito_items('POLO52') (sql/transferencias_polo52.sql).
 */
export default function MiRepoPolo52() {
  const { avisosPolo52 } = useAuth()
  /** Con un local abierto se esconde el encabezado, como en Mi repo */
  const [abierto, setAbierto] = useState(false)

  return (
    <Layout>
      {!abierto && (
        <>
          <BackButton />
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl border p-2.5 sm:p-3" style={{ color: '#ea580c', backgroundColor: '#ea580c24', borderColor: '#ea580c40' }}>
              <ScanLine size={24} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Mi repo</h1>
              <p className="truncate text-sm text-sub">Transferencias Polo 52</p>
            </div>
          </div>
          {avisosPolo52 && (
            <AvisosCelular texto="Activá los avisos para que suene cuando carguen una transferencia que sale de Polo 52, aunque el celular esté bloqueado." />
          )}
        </>
      )}
      <TransferenciasDeposito deposito="POLO52" mostrarVacio alAbrir={setAbierto} />
    </Layout>
  )
}
