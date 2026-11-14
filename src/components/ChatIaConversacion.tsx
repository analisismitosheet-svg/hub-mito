import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * Conversación del Chat IA (solo administradores), compartida por la burbuja flotante
 * (ChatIaFlotante, en Layout) y la pantalla Sistemas > Chat IA. La conversación vive en
 * memoria mientras la app está abierta (no se guarda historial) y es la misma en los dos lados.
 * La IA consulta los datos en /api/chat: OpenCode Go (Haiku 5.5) y, de respaldo, Ollama.
 */

export interface MensajeChatIa {
  role: 'user' | 'assistant'
  content: string
  proveedor?: 'opencode' | 'ollama'
  consultas?: string[]
  /** por qué no contestó OpenCode (cuando respondió Ollama) */
  aviso?: string
  /** tokens que consumió la pregunta (entrada + salida + caché) */
  tokens?: number
  error?: boolean
}

// ---------- estado compartido (memoria de la pestaña) ----------

let estado: { mensajes: MensajeChatIa[]; pensando: boolean } = { mensajes: [], pensando: false }
/** ID estable de la conversación (OpenCode Go lo pide en x-opencode-session); cambia con "Nueva conversación". */
let sesion = crypto.randomUUID()
const oyentes = new Set<() => void>()
function fijar(cambio: Partial<typeof estado>) {
  estado = { ...estado, ...cambio }
  oyentes.forEach((o) => o())
}
function suscribir(o: () => void) {
  oyentes.add(o)
  return () => oyentes.delete(o)
}
export function useChatIa() {
  return useSyncExternalStore(suscribir, () => estado)
}
export function reiniciarChatIa() {
  if (estado.pensando) return
  sesion = crypto.randomUUID()
  fijar({ mensajes: [] })
}

async function preguntar(q: string) {
  const historial: MensajeChatIa[] = [...estado.mensajes, { role: 'user', content: q }]
  fijar({ mensajes: historial, pensando: true })
  try {
    const { data } = await supabase!.auth.getSession()
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({
        sesion,
        mensajes: historial.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
      }),
    })
    const cuerpo = (await res.json().catch(() => null)) as
      | { respuesta?: string; proveedor?: 'opencode' | 'ollama'; consultas?: string[]; aviso?: string; tokens?: number; error?: string }
      | null
    if (!res.ok || !cuerpo?.respuesta) throw new Error(cuerpo?.error ?? `Error ${res.status}`)
    fijar({
      mensajes: [
        ...estado.mensajes,
        { role: 'assistant', content: cuerpo.respuesta, proveedor: cuerpo.proveedor, consultas: cuerpo.consultas, aviso: cuerpo.aviso, tokens: cuerpo.tokens },
      ],
    })
  } catch (err) {
    fijar({ mensajes: [...estado.mensajes, { role: 'assistant', content: (err as Error).message, error: true }] })
  } finally {
    fijar({ pensando: false })
  }
}

// ---------- textos ----------

const SUGERENCIAS = [
  '¿Cuánto vendió cada local ayer contra su objetivo?',
  '¿Qué locales tuvieron más entradas de clientes esta semana?',
  '¿Cómo viene la tasa de conversión de hoy?',
  '¿Cuál fue el artículo más vendido ayer?',
  '¿Cuánto stock hay del artículo …?',
  '¿Cuántos pedidos y cuánta plata entró por la tienda web esta semana?',
  '¿Qué pedidos de compra a proveedores tienen unidades pendientes de recibir?',
  '¿Qué órdenes de compra se cargaron este mes y por cuánto?',
  'Resumime los pedidos de venta mayoristas de los últimos 7 días.',
  '¿Qué transferencias entre locales se cargaron esta semana?',
]

const NOMBRE_CONSULTA: Record<string, string> = {
  listar_locales: 'locales',
  buscar_articulos: 'artículos',
  ventas_locales: 'ventas',
  ventas_por_articulo: 'ventas por artículo',
  contador_clientes: 'contador',
  contador_hoy: 'contador hoy',
  ventas_web: 'tienda web',
  pedidos_venta: 'pedidos de venta',
  estado_pedidos_compra: 'pedidos de compra',
  ordenes_compra: 'órdenes de compra',
  transferencias: 'transferencias',
}

// ---------- Markdown mínimo (negrita, listas, tablas), sin HTML crudo ----------

function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-surface2 px-1 text-[0.9em]">{p.slice(1, -1)}</code>
    return p
  })
}

const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

function Markdown({ texto }: { texto: string }) {
  const lineas = texto.split('\n')
  const bloques: ReactNode[] = []
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]
    if (/^\s*\|/.test(l) && i + 1 < lineas.length && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1])) {
      const cab = celdas(l)
      const filas: string[][] = []
      i += 2
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      bloques.push(
        <div key={bloques.length} className="my-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-left text-sub">
              <tr>{cab.map((c, j) => <th key={j} className="px-2 py-1.5 font-semibold">{enLinea(c)}</th>)}</tr>
            </thead>
            <tbody>
              {filas.map((f, k) => (
                <tr key={k} className="border-t border-line">
                  {f.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{enLinea(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const items: string[] = []
      while (i < lineas.length && /^\s*([-*•]|\d+\.)\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ''))
      bloques.push(
        <ul key={bloques.length} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((t, j) => <li key={j}>{enLinea(t)}</li>)}
        </ul>,
      )
      continue
    }
    if (/^#{1,4}\s/.test(l)) {
      bloques.push(<p key={bloques.length} className="mt-2 font-semibold">{enLinea(l.replace(/^#+\s/, ''))}</p>)
    } else if (l.trim()) {
      bloques.push(<p key={bloques.length} className="my-1">{enLinea(l)}</p>)
    }
    i++
  }
  return <>{bloques}</>
}

// ---------- dictado por voz (Web Speech API: Chrome, Edge y Safari) ----------

type Reconocedor = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

function crearReconocedorDisponible(): boolean {
  const w = window as unknown as Record<string, unknown>
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

function crearReconocedor(): Reconocedor | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconocedor; webkitSpeechRecognition?: new () => Reconocedor }
  const Clase = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Clase ? new Clase() : null
}

const ERRORES_VOZ: Record<string, string> = {
  'not-allowed': 'El navegador no dio permiso al micrófono.',
  'service-not-allowed': 'El navegador no dio permiso al micrófono.',
  'no-speech': 'No se escuchó nada. Probá de nuevo.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'El dictado necesita conexión a internet.',
}

// ---------- conversación ----------

/** Lista de mensajes + sugerencias + cuadro de texto. Ocupa todo el alto del contenedor. */
export default function ChatIaConversacion({ compacto = false }: { compacto?: boolean }) {
  const { mensajes, pensando } = useChatIa()
  const [texto, setTexto] = useState('')
  const listaRef = useRef<HTMLDivElement>(null)
  const entradaRef = useRef<HTMLTextAreaElement>(null)
  const reconocedorRef = useRef<Reconocedor | null>(null)
  const [escuchando, setEscuchando] = useState(false)
  const [avisoVoz, setAvisoVoz] = useState('')
  const hayVoz = typeof window !== 'undefined' && !!crearReconocedorDisponible()

  useEffect(() => () => reconocedorRef.current?.stop(), [])

  /** Escucha una pregunta; al terminar de hablar la manda sola. */
  function dictar() {
    if (escuchando) {
      reconocedorRef.current?.stop()
      return
    }
    const rec = crearReconocedor()
    if (!rec) return
    reconocedorRef.current = rec
    rec.lang = 'es-AR'
    rec.interimResults = true
    rec.continuous = false
    let final = ''
    rec.onresult = (e) => {
      let parcial = ''
      final = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) final += r[0].transcript
        else parcial += r[0].transcript
      }
      setTexto((final + parcial).trim())
    }
    rec.onerror = (e) => setAvisoVoz(ERRORES_VOZ[e.error] ?? `No se pudo usar el micrófono (${e.error}).`)
    rec.onend = () => {
      setEscuchando(false)
      reconocedorRef.current = null
      if (final.trim()) enviar(final)
    }
    setAvisoVoz('')
    setTexto('')
    setEscuchando(true)
    try {
      rec.start()
    } catch {
      setEscuchando(false)
    }
  }

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes.length, pensando])

  function enviar(pregunta: string) {
    const q = pregunta.trim()
    if (!q || pensando) return
    // La sugerencia con "…" se completa a mano: va al cuadro de texto, no se envía
    if (q.includes('…')) {
      setTexto(q.replace('…', ''))
      entradaRef.current?.focus()
      return
    }
    setTexto('')
    void preguntar(q)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listaRef} className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ${compacto ? 'p-3' : 'py-2'}`}>
        {mensajes.length === 0 && (
          <section className={compacto ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles size={16} className="text-amber-500" aria-hidden /> Probá con alguna de estas
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="btn-press rounded-full border border-line bg-surface2 px-3 py-1.5 text-left text-xs text-ink hover:bg-line"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${compacto ? '' : 'sm:max-w-[80%]'} ${
                m.role === 'user'
                  ? 'bg-violet-600 text-white'
                  : m.error
                    ? 'border border-rose-500/30 bg-rose-500/10 text-rose-500'
                    : 'border border-line bg-surface text-ink'
              }`}
            >
              {m.role === 'user' ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown texto={m.content} />}
              {m.role === 'assistant' && !m.error && (
                <p className="mt-2 text-[11px] text-sub/70">
                  {m.proveedor === 'ollama' ? 'Ollama (respaldo local)' : 'Claude Haiku'}
                  {m.consultas?.length
                    ? ` · consultó ${[...new Set(m.consultas)].map((c) => NOMBRE_CONSULTA[c] ?? c).join(', ')}`
                    : ''}
                  {m.tokens ? ` · ${m.tokens.toLocaleString('es-AR')} tokens` : ''}
                  {m.aviso ? ` · OpenCode no respondió: ${m.aviso}` : ''}
                </p>
              )}
            </div>
          </div>
        ))}

        {pensando && (
          <div className="flex items-center gap-2 text-sm text-sub">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Consultando los datos…
          </div>
        )}
      </div>

      {avisoVoz && <p className={`text-xs text-rose-500 ${compacto ? 'px-3' : ''}`}>{avisoVoz}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className={`flex items-end gap-2 border-t border-line ${compacto ? 'p-3' : 'pt-3'}`}
      >
        <textarea
          ref={entradaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar(texto)
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={escuchando ? 'Te escucho…' : 'Preguntá sobre stock, ventas, contador, pedidos…'}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-violet-500"
        />
        {hayVoz && (
          <button
            type="button"
            onClick={dictar}
            disabled={pensando}
            aria-label={escuchando ? 'Dejar de escuchar' : 'Preguntar hablando'}
            title={escuchando ? 'Dejar de escuchar' : 'Preguntar hablando'}
            className={`btn-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border disabled:opacity-40 ${
              escuchando ? 'animate-pulse border-rose-500 bg-rose-500 text-white' : 'border-line bg-surface2 text-ink hover:bg-line'
            }`}
          >
            {escuchando ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
          </button>
        )}
        <button
          type="submit"
          disabled={pensando || !texto.trim()}
          aria-label="Enviar"
          className="btn-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40"
        >
          <Send size={18} aria-hidden />
        </button>
      </form>
    </div>
  )
}
