import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Motivo de la pausa (Mi repo y armado). Sin motivo no se pausa:     */
/*  la base lo exige (sql/piso_pausas.sql) y queda medido en           */
/*  Eficiencia mayorista.                                              */
/* ------------------------------------------------------------------ */

export type MotivoPausa = 'bano' | 'comida' | 'otra_tarea' | 'falta_mercaderia' | 'equipo' | 'otro'

export const MOTIVOS_PAUSA: { id: MotivoPausa; label: string; icono: string }[] = [
  { id: 'bano', label: 'Baño', icono: '🚻' },
  { id: 'comida', label: 'Almuerzo / merienda', icono: '🍽️' },
  { id: 'otra_tarea', label: 'Me pidieron otra tarea', icono: '📋' },
  { id: 'falta_mercaderia', label: 'Falta mercadería / no la encuentro', icono: '📦' },
  { id: 'equipo', label: 'Problema con el celular o escáner', icono: '📱' },
  { id: 'otro', label: 'Otro (contalo)', icono: '✏️' },
]

export const nombreMotivoPausa = (m: string) => MOTIVOS_PAUSA.find((x) => x.id === m)?.label ?? m

export default function MotivoPausaDialog({
  abierto, enviando, error, onCancelar, onConfirmar,
}: {
  abierto: boolean
  enviando: boolean
  error: string | null
  onCancelar: () => void
  onConfirmar: (motivo: MotivoPausa, detalle: string) => void
}) {
  const [motivo, setMotivo] = useState<MotivoPausa | null>(null)
  const [detalle, setDetalle] = useState('')
  if (!abierto) return null
  const falta = !motivo || (motivo === 'otro' && detalle.trim().length < 3)

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onCancelar}>
      <div
        role="dialog"
        aria-label="Motivo de la pausa"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
            <Pause size={16} className="text-amber-500" aria-hidden /> ¿Por qué pausás?
          </h3>
          <button type="button" onClick={onCancelar} className="rounded-lg p-1 text-sub hover:text-ink" aria-label="Cancelar">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="grid gap-1.5">
          {MOTIVOS_PAUSA.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMotivo(m.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
                motivo === m.id ? 'border-amber-500/60 bg-amber-500/15 text-amber-400' : 'border-line bg-surface2 text-ink hover:border-line2'
              }`}
            >
              <span aria-hidden>{m.icono}</span> {m.label}
            </button>
          ))}
        </div>
        {motivo === 'otro' && (
          <input
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Contá brevemente el motivo"
            maxLength={120}
            className="mt-2 w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-amber-500"
          />
        )}
        <p className="mt-2 text-[11px] text-sub">La pausa queda registrada con el motivo y cuánto dura.</p>
        {error && <p className="mt-2 text-xs font-medium text-brand-400">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="rounded-xl px-3 py-2 text-sm text-sub hover:text-ink">
            Cancelar
          </button>
          <button
            type="button"
            disabled={falta || enviando}
            onClick={() => motivo && onConfirmar(motivo, detalle.trim())}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {enviando ? 'Pausando…' : 'Pausar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
