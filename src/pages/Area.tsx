import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FolderOpen, ArrowRight } from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import BackButton from '@/components/BackButton'
import { getArea, cargarOverridesAreas, appsDeAreaConOverrides, type AppDef } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'

export default function Area() {
  const { areaId = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [overrides, setOverrides] = useState<Record<string, string[]>>({})
  const area = getArea(areaId)

  useEffect(() => {
    let activo = true
    void cargarOverridesAreas().then((m) => { if (activo) setOverrides(m) })
    return () => { activo = false }
  }, [])

  // Ocultar apps sin permiso y ordenar alfabéticamente por título
  const apps = appsDeAreaConOverrides(areaId, overrides)
    .filter((a) => !a.permiso || can(a.permiso))
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
  const verArchivos = can('documentos.view')

  if (!area) {
    return (
      <Layout>
        <p className="text-sub">Área no encontrada.</p>
        <BackButton className="mt-4 inline-flex items-center gap-1 font-medium text-brand-500" />
      </Layout>
    )
  }

  const Icon = area.icon
  const vacio = apps.length === 0 && !verArchivos

  return (
    <Layout>
      <BackButton />

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
          {intercalarArchivos(apps, verArchivos).map((item, i) => (
            item.tipo === 'app' ? (
              <AppCard key={item.app!.id} app={item.app!} index={i} areaId={areaId} />
            ) : (
              <button
                key="archivos"
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
            )
          ))}
        </div>
      )}
    </Layout>
  )
}

/** Mezcla la tarjeta "Archivos" en la posición alfabética correcta entre las apps. */
function intercalarArchivos(
  apps: AppDef[],
  verArchivos: boolean,
): ({ tipo: 'app'; app: AppDef } | { tipo: 'archivos' })[] {
  const out: ({ tipo: 'app'; app: AppDef } | { tipo: 'archivos' })[] = []
  const sorted = [...apps].sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
  if (!verArchivos) return sorted.map((app) => ({ tipo: 'app', app }))

  let insertado = false
  for (const app of sorted) {
    if (!insertado && 'Archivos'.localeCompare(app.title, 'es', { sensitivity: 'base' }) < 0) {
      out.push({ tipo: 'archivos' })
      insertado = true
    }
    out.push({ tipo: 'app', app })
  }
  if (!insertado) out.push({ tipo: 'archivos' })
  return out
}