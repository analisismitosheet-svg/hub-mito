import { useMemo } from 'react'
import Layout from '@/components/Layout'
import AreaCard from '@/components/AreaCard'
import { AREAS } from '@/config/areas'

export default function Menu() {
  const areas = useMemo(
    () => [...AREAS].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [],
  )

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">Áreas</h1>
        <p className="mt-1 text-brand-700/70">Elegí un área para ver sus aplicaciones.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {areas.map((area, i) => (
          <AreaCard key={area.id} area={area} index={i} />
        ))}
      </div>
    </Layout>
  )
}
