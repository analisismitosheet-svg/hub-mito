import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { EyeOff, Minus, RotateCcw, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import ChatIaConversacion, { reiniciarChatIa, useChatIa } from '@/components/ChatIaConversacion'

/**
 * Burbuja flotante del Chat IA (solo administradores), en todas las pantallas del hub.
 *   - Minimizar (—): vuelve a la burbuja; la conversación sigue.
 *   - Ocultar (ojo tachado, o la ✕ chiquita de la burbuja): la saca de todas las pantallas.
 *     Se guarda en este navegador y se vuelve a mostrar desde Sistemas > Chat IA.
 * Va arriba de la burbuja de Agentes IA (ChatAgentes, abajo a la derecha) para no taparla.
 */

const CLAVE_OCULTO = 'chatIaOculto'
const EVENTO = 'chat-ia-visibilidad'
let abiertoGlobal = false

function leerOculto(): boolean {
  try {
    return localStorage.getItem(CLAVE_OCULTO) === '1'
  } catch {
    return false
  }
}

/** Muestra u oculta la burbuja en este navegador (lo usa también la pantalla Chat IA). */
export function fijarChatIaOculto(oculto: boolean) {
  try {
    if (oculto) localStorage.setItem(CLAVE_OCULTO, '1')
    else localStorage.removeItem(CLAVE_OCULTO)
  } catch {
    /* sin storage: vale solo para esta pestaña */
  }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: oculto }))
}

export function useChatIaOculto(): boolean {
  const [oculto, setOculto] = useState(leerOculto)
  useEffect(() => {
    const alCambiar = (e: Event) => setOculto((e as CustomEvent<boolean>).detail)
    window.addEventListener(EVENTO, alCambiar)
    return () => window.removeEventListener(EVENTO, alCambiar)
  }, [])
  return oculto
}

export default function ChatIaFlotante() {
  const { isAdmin } = useAuth()
  const { pathname } = useLocation()
  const oculto = useChatIaOculto()
  const { pensando, mensajes } = useChatIa()
  // Cada pantalla monta su propio Layout: se recuerda si estaba abierto para que no se cierre al navegar
  const [abierto, setAbiertoLocal] = useState(abiertoGlobal)
  const setAbierto = (v: boolean) => {
    abiertoGlobal = v
    setAbiertoLocal(v)
  }

  // En la pantalla propia del chat no hace falta la burbuja
  if (!isAdmin || oculto || pathname === '/chat-ia') return null

  const ocultar = () => {
    setAbierto(false)
    fijarChatIaOculto(true)
  }

  if (!abierto) {
    return (
      <div className="group fixed bottom-20 right-5 z-[70]">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="btn-press relative flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-soft-lg outline-none transition hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500/50"
          title="Chat IA"
          aria-label="Abrir Chat IA"
        >
          <Sparkles size={22} aria-hidden />
          {pensando && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-400" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={ocultar}
          className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-sub opacity-100 shadow transition hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
          title="Ocultar el Chat IA (se vuelve a mostrar desde Sistemas > Chat IA)"
          aria-label="Ocultar el Chat IA"
        >
          <X size={12} aria-hidden />
        </button>
      </div>
    )
  }

  const btn = 'rounded-lg p-1.5 text-sub transition hover:bg-surface2 hover:text-ink disabled:opacity-50'
  return (
    <section
      className="fixed bottom-0 right-0 z-[71] flex h-[100dvh] w-full animate-enter flex-col border-line bg-paper shadow-soft-lg sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[420px] sm:rounded-2xl sm:border"
      aria-label="Chat IA"
    >
      <header className="flex items-center gap-1 border-b border-line px-4 py-3">
        <Sparkles size={18} className="mr-1 text-violet-500" aria-hidden />
        <h2 className="flex-1 font-display text-sm font-semibold text-ink">Chat IA</h2>
        {mensajes.length > 0 && (
          <button type="button" onClick={reiniciarChatIa} disabled={pensando} className={btn} title="Nueva conversación" aria-label="Nueva conversación">
            <RotateCcw size={16} aria-hidden />
          </button>
        )}
        <button type="button" onClick={ocultar} className={btn} title="Ocultar el Chat IA en todas las pantallas" aria-label="Ocultar el Chat IA">
          <EyeOff size={16} aria-hidden />
        </button>
        <button type="button" onClick={() => setAbierto(false)} className={btn} title="Minimizar" aria-label="Minimizar el Chat IA">
          <Minus size={16} aria-hidden />
        </button>
      </header>
      <ChatIaConversacion compacto />
    </section>
  )
}
