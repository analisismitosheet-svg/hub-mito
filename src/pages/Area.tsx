import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import { appsDeArea, getArea } from '@/config/areas'

export default function Area() {
  const { areaId = '' } = useParams()
  const area = getArea(areaId)
  const apps = appsDeArea(areaId)

  if (!area) {
    return (
      <Layout>
        <p className="text-sub">Área no encontrada.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 font-medium text-brand-500">
          <ArrowLeft size={15} aria-hidden /> Volver
        </Link>
      </Layout>
    )
  }

  const Icon = area.icon

  return (
    <Layout>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden /> Áreas
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div
          className="rounded-xl border p-3"
          style={{
            color: area.color,
            backgroundColor: `${area.color}24`,
            borderColor: `${area.color}40`,
          }}
        >
          <Icon size={26} aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">{area.name}</h1>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 py-16 text-center text-sub">
          Todavía no hay aplicaciones en esta área.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} />
          ))}
        </div>
      )}
    </Layout>
  )
}
