import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, ExternalLink, Loader2, Lock, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  /oc/:token — lo que abre el autorizador desde el WhatsApp.          */
/*  Sin usuario: el token es de ese envío y la clave, del autorizador.  */
/*  Sin la clave no se ve ningún dato. Ver sql/ordenes_compra_link.sql. */
/* ------------------------------------------------------------------ */

interface ItemOc { articulo: string; descripcion?: string; color: string; talle: string; cantidad: number; precio: number }
interface OcPublica {
  nombre: string | null
  numero: number
  tipo: string
  proveedor: string
  monto: number | null
  observacion: string | null
  cargo: string | null
  area: string | null
  forma_pago: string | null
  plazo: string | null
  fecha_entrega: string | null
  archivo_url: string | null
  items: ItemOc[]
  autorizada_por: string | null
  autorizada_at: string | null
  cancelada_por: string | null
  cancelada_at: string | null
  no_autorizada: boolean
}

interface Inicio { nombre: string | null; tiene_clave: boolean; bloqueada: boolean }
type Resultado = { oc: OcPublica; error?: undefined } | { oc?: undefined; error: 'link' | 'sin_clave' | 'bloqueada' | 'clave'; restantes?: number | null }

const BLOQUEADA = 'Tu clave quedó bloqueada por demasiados intentos. Pedile al administrador que la desbloquee.'
const SIN_CLAVE = 'Todavía no tenés clave. Pedile al administrador que te cargue una.'

const pesos = (n: number | null) => n == null ? 'Sin monto' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fechaHora = (iso: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso))

function Dato({ titulo, valor }: { titulo: string; valor: string | null | undefined }) {
  if (!valor) return null
  return <div className="flex justify-between gap-4 border-t border-neutral-100 py-2 text-sm"><span className="text-neutral-500">{titulo}</span><span className="text-right font-medium">{valor}</span></div>
}

export default function AutorizarOc() {
  const { token = '' } = useParams()
  const [inicio, setInicio] = useState<Inicio | null>(null)
  const [clave, setClave] = useState('')
  const [oc, setOc] = useState<OcPublica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eleccion, setEleccion] = useState<'si' | 'no' | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.rpc('oc_link_inicio', { p_token: token }).then(({ data, error: e }) => {
      if (e) setError('No se pudo abrir la orden. Probá de nuevo en un rato.')
      else if (!data) setError('Este link no existe o ya no está disponible.')
      else setInicio(data as Inicio)
      setCargando(false)
    })
  }, [token])

  /** Lo que devuelve la base cuando la clave no pasa: vuelve a la pantalla de la clave. */
  function aplicar(r: Resultado) {
    if (r.oc) { setOc(r.oc); return }
    setOc(null)
    setClave('')
    if (r.error === 'clave') setError(`Clave incorrecta. Te quedan ${r.restantes} ${r.restantes === 1 ? 'intento' : 'intentos'}.`)
    else if (r.error === 'bloqueada') setError(BLOQUEADA)
    else if (r.error === 'sin_clave') setError(SIN_CLAVE)
    else setError('Este link no existe o ya no está disponible.')
  }

  async function abrir(ev: React.FormEvent) {
    ev.preventDefault()
    if (!supabase || !clave) return
    setEnviando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('oc_link_abrir', { p_token: token, p_clave: clave })
    setEnviando(false)
    if (e) { setError('No se pudo abrir la orden. Probá de nuevo en un rato.'); return }
    aplicar(data as Resultado)
  }

  async function responder() {
    if (!supabase || !eleccion) return
    setEnviando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('oc_link_responder', { p_token: token, p_clave: clave, p_autoriza: eleccion === 'si', p_motivo: motivo })
    setEnviando(false)
    if (e) { setError('No se pudo guardar la respuesta. Probá de nuevo.'); return }
    aplicar(data as Resultado)
  }

  const resuelta = Boolean(oc?.autorizada_at || oc?.cancelada_at)

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="bg-neutral-950 px-4 pb-4 pt-5 text-white">
        <div className="mx-auto max-w-xl">
          <p className="font-display text-xl font-black tracking-tight text-red-500">MITO</p>
          <h1 className="mt-1 text-lg font-bold">Orden de compra para autorizar</h1>
          {oc && <p className="text-xs text-white/70">OC N° {oc.numero} · {oc.tipo}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-3 pb-10 pt-3">
        {cargando && <p className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" aria-hidden /> Abriendo la orden…</p>}
        {!cargando && !inicio && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {inicio && !oc && (
          <form onSubmit={(ev) => void abrir(ev)} className="mx-auto mt-6 max-w-sm rounded-2xl bg-white p-5 text-center shadow-sm">
            <Lock size={26} aria-hidden className="mx-auto text-neutral-500" />
            <p className="mt-2 text-base font-bold">{inicio.nombre ? `Hola ${inicio.nombre}` : 'Hola'}</p>
            {!inicio.tiene_clave || inicio.bloqueada ? (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{inicio.bloqueada ? BLOQUEADA : SIN_CLAVE}</p>
            ) : error === BLOQUEADA ? (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{BLOQUEADA}</p>
            ) : (
              <>
                <label htmlFor="clave-oc" className="mb-3 block text-sm text-neutral-600">Ingresá tu clave para ver la orden</label>
                <input id="clave-oc" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={clave}
                  onChange={(e) => setClave(e.target.value.replace(/\D/g, ''))}
                  className="mb-3 h-12 w-full rounded-xl border border-neutral-300 text-center text-xl tracking-widest outline-none" />
                {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
                <button disabled={enviando || !clave} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 font-bold text-white disabled:opacity-50">
                  {enviando && <Loader2 size={16} className="animate-spin" aria-hidden />} Entrar
                </button>
              </>
            )}
          </form>
        )}

        {oc && (
          <>
            {oc.autorizada_at && (
              <p className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                <Check size={18} aria-hidden className="shrink-0" /> Autorizada por {oc.autorizada_por} · {fechaHora(oc.autorizada_at)}
              </p>
            )}
            {oc.cancelada_at && (
              <p className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
                <X size={18} aria-hidden className="shrink-0" /> {oc.no_autorizada ? 'No autorizada' : 'Cancelada'} por {oc.cancelada_por} · {fechaHora(oc.cancelada_at)}
              </p>
            )}

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              {!resuelta && oc.nombre && <p className="mb-2 text-sm text-neutral-600">Hola {oc.nombre}, revisá la orden y respondé abajo.</p>}
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Monto bruto</p>
              <p className="mb-1 text-3xl font-black tabular-nums">{pesos(oc.monto)}</p>
              <p className="mb-3 text-base font-bold">{oc.proveedor}</p>
              <Dato titulo="Qué es" valor={oc.observacion} />
              <Dato titulo="Cargó" valor={oc.cargo} />
              <Dato titulo="Área" valor={oc.area} />
              <Dato titulo="Pago" valor={[oc.forma_pago, oc.plazo].filter(Boolean).join(' · ')} />
              <Dato titulo="Entrega" valor={oc.fecha_entrega?.split('-').reverse().join('/')} />
              {oc.archivo_url && /^https?:\/\//i.test(oc.archivo_url) && (
                <a href={oc.archivo_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 underline">
                  Ver presupuesto <ExternalLink size={14} aria-hidden />
                </a>
              )}
            </section>

            {oc.items.length > 0 && (
              <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
                <p className="mb-1 text-sm font-bold">Artículos ({oc.items.length})</p>
                <ul className="max-h-72 overflow-auto text-sm">
                  {oc.items.map((i, n) => (
                    <li key={n} className="flex justify-between gap-3 border-t border-neutral-100 py-1.5">
                      <span>{i.articulo} {i.color} {i.talle}{i.descripcion && <span className="block text-xs text-neutral-500">{i.descripcion}</span>}</span>
                      <span className="shrink-0 text-right tabular-nums">{i.cantidad} u.<span className="block text-xs text-neutral-500">{pesos(i.precio)}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            {!resuelta && !eleccion && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button onClick={() => setEleccion('no')} className="h-12 rounded-xl border border-red-300 bg-white font-bold text-red-700">No autorizar</button>
                <button onClick={() => setEleccion('si')} className="h-12 rounded-xl bg-emerald-600 font-bold text-white">Autorizar</button>
              </div>
            )}
            {!resuelta && eleccion && (
              <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
                <p className="mb-3 font-bold">{eleccion === 'si' ? `¿Autorizás la OC N° ${oc.numero} por ${pesos(oc.monto)}?` : `¿No autorizás la OC N° ${oc.numero}?`}</p>
                {eleccion === 'no' && (
                  <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Motivo (opcional)"
                    className="mb-3 min-h-[70px] w-full rounded-xl border border-neutral-300 p-2.5 text-sm outline-none" />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button disabled={enviando} onClick={() => setEleccion(null)} className="h-12 rounded-xl border border-neutral-300 font-semibold">Volver</button>
                  <button disabled={enviando} onClick={() => void responder()}
                    className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl font-bold text-white disabled:opacity-60 ${eleccion === 'si' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                    {enviando && <Loader2 size={16} className="animate-spin" aria-hidden />} Confirmar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
