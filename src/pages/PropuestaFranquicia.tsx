import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Loader2, Minus, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  /p/:token — lo que abre la franquicia desde el WhatsApp.            */
/*  Sin usuario: sólo ve su propuesta (RPC propuesta_franquicia_publica)*/
/*  y la confirma una vez (confirmar_propuesta_franquicia). No puede    */
/*  pedir más que el stock de MITO. Ver sql/franquicias_propuestas.sql. */
/* ------------------------------------------------------------------ */

interface ItemPub {
  id: number
  art: string
  descrip: string | null
  color: string | null
  talle: string | null
  sugerido: number
  vendido: number
  maximo: number
  precio: number | null
  elegido: boolean | null
  cantidad: number | null
}
interface PropuestaPub {
  numero: string
  franquicia: string
  cliente: string | null
  tipo: 'reposicion' | 'calzado' | null
  desde: string | null
  hasta: string | null
  vence_at: string
  vencida: boolean
  confirmada: boolean
  confirmada_at: string | null
  comentario: string | null
  items: ItemPub[]
}

const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const diaIso = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const fmtFecha = (iso: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso))

export default function PropuestaFranquicia() {
  const { token = '' } = useParams()
  const [prop, setProp] = useState<PropuestaPub | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // por ítem: true = sí, false = no, null = sin responder; y la cantidad
  const [si, setSi] = useState<Record<number, boolean | null>>({})
  const [cant, setCant] = useState<Record<number, number>>({})
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<{ unidades: number; total: number } | null>(null)

  useEffect(() => {
    if (!supabase) return
    void supabase.rpc('propuesta_franquicia_publica', { p_token: token }).then(({ data, error: e }) => {
      if (e) setError('No se pudo abrir la propuesta. Probá de nuevo en un rato.')
      else if (!data) setError('Este link no existe o ya no está disponible.')
      else {
        const p = data as PropuestaPub
        setProp(p)
        setSi(Object.fromEntries(p.items.map((i) => [i.id, p.confirmada ? Boolean(i.elegido) : null])))
        setCant(Object.fromEntries(p.items.map((i) => [i.id, p.confirmada ? (i.cantidad ?? 0) : Math.min(i.sugerido, i.maximo)])))
      }
      setCargando(false)
    })
  }, [token])

  const cerrado = Boolean(prop?.confirmada || prop?.vencida || hecho)
  const elegidos = useMemo(() => (prop?.items ?? []).filter((i) => si[i.id] === true && (cant[i.id] ?? 0) > 0), [prop, si, cant])
  const unidades = elegidos.reduce((s, i) => s + (cant[i.id] ?? 0), 0)
  const total = elegidos.reduce((s, i) => s + (cant[i.id] ?? 0) * (i.precio ?? 0), 0)
  const sinResponder = (prop?.items ?? []).filter((i) => si[i.id] == null).length

  function cambiar(i: ItemPub, delta: number) {
    if (cerrado) return
    setCant((c) => ({ ...c, [i.id]: Math.max(0, Math.min(i.maximo, (c[i.id] ?? 0) + delta)) }))
    setSi((s) => ({ ...s, [i.id]: s[i.id] === false ? false : true }))
  }
  function todos(valor: boolean) {
    if (!prop || cerrado) return
    setSi(Object.fromEntries(prop.items.map((i) => [i.id, valor])))
  }

  async function confirmar() {
    if (!supabase || !prop || cerrado) return
    if (sinResponder > 0 && !window.confirm(`Quedan ${sinResponder} artículo(s) sin marcar: se toman como "No". ¿Confirmás el pedido?`)) return
    setEnviando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('confirmar_propuesta_franquicia', {
      p_token: token,
      p_items: elegidos.map((i) => ({ id: i.id, cantidad: cant[i.id] ?? 0 })),
      p_comentario: comentario,
    })
    setEnviando(false)
    if (e) { setError(e.message || 'No se pudo confirmar el pedido.'); return }
    const r = data as { unidades: number; total: number }
    setHecho({ unidades: r.unidades, total: Number(r.total) || 0 })
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="bg-neutral-950 px-4 pb-4 pt-5 text-white">
        <div className="mx-auto max-w-xl">
          <p className="font-display text-xl font-black tracking-tight text-red-500">MITO</p>
          <h1 className="mt-1 text-lg font-bold">{prop?.tipo === 'calzado' ? 'Pedido de calzado' : 'Propuesta de reposición'}</h1>
          {prop && (
            <p className="text-xs text-white/70">
              {prop.cliente || prop.franquicia} · N° {prop.numero}
              {!prop.confirmada && !prop.vencida && ` · válida hasta el ${fmtFecha(prop.vence_at)}`}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-3 pb-32 pt-3">
        {cargando && <p className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Abriendo la propuesta…</p>}
        {!cargando && !prop && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {hecho && (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white"><Check size={32} aria-hidden /></div>
            <h2 className="text-lg font-bold">¡Pedido enviado!</h2>
            <p className="mt-1 text-sm text-neutral-600">MITO recibió tu pedido de la propuesta <b>{prop?.numero}</b>: {hecho.unidades} unidades{hecho.total ? ` · ${fmtPesos(hecho.total)}` : ''}.</p>
          </div>
        )}

        {prop && !hecho && (
          <>
            {prop.confirmada && (
              <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Este pedido ya fue confirmado{prop.confirmada_at ? ` el ${fmtFecha(prop.confirmada_at)}` : ''}. Así quedó:
              </p>
            )}
            {prop.vencida && (
              <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Esta propuesta venció. Pedile a MITO una nueva.</p>
            )}
            {!cerrado && (
              <>
                <p className="mb-2 text-xs text-neutral-600">
                  {prop.desde && prop.hasta && <>Según tu venta del <b>{diaIso(prop.desde)} al {diaIso(prop.hasta)}</b>. </>}
                  Marcá lo que querés que te enviemos. Podés cambiar las cantidades (hasta lo que hay en stock).
                </p>
                <div className="mb-3 flex gap-2">
                  <button type="button" onClick={() => todos(true)} className="flex-1 rounded-xl border border-neutral-300 bg-white py-2 text-xs font-bold text-neutral-700">✓ Quiero todo</button>
                  <button type="button" onClick={() => todos(false)} className="flex-1 rounded-xl border border-neutral-300 bg-white py-2 text-xs font-bold text-neutral-700">✕ Nada</button>
                </div>
              </>
            )}

            <ul className="flex flex-col gap-2">
              {prop.items.map((i) => {
                const v = si[i.id]
                const c = cant[i.id] ?? 0
                return (
                  <li key={i.id} className={`rounded-2xl border-[1.5px] p-3 transition ${v === true ? 'border-emerald-500 bg-emerald-50' : v === false ? 'border-neutral-200 bg-white opacity-50' : 'border-neutral-200 bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{i.art}</p>
                        <p className="truncate text-xs text-neutral-500">{i.descrip || '—'}</p>
                        <p className="mt-0.5 text-[11px] text-neutral-600">
                          Color {i.color || 'U'} · Talle {i.talle || '—'}{i.precio ? ` · ${fmtPesos(i.precio)} c/u` : ''}
                        </p>
                        <p className="mt-0.5 text-[12px] font-semibold text-neutral-800">
                          Venta cliente {i.vendido} · te proponemos {i.sugerido}
                        </p>
                      </div>
                      {v === true && i.precio ? <p className="shrink-0 text-sm font-bold tabular-nums">{fmtPesos(c * i.precio)}</p> : null}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="inline-flex overflow-hidden rounded-xl border border-neutral-300">
                        <button type="button" disabled={cerrado} onClick={() => setSi((s) => ({ ...s, [i.id]: true }))} className={`px-3 py-1.5 text-xs font-extrabold ${v === true ? 'bg-emerald-500 text-white' : 'bg-white text-neutral-600'}`}>Sí</button>
                        <button type="button" disabled={cerrado} onClick={() => setSi((s) => ({ ...s, [i.id]: false }))} className={`px-3 py-1.5 text-xs font-extrabold ${v === false ? 'bg-red-500 text-white' : 'bg-white text-neutral-600'}`}>No</button>
                      </span>
                      {v !== false && (
                        <span className="inline-flex items-center overflow-hidden rounded-xl border border-neutral-300 bg-white">
                          <button type="button" aria-label="Menos" disabled={cerrado || c <= 0} onClick={() => cambiar(i, -1)} className="grid h-8 w-8 place-items-center bg-neutral-100 disabled:opacity-40"><Minus size={14} aria-hidden /></button>
                          <span className="w-9 text-center text-sm font-black tabular-nums">{c}</span>
                          <button type="button" aria-label="Más" disabled={cerrado || c >= i.maximo} onClick={() => cambiar(i, 1)} className="grid h-8 w-8 place-items-center bg-neutral-100 disabled:opacity-40"><Plus size={14} aria-hidden /></button>
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            {!cerrado ? (
              <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario para MITO (opcional)" maxLength={500} className="mt-3 min-h-[60px] w-full rounded-xl border border-neutral-300 bg-white p-2 text-sm" />
            ) : prop.comentario ? (
              <p className="mt-3 text-xs text-neutral-600">Tu comentario: <b>{prop.comentario}</b></p>
            ) : null}
            {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </main>

      {prop && !hecho && (
        <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white px-3 py-3">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="flex-1 text-xs text-neutral-600">
              <b className="text-base text-neutral-900 tabular-nums">{unidades}</b> unidades · {elegidos.length} artículos
              {total > 0 && <><br /><b className="text-sm text-neutral-900 tabular-nums">{fmtPesos(total)}</b></>}
            </div>
            {!cerrado && (
              <button type="button" onClick={() => void confirmar()} disabled={enviando || unidades === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50">
                {enviando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Confirmar pedido
              </button>
            )}
            {cerrado && !prop.confirmada && <X size={18} className="text-neutral-400" aria-hidden />}
          </div>
        </div>
      )}
    </div>
  )
}
