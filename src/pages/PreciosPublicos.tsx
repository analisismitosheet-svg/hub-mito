import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, Loader2, LocateFixed, MapPin, Search, Store, Tag, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ScannerCamara from '@/components/ScannerCamara'
import { fotosArticulo, useFotosArticulos } from '@/lib/fotosArticulos'
import { compararTalles } from '@/lib/ordenPiso'
import { RADIO_EN_LOCAL_M, localPorCodigo, porCercania, useLocalesPublicos, type LocalPublico } from '@/lib/localesPublicos'

/**
 * CONSULTA DE PRECIOS Y STOCK para clientes (link público /precios, sin usuario).
 * Versión web del tótem ConsultaPrecios.exe: buscar por código, nombre o escaneando la
 * etiqueta y ver el precio de contado (LISTA1) y el stock por color y talle del local
 * donde está el cliente (detectado por ubicación, elegido a mano o fijado por QR).
 *
 * Datos: precio por la RPC `precios_publicos_buscar` (sql/precios_publicos.sql) y stock por
 * GET /api/sql/stock-publico (src/lib/stockPublicoApi.ts → acción `stock_publico` del puente).
 * Links: /precios?q=CODIGO abre un artículo; /precios?local=CFRA fija el local (QR del local).
 * La ubicación del cliente se usa solo en el celular: no se manda a ningún servidor.
 */

type Articulo = { articulo: string; descripcion: string; precio: number }
type Respuesta = { exacto?: Articulo; resultados: Articulo[]; actualizado?: string | null }
type FilaStock = { color: string; talle: string; stock: number }
type Stock = { locales: Record<string, FilaStock[]>; colores: Record<string, string>; sin_datos: string[]; en: string }
type Ubicacion = { lat: number; lng: number; precision: number }
type Origen = 'qr' | 'ubicacion' | 'manual'
/** Precios de la lista propia del local (General Paz = Outlet); los que no están ahí van a Contado. */
type PreciosLocal = { local: string; lista: string | null; precios: Record<string, number> }

/** Locales con lista de precios propia (los mismos de LISTAS_LOCAL_PUBLICO del puente). */
const LOCALES_CON_LISTA = new Set(['GPAZD'])

const CLAVE_LOCAL = 'precios.local'

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

const distancia = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')} km`)

/** Color y talle de la etiqueta escaneada (ART!COLOR!TALLE o ART%CCTALLE), para resaltarlos. */
function colorTalleDe(texto: string): { color: string; talle: string } | null {
  const t = texto.trim().toUpperCase().replace(/^\d+\+/, '')
  if (t.includes('!')) {
    const [, color, talle] = t.split('!')
    return color ? { color, talle: talle ?? '' } : null
  }
  if (t.includes('%')) {
    const resto = t.split('%')[1] ?? ''
    return resto.length >= 2 ? { color: resto.slice(0, 2), talle: resto.slice(2) } : null
  }
  return null
}

function leerGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE_LOCAL)
  } catch {
    return null
  }
}
function guardar(cod: string) {
  try {
    localStorage.setItem(CLAVE_LOCAL, cod)
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export default function PreciosPublicos() {
  const [params, setParams] = useSearchParams()
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [elegido, setElegido] = useState<Articulo | null>(null)
  const [buscado, setBuscado] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [camara, setCamara] = useState(false)
  const fotos = useFotosArticulos()
  const pedido = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  /* ---------- Local: QR (?local=) > elegido a mano > ubicación ---------- */
  const locales = useLocalesPublicos()
  const [local, setLocal] = useState<{ codigo: string; origen: Origen } | null>(() => {
    const qr = localPorCodigo(locales, params.get('local'))
    if (qr) return { codigo: qr.codigo, origen: 'qr' }
    const g = localPorCodigo(locales, leerGuardado())
    return g ? { codigo: g.codigo, origen: 'manual' } : null
  })
  // "Usar mi ubicación" (el botón) pisa lo elegido a mano; la detección del arranque, no
  const forzarUbicacion = useRef(false)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const [geo, setGeo] = useState<'idle' | 'pidiendo' | 'ok' | 'denegado' | 'no'>('idle')

  const pedirUbicacion = useCallback(
    (forzar = false) => {
      if (!('geolocation' in navigator)) {
        setGeo('no')
        return
      }
      setGeo('pidiendo')
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const u = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy || 0 }
          forzarUbicacion.current = forzar
          setUbicacion(u)
          setGeo('ok')
        },
        (e) => setGeo(e.code === e.PERMISSION_DENIED ? 'denegado' : 'no'),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
      )
    },
    [],
  )

  // Al entrar: detectar el local por ubicación (si vino por QR, igual se usa para ordenar los demás)
  useEffect(() => {
    document.title = 'Consulta de precios · MITO'
    pedirUbicacion()
  }, [pedirUbicacion])

  // Con la ubicación y las coordenadas del mapa: el local más cercano
  // (el del QR y el elegido a mano mandan, salvo que toque "Usar mi ubicación")
  useEffect(() => {
    if (!ubicacion) return
    const cerca = porCercania(locales, ubicacion.lat, ubicacion.lng)[0]
    if (!cerca || !isFinite(cerca.distancia)) return
    setLocal((actual) => {
      if (actual && actual.origen !== 'ubicacion' && !forzarUbicacion.current) return actual
      return actual?.codigo === cerca.codigo && actual.origen === 'ubicacion' ? actual : { codigo: cerca.codigo, origen: 'ubicacion' }
    })
    forzarUbicacion.current = false
  }, [ubicacion, locales])

  // General Paz (outlet): precios de su lista para lo que está en pantalla
  const [preciosLocal, setPreciosLocal] = useState<PreciosLocal | null>(null)
  const codLocal = local?.codigo ?? null
  const codigosVisibles = useMemo(
    () => [...new Set([...(elegido ? [elegido.articulo] : []), ...resultados.map((r) => r.articulo)])].slice(0, 40).join(','),
    [elegido, resultados],
  )
  useEffect(() => {
    if (!codLocal || !LOCALES_CON_LISTA.has(codLocal) || !codigosVisibles) {
      setPreciosLocal(null)
      return
    }
    let vivo = true
    fetch(`/api/sql/stock-publico?local=${encodeURIComponent(codLocal)}&articulos=${encodeURIComponent(codigosVisibles)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PreciosLocal | null) => {
        // Si falla, queda Contado (no se espera para siempre)
        if (vivo) setPreciosLocal(j && typeof j.precios === 'object' ? { ...j, local: codLocal } : { local: codLocal, lista: null, precios: {} })
      })
      .catch(() => vivo && setPreciosLocal({ local: codLocal, lista: null, precios: {} }))
    return () => {
      vivo = false
    }
  }, [codLocal, codigosVisibles])
  /** Precio a mostrar: el de la lista del local si lo tiene; si no, Contado. */
  const precioDe = (a: Articulo): { precio: number; lista: string | null } => {
    const p = preciosLocal && preciosLocal.local === codLocal ? preciosLocal.precios[a.articulo] : undefined
    return p != null ? { precio: p, lista: preciosLocal?.lista ?? 'Outlet' } : { precio: a.precio, lista: null }
  }
  const esperandoLista = !!codLocal && LOCALES_CON_LISTA.has(codLocal) && preciosLocal?.local !== codLocal

  const elegirLocal = (codigo: string) => {
    setLocal({ codigo, origen: 'manual' })
    guardar(codigo)
  }

  /* ---------- Búsqueda ---------- */
  const buscar = useCallback(async (q: string) => {
    const limpio = q.trim()
    const n = ++pedido.current
    if (limpio.length < 2) {
      setResultados([])
      setBuscado('')
      setError(null)
      return
    }
    if (!supabase) {
      setError('La consulta no está disponible en este momento.')
      return
    }
    setCargando(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('precios_publicos_buscar', { p_q: limpio })
    if (n !== pedido.current) return
    setCargando(false)
    if (err) {
      setError('No se pudo consultar. Revisá la conexión y probá de nuevo.')
      return
    }
    const r = (data ?? { resultados: [] }) as Respuesta
    setActualizado(r.actualizado ?? null)
    setResultados(r.resultados ?? [])
    setBuscado(limpio)
    if (r.exacto) setElegido(r.exacto)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void buscar(texto), 350)
    return () => clearTimeout(t)
  }, [texto, buscar])

  // El código (y el local del QR) quedan en la URL: se puede compartir el link de un artículo
  useEffect(() => {
    const q = texto.trim()
    if ((params.get('q') ?? '') !== q) {
      const nuevo: Record<string, string> = {}
      if (q) nuevo.q = q
      const l = params.get('local')
      if (l) nuevo.local = l
      setParams(nuevo, { replace: true })
    }
  }, [texto, params, setParams])

  const leido = (cod: string) => {
    setCamara(false)
    setElegido(null)
    setTexto(cod.trim())
    if (navigator.vibrate) navigator.vibrate(60)
  }

  const limpiar = () => {
    setTexto('')
    setElegido(null)
    inputRef.current?.focus()
  }


  return (
    <div className="min-h-screen bg-paper px-4 pb-10 pt-6">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-600 font-display text-lg font-bold text-white shadow-glow">
            M
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold leading-tight text-ink">Consulta de precios</h1>
            <p className="text-sm text-sub">Buscá por código, nombre o escaneá la etiqueta</p>
          </div>
        </header>

        <BarraLocal
          locales={locales}
          local={local}
          ubicacion={ubicacion}
          geo={geo}
          onElegir={elegirLocal}
          onUbicar={() => pedirUbicacion(true)}
        />

        {elegido ? (
          <Detalle
            art={elegido}
            precio={precioDe(elegido)}
            esperandoLista={esperandoLista}
            fotos={fotosArticulo(elegido.articulo, fotos)}
            locales={locales}
            local={local?.codigo ?? null}
            ubicacion={ubicacion}
            marca={colorTalleDe(texto)}
            onElegirLocal={elegirLocal}
            onVolver={() => setElegido(null)}
          />
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
                <input
                  ref={inputRef}
                  value={texto}
                  onChange={(e) => {
                    setElegido(null)
                    setTexto(e.target.value)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void buscar(texto)}
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={80}
                  placeholder="Ej: CF050302 o remera negra"
                  aria-label="Código o nombre del artículo"
                  className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-10 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
                {texto && (
                  <button
                    type="button"
                    onClick={limpiar}
                    aria-label="Borrar"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-sub hover:text-ink"
                  >
                    <X size={18} aria-hidden />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCamara((v) => !v)}
                aria-label="Escanear etiqueta"
                className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-4 font-medium text-white shadow-soft hover:bg-brand-700"
              >
                <Camera size={18} aria-hidden />
                <span className="hidden sm:inline">Escanear</span>
              </button>
            </div>

            {camara && (
              <div className="mt-3">
                <ScannerCamara onLectura={(t) => leido(t)} onCerrar={() => setCamara(false)} />
              </div>
            )}

            <div className="mt-4">
              {cargando && resultados.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-sub">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> Buscando…
                </p>
              ) : error ? (
                <p className="py-10 text-center text-sm text-brand-400">{error}</p>
              ) : buscado && resultados.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-medium text-ink">No encontramos «{buscado}»</p>
                  <p className="mt-1 text-sm text-sub">Probá con otra palabra o con el código de la etiqueta.</p>
                </div>
              ) : !buscado ? (
                <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-sub">
                  <Tag size={28} className="mx-auto mb-2 text-sub/70" aria-hidden />
                  Escribí el código que figura en la etiqueta o tocá <b className="text-ink">Escanear</b> y apuntá al
                  código de barras.
                </div>
              ) : (
                <ul className="space-y-2" aria-live="polite">
                  {resultados.map((a) => {
                    const foto = fotosArticulo(a.articulo, fotos)[0]
                    return (
                      <li key={a.articulo}>
                        <button
                          type="button"
                          onClick={() => setElegido(a)}
                          className="btn-press flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left hover:border-line2"
                        >
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper">
                            {foto ? (
                              <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                            ) : (
                              <Tag size={18} className="text-sub/60" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium text-ink">{a.descripcion}</p>
                            <p className="font-mono text-xs text-sub">{a.articulo}</p>
                          </div>
                          <p className="shrink-0 text-right">
                            <span className={`block font-display text-base font-semibold tabular-nums ${esperandoLista ? 'text-sub' : 'text-ink'}`}>
                              {pesos(precioDe(a).precio)}
                            </span>
                            {precioDe(a).lista && <span className="block text-[11px] font-medium text-brand-400">{precioDe(a).lista}</span>}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-sub">
          {codLocal && LOCALES_CON_LISTA.has(codLocal)
            ? 'En General Paz rigen los precios outlet (los artículos sin precio outlet, al de contado). Con IVA incluido.'
            : 'Precios de contado, con IVA incluido.'}
          {actualizado && <> Actualizados el {fechaHora(actualizado)} h.</>} Pueden variar sin previo aviso; el precio
          final es el que figura en caja. El stock es orientativo.
        </p>
      </div>
    </div>
  )
}

/* ---------- Local elegido (arriba de todo) ---------- */
function BarraLocal({
  locales,
  local,
  ubicacion,
  geo,
  onElegir,
  onUbicar,
}: {
  locales: LocalPublico[]
  local: { codigo: string; origen: Origen } | null
  ubicacion: Ubicacion | null
  geo: 'idle' | 'pidiendo' | 'ok' | 'denegado' | 'no'
  onElegir: (codigo: string) => void
  onUbicar: () => void
}) {
  const ordenados = useMemo(
    () =>
      ubicacion
        ? porCercania(locales, ubicacion.lat, ubicacion.lng)
        : [...locales].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((l) => ({ ...l, distancia: Infinity })),
    [locales, ubicacion],
  )
  const dist = local ? ordenados.find((l) => l.codigo === local.codigo)?.distancia : undefined
  const enLocal = dist != null && isFinite(dist) && dist <= RADIO_EN_LOCAL_M + Math.min(ubicacion?.precision ?? 0, 150)
  // Locales pegados (mismo shopping / misma cuadra): el GPS puede confundirlos
  const vecinos =
    local?.origen === 'ubicacion' && ubicacion
      ? ordenados.filter((l) => l.codigo !== local.codigo && l.distancia <= RADIO_EN_LOCAL_M + Math.min(ubicacion.precision, 150))
      : []

  const leyenda = !local
    ? geo === 'pidiendo'
      ? 'Buscando el local más cercano…'
      : 'Elegí el local para ver su stock'
    : local.origen === 'qr'
      ? 'Local del QR'
      : local.origen === 'ubicacion'
        ? enLocal
          ? 'Estás en este local (por tu ubicación)'
          : `El más cercano a vos${dist != null && isFinite(dist) ? ` · a ${distancia(dist)}` : ''}`
        : 'Elegido por vos'

  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600/15 text-brand-400">
          {geo === 'pidiendo' && !local ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Store size={18} aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="local-precios" className="block text-xs text-sub">
            {leyenda}
          </label>
          <select
            id="local-precios"
            value={local?.codigo ?? ''}
            onChange={(e) => e.target.value && onElegir(e.target.value)}
            className="w-full truncate bg-transparent font-medium text-ink outline-none"
          >
            {!local && <option value="">Elegir local…</option>}
            {ordenados.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.nombre}
                {isFinite(l.distancia) ? ` (${distancia(l.distancia)})` : ''}
              </option>
            ))}
          </select>
        </div>
        {geo !== 'no' && (
          <button
            type="button"
            onClick={onUbicar}
            aria-label="Usar mi ubicación"
            title="Usar mi ubicación"
            className="btn-press shrink-0 rounded-lg p-2 text-sub hover:text-ink"
          >
            {geo === 'pidiendo' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <LocateFixed size={18} aria-hidden />}
          </button>
        )}
      </div>
      {vecinos.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-sub">
          ¿Estás en otro?
          {vecinos.map((v) => (
            <button
              key={v.codigo}
              type="button"
              onClick={() => onElegir(v.codigo)}
              className="btn-press rounded-full border border-line px-2.5 py-1 text-ink hover:border-line2"
            >
              {v.nombre}
            </button>
          ))}
        </div>
      )}
      {/* Al abrir el link se pide la ubicación; mientras no esté activada, se avisa bien grande */}
      {local?.origen !== 'qr' && (geo === 'idle' || geo === 'pidiendo' || geo === 'denegado') && (
        <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-600/10 p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-ink">
            <MapPin size={18} className="mt-0.5 shrink-0 text-brand-400" aria-hidden />
            {geo === 'denegado'
              ? 'Tu ubicación está desactivada'
              : 'Activá tu ubicación para ver el stock del local donde estás'}
          </p>
          {geo === 'denegado' ? (
            <p className="mt-1 pl-[26px] text-xs text-sub">
              Tocá el candado o los ajustes al lado de la dirección de la página → <b>Permisos</b> →{' '}
              <b>Ubicación</b> → <b>Permitir</b>, y volvé a cargar. Si preferís, elegí el local de la lista.
            </p>
          ) : (
            <p className="mt-1 pl-[26px] text-xs text-sub">
              Tu celular te va a preguntar si nos dejás usarla: tocá <b>Permitir</b>. Solo la usamos para saber en qué
              local estás; no se guarda ni se envía.
            </p>
          )}
          <button
            type="button"
            onClick={onUbicar}
            disabled={geo === 'pidiendo'}
            className="btn-press mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white shadow-soft hover:bg-brand-700 disabled:opacity-60"
          >
            {geo === 'pidiendo' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LocateFixed size={16} aria-hidden />}
            {geo === 'pidiendo' ? 'Esperando permiso…' : geo === 'denegado' ? 'Probar de nuevo' : 'Activar ubicación'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Detalle de un artículo: precio + stock ---------- */
function Detalle({
  art,
  precio,
  esperandoLista,
  fotos,
  locales,
  local,
  ubicacion,
  marca,
  onElegirLocal,
  onVolver,
}: {
  art: Articulo
  precio: { precio: number; lista: string | null }
  esperandoLista: boolean
  fotos: string[]
  locales: LocalPublico[]
  local: string | null
  ubicacion: Ubicacion | null
  marca: { color: string; talle: string } | null
  onElegirLocal: (codigo: string) => void
  onVolver: () => void
}) {
  const [foto, setFoto] = useState(0)
  const [stock, setStock] = useState<Stock | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando')

  useEffect(() => setFoto(0), [art.articulo])

  useEffect(() => {
    let vivo = true
    setEstado('cargando')
    setStock(null)
    fetch(`/api/sql/stock-publico?articulo=${encodeURIComponent(art.articulo)}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as Stock | null
        if (!vivo) return
        if (!r.ok || !j || typeof j.locales !== 'object') throw new Error()
        setStock(j)
        setEstado('ok')
      })
      .catch(() => vivo && setEstado('error'))
    return () => {
      vivo = false
    }
  }, [art.articulo])

  const nombreLocal = localPorCodigo(locales, local)?.nombre ?? null
  const filas = (local && stock?.locales[local]) || []
  const sinDatosLocal = !!local && !!stock?.sin_datos.includes(local)

  const grilla = useMemo(() => {
    const talles = [...new Set(filas.map((f) => f.talle))].sort(compararTalles)
    const colores = new Map<string, Record<string, number>>()
    for (const f of filas) {
      const c = colores.get(f.color) ?? {}
      c[f.talle] = (c[f.talle] ?? 0) + f.stock
      colores.set(f.color, c)
    }
    return { talles, colores: [...colores.entries()].sort((a, b) => a[0].localeCompare(b[0])) }
  }, [filas])

  // Otros locales con stock del artículo (o del color/talle escaneado), los más cercanos primero
  const otros = useMemo(() => {
    if (!stock) return []
    const dist = ubicacion ? new Map(porCercania(locales, ubicacion.lat, ubicacion.lng).map((l) => [l.codigo, l.distancia])) : null
    return locales.filter((l) => l.codigo !== local)
      .map((l) => {
        const fs = stock.locales[l.codigo] ?? []
        const total = fs.reduce((s, f) => s + f.stock, 0)
        const delEscaneado = marca
          ? fs.filter((f) => f.color === marca.color && (!marca.talle || f.talle === marca.talle)).reduce((s, f) => s + f.stock, 0)
          : null
        return { ...l, total, delEscaneado, distancia: dist?.get(l.codigo) ?? Infinity }
      })
      .filter((l) => (marca ? (l.delEscaneado ?? 0) > 0 : l.total > 0))
      .sort((a, b) => (ubicacion ? a.distancia - b.distancia : b.total - a.total))
  }, [stock, locales, local, ubicacion, marca])

  return (
    <div>
      <button
        type="button"
        onClick={onVolver}
        className="btn-press mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-sub hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden /> Buscar otro
      </button>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg">
        {fotos.length > 0 && (
          <div className="bg-white">
            <img src={fotos[foto]} alt={art.descripcion} className="mx-auto aspect-square w-full max-w-sm object-contain" />
            {fotos.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-t border-line bg-surface p-2">
                {fotos.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setFoto(i)}
                    aria-label={`Foto ${i + 1}`}
                    className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 ${i === foto ? 'border-brand-500' : 'border-transparent'}`}
                  >
                    <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="p-5 text-center">
          <p className="font-mono text-xs text-sub">{art.articulo}</p>
          <h2 className="mt-1 text-base font-medium text-ink">{art.descripcion}</h2>
          <p className={`mt-4 font-display text-4xl font-bold tabular-nums ${esperandoLista ? 'text-sub' : 'text-ink'}`}>
            {pesos(precio.precio)}
          </p>
          {precio.lista ? (
            <>
              <p className="mt-1 text-sm font-medium text-brand-400">Precio {precio.lista} · {localPorCodigo(locales, local)?.nombre}</p>
              {art.precio > precio.precio && (
                <p className="mt-0.5 text-xs text-sub">
                  Contado en otros locales: <span className="line-through">{pesos(art.precio)}</span>
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-sub">{esperandoLista ? 'Buscando el precio outlet…' : 'Precio de contado'}</p>
          )}
        </div>
      </div>

      {/* Stock del local */}
      <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <h3 className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
          <MapPin size={16} className="text-brand-400" aria-hidden />
          {nombreLocal ? `Stock en ${nombreLocal}` : 'Stock'}
        </h3>
        {estado === 'cargando' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-sub">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Consultando stock…
          </p>
        ) : estado === 'error' ? (
          <p className="py-4 text-sm text-sub">No pudimos consultar el stock en este momento. Probá de nuevo en un rato.</p>
        ) : !local ? (
          <p className="py-4 text-sm text-sub">Elegí el local arriba para ver el stock por color y talle.</p>
        ) : sinDatosLocal ? (
          <p className="py-4 text-sm text-sub">No pudimos leer el stock de este local ahora. Consultá a un vendedor.</p>
        ) : grilla.colores.length === 0 ? (
          <p className="py-4 text-sm text-sub">No hay stock de este artículo en {nombreLocal}.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface py-1.5 pr-3 text-left text-xs font-medium text-sub">Color</th>
                  {grilla.talles.map((t) => (
                    <th
                      key={t}
                      className={`px-2 py-1.5 text-center text-xs font-semibold ${marca?.talle === t ? 'text-brand-400' : 'text-sub'}`}
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grilla.colores.map(([color, talles]) => {
                  const esColor = marca?.color === color
                  return (
                    <tr key={color} className={esColor ? 'bg-brand-600/10' : ''}>
                      <td className="sticky left-0 border-t border-line bg-surface py-2 pr-3 text-left">
                        <span className={`font-medium ${esColor ? 'text-brand-400' : 'text-ink'}`}>
                          {stock?.colores[color] ?? color}
                        </span>
                      </td>
                      {grilla.talles.map((t) => {
                        const n = talles[t] ?? 0
                        const esCelda = esColor && marca?.talle === t
                        return (
                          <td
                            key={t}
                            className={`border-t border-line px-2 py-2 text-center tabular-nums ${
                              n ? 'font-semibold text-ink' : 'text-sub/40'
                            } ${esCelda ? 'rounded-md ring-2 ring-inset ring-brand-500' : ''}`}
                          >
                            {n || '–'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Otros locales */}
      {estado === 'ok' && otros.length > 0 && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h3 className="font-display text-base font-semibold text-ink">
            {marca ? 'Tu color y talle en otros locales' : 'También hay en'}
          </h3>
          <ul className="mt-2 divide-y divide-line">
            {otros.map((l) => (
              <li key={l.codigo}>
                <button
                  type="button"
                  onClick={() => {
                    onElegirLocal(l.codigo)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{l.nombre}</span>
                    {isFinite(l.distancia) && <span className="text-xs text-sub">a {distancia(l.distancia)}</span>}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-sub">
                    {marca ? l.delEscaneado : l.total} u.
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
