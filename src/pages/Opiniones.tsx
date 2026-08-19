import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode, Copy, Check, MessageSquare, ChevronDown, Trash2, ArrowDownUp, Printer, MapPin, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import StarRating from '@/components/StarRating'
import { buildLabelHtml, QR_LABEL_DEFAULT, type QrLabelConfig } from '@/components/QrEtiqueta'
import type { Encuesta, Pregunta, Sector } from '@/types/encuestas'

interface Local {
  codigo: string
  nombre: string
}
interface Respuesta {
  id: string
  local: string | null
  sector_id: string | null
  qr_token: string | null
  created_at: string
}
interface Item {
  respuesta_id: string
  pregunta_id: string
  tipo: string
  estrellas: number | null
  valor: number | null
  valor_texto: string | null
  detalle: string | null
}

const PAGE = 1000

async function cargarTodo<T>(build: (desde: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = []
  for (let desde = 0; ; desde += PAGE) {
    const { data, error } = await build(desde)
    if (error || !data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

function prom(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

export default function Opiniones() {
  const { can } = useAuth()
  const puedeBorrar = can('opiniones.borrar')
  const [encuestas, setEncuestas] = useState<Encuesta[]>([])
  const [encuestaId, setEncuestaId] = useState<string>('')
  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [respuestas, setRespuestas] = useState<Respuesta[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [locales, setLocales] = useState<Local[]>([])
  const [sectores, setSectores] = useState<Sector[]>([])
  const [cargando, setCargando] = useState(true)
  const [cargandoDatos, setCargandoDatos] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [orden, setOrden] = useState<'desc' | 'asc'>('desc')
  const [qrCfg, setQrCfg] = useState<QrLabelConfig>(QR_LABEL_DEFAULT)

  // Carga inicial: locales + lista de encuestas
  useEffect(() => {
    if (!supabase) return
    ;(async () => {
      const [{ data: locs }, { data: encs }, { data: sects }] = await Promise.all([
        supabase!.from('locales').select('codigo, nombre').order('nombre'),
        supabase!
          .from('encuestas')
          .select('id, nombre, descripcion, contexto, publica, estado, version, created_at, updated_at')
          .order('created_at'),
        supabase!.from('sectores').select('*').order('local').order('orden').order('nombre'),
      ])
      setLocales((locs as Local[]) ?? [])
      setSectores((sects as Sector[]) ?? [])
      const lista = (encs as Encuesta[]) ?? []
      setEncuestas(lista)
      // Diseño de la etiqueta del QR (si está configurado)
      supabase!
        .from('config_app')
        .select('valor')
        .eq('clave', 'qr_etiqueta')
        .maybeSingle()
        .then(({ data }) => {
          if (data?.valor) setQrCfg({ ...QR_LABEL_DEFAULT, ...(data.valor as Partial<QrLabelConfig>) })
        })
      const def = lista.find((e) => e.publica && e.contexto === 'local') ?? lista[0]
      setEncuestaId(def?.id ?? '')
      setCargando(false)
    })()
  }, [])

  // Al cambiar de encuesta: preguntas + respuestas + items
  useEffect(() => {
    if (!supabase || !encuestaId) return
    ;(async () => {
      setCargandoDatos(true)
      const { data: preg } = await supabase!
        .from('encuesta_preguntas')
        .select('id, encuesta_id, orden, texto, ayuda, tipo, obligatoria, estado, config, version, created_at, updated_at')
        .eq('encuesta_id', encuestaId)
        .order('orden')

      const resp = await cargarTodo<Respuesta>((desde) =>
        supabase!
          .from('encuesta_respuestas')
          .select('id, local, sector_id, qr_token, created_at')
          .eq('encuesta_id', encuestaId)
          .order('created_at', { ascending: false })
          .range(desde, desde + PAGE - 1),
      )
      const ids = resp.map((r) => r.id)
      let its: Item[] = []
      if (ids.length) {
        // items en tandas por si hay muchas respuestas
        for (let i = 0; i < ids.length; i += 200) {
          const trozo = ids.slice(i, i + 200)
          const parte = await cargarTodo<Item>((desde) =>
            supabase!
              .from('encuesta_respuesta_items')
              .select('respuesta_id, pregunta_id, tipo, estrellas, valor, valor_texto, detalle')
              .in('respuesta_id', trozo)
              .range(desde, desde + PAGE - 1),
          )
          its = its.concat(parte)
        }
      }
      setPreguntas((preg as Pregunta[]) ?? [])
      setRespuestas(resp)
      setItems(its)
      setCargandoDatos(false)
    })()
  }, [encuestaId])

  const nombrePorCodigo = useMemo(() => {
    const m = new Map<string, string>()
    locales.forEach((l) => m.set(l.codigo, l.nombre))
    return m
  }, [locales])

  // max valor por pregunta de estrellas (para puntuación porcentual)
  const maxValorPreg = useMemo(() => {
    const m = new Map<string, number>()
    preguntas.forEach((p) => {
      if (p.tipo !== 'estrellas') return
      const vals = p.config.valores ?? []
      const max = vals.length ? Math.max(...vals.map((v) => v.valor)) : p.config.max ?? 5
      m.set(p.id, max)
    })
    return m
  }, [preguntas])

  const esEstrella = useMemo(() => {
    const m = new Map<string, boolean>()
    preguntas.forEach((p) => m.set(p.id, p.tipo === 'estrellas'))
    return m
  }, [preguntas])

  // Promedio general de estrellas + puntuación %
  const global = useMemo(() => {
    const est = items.filter((i) => esEstrella.get(i.pregunta_id) && i.estrellas != null)
    const promEstrellas = prom(est.map((i) => Number(i.estrellas)))
    let sumV = 0
    let sumMax = 0
    est.forEach((i) => {
      sumV += Number(i.valor ?? 0)
      sumMax += maxValorPreg.get(i.pregunta_id) ?? 0
    })
    const pct = sumMax ? (sumV / sumMax) * 100 : 0
    return { promEstrellas, pct, totalRespuestas: respuestas.length }
  }, [items, esEstrella, maxValorPreg, respuestas])

  // Resumen por local
  const respPorLocal = useMemo(() => {
    const m = new Map<string, Set<string>>()
    respuestas.forEach((r) => {
      const k = r.local ?? '—'
      if (!m.has(k)) m.set(k, new Set())
      m.get(k)!.add(r.id)
    })
    return m
  }, [respuestas])

  const sectorPorId = useMemo(() => {
    const m = new Map<string, Sector>()
    sectores.forEach((s) => m.set(s.id, s))
    return m
  }, [sectores])

  const sectoresPorLocal = useMemo(() => {
    const m = new Map<string, Sector[]>()
    sectores.forEach((s) => {
      const arr = m.get(s.local) ?? []
      arr.push(s)
      m.set(s.local, arr)
    })
    return m
  }, [sectores])

  const resumenLocales = useMemo(() => {
    const itemsByResp = new Map<string, Item[]>()
    items.forEach((i) => {
      const a = itemsByResp.get(i.respuesta_id) ?? []
      a.push(i)
      itemsByResp.set(i.respuesta_id, a)
    })
    const codigos = new Set<string>([...locales.map((l) => l.codigo), ...respPorLocal.keys()])
    return [...codigos]
      .filter((c) => c !== '—')
      .map((codigo) => {
        const respIds = respPorLocal.get(codigo) ?? new Set()
        const estrellasLocal: number[] = []
        const submissions: {
          id: string
          fecha: string
          estrellas: number | null
          textos: string[]
          sector: string | null
        }[] = []
        respuestas
          .filter((r) => respIds.has(r.id))
          .forEach((r) => {
            const its = itemsByResp.get(r.id) ?? []
            const est = its
              .filter((i) => esEstrella.get(i.pregunta_id) && i.estrellas != null)
              .map((i) => Number(i.estrellas))
            est.forEach((e) => estrellasLocal.push(e))
            const textos: string[] = []
            its.forEach((i) => {
              if (i.tipo === 'texto' && i.valor_texto) textos.push(i.valor_texto)
              if (i.tipo === 'si_no' && i.detalle) textos.push(`“No”: ${i.detalle}`)
            })
            const sec = r.sector_id ? sectorPorId.get(r.sector_id) : null
            submissions.push({
              id: r.id,
              fecha: r.created_at,
              estrellas: est.length ? prom(est) : null,
              textos,
              sector: sec?.nombre ?? null,
            })
          })
        submissions.sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
        return {
          codigo,
          nombre: nombrePorCodigo.get(codigo) ?? codigo,
          total: respIds.size,
          prom: prom(estrellasLocal),
          sectores: sectoresPorLocal.get(codigo) ?? [],
          submissions,
        }
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [locales, respPorLocal, items, esEstrella, respuestas, nombrePorCodigo, sectorPorId, sectoresPorLocal])

  async function borrarOpinion(id: string) {
    if (!supabase) return
    if (!confirm('¿Borrar esta opinión? No se puede deshacer.')) return
    const { error } = await supabase.from('encuesta_respuestas').delete().eq('id', id)
    if (error) return
    setRespuestas((rs) => rs.filter((r) => r.id !== id))
    setItems((its) => its.filter((i) => i.respuesta_id !== id))
  }

  const encuestaSel = encuestas.find((e) => e.id === encuestaId)
  const maxEstrellas = useMemo(() => {
    const p = preguntas.find((q) => q.tipo === 'estrellas')
    return p?.config.max ?? 5
  }, [preguntas])

  // Datos del gráfico: locales con respuestas, ordenados por promedio
  const datosGrafico = useMemo(() => {
    return resumenLocales
      .filter((r) => r.total > 0)
      .sort((a, b) => (orden === 'asc' ? a.prom - b.prom : b.prom - a.prom))
  }, [resumenLocales, orden])

  function linkPublico(codigo: string) {
    return `${window.location.origin}/opinar/${encodeURIComponent(codigo)}`
  }
  /** Imprime la etiqueta leyendo SIEMPRE el diseño más reciente guardado. */
  function imprimir(nombre: string, url: string) {
    const w = window.open('', '_blank', 'width=480,height=680')
    if (!w) return
    w.document.write('<p style="font-family:Arial,sans-serif;padding:16px;color:#333">Generando etiqueta…</p>')
    ;(async () => {
      let cfg = qrCfg
      if (supabase) {
        const { data } = await supabase.from('config_app').select('valor').eq('clave', 'qr_etiqueta').maybeSingle()
        if (data?.valor) {
          cfg = { ...QR_LABEL_DEFAULT, ...(data.valor as Partial<QrLabelConfig>) }
          setQrCfg(cfg)
        }
      }
      w.document.open()
      w.document.write(buildLabelHtml(cfg, nombre, url))
      w.document.close()
    })()
  }
  async function copiar(codigo: string) {
    try {
      await navigator.clipboard.writeText(linkPublico(codigo))
      setCopiado(codigo)
      setTimeout(() => setCopiado((c) => (c === codigo ? null : c)), 1800)
    } catch {
      /* ignore */
    }
  }
  function fecha(iso: string) {
    return iso
      ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : ''
  }

  return (
    <Layout>
      <BackButton />

      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Opiniones</h1>
          <p className="mt-1 text-sm text-sub">Resultados de encuestas por local. Compartí el enlace o el QR.</p>
        </div>
        {encuestas.length > 1 && (
          <select
            value={encuestaId}
            onChange={(e) => {
              setEncuestaId(e.target.value)
              setAbierto(null)
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
          >
            {encuestas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
      </header>

      {cargando ? (
        <p className="text-sm text-sub">Cargando…</p>
      ) : !encuestaSel ? (
        <p className="text-sm text-sub">No hay encuestas creadas todavía.</p>
      ) : (
        <>
          {/* Resumen global */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="font-display text-3xl font-bold text-ink">
                  {global.promEstrellas ? global.promEstrellas.toFixed(1) : '—'}
                </span>
                <StarRating value={global.promEstrellas} max={maxEstrellas} readOnly size={18} />
              </div>
              <p className="mt-0.5 text-xs text-sub">Promedio de estrellas</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <span className="font-display text-3xl font-bold text-ink">
                {global.pct ? `${global.pct.toFixed(0)}%` : '—'}
              </span>
              <p className="mt-0.5 text-xs text-sub">Puntuación porcentual</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <span className="font-display text-3xl font-bold text-ink">{global.totalRespuestas}</span>
              <p className="mt-0.5 text-xs text-sub">Respuestas totales</p>
            </div>
          </div>

          {/* Gráfico de barras: promedio por local */}
          {datosGrafico.length > 0 && (
            <div className="mb-6 rounded-2xl border border-line bg-surface p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">Promedio por local</h2>
                <button
                  onClick={() => setOrden((o) => (o === 'desc' ? 'asc' : 'desc'))}
                  className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-sub hover:text-ink"
                >
                  <ArrowDownUp size={14} aria-hidden />
                  {orden === 'desc' ? 'Mayor a menor' : 'Menor a mayor'}
                </button>
              </div>
              <div className="space-y-2.5">
                {datosGrafico.map((r) => {
                  const pct = maxEstrellas ? (r.prom / maxEstrellas) * 100 : 0
                  return (
                    <div key={r.codigo} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-sm text-ink sm:w-40" title={r.nombre}>
                        {r.nombre}
                      </span>
                      <div className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-surface2">
                        <div
                          className="flex h-full items-center justify-end rounded-md bg-amber-400 px-2 transition-all"
                          style={{ width: `${Math.max(pct, 6)}%` }}
                        >
                          <span className="text-xs font-semibold text-black/80">{r.prom.toFixed(1)}</span>
                        </div>
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs text-sub">{r.total}</span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-sub">Promedio de estrellas (sobre {maxEstrellas}) · el número de la derecha es la cantidad de respuestas.</p>
            </div>
          )}

          {cargandoDatos && <p className="mb-3 text-xs text-sub">Actualizando datos…</p>}

          {/* Por local */}
          <h2 className="mb-2 text-sm font-semibold text-ink">Por local</h2>
          <div className="space-y-2">
            {resumenLocales.map((r) => {
              const open = abierto === r.codigo
              return (
                <div key={r.codigo} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  <div className="flex items-center gap-3 p-3">
                    <button onClick={() => setAbierto(open ? null : r.codigo)} className="flex flex-1 items-center gap-3 text-left">
                      <ChevronDown size={16} aria-hidden className={`shrink-0 text-sub transition-transform ${open ? 'rotate-180' : ''}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{r.nombre}</span>
                        <span className="text-xs text-sub">
                          {r.total ? `${r.total} respuesta${r.total === 1 ? '' : 's'}` : 'Sin respuestas'}
                          {r.sectores.length > 0 && (
                            <> · {r.sectores.length} sector{r.sectores.length === 1 ? '' : 'es'}</>
                          )}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-display text-lg font-semibold text-ink">{r.total ? r.prom.toFixed(1) : '—'}</span>
                        <StarRating value={r.prom} max={maxEstrellas} readOnly size={15} />
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Link
                        to="/sectores-qr"
                        title="Administrar sectores y QR únicos por sector"
                        className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink"
                      >
                        <Settings size={15} aria-hidden />
                      </Link>
                      <button onClick={() => copiar(r.codigo)} title="Copiar enlace por local (legacy)" className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink">
                        {copiado === r.codigo ? <Check size={15} className="text-emerald-400" aria-hidden /> : <Copy size={15} aria-hidden />}
                      </button>
                      <button onClick={() => setQr(qr === r.codigo ? null : r.codigo)} title="Ver QR por local (legacy)" className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink">
                        <QrCode size={15} aria-hidden />
                      </button>
                      <button onClick={() => imprimir(r.nombre, linkPublico(r.codigo))} title="Imprimir QR por local (legacy)" className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink">
                        <Printer size={15} aria-hidden />
                      </button>
                    </div>
                  </div>

                  {qr === r.codigo && (
                    <div className="flex flex-col items-center gap-2 border-t border-line bg-surface2 p-4">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(linkPublico(r.codigo))}`}
                        alt={`QR para opinar sobre ${r.nombre}`}
                        width={180}
                        height={180}
                        className="rounded-xl bg-white p-2"
                      />
                      <code className="max-w-full truncate text-xs text-sub">{linkPublico(r.codigo)}</code>
                    </div>
                  )}

                  {open && (
                    <div className="border-t border-line bg-surface2 p-3">
                      {r.submissions.length === 0 ? (
                        <p className="text-sm text-sub">Sin opiniones.</p>
                      ) : (
                        <ul className="space-y-2">
                          {r.submissions.map((s) => (
                            <li key={s.id} className="rounded-xl border border-line bg-surface p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  {s.sector && (
                                    <div className="mb-1 inline-flex items-center gap-1 rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] font-medium text-sub">
                                      <MapPin size={11} aria-hidden /> {s.sector}
                                    </div>
                                  )}
                                  {s.estrellas != null && (
                                    <div className="mb-1 flex items-center gap-2">
                                      <StarRating value={s.estrellas} max={maxEstrellas} readOnly size={14} />
                                      <span className="text-xs text-sub">{s.estrellas.toFixed(1)}</span>
                                    </div>
                                  )}
                                  {s.textos.map((t, i) => (
                                    <p key={i} className="flex items-start gap-1.5 text-sm text-ink">
                                      <MessageSquare size={14} className="mt-0.5 shrink-0 text-sub" aria-hidden />
                                      <span>{t}</span>
                                    </p>
                                  ))}
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="text-xs text-sub">{fecha(s.fecha)}</span>
                                  {puedeBorrar && (
                                    <button
                                      onClick={() => borrarOpinion(s.id)}
                                      title="Borrar opinión"
                                      className="btn-press rounded-lg border border-line p-1.5 text-sub hover:border-brand-600/40 hover:text-brand-400"
                                    >
                                      <Trash2 size={14} aria-hidden />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Layout>
  )
}
