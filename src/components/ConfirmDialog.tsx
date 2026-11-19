import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
  /** Si viene, hay que tildar esta casilla (ej. «Sí, estoy seguro») antes de poder confirmar */
  confirmarCon?: string
}

export default function ConfirmDialog({
  open,
  title = '¿Confirmar eliminación?',
  message,
  confirmLabel = 'Eliminar',
  busy = false,
  onCancel,
  onConfirm,
  confirmarCon,
}: ConfirmDialogProps) {
  const [tildado, setTildado] = useState(false)
  // Cada vez que se abre, la casilla arranca sin tildar
  useEffect(() => {
    if (open) setTildado(false)
  }, [open])
  if (!open) return null
  const bloqueado = busy || (!!confirmarCon && !tildado)
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[90vw] max-w-sm animate-enter rounded-2xl border border-line bg-surface p-5 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
          <AlertTriangle size={22} aria-hidden />
        </div>
        <h3 className="mb-1 text-base font-semibold text-ink">{title}</h3>
        <p className="mx-auto max-w-xs whitespace-pre-line text-sm text-sub">{message}</p>
        {confirmarCon && (
          <label className="mx-auto mt-4 flex max-w-xs cursor-pointer select-none items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-400">
            <input
              type="checkbox"
              checked={tildado}
              onChange={(e) => setTildado(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 accent-red-600"
            />
            {confirmarCon}
          </label>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink transition hover:bg-line disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={bloqueado}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
