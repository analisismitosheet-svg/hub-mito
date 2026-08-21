import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Database, Loader2, Plus, Trash2, XCircle } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import {
  cargarVistas,
  estadoConexion,
  guardarVistas,
  leerVista,
  type EstadoSql,
  type VistaDef,
} from '@/lib/sqlApi'

const CYAN = '#0891b2'

export default function SqlConexion() {
  const [estado, setEstado] = useState<EstadoSql | null>(null)
  const [vistas, setVistas] = useState<VistaDef[]>([])
  const [nuevaVista, setNuevaVista] = useState('')
  const [nuevaLabel, setNuevaLabel] = useState('')
  const [probando, setProbando] = useState(false)
  const [prueba, setPrueba] = useState<{ ok: boolean; msg: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const [est, vs] = await Promise.all([estadoConexion(), cargarVistas()])
      setEstado(est)
      // Si no hay nada en config_app pero sí env, precargar la lista editable con el env
      setVistas((prev) => (prev.length > 0 ? prev : vs))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  function agregar(e: FormEvent) {
    e.preventDefault()
    const nombre = nuevaVista.trim()
    if (!/^[A-Za-z0-9_]+$/.test(nombre)) {
      setError('El nombre de la vista solo puede tener letras, números y guión bajo.')
      return
    }
    if (vistas.some((v) => v.vista.toLowerCase() === nombre.toLowerCase())) {
      setError('Esa vista ya está en la lista.')
      return
    }
    setError(null)
    setVistas((prev) => [...prev, { vista: nombre, label: nuevaLabel.trim() || nombre }])
    setNuevaVista('')
    setNuevaLabel('')
    setOkMsg(null)
  }

  function quitar(vista: string) {
    setVistas((prev) => prev.filter((v) => v.vista !== vista))
    setOkMsg(null)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    setOkMsg(null)
    const { error: err } = await guardarVistas(vistas)
    setGuardando(false)
    if (err) {
      setError(err)
      return
    }
    setOkMsg('Cambios guardados. Ya están activos para todos los usuarios.')
    await cargarEstadoSilencioso()
  }

  async function cargarEstadoSilencioso() {
    try {
      setEstado(await estadoConexion())
    } catch {
      /* el estado se refresca al recargar */
    }
  }

  async function probar() {
    const primera = vistas[0]?.vista ?? estado?.vistasDb[0]?.vista ?? estado?.vistasEnv[0]
    if (!primera) {
      setPrueba({ ok: false, msg: 'Agregá una vista primero para poder probar.' })
      return
    }
    setProbando(true)
    setPrueba(null)
    const t0 = performance.now()
    try {
      const filas = await leerVista(primera, 1)
      const ms = Math.round(performance.now() - t0)
      setPrueba({ ok: true, msg: `Conexión OK · "${primera}" devolvió ${filas.length} fila(s) en ${ms} ms` })
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      setPrueba({ ok: false, msg: `${e instanceof Error ? e.message : 'Error desconocido.'} (${ms} ms)` })
    } finally {
      setProbando(false)
    }
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2 flex items-center gap-3">
        <div className="rounded-xl border p-3" style={{ color: CYAN, backgroundColor: `${CYAN}24`, borderColor: `${CYAN}40` }}>
          <Database size={24} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Conexión SQL</h1>
          <p className="text-sm text-sub">Enlace al SQL Server de la empresa vía Logic App + Gateway.</p>
        </div>
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

      {/* Estado */}
      <section className="mb-4 rounded-2xl border border-line bg-surface p-4 shadow-soft">
        <h2 className="font-display mb-3 font-semibold text-ink">Estado</h2>
        {estado === null ? (
          !error && (
            <div className="flex items-center gap-2 py-4 text-sub">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Verificando…
            </div>
          )
        ) : (
          <>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                {estado.logicApp ? (
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <XCircle size={15} className="shrink-0 text-brand-500" aria-hidden />
                )}
                <span className="text-ink">Logic App (SQL_LOGICAPP_URL):</span>
                <span className={estado.logicApp ? 'text-emerald-500' : 'text-brand-400'}>
                  {estado.logicApp ? 'configurada' : 'falta configurarla en Vercel'}
                </span>
              </li>
              <li className="flex items-center gap-2 text-sub">
                <Database size={15} aria-hidden className="shrink-0" />
                Vistas habilitadas: <strong className="text-ink">{vistas.length}</strong> de esta lista
                {estado.vistasEnv.length > 0 && <> + {estado.vistasEnv.length} fijas por env</>}
              </li>
            </ul>
            <button
              onClick={() => void probar()}
              disabled={probando}
              className="btn-press mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {probando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
              Probar conexión
            </button>
            {prueba && (
              <p role="status" className={`mt-2 text-sm ${prueba.ok ? 'text-emerald-500' : 'text-brand-400'}`}>
                {prueba.ok ? '✓ ' : '✕ '}
                {prueba.msg}
              </p>
            )}
          </>
        )}
      </section>

      {/* Vistas */}
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
        <h2 className="font-display mb-1 font-semibold text-ink">Vistas expuestas</h2>
        <p className="mb-3 text-sm text-sub">
          Una vista por necesidad (ej. <code className="rounded bg-surface2 px-1 py-0.5 text-xs">vw_stock</code>). Los cambios
          aplican sin redeploys.
        </p>

        {vistas.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {vistas.map((v) => (
              <li key={v.vista} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-ink">{v.vista}</p>
                  {v.label !== v.vista && <p className="truncate text-xs text-sub">{v.label}</p>}
                </div>
                <button
                  onClick={() => quitar(v.vista)}
                  aria-label={`Quitar ${v.vista}`}
                  className="btn-press rounded-lg p-1.5 text-sub hover:bg-brand-600/20 hover:text-brand-400"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={agregar} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Nombre de la vista</span>
            <input
              value={nuevaVista}
              onChange={(e) => setNuevaVista(e.target.value)}
              placeholder="vw_stock"
              className="w-44 rounded-lg border border-line bg-surface2 px-2 py-1.5 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              required
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-sub">Etiqueta (opcional)</span>
            <input
              value={nuevaLabel}
              onChange={(e) => setNuevaLabel(e.target.value)}
              placeholder="Stock depósito"
              className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </label>
          <button type="submit" className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line">
            <Plus size={14} aria-hidden /> Agregar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {guardando && <Loader2 size={14} className="animate-spin" aria-hidden />} Guardar cambios
          </button>
        </form>
      </section>
    </Layout>
  )
}
