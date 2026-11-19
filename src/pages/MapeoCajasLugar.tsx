import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2, ScanLine, PackageOpen, Package, Sparkles, AlertTriangle, RefreshCw, Camera, CameraOff, Shirt, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import { descripcionesDeArticulos } from '@/lib/mapeo'
import {
  cargarCajasLlenas, cargarListaCajas, cargarMapeoCajas, leerCodigoArticulo, type MapeoCaja,
} from '@/lib/mapeoCajas'

/** Cuántas cajas vacías se ofrecen como candidatas al escanear (el resto, abajo) */
const VACIAS_CANDIDATAS = 8

/** Tipo de prenda: la primera palabra de la descripción ("JEAN MOM TIRO ALTO" -> "JEAN") */
function tipoDe(descripcion: string | undefined): string | null {
  const p = (descripcion ?? '').trim().toUpperCase().split(/\s+/)[0]
  return p && p.length >= 3 ? p : null
}

/** Chip de caja: lleva a Escanear con esa caja ya elegida */
function ChipCaja({ caja, detalle, tono = 'neutro' }: { caja: number; detalle?: string; tono?: 'verde' | 'azul' | 'neutro' }) {
  const colores = {
    verde: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25',
    azul: 'border-sky-500/50 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
    neutro: 'border-line bg-surface2 text-ink hover:bg-line',
  }[tono]
  return (
    <Link
      to={`/deposito/mapeo-cajas/escanear?caja=${caja}`}
      className={`btn-press inline-flex min-h-[3rem] min-w-[4.5rem] flex-col items-center justify-center rounded-xl border px-3 py-1 transition ${colores}`}
      title={`Guardar en la caja ${caja}`}
    >
      <span className="font-display text-lg font-bold leading-tight tabular-nums">{caja}</span>
      {detalle && <span className="text-[10.5px] font-medium opacity-80">{detalle}</span>}
    </Link>
  )
}

interface Candidatas {
  /** ya tienen este artículo y no están llenas */
  mismo: number[]
  /** tienen prendas del mismo tipo (JEAN, REMERA…) y no están llenas: caja + cuántos códigos de ese tipo */
  parecidas: { caja: number; cant: number }[]
  /** vacías de la lista (las primeras) */
  vacias: number[]
  /** tienen este artículo pero están llenas (solo para avisar) */
  llenasConEste: number[]
}

/**
 * Mapeo de cajas · ¿Dónde guardo?
 * Escaneás el artículo que entra y te dice qué cajas pueden tener lugar, en este orden:
 * 1) las que ya tienen ese artículo, 2) las que tienen prendas del mismo tipo,
 * 3) las vacías. Las que tienen el tilde de llena nunca se ofrecen.
 * Sin escanear, muestra todas las cajas con lugar.
 */
export default function MapeoCajasLugar() {
  const [filas, setFilas] = useState<MapeoCaja[]>([])
  const [lista, setLista] = useState<number[]>([])
  const [llenas, setLlenas] = useState<Set<number>>(new Set())
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [articulo, setArticulo] = useState<string | null>(null)
  const [descArticulo, setDescArticulo] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [camara, setCamara] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco vuelve al casillero
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [m, l, ll] = await Promise.all([cargarMapeoCajas(), cargarListaCajas(), cargarCajasLlenas()])
      setFilas(m)
      setLista(l)
      setLlenas(ll)
      // Para "prendas parecidas": no frena la pantalla si falla
      descripcionesDeArticulos(m.map((f) => f.codigo)).then(setDescripciones).catch(() => { /* sin parecidas */ })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las cajas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    enfocar()
  }, [cargar, enfocar])

  /** Códigos por caja */
  const porCaja = useMemo(() => {
    const m = new Map<number, Set<string>>()
    for (const f of filas) m.set(f.caja, (m.get(f.caja) ?? new Set()).add(f.codigo.toUpperCase()))
    return m
  }, [filas])

  /** Vacías: creadas en la lista, sin nada mapeado y sin tilde de llena */
  const vacias = useMemo(() => lista.filter((n) => !porCaja.has(n) && !llenas.has(n)), [lista, porCaja, llenas])

  /** Con lugar: tienen mercadería y no están llenas */
  const conLugar = useMemo(
    () =>
      [...porCaja.entries()]
        .filter(([n]) => !llenas.has(n))
        .map(([caja, cods]) => ({ caja, codigos: cods.size }))
        .sort((a, b) => a.caja - b.caja),
    [porCaja, llenas],
  )

  const tipo = tipoDe(descArticulo ?? (articulo ? descripciones.get(articulo) : undefined))

  /** Cajas candidatas para el artículo escaneado */
  const candidatas = useMemo<Candidatas | null>(() => {
    if (!articulo) return null
    const mismo: number[] = []
    const llenasConEste: number[] = []
    const parecidas: { caja: number; cant: number }[] = []
    for (const [caja, cods] of porCaja) {
      if (cods.has(articulo)) {
        if (llenas.has(caja)) llenasConEste.push(caja)
        else mismo.push(caja)
        continue
      }
      if (!tipo || llenas.has(caja)) continue
      const cant = [...cods].filter((c) => tipoDe(descripciones.get(c)) === tipo).length
      if (cant > 0) parecidas.push({ caja, cant })
    }
    return {
      mismo: mismo.sort((a, b) => a - b),
      // Más prendas del mismo tipo primero; a igual cantidad, la de menor número
      parecidas: parecidas.sort((a, b) => b.cant - a.cant || a.caja - b.caja),
      vacias: vacias.slice(0, VACIAS_CANDIDATAS),
      llenasConEste: llenasConEste.sort((a, b) => a - b),
    }
  }, [articulo, porCaja, llenas, tipo, descripciones, vacias])

  const primera = candidatas
    ? candidatas.mismo[0] ?? candidatas.parecidas[0]?.caja ?? candidatas.vacias[0] ?? conLugar[0]?.caja ?? null
    : vacias[0] ?? conLugar[0]?.caja ?? null
  const motivoPrimera = !candidatas
    ? vacias.length ? 'Primera caja vacía' : 'Primera caja con lugar'
    : candidatas.mismo.length
      ? `Ya hay ${articulo} ahí: guardalo junto`
      : candidatas.parecidas.length
        ? `Tiene otras prendas ${tipo}`
        : candidatas.vacias.length
          ? 'No está en ninguna caja: primera vacía'
          : 'Primera caja con lugar'

  const buscar = useCallback(async (texto: string) => {
    const bruto = texto.trim()
    if (!bruto) return
    setBuscando(true)
    setError(null)
    try {
      const cod = (await leerCodigoArticulo(bruto))?.toUpperCase() ?? null
      if (!cod) {
        setError(`No se pudo leer el código ${bruto}.`)
        return
      }
      setArticulo(cod)
      setDescArticulo(null)
      // La descripción del escaneado (puede no estar en ninguna caja todavía)
      descripcionesDeArticulos([cod])
        .then((m) => setDescArticulo(m.get(cod) ?? null))
        .catch(() => { /* sin descripción: sin parecidas */ })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el código.')
    } finally {
      setBuscando(false)
      enfocar()
    }
  }, [enfocar])

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    void buscar(input.value)
    input.value = ''
  }

  function limpiar() {
    setArticulo(null)
    setDescArticulo(null)
    enfocar()
  }

  const hayCandidatas = !!candidatas && (candidatas.mismo.length + candidatas.parecidas.length + candidatas.vacias.length > 0)

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">¿Dónde guardo?</h1>
        <p className="text-sm text-sub">
          Escaneá el artículo que entra y te digo qué cajas pueden tener lugar. Las cajas con el tilde de llena no se ofrecen.
        </p>
      </header>

      <div className="space-y-3 pb-4">
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <form onSubmit={onSubmit} className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <ScanLine size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="Escaneá el artículo a guardar…"
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

          {/* Sugerencia principal */}
          {!cargando && primera != null && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <Sparkles size={20} aria-hidden className="shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-xs text-sub">{motivoPrimera}</p>
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

          {/* Cajas que pueden tener lugar para el escaneado */}
          {candidatas && (
            <div className="space-y-3 rounded-xl border border-line bg-surface2 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-sub">Cajas con lugar para</p>
                  <p className="font-display text-lg font-bold text-ink">{articulo}</p>
                  {descArticulo && <p className="text-xs text-sub">{descArticulo}</p>}
                </div>
                <button
                  onClick={limpiar}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-line hover:text-ink"
                  aria-label="Limpiar"
                  title="Limpiar"
                >
                  <X size={17} aria-hidden />
                </button>
              </div>

              {candidatas.mismo.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-emerald-400">1 · Ya tienen este artículo</p>
                  <div className="flex flex-wrap gap-2">
                    {candidatas.mismo.map((n) => <ChipCaja key={n} caja={n} tono="verde" detalle="mismo art." />)}
                  </div>
                </div>
              )}

              {candidatas.parecidas.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-sky-400">
                    <Shirt size={13} aria-hidden /> {candidatas.mismo.length ? '2' : '1'} · Tienen otras prendas {tipo}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {candidatas.parecidas.map((p) => (
                      <ChipCaja key={p.caja} caja={p.caja} tono="azul" detalle={`${p.cant} ${tipo}`} />
                    ))}
                  </div>
                </div>
              )}

              {candidatas.vacias.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-sub">Vacías</p>
                  <div className="flex flex-wrap gap-2">
                    {candidatas.vacias.map((n) => <ChipCaja key={n} caja={n} />)}
                    {vacias.length > candidatas.vacias.length && (
                      <span className="self-center text-xs text-sub">+{vacias.length - candidatas.vacias.length} más abajo</span>
                    )}
                  </div>
                </div>
              )}

              {!hayCandidatas && (
                <p className="text-sm text-sub">
                  No hay cajas con este artículo ni con prendas {tipo ?? 'parecidas'}, y no quedan vacías. Mirá abajo las que tienen lugar.
                </p>
              )}

              {candidatas.llenasConEste.length > 0 && (
                <p className="text-xs text-brand-400">
                  También está en {candidatas.llenasConEste.length === 1 ? 'la caja' : 'las cajas'}{' '}
                  <b className="tabular-nums">{candidatas.llenasConEste.join(', ')}</b>, pero {candidatas.llenasConEste.length === 1 ? 'está llena' : 'están llenas'}.
                </p>
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
            onCerrar={() => {
              setCamara(false)
              enfocar()
            }}
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
