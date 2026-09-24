import { useMemo, useState } from 'react'
import { Check, Database, Eye, Loader2, Plus, Search, Table2, X } from 'lucide-react'
import { listarBases, listarObjetos, muestraObjeto, type FilaSql, type ObjetoSql } from '@/lib/sqlApi'

const MAX_LISTA = 200

/**
 * Explorador del SQL Server: botón "Consultar bases de datos", se elige una base,
 * botón "Consultar tablas y vistas" y de ahí se elige la tabla o vista.
 * "Agregar" la suma a la lista de vistas expuestas como BASE.esquema.objeto
 * (después hay que apretar "Guardar cambios"). Solo administradores.
 */
export default function ExploradorSql({
  yaAgregadas,
  onAgregar,
}: {
  yaAgregadas: string[]
  onAgregar: (vista: string, label: string) => void
}) {
  const [bases, setBases] = useState<string[] | null>(null)
  const [base, setBase] = useState('')
  const [objetos, setObjetos] = useState<ObjetoSql[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [tipo, setTipo] = useState<'todos' | 'vista' | 'tabla'>('todos')
  const [error, setError] = useState<string | null>(null)
  const [muestra, setMuestra] = useState<{ nombre: string; filas: FilaSql[] | null } | null>(null)

  const [cargandoBases, setCargandoBases] = useState(false)
  // Base de la que se muestran las tablas (puede diferir de la elegida hasta volver a consultar)
  const [baseConsultada, setBaseConsultada] = useState('')

  // Paso 1: botón "Consultar bases de datos"
  async function consultarBases() {
    setCargandoBases(true)
    setError(null)
    try {
      const lista = await listarBases()
      setBases(lista)
      if (!lista.includes(base)) setBase('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron listar las bases.')
    } finally {
      setCargandoBases(false)
    }
  }

  // Paso 2: elegir una base (todavía no consulta nada)
  function elegirBase(b: string) {
    setBase(b)
    setError(null)
  }

  // Paso 3: botón "Consultar tablas y vistas" de la base elegida
  async function consultarObjetos() {
    if (!base) return
    setObjetos(null)
    setMuestra(null)
    setFiltro('')
    setCargando(true)
    setError(null)
    try {
      setObjetos(await listarObjetos(base))
      setBaseConsultada(base)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron listar las tablas.')
    } finally {
      setCargando(false)
    }
  }

  async function verMuestra(nombre: string) {
    setMuestra({ nombre, filas: null })
    try {
      const filas = await muestraObjeto(nombre)
      setMuestra((m) => (m?.nombre === nombre ? { nombre, filas } : m))
    } catch (e) {
      setMuestra(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer la muestra.')
    }
  }

  const agregadas = useMemo(() => new Set(yaAgregadas.map((v) => v.toLowerCase())), [yaAgregadas])

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    return (objetos ?? []).filter(
      (o) => (tipo === 'todos' || o.tipo === tipo) && (!t || `${o.esquema}.${o.nombre}`.toLowerCase().includes(t)),
    )
  }, [objetos, filtro, tipo])

  const columnas = muestra?.filas?.length ? Object.keys(muestra.filas[0]) : []

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface2 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Table2 size={15} aria-hidden /> Explorar el SQL Server
      </p>

      {error && <p className="mb-2 text-sm text-brand-400">{error}</p>}

      {/* 1. Consultar bases */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void consultarBases()}
          disabled={cargandoBases}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {cargandoBases ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Database size={14} aria-hidden />}
          Consultar bases de datos
        </button>
        {bases && <span className="text-xs text-sub">{bases.length} bases disponibles</span>}
      </div>

      {/* 2. Elegir base + consultar sus tablas y vistas */}
      {bases && bases.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[200px] flex-1">
            <span className="mb-1 block text-xs font-medium text-sub">Base de datos</span>
            <select
              value={base}
              onChange={(e) => elegirBase(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <option value="">Elegí una base…</option>
              {bases.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void consultarObjetos()}
            disabled={!base || cargando}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50"
          >
            {cargando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Table2 size={14} aria-hidden />}
            Consultar tablas y vistas
          </button>
        </div>
      )}

      {/* 3. Buscar dentro de lo consultado */}
      {objetos && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <>
            <label className="block min-w-[180px] flex-1">
              <span className="mb-1 block text-xs font-medium text-sub">Buscar en {baseConsultada}</span>
              <div className="relative">
                <Search size={14} aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-sub" />
                <input
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder="equivalencias"
                  className="w-full rounded-lg border border-line bg-surface py-1.5 pl-7 pr-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
              </div>
            </label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as typeof tipo)}
              aria-label="Tipo de objeto"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none"
            >
              <option value="todos">Tablas y vistas</option>
              <option value="vista">Solo vistas</option>
              <option value="tabla">Solo tablas</option>
            </select>
          </>
        </div>
      )}

      {cargando && (
        <p className="mt-3 flex items-center gap-2 text-sm text-sub">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Leyendo {base}…
        </p>
      )}

      {objetos && !cargando && (
        <>
          <p className="mt-3 text-xs text-sub">
            {visibles.length} de {objetos.length} objetos
            {visibles.length > MAX_LISTA && ` · mostrando ${MAX_LISTA}, escribí para filtrar`}
          </p>
          <ul className="mt-1 max-h-80 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line bg-surface">
            {visibles.slice(0, MAX_LISTA).map((o) => {
              const completo = `${baseConsultada}.${o.esquema}.${o.nombre}`
              const ya = agregadas.has(completo.toLowerCase())
              return (
                <li key={completo} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      o.tipo === 'vista' ? 'bg-sky-500/15 text-sky-400' : 'bg-violet-500/15 text-violet-400'
                    }`}
                  >
                    {o.tipo}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink" title={completo}>
                    <span className="text-sub">{o.esquema}.</span>
                    {o.nombre}
                  </span>
                  <button
                    type="button"
                    onClick={() => void verMuestra(completo)}
                    title="Ver las primeras 20 filas"
                    aria-label={`Ver muestra de ${o.nombre}`}
                    className="btn-press shrink-0 rounded-lg p-1.5 text-sub hover:bg-surface2 hover:text-ink"
                  >
                    <Eye size={14} aria-hidden />
                  </button>
                  {ya ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-500">
                      <Check size={13} aria-hidden /> agregada
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAgregar(completo, o.nombre)}
                      className="btn-press inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs font-medium text-ink hover:bg-line"
                    >
                      <Plus size={12} aria-hidden /> Agregar
                    </button>
                  )}
                </li>
              )
            })}
            {visibles.length === 0 && <li className="px-3 py-4 text-center text-xs text-sub">No hay coincidencias.</li>}
          </ul>
        </>
      )}

      {muestra && (
        <div className="mt-3 rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <p className="truncate font-mono text-xs text-sub">{muestra.nombre} · primeras 20 filas</p>
            <button
              type="button"
              onClick={() => setMuestra(null)}
              aria-label="Cerrar muestra"
              className="rounded p-1 text-sub hover:bg-surface2 hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          {muestra.filas === null ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-sub">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Leyendo…
            </p>
          ) : muestra.filas.length === 0 ? (
            <p className="px-3 py-3 text-sm text-sub">Sin filas.</p>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="table-head sticky top-0">
                  <tr>
                    {columnas.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {muestra.filas.map((f, i) => (
                    <tr key={i} className="border-t border-line/60">
                      {columnas.map((c) => (
                        <td key={c} className="whitespace-nowrap px-2 py-1 text-ink">
                          {f[c] == null ? '' : String(f[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
