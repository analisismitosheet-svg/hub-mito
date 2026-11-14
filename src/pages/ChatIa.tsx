import { Bot, Eye, EyeOff, RotateCcw } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ChatIaConversacion, { reiniciarChatIa, useChatIa } from '@/components/ChatIaConversacion'
import { fijarChatIaOculto, useChatIaOculto } from '@/components/ChatIaFlotante'

/**
 * Sistemas > Chat IA (solo administradores): el chat a pantalla completa.
 * Es la misma conversación que la burbuja flotante (ChatIaFlotante). Desde acá se vuelve a
 * mostrar la burbuja si se la ocultó.
 */
export default function ChatIa() {
  const { mensajes, pensando } = useChatIa()
  const oculto = useChatIaOculto()
  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50'

  return (
    <Layout>
      <BackButton />
      <header className="mb-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Bot size={22} className="text-violet-500" aria-hidden /> Chat IA
        </h1>
        <span className="text-xs text-sub/70">Consultas de solo lectura · no se guarda el historial</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => fijarChatIaOculto(!oculto)} className={btnChico}>
            {oculto ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
            {oculto ? 'Mostrar burbuja flotante' : 'Ocultar burbuja flotante'}
          </button>
          {mensajes.length > 0 && (
            <button type="button" onClick={reiniciarChatIa} disabled={pensando} className={btnChico}>
              <RotateCcw size={13} aria-hidden /> Nueva conversación
            </button>
          )}
        </div>
      </header>

      <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] flex-col">
        <ChatIaConversacion />
      </div>
    </Layout>
  )
}
