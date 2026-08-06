import { Link } from 'react-router-dom'
import { ArrowLeft, Hammer } from 'lucide-react'
import Layout from '@/components/Layout'

export default function ComingSoon({ title }: { title: string }) {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 py-20 text-center">
        <div className="rounded-2xl bg-slate-800 p-4 text-amber-400">
          <Hammer size={32} />
        </div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="max-w-md text-slate-400">
          Este módulo todavía está en construcción. Cuando definamos sus datos, lo armamos
          acá dentro del hub.
        </p>
        <Link
          to="/"
          className="mt-2 flex items-center gap-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          <ArrowLeft size={15} /> Volver al menú
        </Link>
      </div>
    </Layout>
  )
}
