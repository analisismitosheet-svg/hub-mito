import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, ArrowRight } from 'lucide-react'
import Layout from '@/components/Layout'
import AreaCard from '@/components/AreaCard'
import Banner from '@/components/Banner'
import { AREAS } from '@/config/areas'
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
      className="hub-card animate-enter group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-5 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-brand-600 transition-transform duration-300 ease-out-strong group-hover:scale-x-100"
      />
      <div
        className="rounded-xl border p-3 transition-transform duration-300 ease-out-strong group-hover:scale-110"
        style={{ color: '#e11d2e', backgroundColor: '#e11d2e24', borderColor: '#e11d2e40' }}
      >
        <Settings size={24} aria-hidden />
      </div>
      <div className="w-full">
        <h3 className="flex items-center gap-2 font-display font-semibold text-ink">
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
      <span className="mt-auto flex items-center gap-1.5 text-sm font-medium text-brand-500">
        Abrir
        <ArrowRight size={14} aria-hidden className="transition-transform duration-300 ease-out-strong group-hover:translate-x-1" />
      </span>
    </button>
  )
}

export default function Menu() {
  const { can, isAdmin } = useAuth()
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
      <Banner />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">Áreas</h1>
        <p className="mt-1 text-sub">Elegí un área para ver sus aplicaciones.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {areas.map((area, i) => (
          <AreaCard key={area.id} area={area} index={i} />
        ))}
        {/* Configuraciones va al final y solo para administradores */}
        {isAdmin && <ConfiguracionesCard />}
      </div>
    </Layout>
  )
}
