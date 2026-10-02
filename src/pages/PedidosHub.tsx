import { ClipboardList, PackageX, Gauge } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AppCard from '@/components/AppCard'
import type { AppDef } from '@/config/areas'

/* ------------------------------------------------------------------ */
/*  Pedidos (Compras / Depósito): agrupa Pedidos de compra,            */
/*  Cancelaciones y Estado de pedidos.                                 */
/* ------------------------------------------------------------------ */

const OPCIONES: AppDef[] = [
  {
    id: 'pedidos-compra',
    areaId: 'compras',
    title: 'Pedidos de compra',
    description: 'Pedidos a proveedores de Dragonfish: artículos y cantidades.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/compras/pedidos-compra',
    color: '#65a30d',
  },
  {
    id: 'cancelaciones',
    areaId: 'compras',
    title: 'Cancelaciones',
    description: 'Lo que se canceló de cada pedido: artículos y unidades.',
    icon: PackageX,
    kind: 'internal',
    target: '/compras/cancelaciones',
    color: '#e11d48',
  },
  {
    id: 'estado-pedidos',
    areaId: 'compras',
    title: 'Estado de pedidos',
    description: 'Cómo venimos con el ingreso: por proveedor y por pedido, en unidades.',
    icon: Gauge,
    kind: 'internal',
    target: '/compras/estado-pedidos',
    color: '#0891b2',
  },
]

export default function PedidosHub() {
  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Pedidos</h1>
        <p className="text-sm text-sub">Pedidos de compra, cancelaciones y cómo viene el ingreso.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPCIONES.map((app, i) => <AppCard key={app.id} app={app} index={i} />)}
      </div>
    </Layout>
  )
}
