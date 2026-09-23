import { useNavigate } from 'react-router-dom'
import { RotateCcw, Users, Truck } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

export default function Rma() {
  const navigate = useNavigate()
  return (
    <Layout wide>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <RotateCcw size={22} className="text-orange-500" aria-hidden /> RMA
        </h1>
        <p className="text-xs text-sub/70">Módulo de RMA y proveedores (Excel PROVEEDORES PACHO).</p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => navigate('/deposito/rma/proveedores')}
          className="hub-card flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5 text-left shadow-soft transition hover:bg-line/20"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/15 text-orange-500"><Users size={20} aria-hidden /></div>
          <span className="font-display text-lg font-semibold text-ink">Proveedores</span>
          <span className="text-sm text-sub">ABM de proveedores de flexus/dragon (código, razón social, CUIT, localidad, tipo).</span>
        </button>
        <button
          onClick={() => navigate('/deposito/rma/guia')}
          className="hub-card flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5 text-left shadow-soft transition hover:bg-line/20"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500"><Truck size={20} aria-hidden /></div>
          <span className="font-display text-lg font-semibold text-ink">Guía</span>
          <span className="text-sm text-sub">Guía de despacho: fecha, N dragon/flexus, planilla, mail, gestión, despacho, NC.</span>
        </button>
      </div>
    </Layout>
  )
}