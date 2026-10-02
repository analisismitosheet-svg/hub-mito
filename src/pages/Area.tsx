import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FolderOpen, ArrowRight } from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import BackButton from '@/components/BackButton'
import { coloresUnicos } from '@/lib/coloresUnicos'
import { getArea, cargarOverridesAreas, appsDeAreaConOverrides, type AppDef } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'

export default function Area() {
  const { areaId = '' } = useParams()
  const navigate = useNavigate()
  const { can, esLegajo, isAdmin } = useAuth()
  const [overrides, setOverrides] = useState<Record<string, string[]>>({})
  const area = getArea(areaId)

  useEffect(() => {
    let activo = true
    void cargarOverridesAreas().then((m) => { if (activo) setOverrides(m) })
    return () => { activo = false }
  }, [])

  // Ocultar apps sin permiso y ordenar alfabéticamente por título
  const apps = appsDeAreaConOverrides(areaId, overrides)
    .filter((a) => (!a.permiso || can(a.permiso)) && (!a.soloLegajo || esLegajo || isAdmin))
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
  const verArchivos = can('documentos.view')

  // La luz de fondo de arriba toma el color del área mientras estás adentro
  useEffect(() => {
    if (!area) return
    const root = document.documentElement
    root.style.setProperty('--glow-1', `${area.color}33`)
    return () => {
      root.style.removeProperty('--glow-1')
    }
  }, [area])

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

      <div className="animate-enter mb-8 flex items-center gap-4 sm:gap-5" style={{ '--c': area.color } as CSSProperties}>
        <div className="icon-tile h-16 w-16 rounded-[1.25rem] sm:h-20 sm:w-20 sm:rounded-3xl">
          <Icon className="h-7 w-7 sm:h-9 sm:w-9" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">{area.name}</h1>
          {!vacio && (
            <p className="mt-1 text-sub">
              {apps.length} app{apps.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      {vacio ? (
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 py-16 text-center text-sub">
          Todavía no hay aplicaciones en esta área.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {conColores(intercalarArchivos(apps, verArchivos), area.color).map(({ item, color }, i) => (
            item.tipo === 'app' ? (
              <AppCard key={item.app!.id} app={{ ...item.app!, color }} index={i} areaId={areaId} />
            ) : (
              <button
                key="archivos"
                onClick={() => navigate(`/archivos/${areaId}`)}
                style={{ animationDelay: `${i * 40}ms`, '--c': color } as CSSProperties}
                className="hub-card animate-enter group relative flex flex-col items-start gap-4 overflow-hidden border border-line bg-surface p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-6"
              >
                <div className="icon-tile h-12 w-12 transition-transform duration-300 ease-out-strong group-hover:scale-110 sm:h-14 sm:w-14">
                  <FolderOpen size={24} aria-hidden />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-ink">Archivos</h3>
                  <p className="mt-1 text-sm text-sub">Fotos, PDF, Excel y documentos del área.</p>
                </div>
                <span className="card-link mt-auto flex items-center gap-1.5 text-sm font-semibold transition-[gap] duration-300 group-hover:gap-2.5">
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

/** Un color por tarjeta sin repetir tonos en el área (Archivos usa el del área). */
function conColores(
  items: ({ tipo: 'app'; app: AppDef } | { tipo: 'archivos' })[],
  colorArea: string,
): { item: { tipo: 'app' | 'archivos'; app?: AppDef }; color: string }[] {
  const colores = coloresUnicos(items.map((it) => (it.tipo === 'app' ? it.app.color : colorArea)))
  return items.map((item, i) => ({ item, color: colores[i] }))
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