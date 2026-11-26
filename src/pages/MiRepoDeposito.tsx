import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ScanLine, Store } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AvisosCelular from '@/components/AvisosCelular'
import TransferenciasIndo from '@/components/TransferenciasIndo'
import { useAuth } from '@/context/AuthContext'

/**
 * Depósito → Mi repo (26/11/2026): SOLO lo de Depósito Indo (juntar y separar
 * por local, TransferenciasIndo). Antes compartía pantalla con Mi repo del
 * mayorista y se mezclaban los pedidos: ahora cada área ve lo suyo.
 */
export default function MiRepoDeposito() {
  const { soloPiso } = useAuth()
  /** Con un local abierto se esconde el encabezado, como en Mi repo */
  const [abierto, setAbierto] = useState(false)

  return (
    <Layout>
      {!abierto && (
        <>
          {soloPiso ? (
            // Las cuentas de piso no tienen menú: vuelven a su Mi repo del mayorista
            <Link to="/mayorista/mi-repo" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-sub hover:text-ink">
              <Store size={15} aria-hidden /> Mi repo Mayorista
            </Link>
          ) : (
            <BackButton />
          )}
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl border p-2.5 sm:p-3" style={{ color: '#ea580c', backgroundColor: '#ea580c24', borderColor: '#ea580c40' }}>
              <ScanLine size={24} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">Mi repo</h1>
              <p className="truncate text-sm text-sub">Transferencias Depósito Indo</p>
            </div>
          </div>
          <AvisosCelular texto="Activá los avisos para que suene cuando carguen una reposición de Depósito Indo, aunque el celular esté bloqueado." />
        </>
      )}
      <TransferenciasIndo mostrarVacio alAbrir={setAbierto} />
    </Layout>
  )
}
