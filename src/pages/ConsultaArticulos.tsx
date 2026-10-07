import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Download,
  Loader2,
  MapPin,
  PackageSearch,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import {
  colorEtiqueta,
  consultarArticulos,
  filasParaExcel,
  VISTA_ARTICULOS,
  type Articulo,
} from '@/lib/articulosConsulta'
import { usePermisosArea } from '@/hooks/usePermisosArea'

/** Espera a que se termine de tipear antes de ir al SQL. */
const ESPERA_MS = 400
/** Con menos letras no se consulta (no se trae el listado entero) */
const MIN_CARACTERES = 2

const fmtN = (n: number) => n.toLocaleString('es-AR')

function precio(v: number | null): string {
  if (v === null) return '—'
  return v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "PB-A2" -> "PB · Pasillo A · Nivel 2" */
function etiquetaUbicacion(u: string): string {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/i.exec(u.trim())
  if (!m) return u
  return `${m[1]} · Pasillo ${m[2].toUpperCase()} · Nivel ${Number(m[3])}`
}

function Chip({ children, tono = 'sub' }: { children: ReactNode; tono?: 'sub' | 'naranja' }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        tono === 'naranja' ? 'bg-amber-500/15 text-amber-500' : 'bg-line text-sub'
      }`}
    >
      {children}
    </span>
  )
}

/** Mayorista · F12 Consulta artículos: datos de MITO por artículo + color + talle. */
export default function ConsultaArticulos() {
  // Módulo de solo consulta: se usa el permiso para esconder la pantalla
  const { ver: puedeVer } = usePermisosArea('mayorista.articulos')

  const [termino, setTermino] = useState('')
  /** Último texto realmente consultado (va con los datos en pantalla) */
  const [consultado, setConsultado] = useState('')
  const [filas, setFilas] = useState<Articulo[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncado, setTruncado] = useState(false)
  const [filtradoEnCliente, setFiltradoEnCliente] = useState(false)
  /** Por defecto solo se ve lo que tiene stock; con la tilde, todas las variantes */
  const [verSinStock, setVerSinStock] = useState(false)
  // Número de consulta en curso: si el usuario sigue tipeando, el resultado viejo se descarta
  const pedido = useRef(0)
  // Último término enviado al SQL, para no preguntar dos veces lo mismo
  const ultimo = useRef<string | null>(null)
  // Debounce pendiente: se anula si el usuario pulsa Enter o "Consultar"
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = useCallback(async (texto: string) => {
    if (temporizador.current !== null) {
      clearTimeout(temporizador.current)
      temporizador.current = null
    }
    const mio = ++pedido.current
    const q = texto.trim()
    ultimo.current = q
    // Sin búsqueda no se consulta nada: solo se muestra lo que se busca
    if (q.length < MIN_CARACTERES) {
      setFilas([])
      setConsultado('')
      setTruncado(false)
      setFiltradoEnCliente(false)
      setError(null)
      setCargando(false)
      return
    }
    setCargando(true)
    setConsultado(q)
    setError(null)
    try {
      const r = await consultarArticulos(q)
      if (mio !== pedido.current) return
      setFilas(r.filas)
      setTruncado(r.truncado)
      setFiltradoEnCliente(r.filtradoEnCliente)
    } catch (e) {
      if (mio !== pedido.current) return
      setFilas([])
      setTruncado(false)
      setFiltradoEnCliente(false)
      setError(e instanceof Error ? e.message : 'No se pudo consultar el SQL Server.')
    } finally {
      if (mio === pedido.current) setCargando(false)
    }
  }, [])

  // Al entrar no trae nada: busca solo cuando se escribe, esperando a que se termine
  // de tipear. El botón "Consultar" y el Enter hacen el pedido al instante.
  useEffect(() => {
    const q = termino.trim()
    if (ultimo.current === q) return
    if (q.length < MIN_CARACTERES) {
      void cargar(q)
      return
    }
    if (temporizador.current !== null) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      temporizador.current = null
      void cargar(q)
    }, ESPERA_MS)
    return () => {
      if (temporizador.current !== null) clearTimeout(temporizador.current)
    }
  }, [termino, cargar])

  const visibles = useMemo(
    () => (verSinStock ? filas : filas.filter((f) => (f.stock ?? 0) > 0)),
    [filas, verSinStock],
  )
  const ocultasSinStock = filas.length - visibles.length

  // Banda por color: cada vez que cambia el artículo+color se alterna el fondo,
  // así un código con 2 colores se ve en dos bloques
  const bandaOscura = useMemo(() => {
    const out: boolean[] = []
    let oscura = false
    let anterior = ''
    visibles.forEach((f, i) => {
      const clave = `${f.idArticulo}|${f.colorCodigo || f.color}`
      if (i > 0 && clave !== anterior) oscura = !oscura
      anterior = clave
      out.push(oscura)
    })
    return out
  }, [visibles])

  async function exportar() {
    if (visibles.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasParaExcel(visibles)), 'Artículos')
    const sufijo = consultado ? `_${consultado.replace(/[^\w-]+/g, '_')}` : ''
    XLSX.writeFile(wb, `consulta_articulos${sufijo}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const { stockTotal, conStock, conUbicacion } = useMemo(
    () => ({
      stockTotal: visibles.reduce((s, f) => s + (f.stock ?? 0), 0),
      conStock: visibles.filter((f) => (f.stock ?? 0) > 0).length,
      conUbicacion: visibles.filter((f) => f.ubicaciones.length > 0).length,
    }),
    [visibles],
  )

  if (!puedeVer) {
    return (
      <Layout>
        <BackButton />
        <p className="mt-6 rounded-xl border border-line bg-surface p-6 text-sm text-sub">
          No tenés permiso para ver la consulta de artículos.
        </p>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <PackageSearch size={22} className="text-amber-500" aria-hidden /> F12 · Consulta artículos
          </h1>
          <p className="mt-1 text-sm text-sub">
            Datos de MITO por artículo + color + talle. Vista del SQL: <span className="font-mono text-xs">{VISTA_ARTICULOS}</span>
          </p>
        </div>
        <button
          onClick={() => void exportar()}
          disabled={visibles.length === 0}
          className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
        >
          <Download size={16} aria-hidden /> Excel
        </button>
      </header>

      <div className="space-y-3 pb-4">
        {/* Buscador */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={termino}
              onChange={(e) => setTermino(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                // Se anula el debounce pendiente y se consulta ya
                setTimeout(() => void cargar(termino.trim()), 0)
              }}
              placeholder="Código o nombre del artículo…"
              aria-label="Buscar artículo"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
            {termino && (
              <button
                onClick={() => setTermino('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink"
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
          <button
            onClick={() => void cargar(termino.trim())}
            disabled={cargando || termino.trim().length < MIN_CARACTERES}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
            title="Consultar"
          >
            <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} aria-hidden />
            <span className="hidden sm:inline">Consultar</span>
          </button>
          <label className="inline-flex h-11 cursor-pointer select-none items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2">
            <input
              type="checkbox"
              checked={verSinStock}
              onChange={(e) => setVerSinStock(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Sin stock
          </label>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
            <p className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {error}
                <span className="mt-1 block text-xs text-sub">
                  Revisá que la vista <span className="font-mono">{VISTA_ARTICULOS}</span> esté creada en el SQL Server y
                  habilitada en Configuraciones → Conexión SQL.
                </span>
              </span>
            </p>
          </div>
        )}

        {/* Resumen */}
        {visibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-sub">
            <span className="font-semibold tabular-nums text-ink">{fmtN(visibles.length)} SKU</span>
            <span>
              <span className="font-semibold tabular-nums text-ink">{fmtN(conStock)}</span> con stock
            </span>
            <span>
              Total <span className="font-semibold tabular-nums text-ink">{fmtN(stockTotal)}</span> unidades
            </span>
            <span>
              <span className="font-semibold tabular-nums text-ink">{fmtN(conUbicacion)}</span> con ubicación
            </span>
            {ocultasSinStock > 0 && (
              <span>· {fmtN(ocultasSinStock)} sin stock ocultos (marcá "Sin stock" para verlos)</span>
            )}
            {truncado && (
              <span className="text-amber-500">
                · se trajo el máximo de filas por consulta: acotá la búsqueda
              </span>
            )}
            {filtradoEnCliente && !truncado && (
              <span className="text-sub/80">· el SQL no aplicó el filtro: se acotó en el navegador</span>
            )}
          </div>
        )}

        {!consultado && !cargando ? (
          <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-sub">
            <Search size={22} aria-hidden />
            {termino.trim().length > 0
              ? `Escribí al menos ${MIN_CARACTERES} caracteres para buscar.`
              : 'Escribí un código o nombre de artículo para buscar.'}
          </p>
        ) : cargando && filas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Consultando el SQL Server…
          </div>
        ) : visibles.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
            {filas.length > 0
              ? `"${consultado}" no tiene stock en MITO (${fmtN(filas.length)} variantes sin stock). Marcá "Sin stock" para verlas.`
              : consultado
                ? `Ningún artículo coincide con "${consultado}".`
                : 'La vista del SQL Server no devolvió artículos.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {['ID artículo', 'Color', 'Talle', 'Nombre completo', 'Material', 'Grupo', 'Stock en MITO', 'Pedido', 'Ubicación', 'Precio'].map(
                      (c) => (
                        <th
                          key={c}
                          scope="col"
                          className={`whitespace-nowrap border-b border-line bg-surface2 px-3 py-2.5 text-xs font-semibold text-sub ${
                            c === 'Stock en MITO' || c === 'Pedido' || c === 'Precio' ? 'text-right' : ''
                          }`}
                        >
                          {c}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f, i) => (
                    <tr
                      key={`${f.idArticulo}|${f.colorCodigo}|${f.color}|${f.talle}|${i}`}
                      className={`${bandaOscura[i] ? 'banda-oscura' : ''} ${i > 0 && bandaOscura[i] !== bandaOscura[i - 1] ? 'banda-inicio' : ''}`}
                    >
                      <td className="border-b border-line/50 px-3 py-2 align-top">
                        <span className="block font-mono text-[13px] font-semibold text-ink">{f.idArticulo || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap border-b border-line/50 px-3 py-2 align-top">
                        {f.color || f.colorCodigo ? <Chip tono="naranja">{colorEtiqueta(f)}</Chip> : <span className="text-sub">—</span>}
                      </td>
                      <td className="whitespace-nowrap border-b border-line/50 px-3 py-2 align-top">
                        {f.talle ? <Chip>{f.talle}</Chip> : <span className="text-sub">—</span>}
                      </td>
                      <td className="border-b border-line/50 px-3 py-2 align-top text-ink">
                        {f.nombre || <span className="text-sub">—</span>}
                      </td>
                      <td className="border-b border-line/50 px-3 py-2 align-top text-sub">{f.material || '—'}</td>
                      <td className="border-b border-line/50 px-3 py-2 align-top text-sub">{f.grupo || '—'}</td>
                      <td className="border-b border-line/50 px-3 py-2 text-right align-top">
                        {f.stock === null ? (
                          <span className="text-sub">—</span>
                        ) : (
                          <span
                            className={`font-semibold tabular-nums ${f.stock > 0 ? 'text-emerald-600' : 'text-sub'}`}
                          >
                            {fmtN(f.stock)}
                          </span>
                        )}
                      </td>
                      <td className="border-b border-line/50 px-3 py-2 text-right align-top">
                        {f.pedido ? (
                          <span className="font-semibold tabular-nums text-amber-500">{fmtN(f.pedido)}</span>
                        ) : (
                          <span className="text-sub">{f.pedido === null ? '—' : '0'}</span>
                        )}
                      </td>
                      <td className="border-b border-line/50 px-3 py-2 align-top">
                        {f.ubicaciones.length === 0 ? (
                          <span className="text-sub">Sin ubicación</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {f.ubicaciones.map((u) => (
                              <li key={u} className="flex items-center gap-1 text-xs text-ink" title={etiquetaUbicacion(u)}>
                                <MapPin size={12} className="shrink-0 text-amber-500" aria-hidden />
                                <span className="font-mono">{u}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="border-b border-line/50 px-3 py-2 text-right align-top font-medium tabular-nums text-ink">
                        {precio(f.precio)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
