import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({
  open,
  title = '¿Confirmar eliminación?',
  message,
  confirmLabel = 'Eliminar',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-[90vw] max-w-sm animate-enter rounded-2xl border border-line bg-surface p-5 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
          <AlertTriangle size={22} aria-hidden />
        </div>
        <h3 className="mb-1 text-base font-semibold text-ink">{title}</h3>
        <p className="mx-auto max-w-xs whitespace-pre-line text-sm text-sub">{message}</p>
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
            disabled={busy}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
