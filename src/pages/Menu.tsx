import Layout from '@/components/Layout'
import AreaCard from '@/components/AreaCard'
import { AREAS } from '@/config/areas'

export default function Menu() {
  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Áreas</h1>
        <p className="mt-1 text-slate-400">
          Elegí un área para ver sus aplicaciones.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {AREAS.map((area) => (
          <AreaCard key={area.id} area={area} />
        ))}
      </div>
    </Layout>
  )
}
