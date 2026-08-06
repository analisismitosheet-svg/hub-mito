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
        <p className="text-slate-400">Área no encontrada.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 text-brand-400">
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
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-400 transition hover:text-slate-200"
      >
        <ArrowLeft size={15} /> Áreas
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className={`rounded-xl bg-slate-800/70 p-3 ${area.accent}`}>
          <Icon size={26} />
        </div>
        <h1 className="text-2xl font-bold text-white">{area.name}</h1>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 py-16 text-center text-slate-400">
          Todavía no hay aplicaciones en esta área.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </Layout>
  )
}
