import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Camera, CameraOff, Check, ChevronDown, ChevronRight, Layers, Loader2, MapPin, Package,
  QrCode, RotateCcw, Search, Trash2,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { leerPosicion, parsearBulto, posicionValida, type RespuestaBulto, type BultoParseado } from '@/lib/poloMapeo'

type Bulto = {
  id: string
  posicion: string
  bulto: string
  origen: string
  nro: string
  remitos: string[]
  bulto_n: number | null
  bultos_total: number | null
  unidades: number
  escaneado_at: string
}
type Item = {
  bulto_id: string
  remito: string | null
  articulo: string
  descripcion: string | null
  color: string | null
  color_nombre: string | null
  talle: string | null
  cantidad: number
}
type Mensaje = { ok: boolean; texto: string; detalle?: string }

const inputCls =
  'h-12 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

async function pedirBulto(codigo: string): Promise<RespuestaBulto & { bulto: BultoParseado }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch(`/api/sql/polo-bulto?${new URLSearchParams({ codigo })}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as (RespuestaBulto & { bulto: BultoParseado }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} buscando el bulto`)
  return body
}

/** Lee todas las filas de una tabla de a 1000 (tope de Supabase por pedido) */
async function todas<T>(tabla: string, columnas: string): Promise<T[]> {
  if (!supabase) return []
  const out: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from(tabla).select(columnas).range(desde, desde + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

/** Polo 52 · Mapeo de bultos: escanear la posición y los bultos que se dejan ahí */
export default function PoloMapeo() {
  const { isAdmin, can } = useAuth()
  const puedeEscanear = isAdmin || can('polo52.mapeo.escanear')
  const puedeGestionar = isAdmin || can('polo52.mapeo.gestionar')

  const [posiciones, setPosiciones] = useState<string[]>([])
  const [bultos, setBultos] = useState<Bulto[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [posicion, setPosicion] = useState<string | null>(null)
  const posRef = useRef<string | null>(null)
  posRef.current = posicion
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [ultimo, setUltimo] = useState<{ bulto: string; items: RespuestaBulto['items'] } | null>(null)
  const [enViaje, setEnViaje] = useState(0)
  const [camara, setCamara] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cola = useRef<Promise<void>>(Promise.resolve())

  const [buscar, setBuscar] = useState('')
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [sacar, setSacar] = useState<Bulto | null>(null)
  const [sacando, setSacando] = useState(false)

  const enfocar = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) return
    setError(null)
    try {
      const [p, b, i] = await Promise.all([
        todas<{ codigo: string }>('polo_posiciones', 'codigo'),
        todas<Bulto>('polo_mapeo_bultos', 'id, posicion, bulto, origen, nro, remitos, bulto_n, bultos_total, unidades, escaneado_at'),
        todas<Item>('polo_mapeo_items', 'bulto_id, remito, articulo, descripcion, color, color_nombre, talle, cantidad'),
      ])
      setPosiciones(p.map((x) => x.codigo).sort((a, b2) => a.localeCompare(b2, 'es', { numeric: true })))
      setBultos(b)
      setItems(i)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const posSet = useMemo(() => new Set(posiciones), [posiciones])

  async function guardarBulto(texto: string) {
    const pos = posRef.current
    if (!pos || !supabase) return
    const p = parsearBulto(texto)
    if (!p) {
      setMensaje({ ok: false, texto: `«${texto}» no es un QR de bulto ni de posición` })
      return
    }
    setEnViaje((n) => n + 1)
    try {
      const r = await pedirBulto(texto)
      if (r.error || r.items.length === 0) {
        setMensaje({ ok: false, texto: `${p.bulto}: ${r.error ?? 'el remito no trae artículos'}` })
        return
      }
      const { data, error: e } = await supabase.rpc('polo_mapeo_guardar', {
        p_posicion: pos,
        p_bulto: {
          bulto: p.bulto,
          origen: r.remitos[0]?.origen || p.origen,
          nro: p.nro,
          remitos: r.remitos.map((x) => x.remito),
          bulto_n: p.bulto_n,
          bultos_total: p.bultos_total,
        },
        p_items: r.items,
      })
      if (e) throw new Error(e.message)
      const res = data as { estado: 'nuevo' | 'movido' | 'repetido'; antes?: string; unidades?: number }
      const unid = r.items.reduce((s, x) => s + x.cantidad, 0)
      const notas: string[] = []
      if (p.bultos_total && p.bultos_total > 1) {
        notas.push(`Remito en ${p.bultos_total} bultos: se cargó el remito entero (puede estar repartido)`)
      }
      if (r.aviso) notas.push(r.aviso)
      if (res.estado === 'repetido') {
        setMensaje({ ok: false, texto: `${p.bulto} ya estaba en ${pos}` })
      } else {
        setMensaje({
          ok: true,
          texto:
            `${res.estado === 'movido' ? `Movido de ${res.antes} a ${pos}` : `En ${pos}`}: ${p.bulto} · ` +
            `${r.items.length} ${r.items.length === 1 ? 'renglón' : 'renglones'}, ${fmt(unid)} u.`,
          detalle: notas.join(' · ') || undefined,
        })
      }
      setUltimo({ bulto: p.bulto, items: r.items })
      void cargar()
    } catch (e) {
      setMensaje({ ok: false, texto: `${p.bulto}: ${e instanceof Error ? e.message : 'no se pudo guardar'}` })
    } finally {
      setEnViaje((n) => n - 1)
    }
  }

  /** Cada lectura: si es una posición, la fija; si no, es un bulto para la posición actual. */
  const procesar = useCallback(
    (texto: string) => {
      const bruto = texto.trim()
      if (!bruto) return
      const pq = leerPosicion(bruto)
      const tipeada = bruto.toUpperCase()
      if (pq || (posicionValida(tipeada) && posSet.has(tipeada) && !parsearBulto(bruto))) {
        const c = pq ?? tipeada
        if (!posSet.has(c)) {
          setMensaje({ ok: false, texto: `La posición ${c} no existe: creala en Posiciones` })
          return
        }
        setPosicion(c)
        setUltimo(null)
        setMensaje({ ok: true, texto: `Posición ${c}: ahora escaneá los bultos` })
        return
      }
      if (!posRef.current) {
        setMensaje({ ok: false, texto: 'Primero escaneá el QR de la posición' })
        return
      }
      // De a uno: así dos bultos seguidos no se pisan
      cola.current = cola.current.then(() => guardarBulto(bruto))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posSet],
  )

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    const v = input.value
    input.value = ''
    procesar(v)
    enfocar()
  }

  async function confirmarSacar() {
    if (!sacar || !supabase) return
    setSacando(true)
    const { error: e } = await supabase.rpc('polo_mapeo_sacar', { p_bulto_id: sacar.id })
    setSacando(false)
    if (e) setError(e.message)
    setSacar(null)
    void cargar()
  }

  // ---- Vista del mapeo: posición -> bultos -> artículos, con buscador ----
  const itemsPorBulto = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const i of items) {
      const l = m.get(i.bulto_id) ?? []
      l.push(i)
      m.set(i.bulto_id, l)
    }
    return m
  }, [items])

  const q = buscar.trim().toUpperCase()
  const vista = useMemo(() => {
    const porPos = new Map<string, Bulto[]>()
    for (const b of bultos) {
      if (q) {
        const its = itemsPorBulto.get(b.id) ?? []
        const coincide =
          b.posicion.includes(q) || b.bulto.includes(q) || b.remitos.some((r) => r.toUpperCase().includes(q)) ||
          its.some((i) => i.articulo.includes(q) || (i.descripcion ?? '').toUpperCase().includes(q))
        if (!coincide) continue
      }
      const l = porPos.get(b.posicion) ?? []
      l.push(b)
      porPos.set(b.posicion, l)
    }
    return [...porPos.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
      .map(([pos, bs]) => ({
        pos,
        bultos: bs.sort((a, b) => a.bulto.localeCompare(b.bulto, 'es', { numeric: true })),
        unidades: bs.reduce((s, b) => s + Number(b.unidades), 0),
      }))
  }, [bultos, itemsPorBulto, q])

  // Al buscar un artículo, las posiciones donde está se abren solas
  const abierta = (k: string) => abiertas.has(k) || (q.length >= 3 && vista.length <= 10)
  function alternar(k: string) {
    setAbiertas((prev) => {
      const s = new Set(prev)
      if (s.has(k)) s.delete(k)
      else s.add(k)
      return s
    })
  }

  const enPosActual = posicion ? bultos.filter((b) => b.posicion === posicion).length : 0

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Mapeo de bultos</h1>
          <p className="text-sm text-sub">Escaneá la posición y después los bultos: los artículos salen del remito en Dragon (Polo 52).</p>
        </div>
        {puedeGestionar && (
          <Link
            to="/polo52/mapeo/posiciones"
            className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2"
          >
            <MapPin size={16} className="text-violet-500" aria-hidden /> Posiciones
          </Link>
        )}
      </header>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      {puedeEscanear && (
        <div className="mb-4 space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          {posicion ? (
            <div className="flex items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
              <MapPin size={22} aria-hidden className="shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-sub">Posición</p>
                <p className="truncate font-display text-2xl font-bold leading-tight text-ink">{posicion}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-xl font-bold leading-tight tabular-nums text-violet-500">{enPosActual}</p>
                <p className="text-[11px] text-sub">bultos</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface2 px-3 py-4">
              <QrCode size={26} aria-hidden className="shrink-0 text-violet-500" />
              <div>
                <p className="font-display font-semibold text-ink">Escaneá el QR de la posición</p>
                <p className="text-xs text-sub">
                  {posiciones.length === 0 && !cargando
                    ? 'Todavía no hay posiciones: crealas en «Posiciones».'
                    : 'Después escaneá el QR de cada bulto que dejás en ese palet.'}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              name="codigo"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder={posicion ? 'QR del bulto…' : 'QR o código de la posición…'}
              aria-label={posicion ? 'QR del bulto' : 'QR de la posición'}
              onBlur={() => { if (!camara) enfocar() }}
              autoFocus
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
            </button>
          </form>

          {(mensaje || enViaje > 0) && (
            <div aria-live="polite" className="space-y-1.5">
              {mensaje && (
                <div
                  className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                    mensaje.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    {mensaje.ok ? <Check size={16} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />}
                    <span className="min-w-0 break-words">{mensaje.texto}</span>
                  </span>
                  {mensaje.detalle && <p className="mt-1 pl-6 text-xs font-normal text-amber-500">{mensaje.detalle}</p>}
                </div>
              )}
              {enViaje > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  Buscando en Dragon y guardando {enViaje === 1 ? '1 bulto' : `${enViaje} bultos`}…
                </p>
              )}
            </div>
          )}

          {ultimo && (
            <details className="rounded-xl border border-line bg-surface2 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Qué trae {ultimo.bulto} ({ultimo.items.length})</summary>
              <ul className="mt-2 space-y-1">
                {ultimo.items.map((i, k) => (
                  <li key={k} className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-ink">{i.articulo}</span>{' '}
                      <span className="text-sub">{[i.color_nombre ?? i.color, i.talle].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink">{fmt(i.cantidad)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {posicion && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-sub">Para pasar a otro palet, escaneá su QR.</p>
              <button
                onClick={() => { setPosicion(null); setUltimo(null); setMensaje(null); enfocar() }}
                className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm font-medium text-ink transition hover:bg-line"
              >
                <RotateCcw size={15} aria-hidden /> Cambiar posición
              </button>
            </div>
          )}
        </div>
      )}

      {camara && (
        <div className="mb-4">
          <ScannerCamara
            conQr
            onLectura={(t) => procesar(t)}
            onCerrar={() => {
              setCamara(false)
              enfocar()
            }}
          />
        </div>
      )}

      {/* ---- Qué hay en cada posición ---- */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar artículo, posición, bulto o remito…"
            aria-label="Buscar en el mapeo"
            className="h-11 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-base text-ink outline-none placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </div>
      </div>
      <p className="mb-2 text-xs text-sub">
        {bultos.length} bultos en {new Set(bultos.map((b) => b.posicion)).size} de {posiciones.length} posiciones
      </p>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : vista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-12 text-center text-sm text-sub">
          {q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay bultos mapeados.'}
        </p>
      ) : (
        <div className="space-y-3 pb-4">
          {vista.map(({ pos, bultos: bs, unidades }) => (
            <div key={pos} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <button
                onClick={() => alternar(pos)}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-surface2"
                aria-expanded={abierta(pos)}
              >
                {abierta(pos) ? <ChevronDown size={16} className="text-sub" aria-hidden /> : <ChevronRight size={16} className="text-sub" aria-hidden />}
                <MapPin size={16} className="text-violet-500" aria-hidden />
                <span className="font-display font-semibold text-ink">{pos}</span>
                <span className="ml-auto text-xs text-sub">
                  {bs.length} {bs.length === 1 ? 'bulto' : 'bultos'} · {fmt(unidades)} u.
                </span>
              </button>
              {abierta(pos) && (
                <div className="divide-y divide-line border-t border-line">
                  {bs.map((b) => {
                    const its = itemsPorBulto.get(b.id) ?? []
                    const mostrar = q ? its.filter((i) => i.articulo.includes(q) || (i.descripcion ?? '').toUpperCase().includes(q)) : its
                    const lista = mostrar.length > 0 ? mostrar : its
                    return (
                      <div key={b.id} className="px-4 py-2.5">
                        <div className="flex items-start gap-2">
                          <Package size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="break-all text-sm font-semibold text-ink">{b.bulto}</p>
                            <p className="text-xs text-sub">
                              {b.remitos.join(', ') || 'sin remito'} · {fmt(Number(b.unidades))} u.
                              {b.bultos_total && b.bultos_total > 1 && (
                                <span className="ml-1 inline-flex items-center gap-0.5 text-amber-500">
                                  <Layers size={11} aria-hidden /> remito en {b.bultos_total} bultos
                                </span>
                              )}
                            </p>
                          </div>
                          {(puedeEscanear || puedeGestionar) && (
                            <button
                              onClick={() => setSacar(b)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                              title="Sacar el bulto de esta posición"
                              aria-label={`Sacar ${b.bulto}`}
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          )}
                        </div>
                        <ul className="mt-1.5 space-y-0.5 pl-6">
                          {lista.map((i, k) => (
                            <li key={k} className="flex justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate">
                                <span className="font-semibold text-ink">{i.articulo}</span>{' '}
                                <span className="text-sub">
                                  {[i.color_nombre ?? i.color, i.talle].filter(Boolean).join(' · ')}
                                  {i.descripcion ? ` — ${i.descripcion}` : ''}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-ink">{fmt(Number(i.cantidad))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={sacar != null}
        title={sacar ? `¿Sacar ${sacar.bulto} de ${sacar.posicion}?` : ''}
        message="Se borra del mapeo con sus artículos (Dragon no se toca). Si lo volvés a escanear, vuelve."
        confirmLabel="Sacar bulto"
        busy={sacando}
        onCancel={() => setSacar(null)}
        onConfirm={() => void confirmarSacar()}
      />
    </Layout>
  )
}
