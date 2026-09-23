import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, Loader2, Plus, Search, Table2, X } from 'lucide-react'
import { listarBases, listarObjetos, muestraObjeto, type FilaSql, type ObjetoSql } from '@/lib/sqlApi'

const MAX_LISTA = 200

/**
 * Explorador del SQL Server: primero se elige la base, después la tabla o vista.
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

  useEffect(() => {
    listarBases()
      .then(setBases)
      .catch((e) => {
        setBases([])
        setError(e instanceof Error ? e.message : 'No se pudieron listar las bases.')
      })
  }, [])

  async function elegirBase(b: string) {
    setBase(b)
    setObjetos(null)
    setMuestra(null)
    setFiltro('')
    if (!b) return
    setCargando(true)
    setError(null)
    try {
      setObjetos(await listarObjetos(b))
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[200px] flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">1. Base de datos</span>
          <select
            value={base}
            onChange={(e) => void elegirBase(e.target.value)}
            disabled={!bases?.length}
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
          >
            <option value="">
              {bases === null ? 'Cargando bases…' : bases.length ? 'Elegí una base…' : 'Sin bases disponibles'}
            </option>
            {bases?.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {objetos && (
          <>
            <label className="block min-w-[180px] flex-1">
              <span className="mb-1 block text-xs font-medium text-sub">2. Buscar tabla o vista</span>
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
        )}
      </div>

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
              const completo = `${base}.${o.esquema}.${o.nombre}`
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
