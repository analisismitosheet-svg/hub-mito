import { FolderOpen } from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import BackButton from '@/components/BackButton'
import { appsDeArea } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'

/** Sub-vista de una carpeta: lista las apps de una sub-área (ej. rrhh-novedades). */
export default function CarpetaArea({ carpetaId = 'rrhh-novedades' }: { carpetaId?: string }) {
  const { can } = useAuth()
  const apps = appsDeArea(carpetaId)
    .filter((a) => !a.permiso || can(a.permiso))
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))

  const titulo = carpetaId.split('-').slice(1).join(' ')

  return (
    <Layout>
      <BackButton />
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border p-3" style={{ color: '#7c3aed', backgroundColor: '#7c3aed24', borderColor: '#7c3aed40' }}>
          <FolderOpen size={24} aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink capitalize">{titulo}</h1>
      </div>

      {apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 py-16 text-center text-sub">
          Esta carpeta está vacía.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} areaId={carpetaId} />
          ))}
        </div>
      )}
    </Layout>
  )
}