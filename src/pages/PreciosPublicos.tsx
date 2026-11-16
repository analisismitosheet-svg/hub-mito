import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, FileDown, Loader2, LocateFixed, MapPin, QrCode, Search, Store, Tag, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import ScannerCamara from '@/components/ScannerCamara'
import { compararTalles } from '@/lib/ordenPiso'
import { descargarQrPdf } from '@/lib/qrPdf'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import './precios.css'
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

/** `fotos`: de indonesiashop.com.ar y de Captain/Zimith (tabla articulos_fotos), las trae la búsqueda. */
type Articulo = { articulo: string; descripcion: string; precio: number; fotos?: string[] }
type Respuesta = { exacto?: Articulo; resultados: Articulo[]; actualizado?: string | null }
type FilaStock = { color: string; talle: string; stock: number }
type Stock = { detalle?: string; locales: Record<string, FilaStock[]>; colores: Record<string, string>; sin_datos: string[]; en: string }
type Ubicacion = { lat: number; lng: number; precision: number }
type Origen = 'qr' | 'ubicacion' | 'manual'
/** Precios de la lista propia del local (General Paz = Outlet); los que no están ahí van a Contado. */
type PreciosLocal = { local: string; lista: string | null; precios: Record<string, number> }

/** Locales con lista de precios propia (los mismos de LISTAS_LOCAL_PUBLICO del puente). */
const LOCALES_CON_LISTA = new Set(['GPAZD'])

const CLAVE_LOCAL = 'precios.local'

const pesos = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

const pesos2 = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

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

  // Usuarios del hub (con sesión): sin ubicación, eligen el local de la lista (queda recordado)
  const { user, loading: cargandoSesion } = useAuth()
  const enHub = !!user

  useEffect(() => {
    const antes = document.title
    document.title = 'Consulta de precios · MITO'
    return () => {
      document.title = antes
    }
  }, [])

  // Al entrar (clientes): detectar el local por ubicación (si vino por QR, igual se usa para ordenar los demás)
  useEffect(() => {
    if (cargandoSesion || enHub) return
    pedirUbicacion()
  }, [cargandoSesion, enHub, pedirUbicacion])

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
    if (r.exacto) {
      setElegido(r.exacto)
      // Como el F12: con el buscador en foco (lector USB/Bluetooth) queda todo seleccionado,
      // así la próxima etiqueta reemplaza a la anterior
      if (document.activeElement === inputRef.current) inputRef.current?.select()
    }
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

  const leido = (leidoCrudo: string) => {
    // Un QR con link (ej. …/precios?q=CF050302): se usa el código que trae, no la URL entera
    let cod = leidoCrudo.trim()
    if (/^https?:\/\//i.test(cod)) {
      try {
        cod = new URL(cod).searchParams.get('q') ?? ''
      } catch {
        /* no es un link válido: queda como vino */
      }
      if (!cod) return
    }
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


  // Marca del local: los Captain Fin (CF*) con su tema; el resto, Indonesia
  const marca = local?.codigo.startsWith('CF') ? 'captain' : 'indonesia'

  return (
    <div className="pp pb-10" data-marca={marca}>
      <header className="pp-cabecera">
        <img
          src={marca === 'captain' ? '/marcas/captain-fin.png' : '/marcas/indonesia.png'}
          alt={marca === 'captain' ? 'Captain Fin' : 'Indonesia'}
        />
        {user && (
          <Link to="/area/locales" className="pp-volver pp-no-imprimir" aria-label="Volver al hub">
            <ArrowLeft size={18} aria-hidden /> Hub
          </Link>
        )}
        {local && <span className="pp-local">{local.codigo}</span>}
      </header>
      <div className="mx-auto w-full max-w-lg px-4 pt-5">
        <header className="pp-no-imprimir mb-4">
          <h1 className="pp-titulo text-xl font-semibold leading-tight text-[var(--pp-texto)]">Consulta de precios y stock</h1>
          <p className="text-sm text-[var(--pp-suave)]">Buscá por código, nombre o escaneá la etiqueta</p>
          {user && <BotonQr />}
        </header>

        <BarraLocal
          locales={locales}
          local={local}
          ubicacion={ubicacion}
          geo={geo}
          onElegir={elegirLocal}
          onUbicar={() => pedirUbicacion(true)}
          sinUbicacion={enHub}
        />

        {/* Buscador siempre a la vista (como el F12 y el tótem): lo escaneado cae acá */}
        <div className="pp-no-imprimir mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--pp-suave)]" aria-hidden />
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
              placeholder={elegido ? 'Escaneá otra etiqueta o escribí el código' : 'Ej: CF050302 o remera negra'}
              aria-label="Código o nombre del artículo"
              className="w-full rounded-xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] py-3 pl-10 pr-10 text-base text-[var(--pp-texto)] outline-none transition placeholder:text-[var(--pp-suave)] focus-visible:border-[var(--pp-acento)] focus-visible:ring-2 focus-visible:ring-[var(--pp-foco)]"
            />
            {texto && (
              <button
                type="button"
                onClick={limpiar}
                aria-label="Borrar"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--pp-suave)] hover:text-[var(--pp-texto)]"
              >
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCamara((v) => !v)}
            aria-label="Escanear etiqueta"
            className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--pp-acento)] px-4 font-medium text-white shadow-soft hover:bg-[var(--pp-acento-hover)]"
          >
            <Camera size={18} aria-hidden />
            <span className="hidden sm:inline">Escanear</span>
          </button>
        </div>

        {camara && (
          <div className="mt-3">
            {/* QR, EAN-13/8, UPC, Code 39 y Code 128 */}
            <ScannerCamara conQr onLectura={(t) => leido(t)} onCerrar={() => setCamara(false)} />
          </div>
        )}
        </div>

        {elegido ? (
          <Detalle
            art={elegido}
            precio={precioDe(elegido)}
            esperandoLista={esperandoLista}
            fotos={Array.isArray(elegido.fotos) ? elegido.fotos : []}
            locales={locales}
            local={local?.codigo ?? null}
            ubicacion={ubicacion}
            marca={colorTalleDe(texto)}
            onElegirLocal={elegirLocal}
            onVolver={() => setElegido(null)}
            conHub={!!user}
          />
        ) : (
          <>
            <div className="mt-4">
              {cargando && resultados.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--pp-suave)]">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> Buscando…
                </p>
              ) : error ? (
                <p className="py-10 text-center text-sm text-[var(--pp-acento-texto)]">{error}</p>
              ) : buscado && resultados.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-medium text-[var(--pp-texto)]">No encontramos «{buscado}»</p>
                  <p className="mt-1 text-sm text-[var(--pp-suave)]">Probá con otra palabra o con el código de la etiqueta.</p>
                </div>
              ) : !buscado ? (
                <div className="rounded-2xl border border-dashed border-[var(--pp-borde)] px-5 py-10 text-center text-sm text-[var(--pp-suave)]">
                  <Tag size={28} className="mx-auto mb-2 text-[var(--pp-tenue)]" aria-hidden />
                  Escribí el código que figura en la etiqueta o tocá <b className="text-[var(--pp-texto)]">Escanear</b> y apuntá al
                  código de barras.
                </div>
              ) : (
                <ul className="space-y-2" aria-live="polite">
                  {resultados.map((a) => {
                    const foto = Array.isArray(a.fotos) ? a.fotos[0] : undefined
                    return (
                      <li key={a.articulo}>
                        <button
                          type="button"
                          onClick={() => setElegido(a)}
                          className="btn-press flex w-full items-center gap-3 rounded-xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] p-2.5 text-left hover:border-[var(--pp-borde2)]"
                        >
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--pp-borde)] bg-[var(--pp-fondo)]">
                            {foto ? (
                              <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                            ) : (
                              <Tag size={18} className="text-[var(--pp-tenue)]" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium text-[var(--pp-texto)]">{a.descripcion}</p>
                            <p className="font-mono text-xs text-[var(--pp-suave)]">{a.articulo}</p>
                          </div>
                          <p className="shrink-0 text-right">
                            <span className={`block pp-titulo text-base font-semibold tabular-nums ${esperandoLista ? 'text-[var(--pp-suave)]' : 'text-[var(--pp-texto)]'}`}>
                              {pesos(precioDe(a).precio)}
                            </span>
                            {precioDe(a).lista && <span className="block text-[11px] font-medium text-[var(--pp-acento-texto)]">{precioDe(a).lista}</span>}
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

        <p className="mt-8 text-center text-xs text-[var(--pp-suave)]">
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

/* ---------- QR del link para imprimir (solo usuarios del hub) ----------
   Link FIJO: va impreso en las remeras de los empleados. Nunca cambiarlo (ver App.tsx). */
const LINK_QR = 'https://hub-mito.vercel.app/precios'

function BotonQr() {
  const lienzo = useRef<HTMLCanvasElement>(null)
  const [generando, setGenerando] = useState(false)
  const [mostrar, setMostrar] = useState(false)

  // Pantalla del QR: se cierra con Esc
  useEffect(() => {
    if (!mostrar) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setMostrar(false)
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [mostrar])

  const descargar = async () => {
    const png = lienzo.current?.toDataURL('image/png')
    if (!png) return
    setGenerando(true)
    try {
      await descargarQrPdf(png, LINK_QR)
    } finally {
      setGenerando(false)
    }
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {/* QR en alta (2000 px, corrección H) fuera de la vista: de acá sale el PDF y el PNG */}
      <QRCodeCanvas ref={lienzo} value={LINK_QR} size={2000} level="H" marginSize={4} className="hidden" />
      <button
        type="button"
        onClick={() => setMostrar(true)}
        className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-[var(--pp-acento)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--pp-acento-hover)]"
      >
        <QrCode size={15} aria-hidden /> Mostrar QR
      </button>
      <button
        type="button"
        onClick={() => void descargar()}
        disabled={generando}
        className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-[var(--pp-borde)] bg-[var(--pp-panel)] px-3 py-1.5 text-sm font-medium text-[var(--pp-texto)] hover:border-[var(--pp-borde2)] disabled:opacity-50"
      >
        {generando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <QrCode size={15} aria-hidden />} QR para imprimir (PDF)
      </button>
      <button
        type="button"
        onClick={() => {
          const png = lienzo.current?.toDataURL('image/png')
          if (!png) return
          const a = document.createElement('a')
          a.href = png
          a.download = 'qr-consulta-stock-precios.png'
          a.click()
        }}
        className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-[var(--pp-borde)] bg-[var(--pp-panel)] px-3 py-1.5 text-sm font-medium text-[var(--pp-texto)] hover:border-[var(--pp-borde2)]"
      >
        <FileDown size={15} aria-hidden /> PNG
      </button>

      {/* QR en pantalla completa, blanco y grande, para escanearlo desde la pantalla. Tocar o Esc cierra. */}
      {mostrar && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR de la consulta de precios y stock"
          onClick={() => setMostrar(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-black"
        >
          <button
            type="button"
            onClick={() => setMostrar(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 rounded-full p-2 text-neutral-600 hover:bg-neutral-100 hover:text-black"
          >
            <X size={26} aria-hidden />
          </button>
          <p className="text-center text-xl font-semibold">Escaneá para ver precios y stock</p>
          <QRCodeSVG value={LINK_QR} level="H" marginSize={2} className="h-auto w-[min(80vw,70vh)]" />
          <p className="text-center font-mono text-sm text-neutral-600">{LINK_QR}</p>
        </div>
      )}
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
  sinUbicacion,
}: {
  locales: LocalPublico[]
  local: { codigo: string; origen: Origen } | null
  ubicacion: Ubicacion | null
  geo: 'idle' | 'pidiendo' | 'ok' | 'denegado' | 'no'
  onElegir: (codigo: string) => void
  onUbicar: () => void
  /** usuarios del hub: sin ubicación (ni aviso ni botón), solo la lista */
  sinUbicacion: boolean
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
    <div className="pp-no-imprimir mb-4 rounded-2xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--pp-acento-suave)] text-[var(--pp-acento-texto)]">
          {geo === 'pidiendo' && !local ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Store size={18} aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor="local-precios" className="block text-xs text-[var(--pp-suave)]">
            {leyenda}
          </label>
          <select
            id="local-precios"
            value={local?.codigo ?? ''}
            onChange={(e) => e.target.value && onElegir(e.target.value)}
            className="w-full truncate bg-transparent font-medium text-[var(--pp-texto)] outline-none"
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
        {!sinUbicacion && geo !== 'no' && (
          <button
            type="button"
            onClick={onUbicar}
            aria-label="Usar mi ubicación"
            title="Usar mi ubicación"
            className="btn-press shrink-0 rounded-lg p-2 text-[var(--pp-suave)] hover:text-[var(--pp-texto)]"
          >
            {geo === 'pidiendo' ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <LocateFixed size={18} aria-hidden />}
          </button>
        )}
      </div>
      {vecinos.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--pp-suave)]">
          ¿Estás en otro?
          {vecinos.map((v) => (
            <button
              key={v.codigo}
              type="button"
              onClick={() => onElegir(v.codigo)}
              className="btn-press rounded-full border border-[var(--pp-borde)] px-2.5 py-1 text-[var(--pp-texto)] hover:border-[var(--pp-borde2)]"
            >
              {v.nombre}
            </button>
          ))}
        </div>
      )}
      {/* Al abrir el link se pide la ubicación; mientras no esté activada, se avisa bien grande */}
      {!sinUbicacion && local?.origen !== 'qr' && (geo === 'idle' || geo === 'pidiendo' || geo === 'denegado') && (
        <div className="mt-3 rounded-xl border border-[var(--pp-acento-borde)] bg-[var(--pp-acento-suave)] p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-[var(--pp-texto)]">
            <MapPin size={18} className="mt-0.5 shrink-0 text-[var(--pp-acento-texto)]" aria-hidden />
            {geo === 'denegado'
              ? 'Tu ubicación está desactivada'
              : 'Activá tu ubicación para ver el stock del local donde estás'}
          </p>
          {geo === 'denegado' ? (
            <p className="mt-1 pl-[26px] text-xs text-[var(--pp-suave)]">
              Tocá el candado o los ajustes al lado de la dirección de la página → <b>Permisos</b> →{' '}
              <b>Ubicación</b> → <b>Permitir</b>, y volvé a cargar. Si preferís, elegí el local de la lista.
            </p>
          ) : (
            <p className="mt-1 pl-[26px] text-xs text-[var(--pp-suave)]">
              Tu celular te va a preguntar si nos dejás usarla: tocá <b>Permitir</b>. Solo la usamos para saber en qué
              local estás; no se guarda ni se envía.
            </p>
          )}
          <button
            type="button"
            onClick={onUbicar}
            disabled={geo === 'pidiendo'}
            className="btn-press mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--pp-acento)] py-2 text-sm font-medium text-white shadow-soft hover:bg-[var(--pp-acento-hover)] disabled:opacity-60"
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
  conHub,
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
  /** usuario del hub (con sesión): ve el stock de todos los locales */
  conHub: boolean
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

  // Solo usuarios del hub: el stock de TODOS los locales (local × color, por talle) (los clientes ven solo su local y la lista de otros)
  const todos = useMemo(() => {
    if (!stock) return { talles: [] as string[], filas: [] as Array<{ local: string; color: string; talles: Record<string, number>; total: number }> }
    const talles = new Set<string>()
    const filas: Array<{ local: string; color: string; talles: Record<string, number>; total: number }> = []
    for (const l of locales) {
      const porColor = new Map<string, Record<string, number>>()
      for (const f of stock.locales[l.codigo] ?? []) {
        talles.add(f.talle)
        const c = porColor.get(f.color) ?? {}
        c[f.talle] = (c[f.talle] ?? 0) + f.stock
        porColor.set(f.color, c)
      }
      for (const [color, t] of [...porColor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        filas.push({ local: l.nombre, color: `${color} ${stock.colores[color] ?? ''}`.trim(), talles: t, total: Object.values(t).reduce((a, b) => a + b, 0) })
      }
    }
    return { talles: [...talles].sort(compararTalles), filas }
  }, [stock, locales])

  return (
    <div>
      <div className="pp-no-imprimir mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onVolver}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-[var(--pp-suave)] hover:text-[var(--pp-texto)]"
        >
          <ArrowLeft size={16} aria-hidden /> Buscar otro
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] shadow-soft-lg">
        {fotos.length > 0 ? (
          <div className="bg-white">
            <img src={fotos[foto]} alt={art.descripcion} className="mx-auto aspect-square w-full max-w-sm object-contain" />
            {fotos.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--pp-borde)] bg-[var(--pp-panel)] p-2">
                {fotos.map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setFoto(i)}
                    aria-label={`Foto ${i + 1}`}
                    className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 ${i === foto ? 'border-[var(--pp-acento)]' : 'border-transparent'}`}
                  >
                    <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-28 flex-col items-center justify-center gap-1 border-b border-[var(--pp-borde)] text-[var(--pp-tenue)]">
            <Tag size={26} aria-hidden />
            <span className="text-xs">Sin foto</span>
          </div>
        )}
        <div className="p-5">
          <p className="font-mono text-xs text-[var(--pp-suave)]">{art.articulo}</p>
          <h2 className="pp-titulo mt-1 text-2xl font-semibold uppercase leading-tight text-[var(--pp-texto)]">{art.descripcion}</h2>
          {/* Precio como el tótem: con IVA grande y al lado sin IVA y el IVA */}
          <p className="mt-4 text-sm text-[var(--pp-suave)]">
            {precio.lista ? `Precio ${precio.lista.toLowerCase()} (con IVA)` : esperandoLista ? 'Buscando el precio outlet…' : 'Precio contado (con IVA)'}
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-x-5 gap-y-2">
            <p
              className={`pp-titulo pp-titulo-grande text-5xl font-semibold tabular-nums leading-none ${
                esperandoLista ? 'text-[var(--pp-suave)]' : 'text-[var(--pp-texto)]'
              }`}
            >
              {pesos(precio.precio)}
            </p>
            <div className="pb-0.5">
              <p className="text-xs text-[var(--pp-suave)]">Sin IVA</p>
              <p className="pp-titulo text-2xl font-semibold tabular-nums leading-tight text-[var(--pp-texto)]">{pesos2(precio.precio / 1.21)}</p>
              <p className="text-xs text-[var(--pp-suave)]">IVA 21 %: {pesos2(precio.precio - precio.precio / 1.21)}</p>
            </div>
          </div>
          {precio.lista && (
            <p className="mt-2 text-sm font-medium text-[var(--pp-acento-texto)]">
              Precio {precio.lista} de {localPorCodigo(locales, local)?.nombre}
              {art.precio > precio.precio && (
                <span className="ml-1 font-normal text-[var(--pp-suave)]">
                  · contado <span className="line-through">{pesos(art.precio)}</span>
                </span>
              )}
            </p>
          )}
          {stock?.detalle && <p className="mt-3 text-sm text-[var(--pp-suave)]">{stock.detalle}</p>}
        </div>
      </div>

      {/* Stock del local */}
      <section className="mt-4 rounded-2xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] p-4">
        <h3 className="flex items-center gap-1.5 pp-titulo text-base font-semibold text-[var(--pp-texto)]">
          <MapPin size={16} className="text-[var(--pp-acento-texto)]" aria-hidden />
          {nombreLocal ? `Stock en ${nombreLocal} por color y talle` : 'Stock por color y talle'}
        </h3>
        {estado === 'cargando' ? (
          <p className="flex items-center gap-2 py-6 text-sm text-[var(--pp-suave)]">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Consultando stock…
          </p>
        ) : estado === 'error' ? (
          <p className="py-4 text-sm text-[var(--pp-suave)]">No pudimos consultar el stock en este momento. Probá de nuevo en un rato.</p>
        ) : !local ? (
          <p className="py-4 text-sm text-[var(--pp-suave)]">Elegí el local arriba para ver el stock por color y talle.</p>
        ) : sinDatosLocal ? (
          <p className="py-4 text-sm text-[var(--pp-suave)]">No pudimos leer el stock de este local ahora. Consultá a un vendedor.</p>
        ) : grilla.colores.length === 0 ? (
          <p className="py-4 text-sm text-[var(--pp-suave)]">No hay stock de este artículo en {nombreLocal}.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[var(--pp-panel)] py-1.5 pr-3 text-left text-xs font-medium text-[var(--pp-suave)]">Color</th>
                  {grilla.talles.map((t) => (
                    <th
                      key={t}
                      className={`px-2 py-1.5 text-center text-xs font-semibold ${marca?.talle === t ? 'text-[var(--pp-acento-texto)]' : 'text-[var(--pp-suave)]'}`}
                    >
                      {t}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-[var(--pp-suave)]">Tot</th>
                </tr>
              </thead>
              <tbody>
                {grilla.colores.map(([color, talles]) => {
                  const esColor = marca?.color === color
                  return (
                    <tr key={color} className={esColor ? 'bg-[var(--pp-acento-suave)]' : ''}>
                      <td className="sticky left-0 border-t border-[var(--pp-borde)] bg-[var(--pp-panel)] py-2 pr-3 text-left">
                        <span className={`font-medium ${esColor ? 'text-[var(--pp-acento-texto)]' : 'text-[var(--pp-texto)]'}`}>
                          {color} {stock?.colores[color] ?? ''}
                        </span>
                      </td>
                      {grilla.talles.map((t) => {
                        const n = talles[t] ?? 0
                        const esCelda = esColor && marca?.talle === t
                        return (
                          <td
                            key={t}
                            className={`border-t border-[var(--pp-borde)] px-2 py-2 text-center tabular-nums ${
                              n ? 'font-semibold text-[var(--pp-texto)]' : 'text-[var(--pp-tenue)]'
                            } ${esCelda ? 'rounded-md ring-2 ring-inset ring-[var(--pp-acento)]' : ''}`}
                          >
                            {n || '–'}
                          </td>
                        )
                      })}
                      <td className="border-t border-[var(--pp-borde)] px-2 py-2 text-center font-semibold tabular-nums text-[var(--pp-texto)]">
                        {Object.values(talles).reduce((a, b) => a + b, 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Solo usuarios del hub: stock de todos los locales (también sale al imprimir) */}
      {conHub && estado === 'ok' && todos.filas.length > 0 && (
        <section className="mt-4 rounded-2xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] p-4">
          <h3 className="pp-titulo text-base font-semibold text-[var(--pp-texto)]">Stock en todos los locales</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="py-1.5 pr-3 text-left text-xs font-medium text-[var(--pp-suave)]">Local</th>
                  <th className="py-1.5 pr-3 text-left text-xs font-medium text-[var(--pp-suave)]">Color</th>
                  {todos.talles.map((t) => (
                    <th key={t} className="px-2 py-1.5 text-center text-xs font-semibold text-[var(--pp-suave)]">{t}</th>
                  ))}
                  <th className="px-2 py-1.5 text-center text-xs font-semibold text-[var(--pp-suave)]">Tot</th>
                </tr>
              </thead>
              <tbody>
                {todos.filas.map((f, i) => (
                  <tr key={`${f.local}-${f.color}`}>
                    <td className="whitespace-nowrap border-t border-[var(--pp-borde)] py-1.5 pr-3 font-medium text-[var(--pp-texto)]">
                      {i === 0 || todos.filas[i - 1].local !== f.local ? f.local : ''}
                    </td>
                    <td className="whitespace-nowrap border-t border-[var(--pp-borde)] py-1.5 pr-3 text-[var(--pp-texto)]">{f.color}</td>
                    {todos.talles.map((t) => (
                      <td
                        key={t}
                        className={`border-t border-[var(--pp-borde)] px-2 py-1.5 text-center tabular-nums ${
                          f.talles[t] ? 'text-[var(--pp-texto)]' : 'text-[var(--pp-tenue)]'
                        }`}
                      >
                        {f.talles[t] || '–'}
                      </td>
                    ))}
                    <td className="border-t border-[var(--pp-borde)] px-2 py-1.5 text-center font-semibold tabular-nums text-[var(--pp-texto)]">{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Otros locales */}
      {!conHub && estado === 'ok' && otros.length > 0 && (
        <section className="mt-4 rounded-2xl border border-[var(--pp-borde)] bg-[var(--pp-panel)] p-4">
          <h3 className="pp-titulo text-base font-semibold text-[var(--pp-texto)]">
            {marca ? 'Tu color y talle en otros locales' : 'También hay en'}
          </h3>
          <ul className="mt-2 divide-y divide-[var(--pp-borde)]">
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
                    <span className="block truncate text-sm font-medium text-[var(--pp-texto)]">{l.nombre}</span>
                    {isFinite(l.distancia) && <span className="text-xs text-[var(--pp-suave)]">a {distancia(l.distancia)}</span>}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--pp-suave)]">
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
