import { ShieldX } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

/** 403 — el usuario está aprobado pero no tiene permiso para esta sección. */
export default function Denegado() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-surface py-20 text-center shadow-soft">
        <div className="rounded-2xl bg-brand-600/12 p-4 text-brand-500">
          <ShieldX size={32} aria-hidden />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">Acceso denegado</h1>
        <p className="max-w-md text-sub">
          No tenés permiso para ver esta sección. Si creés que deberías tenerlo, pedile al
          administrador que te lo asigne.
        </p>
        <BackButton
          label="Volver"
          className="btn-press mt-2 flex items-center gap-1 rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line"
        />
      </div>
    </Layout>
  )
}
