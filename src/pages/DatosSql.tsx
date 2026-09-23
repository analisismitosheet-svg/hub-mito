import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Database, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { cargarVistas, guardarVistas, leerVista, type FilaSql, type VistaDef } from '@/lib/sqlApi'
import { usePermisosArea } from '@/hooks/usePermisosArea'

const MAX_FILAS_UI = 300
const NOMBRE_VISTA = /^[A-Za-z0-9_]+$/

function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace('T', ' ').slice(0, 19)
  return String(v)
}

export default function DatosSql() {
  const permisos = usePermisosArea('datos_sql')
  const puedeGestionar = permisos.crear || permisos.editar || permisos.borrar

  const [vistas, setVistas] = useState<VistaDef[] | null>(null)
  const [vista, setVista] = useState('')
  const [filas, setFilas] = useState<FilaSql[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Gestión de vistas
  const [dirty, setDirty] = useState(false)
  const [nuevaVista, setNuevaVista] = useState('')
  const [nuevaLabel, setNuevaLabel] = useState('')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [probandoVista, setProbandoVista] = useState<string | null>(null)
  const [resultadoPrueba, setResultadoPrueba] = useState<{ vista: string; ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    let activo = true
    void cargarVistas().then((vs) => {
      if (!activo) return
      setVistas(vs)
      setVista(vs[0]?.vista ?? '')
    })
    return () => {
      activo = false
    }
  }, [])

  const cargar = useCallback(async (v: string) => {
    if (!v) return
    setCargando(true)
    setError(null)
    setFilas([])
    try {
      setFilas(await leerVista(v))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (vista) void cargar(vista)
  }, [vista, cargar])

  const columnas = useMemo(() => {
    const cols: string[] = []
    for (const f of filas.slice(0, 20)) {
      for (const k of Object.keys(f)) if (!cols.includes(k)) cols.push(k)
    }
    return cols
  }, [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtradas = q
      ? filas.filter((f) => Object.values(f).some((val) => String(val ?? '').toLowerCase().includes(q)))
      : filas
    return filtradas.slice(0, MAX_FILAS_UI)
  }, [filas, busqueda])

  /* ----------------------- CRUD de vistas ----------------------- */

  function agregar(e: FormEvent) {
    e.preventDefault()
    const nombre = nuevaVista.trim()
    if (!NOMBRE_VISTA.test(nombre)) {
      setError('El nombre de la vista solo puede tener letras, números y guión bajo.')
      return
    }
    if ((vistas ?? []).some((v) => v.vista.toLowerCase() === nombre.toLowerCase())) {
      setError('Esa vista ya está en la lista.')
      return
    }
    setError(null)
    setOkMsg(null)
    setVistas((prev) => [...(prev ?? []), { vista: nombre, label: nuevaLabel.trim() || nombre }])
    setNuevaVista('')
    setNuevaLabel('')
    setDirty(true)
  }

  function empezarEdicion(v: VistaDef) {
    setError(null)
    setEditandoId(v.vista)
    setEditNombre(v.vista)
    setEditLabel(v.label)
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setEditNombre('')
    setEditLabel('')
  }

  function guardarEdicion() {
    if (editandoId === null || vistas === null) return
    const nombre = editNombre.trim()
    if (!NOMBRE_VISTA.test(nombre)) {
      setError('El nombre de la vista solo puede tener letras, números y guión bajo.')
      return
    }
    if (vistas.some((v) => v.vista !== editandoId && v.vista.toLowerCase() === nombre.toLowerCase())) {
      setError('Esa vista ya está en la lista.')
      return
    }
    setError(null)
    setOkMsg(null)
    setVistas((prev) =>
      (prev ?? []).map((v) =>
        v.vista === editandoId ? { vista: nombre, label: editLabel.trim() || nombre } : v,
      ),
    )
    setVista((prev) => (prev === editandoId ? nombre : prev))
    cancelarEdicion()
    setDirty(true)
  }

  function quitar(nombre: string) {
    if (!confirm(`¿Quitar la vista "${nombre}" de la lista? No borra nada en el SQL Server.`)) return
    const sin = (vistas ?? []).filter((v) => v.vista !== nombre)
    setVistas(sin)
    setVista((prev) => (prev === nombre ? sin[0]?.vista ?? '' : prev))
    setEditandoId((prev) => (prev === nombre ? null : prev))
    setOkMsg(null)
    setDirty(true)
  }

  async function probar(nombre: string) {
    setProbandoVista(nombre)
    setResultadoPrueba(null)
    setError(null)
    const t0 = performance.now()
    try {
      const rows = await leerVista(nombre, 1)
      const ms = Math.round(performance.now() - t0)
      setResultadoPrueba({ vista: nombre, ok: true, msg: `Conexión OK · devolvió ${rows.length} fila(s) en ${ms} ms` })
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      setResultadoPrueba({
        vista: nombre,
        ok: false,
        msg: `${e instanceof Error ? e.message : 'Error desconocido.'} (${ms} ms)`,
      })
    } finally {
      setProbandoVista(null)
    }
  }

  async function guardarLista() {
    if (vistas === null) return
    setGuardando(true)
    setError(null)
    setOkMsg(null)
    const { error: err } = await guardarVistas(vistas)
    setGuardando(false)
    if (err) {
      setError(`No se pudo guardar: ${err}`)
      return
    }
    setDirty(false)
    setOkMsg('Cambios guardados. Ya están activos para todos los usuarios.')
    setVista((prev) => (vistas.some((v) => v.vista === prev) ? prev : vistas[0]?.vista ?? ''))
  }

  async function descartar() {
    setError(null)
    setOkMsg(null)
    setEditandoId(null)
    const vs = await cargarVistas()
    setVistas(vs)
    setVista((prev) => (vs.some((v) => v.vista === prev) ? prev : vs[0]?.vista ?? ''))
    setDirty(false)
  }

  if (vistas === null) {
    return (
      <Layout>
        <BackButton />
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Datos SQL</h1>
          <p className="mt-1 text-sm text-sub">Consulta en vivo de vistas del SQL Server.</p>
        </div>
        <button
          onClick={() => void cargar(vista)}
          disabled={cargando || !vista}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}
      {okMsg && (
        <p role="status" className="mb-4 rounded-xl border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-500">
          {okMsg}
        </p>
      )}

      {puedeGestionar && (
        <section className="mb-5 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-semibold text-ink">Gestión de vistas</h2>
            {dirty && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-500">
                Hay cambios sin guardar
              </span>
            )}
          </div>
          <p className="mb-3 text-sm text-sub">
            Las vistas deben existir en el SQL Server (DWH). Acá las habilitás y ponés nombre legible para todo el hub,
            sin redeploy.
          </p>

          {vistas.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {vistas.map((v) => {
                const editando = editandoId === v.vista
                return (
                  <li
                    key={v.vista}
                    className="rounded-xl border border-line bg-surface2 px-3 py-2"
                  >
                    {editando ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-sub">Nombre</span>
                          <input
                            value={editNombre}
                            onChange={(e) => setEditNombre(e.target.value)}
                            autoFocus
                            className="w-44 rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                          />
                        </label>
                        <label className="block min-w-[160px] flex-1">
                          <span className="mb-1 block text-xs font-medium text-sub">Etiqueta</span>
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                          />
                        </label>
                        <button
                          onClick={guardarEdicion}
                          className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                        >
                          <Check size={14} aria-hidden /> Guardar
                        </button>
                        <button
                          onClick={cancelarEdicion}
                          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-sub hover:bg-line"
                        >
                          <X size={14} aria-hidden /> Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm text-ink">{v.vista}</p>
                          {v.label !== v.vista && <p className="truncate text-xs text-sub">{v.label}</p>}
                          {resultadoPrueba?.vista === v.vista && (
                            <p
                              role="status"
                              className={`mt-0.5 text-xs ${
                                resultadoPrueba.ok ? 'text-emerald-500' : 'text-brand-400'
                              }`}
                            >
                              {resultadoPrueba.ok ? '✓ ' : '✕ '}
                              {resultadoPrueba.msg}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => void probar(v.vista)}
                            disabled={probandoVista !== null}
                            className="btn-press inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-sub hover:bg-brand-600/20 hover:text-brand-400 disabled:opacity-50"
                            title={`Probar ${v.vista}`}
                          >
                            {probandoVista === v.vista ? (
                              <Loader2 size={13} className="animate-spin" aria-hidden />
                            ) : (
                              <RefreshCw size={13} aria-hidden />
                            )}
                            Probar
                          </button>
                          <button
                            onClick={() => empezarEdicion(v)}
                            disabled={probandoVista !== null}
                            aria-label={`Editar ${v.vista}`}
                            className="btn-press rounded-lg p-1.5 text-sub hover:bg-brand-600/20 hover:text-brand-400 disabled:opacity-50"
                          >
                            <Pencil size={14} aria-hidden />
                          </button>
                          <button
                            onClick={() => quitar(v.vista)}
                            disabled={probandoVista !== null}
                            aria-label={`Quitar ${v.vista}`}
                            className="btn-press rounded-lg p-1.5 text-sub hover:bg-brand-600/20 hover:text-brand-400 disabled:opacity-50"
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <form onSubmit={agregar} className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Nombre de la vista</span>
              <input
                value={nuevaVista}
                onChange={(e) => setNuevaVista(e.target.value)}
                placeholder="vw_equi"
                pattern="[A-Za-z0-9_]+"
                required
                className="w-44 rounded-lg border border-line bg-surface2 px-2 py-1.5 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              />
            </label>
            <label className="block min-w-[200px] flex-1">
              <span className="mb-1 block text-xs font-medium text-sub">Etiqueta (opcional)</span>
              <input
                value={nuevaLabel}
                onChange={(e) => setNuevaLabel(e.target.value)}
                placeholder="Equipos (EQUI)"
                className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              />
            </label>
            <button type="submit" className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line">
              <Plus size={14} aria-hidden /> Agregar
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void guardarLista()}
              disabled={guardando || !dirty}
              className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {guardando && <Loader2 size={14} className="animate-spin" aria-hidden />} Guardar cambios
            </button>
            <button
              onClick={() => void descartar()}
              disabled={guardando || !dirty}
              className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-sub hover:bg-line disabled:opacity-50"
            >
              Descartar cambios
            </button>
          </div>
        </section>
      )}

      {vistas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line2 bg-surface/50 p-8 text-center">
          <Database size={28} className="mx-auto mb-3 text-sub/50" aria-hidden />
          <p className="text-sm text-sub">
            No hay vistas habilitadas. {puedeGestionar ? 'Agregalas en la sección de arriba.' : 'Avisale a un administrador o agregalas desde Configuraciones → Conexión SQL.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {vistas.map((v) => (
              <button
                key={v.vista}
                onClick={() => setVista(v.vista)}
                aria-pressed={vista === v.vista}
                className={
                  vista === v.vista
                    ? 'btn-press rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'btn-press rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-sub hover:bg-surface2 hover:text-ink'
                }
              >
                {v.label}
              </button>
            ))}
          </div>

          <label className="mb-3 block">
            <span className="sr-only">Buscar</span>
            <div className="relative">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/60" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar en los resultados…"
                className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/50 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              />
            </div>
          </label>

          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub">
              <Loader2 size={18} className="animate-spin" aria-hidden /> Consultando…
            </div>
          ) : filas.length === 0 ? (
            !error && (
              <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">La vista no devolvió filas.</p>
            )
          ) : visibles.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Ningún resultado coincide con la búsqueda.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-soft">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {columnas.map((c) => (
                        <th key={c} scope="col" className="whitespace-nowrap border-b border-line bg-surface2 px-3 py-2 font-semibold text-sub">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((f, i) => (
                      <tr key={i} className="odd:bg-surface even:bg-surface2/40">
                        {columnas.map((c) => (
                          <td key={c} className="max-w-[280px] truncate whitespace-nowrap px-3 py-1.5 text-ink" title={celda(f[c])}>
                            {celda(f[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-right text-xs text-sub/70">
                Mostrando {visibles.length} de {filas.length} filas{filas.length > MAX_FILAS_UI ? ` (primeras ${MAX_FILAS_UI})` : ''}
              </p>
            </>
          )}
        </>
      )}
    </Layout>
  )
}