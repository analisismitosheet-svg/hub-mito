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
        <p className="text-brand-700/70">Área no encontrada.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 font-medium text-brand-600">
          <ArrowLeft size={15} /> Volver
        </Link>
      </Layout>
    )
  }

  const Icon = area.icon

  return (
    <Layout>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700/70 transition duration-250 hover:text-brand-700"
      >
        <ArrowLeft size={15} /> Áreas
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className={`rounded-xl bg-white p-3 shadow-soft ring-1 ring-inset ring-brand-100 ${area.accent}`}>
          <Icon size={26} />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">{area.name}</h1>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-white/60 py-16 text-center text-brand-700/70">
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
