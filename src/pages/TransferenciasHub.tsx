import { Navigate } from 'react-router-dom'
import { PackageCheck, Shuffle } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AppCard from '@/components/AppCard'
import { useAuth } from '@/context/AuthContext'
import type { AppDef } from '@/config/areas'

/* ------------------------------------------------------------------ */
/*  Reposiciones / Transferencias (/transferencias/inicio): como       */
/*  Pedidos, agrupa en tarjetas:                                       */
/*    - Reposición diaria (repo de MITO → Dragon)                      */
/*    - Transferencia diaria (cascada entre locales + pestaña «Lotes   */
/*      en Transferencias», los lotes que marca cada local)            */
/*  Quien no importa transferencias (los locales) va directo a los     */
/*  lotes, como siempre.                                               */
/* ------------------------------------------------------------------ */

const OPCIONES: AppDef[] = [
  {
    id: 'reposicion-diaria',
    areaId: 'compras',
    title: 'Reposición diaria',
    description: 'Lo que manda MITO a cada local con la venta de ayer. Carga en Dragon y pedido de armado.',
    icon: PackageCheck,
    kind: 'internal',
    target: '/transferencias/reposicion-diaria',
    color: '#0ea5e9',
  },
  {
    id: 'transferencia-diaria',
    areaId: 'compras',
    title: 'Transferencia diaria',
    description: 'Lo que MITO no pudo reponer, pasado entre locales, y los lotes que marca cada local.',
    icon: Shuffle,
    kind: 'internal',
    target: '/transferencias/transferencia-diaria',
    color: '#8b5cf6',
  },
]

export default function TransferenciasHub() {
  const { can, isAdmin, loading } = useAuth()
  if (loading) return null
  if (!isAdmin && !can('transferencias.import')) return <Navigate to="/transferencias" replace />
  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Reposiciones / Transferencias</h1>
        <p className="text-sm text-sub">La reposición diaria de MITO y la transferencia diaria entre locales, con sus lotes.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {OPCIONES.map((app, i) => <AppCard key={app.id} app={app} index={i} />)}
      </div>
    </Layout>
  )
}
