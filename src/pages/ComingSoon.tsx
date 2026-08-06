import { Link } from 'react-router-dom'
import { ArrowLeft, Hammer } from 'lucide-react'
import Layout from '@/components/Layout'

export default function ComingSoon({ title }: { title: string }) {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-brand-100 bg-white py-20 text-center shadow-soft">
        <div className="rounded-2xl bg-accent-600/10 p-4 text-accent-600">
          <Hammer size={32} />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        <p className="max-w-md text-brand-700/70">
          Este módulo todavía está en construcción. Cuando definamos sus datos, lo armamos
          acá dentro del hub.
        </p>
        <Link
          to="/"
          className="btn-press mt-2 flex cursor-pointer items-center gap-1 rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-soft hover:border-brand-300 hover:bg-brand-50"
        >
          <ArrowLeft size={15} /> Volver al menú
        </Link>
      </div>
    </Layout>
  )
}
