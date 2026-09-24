import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ScanLine, ListOrdered, Loader2, Check, AlertTriangle, Camera, CameraOff, MapPin,
  Search, Trash2, Download, RefreshCw, MoveDown,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/** Fila de public.mapeo_deposito (sql/mapeo_deposito.sql) */
interface Mapeo {
  id: string
  orden: number
  codigo: string
  color: string | null
  talle: string | null
  ubicacion: string | null
  escaneado_at: string
}

/** Lo que devuelve mapeo_escanear() */
interface FilaEscaneo {
  estado: 'nuevo' | 'movido' | 'ya_mapeado'
  id: string
  orden: number
  codigo: string
  color: string | null
  talle: string | null
  ubicacion: string | null
}

type Vista = 'escanear' | 'orden'

const COLUMNAS = 'id,orden,codigo,color,talle,ubicacion,escaneado_at'
const CLAVE_UBICACION = 'mapeo_deposito.ubicacion'

function leerUbicacion(): string {
  try {
    return localStorage.getItem(CLAVE_UBICACION) ?? ''
  } catch {
    return ''
  }
}

function guardarUbicacion(u: string) {
  try {
    localStorage.setItem(CLAVE_UBICACION, u)
  } catch { /* sin storage: solo dura la sesión */ }
}

/** Talle numérico con "T" (T38); de letra tal cual (M, L, U) */
function fmtTalle(talle: string | null): string | null {
  if (!talle) return null
  return /^\d/.test(talle) ? `T${talle}` : talle
}

function Etiquetas({ m, chico = false }: { m: Pick<Mapeo, 'codigo' | 'color' | 'talle'>; chico?: boolean }) {
  const talle = fmtTalle(m.talle)
  const txt = chico ? 'text-[11px]' : 'text-xs'
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`${chico ? 'text-sm' : 'text-[15px]'} font-semibold text-ink`}>{m.codigo}</span>
      {m.color && (
        <span className={`rounded-md bg-sky-500/15 px-1.5 py-0.5 ${txt} font-semibold text-sky-400`} title="Color">{m.color}</span>
      )}
      {talle && (
        <span className={`rounded-md bg-violet-500/15 px-1.5 py-0.5 ${txt} font-semibold text-violet-400`} title="Talle">{talle}</span>
      )}
    </span>
  )
}

export default function MapeoDeposito() {
  const { can } = useAuth()
  const puedeEscanear = can('mayorista.mapeo.escanear')
  const puedeBorrar = can('mayorista.mapeo.borrar')

  const [vista, setVista] = useState<Vista>(puedeEscanear ? 'escanear' : 'orden')
  const [filas, setFilas] = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ------------------------------------------------------------------ */
  /*  Carga (paginada: Supabase corta en 1000 filas)                     */
  /* ------------------------------------------------------------------ */
  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const todas: Mapeo[] = []
      const paso = 1000
      for (let desde = 0; ; desde += paso) {
        const { data, error: e } = await supabase
          .from('mapeo_deposito')
          .select(COLUMNAS)
          .order('orden', { ascending: true })
          .range(desde, desde + paso - 1)
        if (e) throw new Error(e.message)
        const lote = (data as Mapeo[] | null) ?? []
        todas.push(...lote)
        if (lote.length < paso) break
      }
      setFilas(todas)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Aplica en pantalla lo que devolvió un escaneo (sin recargar todo) */
  const aplicarEscaneo = useCallback((f: FilaEscaneo) => {
    if (f.estado === 'ya_mapeado') return
    setFilas((prev) => {
      const sin = prev.filter((m) => m.id !== f.id)
      return [
        ...sin,
        {
          id: f.id, orden: f.orden, codigo: f.codigo, color: f.color, talle: f.talle,
          ubicacion: f.ubicacion, escaneado_at: new Date().toISOString(),
        },
      ]
    })
  }, [])

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Mapeo depósito</h1>
        <p className="text-sm text-sub">
          Recorré el depósito escaneando los artículos en el orden en que están.
        </p>
      </header>

      {/* Pestañas */}
      <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1">
        {puedeEscanear && (
          <button
            role="tab"
            aria-selected={vista === 'escanear'}
            onClick={() => setVista('escanear')}
            className={`inline-flex min-h-[2.75rem] items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
              vista === 'escanear' ? 'bg-amber-500/15 text-amber-500' : 'text-sub hover:text-ink'
            }`}
          >
            <ScanLine size={16} aria-hidden /> Escanear
          </button>
        )}
        <button
          role="tab"
          aria-selected={vista === 'orden'}
          onClick={() => setVista('orden')}
          className={`inline-flex min-h-[2.75rem] items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
            puedeEscanear ? '' : 'col-span-2'
          } ${vista === 'orden' ? 'bg-amber-500/15 text-amber-500' : 'text-sub hover:text-ink'}`}
        >
          <ListOrdered size={16} aria-hidden /> Orden mapeado
          <span className="rounded-full bg-line px-1.5 text-xs tabular-nums">{filas.length}</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {vista === 'escanear' && puedeEscanear ? (
        <PanelEscanear filas={filas} onEscaneo={aplicarEscaneo} />
      ) : (
        <PanelOrden
          filas={filas}
          cargando={cargando}
          puedeBorrar={puedeBorrar}
          onRecargar={() => void cargar()}
          onBorrado={(id) => setFilas((prev) => prev.filter((m) => m.id !== id))}
        />
      )}
    </Layout>
  )
}

/* ==================================================================== */
/*  Parte 1: escanear                                                    */
/* ==================================================================== */
function PanelEscanear({ filas, onEscaneo }: { filas: Mapeo[]; onEscaneo: (f: FilaEscaneo) => void }) {
  const [ubicacion, setUbicacion] = useState(leerUbicacion)
  const [camara, setCamara] = useState(false)
  const [enViaje, setEnViaje] = useState(0)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  // Artículo que ya estaba mapeado: se ofrece moverlo a la posición actual
  const [repetido, setRepetido] = useState<{ bruto: string; fila: FilaEscaneo } | null>(null)
  const [moviendo, setMoviendo] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco tiene que volver siempre.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    enfocar()
  }, [enfocar])

  const ubicacionRef = useRef(ubicacion)
  useEffect(() => {
    ubicacionRef.current = ubicacion
    guardarUbicacion(ubicacion)
  }, [ubicacion])

  const escanear = useCallback(
    async (bruto: string, mover = false) => {
      const codigo = bruto.trim()
      if (!codigo || !supabase) return
      setEnViaje((n) => n + 1)
      try {
        const { data, error } = await supabase.rpc('mapeo_escanear', {
          p_codigo: codigo,
          p_ubicacion: ubicacionRef.current.trim() || null,
          p_mover: mover,
        })
        if (error) throw new Error(error.message)
        const f = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneo | null
        if (!f) throw new Error('Sin respuesta del servidor.')
        onEscaneo(f)
        if (f.estado === 'ya_mapeado') {
          setRepetido({ bruto: codigo, fila: f })
          setMensaje({
            ok: false,
            texto: `${f.codigo} ya está mapeado (posición ${f.orden}${f.ubicacion ? ` · ${f.ubicacion}` : ''})`,
          })
        } else {
          setRepetido(null)
          setMensaje({
            ok: true,
            texto: `${f.estado === 'movido' ? 'Movido' : 'Mapeado'}: ${[f.codigo, f.color, fmtTalle(f.talle)].filter(Boolean).join(' · ')}`,
          })
        }
      } catch (e) {
        setRepetido(null)
        setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo guardar el escaneo.' })
      } finally {
        setEnViaje((n) => n - 1)
      }
    },
    [onEscaneo],
  )

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    const v = input.value
    input.value = ''
    void escanear(v)
    enfocar()
  }

  async function moverRepetido() {
    if (!repetido) return
    setMoviendo(true)
    await escanear(repetido.bruto, true)
    setMoviendo(false)
    enfocar()
  }

  // Últimos mapeados (lo más nuevo arriba)
  const ultimos = useMemo(() => [...filas].sort((a, b) => b.orden - a.orden).slice(0, 15), [filas])

  return (
    <div className="space-y-3 pb-4">
      <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-4 shadow-soft">
        {/* Ubicación actual: queda fija para todos los escaneos siguientes */}
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-sub">
            <MapPin size={13} aria-hidden /> Ubicación actual (pasillo / estante) — opcional
          </span>
          <input
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                enfocar()
              }
            }}
            placeholder="Ej: P1-E3"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </label>

        {/* Entrada: escáner inalámbrico (escribe + Enter), teclado o cámara */}
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            name="codigo"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="Escaneá o escribí el código…"
            aria-label="Código de barra"
            className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
          <button
            type="button"
            onClick={() => setCamara((c) => !c)}
            className="btn-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
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
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium ${
                  mensaje.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {mensaje.ok ? <Check size={16} className="shrink-0" aria-hidden /> : <AlertTriangle size={16} className="shrink-0" aria-hidden />}
                  <span className="truncate">{mensaje.texto}</span>
                </span>
                {repetido && (
                  <button
                    onClick={() => void moverRepetido()}
                    disabled={moviendo}
                    className="inline-flex min-h-[2.25rem] shrink-0 items-center gap-1 rounded-lg border border-current px-2.5 text-xs font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
                    title="Lo saca de su posición y lo pone al final, con la ubicación actual"
                  >
                    <MoveDown size={14} aria-hidden /> Mover acá
                  </button>
                )}
              </div>
            )}
            {enViaje > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-sub">
                <Loader2 size={12} className="animate-spin" aria-hidden />
                Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
              </p>
            )}
          </div>
        )}
      </div>

      {camara && (
        <ScannerCamara
          onLectura={(t) => void escanear(t)}
          onCerrar={() => {
            setCamara(false)
            enfocar()
          }}
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-display text-sm font-semibold text-ink">Últimos mapeados</span>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-500">
            {filas.length} artículos
          </span>
        </div>
        {ultimos.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-sub">Todavía no hay nada mapeado. Escaneá el primer artículo.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {ultimos.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-sub">#{m.orden}</span>
                <span className="min-w-0 flex-1">
                  <Etiquetas m={m} chico />
                </span>
                {m.ubicacion && (
                  <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{m.ubicacion}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ==================================================================== */
/*  Parte 2: orden mapeado                                               */
/* ==================================================================== */
function PanelOrden({
  filas, cargando, puedeBorrar, onRecargar, onBorrado,
}: {
  filas: Mapeo[]
  cargando: boolean
  puedeBorrar: boolean
  onRecargar: () => void
  onBorrado: (id: string) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [borrar, setBorrar] = useState<Mapeo | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Posición = lugar en el recorrido (1..n), sin huecos aunque se borre algo
  const ordenadas = useMemo(
    () => [...filas].sort((a, b) => a.orden - b.orden).map((m, i) => ({ ...m, pos: i + 1 })),
    [filas],
  )

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase()
    if (!q) return ordenadas
    return ordenadas.filter((m) =>
      [m.codigo, m.color, m.talle, m.ubicacion].some((v) => String(v ?? '').toUpperCase().includes(q)),
    )
  }, [ordenadas, busqueda])

  // Agrupa tramos consecutivos con la misma ubicación (respeta el recorrido)
  const grupos = useMemo(() => {
    const out: { ubicacion: string | null; items: typeof visibles }[] = []
    for (const m of visibles) {
      const ult = out[out.length - 1]
      if (ult && ult.ubicacion === m.ubicacion) ult.items.push(m)
      else out.push({ ubicacion: m.ubicacion, items: [m] })
    }
    return out
  }, [visibles])

  async function confirmarBorrar() {
    if (!borrar || !supabase) return
    setBorrando(true)
    setError(null)
    const { error: e } = await supabase.from('mapeo_deposito').delete().eq('id', borrar.id)
    setBorrando(false)
    if (e) {
      setError(e.message)
    } else {
      onBorrado(borrar.id)
    }
    setBorrar(null)
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const datos = ordenadas.map((m) => ({
      Posición: m.pos,
      Ubicación: m.ubicacion ?? '',
      Artículo: m.codigo,
      Color: m.color ?? '',
      Talle: m.talle ?? '',
      Escaneado: new Date(m.escaneado_at).toLocaleString('es-AR'),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="space-y-3 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar artículo o ubicación…"
            aria-label="Buscar"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </div>
        <button
          onClick={onRecargar}
          disabled={cargando}
          className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
          title="Actualizar"
        >
          <RefreshCw size={16} aria-hidden className={cargando ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
        <button
          onClick={() => void exportar()}
          disabled={ordenadas.length === 0}
          className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
        >
          <Download size={16} aria-hidden /> Excel
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      {cargando && filas.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando mapeo…
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
          {busqueda ? 'No hay artículos que coincidan con la búsqueda.' : 'Todavía no hay nada mapeado.'}
        </p>
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => (
            <div key={`${g.items[0].id}`} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <span className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink">
                  <MapPin size={14} aria-hidden className="text-amber-500" />
                  {g.ubicacion ?? <span className="font-normal text-sub">Sin ubicación</span>}
                </span>
                <span className="text-xs tabular-nums text-sub">
                  #{g.items[0].pos}{g.items.length > 1 ? `–${g.items[g.items.length - 1].pos}` : ''}
                </span>
              </div>
              <ul className="divide-y divide-line/60">
                {g.items.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-sub">{m.pos}</span>
                    <span className="min-w-0 flex-1">
                      <Etiquetas m={m} chico />
                    </span>
                    {puedeBorrar && (
                      <button
                        onClick={() => setBorrar(m)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                        title="Quitar del mapeo"
                        aria-label={`Quitar ${m.codigo} del mapeo`}
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!borrar}
        title="¿Quitar del mapeo?"
        message={borrar ? `${borrar.codigo} sale del orden. Si lo volvés a escanear, entra al final.` : ''}
        confirmLabel="Quitar"
        busy={borrando}
        onCancel={() => setBorrar(null)}
        onConfirm={() => void confirmarBorrar()}
      />
    </div>
  )
}
