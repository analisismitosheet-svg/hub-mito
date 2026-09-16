import { RotateCcw } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

export default function Rma() {
  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <RotateCcw size={22} className="text-orange-500" aria-hidden /> RMA
        </h1>
        <p className="text-xs text-sub/70">Gestion de RMA (devoluciones).</p>
      </header>

      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface py-20 text-center shadow-soft">
        <div className="rounded-2xl bg-orange-500/12 p-4 text-orange-500">
          <RotateCcw size={32} aria-hidden />
        </div>
        <h2 className="font-display text-lg font-semibold text-ink">RMA</h2>
        <p className="max-w-md text-sm text-sub">
          El modulo esta listo. Cuando definas los campos y el flujo de RMA, lo armamos aca dentro.
        </p>
      </div>
    </Layout>
  )
}
