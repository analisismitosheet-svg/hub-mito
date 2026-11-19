import { BarChart3, CalendarClock, ListChecks } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import AppCard from '@/components/AppCard'
import type { AppDef } from '@/config/areas'

/* ------------------------------------------------------------------ */
/*  Mayorista → Franquicias: agrupa la reposición diaria automática     */
/*  y el dashboard de venta/stock de cada franquicia.                   */
/* ------------------------------------------------------------------ */

const OPCIONES: AppDef[] = [
  {
    id: 'franquicias-auto',
    areaId: 'mayorista',
    title: 'Reposición diaria automática',
    description: 'Cada cliente con su base y sus WhatsApps, días y hora de salida, y las reposiciones por cliente y fecha.',
    icon: CalendarClock,
    kind: 'internal',
    target: '/mayorista/franquicias/auto',
    color: '#d97706',
  },
  {
    id: 'franquicias-venta-stock',
    areaId: 'mayorista',
    title: 'Venta/stock franquicias',
    description: 'Cuánto vende cada franquicia, qué tiene en el local, quiebres y lo que no rota.',
    icon: BarChart3,
    kind: 'internal',
    target: '/mayorista/franquicias/venta-stock',
    color: '#0891b2',
  },
  {
    id: 'franquicias-sugerida',
    areaId: 'mayorista',
    title: 'Reposición franquicias sugerida',
    description: 'Qué reponerle a cada franquicia: lo vendido contra su stock, sin pasar el stock de MITO. Con Excel, WhatsApp y propuesta.',
    icon: ListChecks,
    kind: 'internal',
    target: '/mayorista/franquicias/diaria',
    color: '#7c3aed',
  },
]

export default function FranquiciasMenu() {
  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Franquicias</h1>
        <p className="text-sm text-sub">Reposición automática, reposición sugerida y cómo vienen las ventas y el stock de cada franquicia.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OPCIONES.map((app, i) => <AppCard key={app.id} app={app} index={i} />)}
      </div>
    </Layout>
  )
}
