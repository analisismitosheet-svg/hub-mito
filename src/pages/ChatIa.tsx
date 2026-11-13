import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

/**
 * Sistemas > Chat IA (solo administradores).
 * Pregunta en lenguaje natural sobre stock, ventas, contador, pedidos, OC y transferencias.
 * La IA consulta los datos con herramientas de solo lectura en /api/chat (OpenCode Go con
 * Haiku 5.5 y, si no responde o se agotó el cupo, Ollama del mito-server).
 * No se guarda historial: la conversación vive solo mientras la pantalla está abierta.
 */

interface Mensaje {
  role: 'user' | 'assistant'
  content: string
  proveedor?: 'opencode' | 'ollama'
  consultas?: string[]
  error?: boolean
}

const SUGERENCIAS = [
  '¿Cuánto vendió cada local ayer contra su objetivo?',
  '¿Qué locales tuvieron más entradas de clientes esta semana?',
  '¿Cómo viene la tasa de conversión de hoy?',
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

// ---------- pantalla ----------

export default function ChatIa() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)
  const entradaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes, pensando])

  async function enviar(pregunta: string) {
    const q = pregunta.trim()
    if (!q || pensando) return
    // La sugerencia con "…" se completa a mano: va al cuadro de texto, no se envía
    if (q.includes('…')) {
      setTexto(q.replace('…', ''))
      entradaRef.current?.focus()
      return
    }
    const historial: Mensaje[] = [...mensajes, { role: 'user', content: q }]
    setMensajes(historial)
    setTexto('')
    setPensando(true)
    try {
      const { data } = await supabase!.auth.getSession()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          mensajes: historial.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const cuerpo = (await res.json().catch(() => null)) as
        | { respuesta?: string; proveedor?: 'opencode' | 'ollama'; consultas?: string[]; error?: string }
        | null
      if (!res.ok || !cuerpo?.respuesta) throw new Error(cuerpo?.error ?? `Error ${res.status}`)
      setMensajes((m) => [
        ...m,
        { role: 'assistant', content: cuerpo.respuesta!, proveedor: cuerpo.proveedor, consultas: cuerpo.consultas },
      ])
    } catch (err) {
      setMensajes((m) => [...m, { role: 'assistant', content: (err as Error).message, error: true }])
    } finally {
      setPensando(false)
    }
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Bot size={22} className="text-violet-500" aria-hidden /> Chat IA
        </h1>
        <span className="text-xs text-sub/70">Consultas de solo lectura · no se guarda el historial</span>
        {mensajes.length > 0 && (
          <button
            type="button"
            onClick={() => setMensajes([])}
            className="btn-press ml-auto inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line"
          >
            <RotateCcw size={13} aria-hidden /> Nueva conversación
          </button>
        )}
      </header>

      <div className="flex min-h-[55vh] flex-col gap-3 pb-40">
        {mensajes.length === 0 && (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <Sparkles size={16} className="text-amber-500" aria-hidden /> Probá con alguna de estas
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void enviar(s)}
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
              className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[80%] ${
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
        <div ref={finRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(texto)
        }}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={entradaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void enviar(texto)
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Preguntá sobre stock, ventas, contador, pedidos…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={pensando || !texto.trim()}
            aria-label="Enviar"
            className="btn-press inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40"
          >
            <Send size={18} aria-hidden />
          </button>
        </div>
      </form>
    </Layout>
  )
}
