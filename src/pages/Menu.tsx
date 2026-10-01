import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, ArrowRight } from 'lucide-react'
import Layout from '@/components/Layout'
import AreaCard from '@/components/AreaCard'
import AppCard from '@/components/AppCard'
import { AREAS, ACCESOS_MENU, areasDeApp, cargarOverridesAreas } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

function ConfiguracionesCard() {
  const navigate = useNavigate()
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente')
      .then(({ count }) => setPendientes(count ?? 0))
  }, [])

  return (
    <button
      onClick={() => navigate('/configuraciones')}
      className="hub-card animate-enter group relative flex flex-col items-start gap-4 overflow-hidden border border-line bg-surface p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-6"
    >
      <div className="icon-tile h-12 w-12 transition-transform duration-300 ease-out-strong group-hover:scale-110 sm:h-14 sm:w-14">
        <Settings size={24} aria-hidden />
      </div>
      <div className="w-full">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink">
          Configuraciones
          {pendientes > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
              {pendientes}
            </span>
          )}
        </h3>
        <p className="mt-1 text-sm text-sub">
          {pendientes > 0 ? `${pendientes} solicitud${pendientes > 1 ? 'es' : ''} pendiente${pendientes > 1 ? 's' : ''}` : 'Usuarios, roles y permisos'}
        </p>
      </div>
      <span className="card-link mt-auto flex items-center gap-1.5 text-sm font-semibold transition-[gap] duration-300 group-hover:gap-2.5">
        Abrir
        <ArrowRight size={14} aria-hidden className="transition-transform duration-300 ease-out-strong group-hover:translate-x-1" />
      </span>
    </button>
  )
}

export default function Menu() {
  const { can, isAdmin } = useAuth()
  const [overrides, setOverrides] = useState<Record<string, string[]> | null>(null)

  useEffect(() => {
    let activo = true
    void cargarOverridesAreas().then((m) => { if (activo) setOverrides(m) })
    return () => { activo = false }
  }, [])

  // Accesos directos (Transporte, Control de Locales): los ve quien pueda ver
  // alguna de las áreas donde estaban antes (o las tildadas en Roles)
  const accesos = useMemo(
    () =>
      overrides === null
        ? []
        : ACCESOS_MENU.filter(
            (app) => isAdmin || areasDeApp(app, overrides).some((a) => can(`area_${a}.view`)),
          ),
    [overrides, can, isAdmin],
  )
  const areas = useMemo(
    () =>
      [...AREAS]
        // Menú dinámico: cada área requiere su permiso area_<id>.view (admin ve todo)
        .filter((a) => can(`area_${a.id}.view`))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [can],
  )

  return (
    <Layout>
      {accesos.length > 0 && (
        <section className="mb-10">
          <h2 className="animate-enter mb-4 font-display text-xl font-bold text-ink sm:text-2xl">Accesos directos</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {accesos.map((app, i) => (
              <AppCard key={app.id} app={app} index={i} />
            ))}
          </div>
        </section>
      )}

      <div className="animate-enter mb-8">
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">Áreas</h1>
        <p className="mt-1.5 text-sub sm:text-lg">Elegí un área para ver sus aplicaciones.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {areas.map((area, i) => (
          <AreaCard key={area.id} area={area} index={i} />
        ))}
        {/* Configuraciones va al final y solo para administradores */}
        {isAdmin && <ConfiguracionesCard />}
      </div>
    </Layout>
  )
}
