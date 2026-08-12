import { Hammer } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

export default function ComingSoon({ title }: { title: string }) {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface py-20 text-center shadow-soft">
        <div className="rounded-2xl bg-brand-600/12 p-4 text-brand-500">
          <Hammer size={32} aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
        <p className="max-w-md text-sub">
          Este módulo todavía está en construcción. Cuando definamos sus datos, lo armamos
          acá dentro del hub.
        </p>
        <BackButton
          label="Volver"
          className="btn-press mt-2 flex cursor-pointer items-center gap-1 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-soft hover:border-line2 hover:bg-surface2"
        />
      </div>
    </Layout>
  )
}
