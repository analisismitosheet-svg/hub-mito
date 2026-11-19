import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, PackageOpen, Package, Sparkles, AlertTriangle, RefreshCw, Camera, CameraOff } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import {
  cargarCajasLlenas, cargarListaCajas, cargarMapeoCajas, leerCodigoArticulo, type MapeoCaja,
} from '@/lib/mapeoCajas'

interface ConLugar {
  caja: number
  codigos: number
}

/** Chip de caja: lleva a Escanear con esa caja ya elegida */
function ChipCaja({ caja, detalle, destacada = false }: { caja: number; detalle?: string; destacada?: boolean }) {
  return (
    <Link
      to={`/deposito/mapeo-cajas/escanear?caja=${caja}`}
      className={`btn-press inline-flex min-h-[3rem] min-w-[4.5rem] flex-col items-center justify-center rounded-xl border px-3 py-1 transition ${
        destacada
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
          : 'border-line bg-surface2 text-ink hover:bg-line'
      }`}
      title={`Guardar en la caja ${caja}`}
    >
      <span className="font-display text-lg font-bold leading-tight tabular-nums">{caja}</span>
      {detalle && <span className="text-[10.5px] font-medium text-sub">{detalle}</span>}
    </Link>
  )
}

/**
 * Mapeo de cajas · ¿Dónde guardo?
 * Mercadería nueva: muestra las cajas que tienen lugar (las que no tienen el tilde
 * de llena). Si escaneás el artículo, primero las cajas donde ya hay de ese
 * artículo, para guardarlo junto.
 */
export default function MapeoCajasLugar() {
  const [filas, setFilas] = useState<MapeoCaja[]>([])
  const [lista, setLista] = useState<number[]>([])
  const [llenas, setLlenas] = useState<Set<number>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [articulo, setArticulo] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [camara, setCamara] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [m, l, ll] = await Promise.all([cargarMapeoCajas(), cargarListaCajas(), cargarCajasLlenas()])
      setFilas(m)
      setLista(l)
      setLlenas(ll)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cajas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Códigos por caja */
  const porCaja = useMemo(() => {
    const m = new Map<number, Set<string>>()
    for (const f of filas) m.set(f.caja, (m.get(f.caja) ?? new Set()).add(f.codigo))
    return m
  }, [filas])

  /** Vacías: creadas en la lista, sin nada mapeado y sin tilde de llena */
  const vacias = useMemo(() => lista.filter((n) => !porCaja.has(n) && !llenas.has(n)), [lista, porCaja, llenas])

  /** Con lugar: tienen mercadería y no están llenas (las de menos códigos primero) */
  const conLugar = useMemo<ConLugar[]>(
    () =>
      [...porCaja.entries()]
        .filter(([n]) => !llenas.has(n))
        .map(([caja, cods]) => ({ caja, codigos: cods.size }))
        .sort((a, b) => a.caja - b.caja),
    [porCaja, llenas],
  )

  /** Del artículo escaneado: dónde ya está (con lugar / llenas) */
  const delArticulo = useMemo(() => {
    if (!articulo) return null
    const cajas = filas.filter((f) => f.codigo.toUpperCase() === articulo).map((f) => f.caja).sort((a, b) => a - b)
    return { conLugar: cajas.filter((n) => !llenas.has(n)), llenas: cajas.filter((n) => llenas.has(n)) }
  }, [articulo, filas, llenas])

  const buscar = useCallback(async (texto: string) => {
    const bruto = texto.trim()
    if (!bruto) {
      setArticulo(null)
      return
    }
    setBuscando(true)
    setError(null)
    try {
      const cod = await leerCodigoArticulo(bruto)
      if (!cod) setError(`No se pudo leer el código ${bruto}.`)
      setArticulo(cod ? cod.toUpperCase() : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el código.')
    } finally {
      setBuscando(false)
    }
  }, [])

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    void buscar(input.value)
    input.value = ''
  }

  const primera = delArticulo?.conLugar[0] ?? vacias[0] ?? conLugar[0]?.caja ?? null

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">¿Dónde guardo?</h1>
        <p className="text-sm text-sub">
          Las cajas que tienen lugar (sin el tilde de llena). Escaneá el artículo para ver si ya hay una caja con ese mismo artículo.
        </p>
      </header>

      <div className="space-y-3 pb-4">
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <form onSubmit={onSubmit} className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="Escaneá el artículo nuevo (opcional)…"
                aria-label="Artículo a guardar"
                className="h-12 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              />
            </div>
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => void cargar()}
              disabled={cargando}
              className="btn-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line disabled:opacity-60"
              aria-label="Actualizar"
            >
              <RefreshCw size={18} aria-hidden className={cargando ? 'animate-spin' : ''} />
            </button>
          </form>

          {buscando && (
            <p className="flex items-center gap-1.5 text-xs text-sub">
              <Loader2 size={12} className="animate-spin" aria-hidden /> Leyendo código…
            </p>
          )}

          {/* Sugerencia */}
          {!cargando && primera != null && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <Sparkles size={20} aria-hidden className="shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-xs text-sub">
                  {delArticulo?.conLugar.length
                    ? `Ya hay ${articulo} en esa caja: guardalo junto`
                    : vacias.length
                      ? 'Primera caja vacía'
                      : 'Primera caja con lugar'}
                </p>
                <p className="font-display text-2xl font-bold leading-tight tabular-nums text-ink">Caja {primera}</p>
              </div>
              <Link
                to={`/deposito/mapeo-cajas/escanear?caja=${primera}`}
                className="btn-press inline-flex h-10 shrink-0 items-center rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Guardar ahí
              </Link>
            </div>
          )}

          {delArticulo && (
            <div className="rounded-xl border border-line bg-surface2 p-3 text-sm">
              <p className="font-semibold text-ink">{articulo}</p>
              {delArticulo.conLugar.length === 0 && delArticulo.llenas.length === 0 ? (
                <p className="mt-0.5 text-sub">No está en ninguna caja todavía: usá una vacía o una con lugar.</p>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {delArticulo.conLugar.map((n) => (
                    <ChipCaja key={n} caja={n} destacada detalle="con lugar" />
                  ))}
                  {delArticulo.llenas.map((n) => (
                    <span
                      key={n}
                      className="inline-flex min-h-[3rem] min-w-[4.5rem] flex-col items-center justify-center rounded-xl border border-brand-600/40 bg-brand-600/10 px-3 py-1 text-brand-400"
                    >
                      <span className="font-display text-lg font-bold leading-tight tabular-nums">{n}</span>
                      <span className="text-[10.5px] font-bold">LLENA</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {camara && (
          <ScannerCamara
            onLectura={(t) => {
              setCamara(false)
              void buscar(t)
            }}
            onCerrar={() => setCamara(false)}
          />
        )}

        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
            <AlertTriangle size={16} aria-hidden className="shrink-0" /> {error}
          </p>
        )}

        {cargando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Buscando lugar…
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2.5 flex items-center gap-2 font-display text-base font-bold text-ink">
                <PackageOpen size={18} aria-hidden className="text-emerald-400" /> Cajas vacías
                <span className="text-sm font-medium text-sub">{vacias.length}</span>
              </h2>
              {vacias.length ? (
                <div className="flex flex-wrap gap-2">
                  {vacias.map((n) => <ChipCaja key={n} caja={n} />)}
                </div>
              ) : (
                <p className="text-sm text-sub">
                  {lista.length
                    ? 'No quedan cajas vacías de la lista.'
                    : 'Para ver las vacías, creá los números en «Lista de cajas».'}
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2.5 flex items-center gap-2 font-display text-base font-bold text-ink">
                <Package size={18} aria-hidden className="text-orange-500" /> Con mercadería y con lugar
                <span className="text-sm font-medium text-sub">{conLugar.length}</span>
              </h2>
              {conLugar.length ? (
                <div className="flex flex-wrap gap-2">
                  {conLugar.map((c) => (
                    <ChipCaja key={c.caja} caja={c.caja} detalle={`${c.codigos} ${c.codigos === 1 ? 'código' : 'códigos'}`} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-sub">Todas las cajas con mercadería están marcadas como llenas.</p>
              )}
            </section>

            {llenas.size > 0 && (
              <p className="text-xs text-sub">
                {llenas.size} {llenas.size === 1 ? 'caja marcada llena no aparece' : 'cajas marcadas llenas no aparecen'}. El tilde se pone o se saca al escanear o en «Cajas mapeadas».
              </p>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
