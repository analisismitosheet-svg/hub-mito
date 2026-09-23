import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Bot, Check, Loader2, RotateCcw, Send, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  agentesDisponibles,
  cancelarAccion,
  chatAgente,
  confirmarAccion,
  listarAgentes,
  type AccionPropuesta,
  type AgenteInfo,
} from '@/lib/agentesApi'

interface Mensaje {
  rol: 'user' | 'assistant' | 'error'
  texto: string
  herramientas?: string[]
  acciones?: AccionPropuesta[]
}

/**
 * Chat flotante con los agentes del servidor de IA (Ollama en la PC del servidor).
 * Solo para administradores, y solo si el servidor responde (en esa PC o por Tailscale).
 */
export default function ChatAgentes() {
  const { isAdmin } = useAuth()
  const [disponible, setDisponible] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [agentes, setAgentes] = useState<AgenteInfo[]>([])
  const [agente, setAgente] = useState('soporte')
  const [mensajes, setMensajes] = useState<Record<string, Mensaje[]>>({})
  const [conversaciones, setConversaciones] = useState<Record<string, string>>({})
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAdmin) return
    let vivo = true
    const revisar = async () => {
      const ok = await agentesDisponibles()
      if (vivo) setDisponible(ok)
    }
    revisar()
    const id = setInterval(revisar, 60_000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [isAdmin])

  useEffect(() => {
    if (!abierto || agentes.length) return
    listarAgentes()
      .then(setAgentes)
      .catch(() => setAgentes([]))
  }, [abierto, agentes.length])

  const actuales = mensajes[agente] ?? []

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight })
  }, [actuales.length, enviando, abierto])

  if (!disponible || !isAdmin) return null

  const agregar = (m: Mensaje) => setMensajes((prev) => ({ ...prev, [agente]: [...(prev[agente] ?? []), m] }))

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    const mensaje = texto.trim()
    if (!mensaje || enviando) return
    setTexto('')
    agregar({ rol: 'user', texto: mensaje })
    setEnviando(true)
    try {
      const r = await chatAgente(agente, mensaje, conversaciones[agente])
      setConversaciones((prev) => ({ ...prev, [agente]: r.conversacionId }))
      agregar({
        rol: 'assistant',
        texto: r.respuesta,
        herramientas: r.herramientasUsadas.map((h) => h.nombre),
        acciones: r.acciones,
      })
    } catch (err) {
      agregar({ rol: 'error', texto: (err as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  function reiniciar() {
    setMensajes((prev) => ({ ...prev, [agente]: [] }))
    setConversaciones((prev) => {
      const { [agente]: _, ...resto } = prev
      return resto
    })
  }

  const info = agentes.find((a) => a.id === agente)

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="btn-press fixed bottom-5 right-5 z-[70] flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-brand-600 text-white shadow-glow outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/50"
          title="Agentes IA"
          aria-label="Abrir chat de agentes"
        >
          <Bot size={22} aria-hidden />
        </button>
      )}

      {abierto && (
        <section
          className="fixed bottom-0 right-0 z-[70] flex h-[100dvh] w-full animate-enter flex-col border-line bg-surface shadow-soft-lg sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[400px] sm:rounded-2xl sm:border"
          aria-label="Chat de agentes"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Bot size={18} className="text-brand-500" aria-hidden />
            <h2 className="flex-1 font-display text-sm font-semibold text-ink">Agentes IA</h2>
            <button
              type="button"
              onClick={reiniciar}
              disabled={enviando}
              className="rounded-lg p-1.5 text-sub transition hover:bg-surface2 hover:text-ink disabled:opacity-50"
              title="Nueva conversación"
              aria-label="Nueva conversación"
            >
              <RotateCcw size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg p-1.5 text-sub transition hover:bg-surface2 hover:text-ink"
              title="Cerrar"
              aria-label="Cerrar chat"
            >
              <X size={18} aria-hidden />
            </button>
          </header>

          <nav className="flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2" aria-label="Elegir agente">
            {agentes.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgente(a.id)}
                aria-pressed={a.id === agente}
                className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-medium transition ${
                  a.id === agente
                    ? 'border-brand-500/60 bg-brand-600/15 text-ink'
                    : 'border-line text-sub hover:border-line2 hover:text-ink'
                }`}
              >
                {a.nombre}
              </button>
            ))}
          </nav>

          <div ref={listaRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {!actuales.length && (
              <p className="mt-8 text-center text-sm text-sub">{info?.descripcion ?? 'Escribí tu consulta.'}</p>
            )}
            {actuales.map((m, i) => (
              <div
                key={i}
                className={`max-w-[90%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm ${
                  m.rol === 'user'
                    ? 'ml-auto bg-brand-600 text-white'
                    : m.rol === 'error'
                      ? 'border border-red-500/40 bg-red-500/10 text-red-400'
                      : 'border border-line bg-surface2 text-ink'
                }`}
              >
                {m.texto}
                {!!m.herramientas?.length && (
                  <p className="mt-1.5 text-[11px] text-sub">Consultó: {m.herramientas.join(', ')}</p>
                )}
                {m.acciones?.map((a) => <TarjetaAccion key={a.id} accion={a} />)}
              </div>
            ))}
            {enviando && (
              <p className="flex items-center gap-2 text-xs text-sub">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Pensando… puede tardar hasta un minuto
              </p>
            )}
          </div>

          <form onSubmit={enviar} className="flex gap-2 border-t border-line p-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
              rows={1}
              placeholder="Escribí un mensaje…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-sub focus:border-brand-500/60"
            />
            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="btn-press flex w-10 items-center justify-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-50"
              aria-label="Enviar"
            >
              <Send size={16} aria-hidden />
            </button>
          </form>
        </section>
      )}
    </>
  )
}

/** Cambio propuesto por el agente de soporte: no se aplica hasta tocar Confirmar */
function TarjetaAccion({ accion }: { accion: AccionPropuesta }) {
  const [estado, setEstado] = useState<'pendiente' | 'aplicando' | 'hecha' | 'cancelada' | 'error'>('pendiente')
  const [resultado, setResultado] = useState('')
  const [secreto, setSecreto] = useState('')

  async function confirmar() {
    setEstado('aplicando')
    try {
      const r = await confirmarAccion(accion.id)
      setResultado(r.mensaje)
      setSecreto(r.secreto ?? '')
      setEstado('hecha')
    } catch (err) {
      setResultado((err as Error).message)
      setEstado('error')
    }
  }

  async function cancelar() {
    setEstado('cancelada')
    await cancelarAccion(accion.id).catch(() => {})
  }

  return (
    <div className="mt-2 whitespace-normal rounded-lg border border-amber-500/50 bg-paper p-2.5">
      <p className="flex items-start gap-1.5 text-[13px] font-semibold text-ink">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
        {accion.titulo}
      </p>
      <p className="mt-1 text-xs text-sub">{accion.detalle}</p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-sub">
            <th className="pr-2 font-medium">Dato</th>
            <th className="pr-2 font-medium">Ahora</th>
            <th className="font-medium">Quedaría</th>
          </tr>
        </thead>
        <tbody>
          {accion.cambios.map((c) => (
            <tr key={c.campo} className="align-top">
              <td className="pr-2 text-sub">{c.campo}</td>
              <td className="pr-2">{String(c.antes ?? '')}</td>
              <td className="font-medium">{String(c.despues ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(estado === 'pendiente' || estado === 'aplicando') && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={confirmar}
            disabled={estado === 'aplicando'}
            className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {estado === 'aplicando' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} aria-hidden />}
            Confirmar
          </button>
          <button
            type="button"
            onClick={cancelar}
            disabled={estado === 'aplicando'}
            className="rounded-lg border border-line px-3 py-1 text-xs text-sub transition hover:text-ink disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      )}
      {estado === 'hecha' && (
        <p className="mt-2 text-xs text-green-500">
          ✔ {resultado}
          {secreto && (
            <>
              <br />
              Contraseña temporal: <span className="select-all rounded bg-surface2 px-1.5 py-0.5 font-mono text-sm text-ink">{secreto}</span>
              <br />
              <span className="text-sub">Se muestra una sola vez: pasásela al usuario y pedile que la cambie.</span>
            </>
          )}
        </p>
      )}
      {estado === 'error' && <p className="mt-2 text-xs text-red-400">✖ {resultado}</p>}
      {estado === 'cancelada' && <p className="mt-2 text-xs text-sub">Cancelada. No se cambió nada.</p>}
    </div>
  )
}
