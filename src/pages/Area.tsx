import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen, ArrowRight } from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import { appsDeArea, getArea } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'

export default function Area() {
  const { areaId = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const area = getArea(areaId)
  // Ocultar apps para las que el usuario no tiene permiso (las externas sin permiso quedan visibles)
  const apps = appsDeArea(areaId).filter((a) => !a.permiso || can(a.permiso))
  const verArchivos = can('documentos.view')

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
  const vacio = apps.length === 0 && !verArchivos

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

      {vacio ? (
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 py-16 text-center text-sub">
          Todavía no hay aplicaciones en esta área.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} />
          ))}
          {verArchivos && (
            <button
              onClick={() => navigate(`/archivos/${areaId}`)}
              className="hub-card animate-enter group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 ease-out-strong group-hover:scale-x-100"
                style={{ backgroundColor: area.color }}
              />
              <div
                className="rounded-xl border p-3 transition-transform duration-300 ease-out-strong group-hover:scale-110"
                style={{ color: area.color, backgroundColor: `${area.color}24`, borderColor: `${area.color}40` }}
              >
                <FolderOpen size={24} aria-hidden />
              </div>
              <div>
                <h3 className="font-display font-semibold text-ink">Archivos</h3>
                <p className="mt-1 text-sm text-sub">Fotos, PDF, Excel y documentos del área.</p>
              </div>
              <span className="mt-auto flex items-center gap-1.5 text-sm font-medium" style={{ color: area.color }}>
                Abrir
                <ArrowRight size={14} aria-hidden className="transition-transform duration-300 ease-out-strong group-hover:translate-x-1" />
              </span>
            </button>
          )}
        </div>
      )}
    </Layout>
  )
}
