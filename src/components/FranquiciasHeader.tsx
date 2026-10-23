import { Link } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import BackButton from '@/components/BackButton'
import FranquiciasTabs from '@/components/FranquiciasTabs'

/**
 * Encabezado común de las tres pantallas de Franquicias.
 * La configuración de clientes, bases y teléfonos vive en Sistemas.
 */
export default function FranquiciasHeader({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <BackButton />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-400">Franquicias</p>
            <h1 className="font-display truncate text-xl font-semibold text-ink md:text-2xl">{titulo}</h1>
            <p className="mt-1 max-w-2xl text-sm text-sub">{descripcion}</p>
          </div>
        </div>
        <Link
          to="/sistemas/franquicias"
          className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface2"
        >
          <Settings2 size={14} aria-hidden />
          Configurar clientes, bases y teléfonos
        </Link>
      </div>
      <FranquiciasTabs />
    </>
  )
}
