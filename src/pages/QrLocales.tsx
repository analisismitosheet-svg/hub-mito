import { Link } from 'react-router-dom'
import { QrCode, ImageIcon, ChevronRight } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

export default function QrLocales() {
  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">QR Locales</h1>
        <p className="mt-1 text-sm text-sub">Sectores, QR únicos por local y diseño de etiquetas.</p>
      </header>

      <div className="space-y-3">
        <Link
          to="/sectores-qr"
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
        >
          <div className="rounded-xl border p-3" style={{ color: '#22c55e', backgroundColor: '#22c55e24', borderColor: '#22c55e40' }}>
            <QrCode size={22} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-ink">Sectores / QR</div>
            <p className="text-sm text-sub">Crear sectores, generar y regenerar QR únicos por combinación <b>Local + Sector</b>.</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
        </Link>

        <Link
          to="/qr-etiqueta"
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
        >
          <div className="rounded-xl border p-3" style={{ color: '#0ea5e9', backgroundColor: '#0ea5e924', borderColor: '#0ea5e940' }}>
            <ImageIcon size={22} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-ink">Etiqueta del QR</div>
            <p className="text-sm text-sub">Diseñar la impresión del QR: logo, textos y tamaños, con vista previa.</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
        </Link>
      </div>
    </Layout>
  )
}
