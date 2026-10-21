import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import FranquiciasTabs from '@/components/FranquiciasTabs'
import {
  asignarBase,
  cargarClientes,
  cargarMapaFranquicias,
  claveFranquicia,
  crearBase,
  type ClienteFranquicia,
  type MapaFranquicias,
} from '@/lib/franquicias'

/* ------------------------------------------------------------------ */
/*  Franquicias · Clientes y bases                                    */
/*  Cada cliente apunta a una base de Dragon (y a la sucursal de la   */
/*  que se lee su stock). Lo usan la reposición y el pedido de        */
/*  calzado. Datos: sql/franquicias_clientes_bases.sql.               */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)

export default function MayoristaFranquiciasClientes() {
  const [mapa, setMapa] = useState<MapaFranquicias>({ bases: [], clientes: {} })
  const [clientes, setClientes] = useState<ClienteFranquicia[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; txt: string } | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroBase, setFiltroBase] = useState('')
  const [guardando, setGuardando] = useState<string | null>(null)

  const [nueva, setNueva] = useState({ base: '', sucursal: '', nombre: '' })
  const [creando, setCreando] = useState(false)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const [m, cs] = await Promise.all([cargarMapaFranquicias(), cargarClientes()])
      setMapa(m)
      setClientes(cs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { void cargar() }, [])

  const baseDe = (codigo: string) => mapa.clientes[codigo] ?? ''
  const nombreBase = (base: string) => mapa.bases.find((b) => b.base === base)?.nombre || base

  const asignados = useMemo(() => clientes.filter((c) => Boolean(baseDe(c.codigo))).length, [clientes, mapa])

  const visibles = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return clientes.filter((c) => {
      const base = baseDe(c.codigo)
      if (filtroBase === '__sin' && base) return false
      if (filtroBase && filtroBase !== '__sin' && base !== filtroBase) return false
      if (!q) return true
      return `${c.codigo} ${c.nCliente} ${c.razonSocial}`.toUpperCase().includes(q)
    })
  }, [clientes, mapa, busca, filtroBase])

  async function cambiarBase(c: ClienteFranquicia, base: string) {
    setGuardando(c.codigo)
    setAviso(null)
    try {
      await asignarBase(c.codigo, base || null)
      setMapa((m) => {
        const clientes = { ...m.clientes }
        if (base) clientes[c.codigo] = base
        else delete clientes[c.codigo]
        return { ...m, clientes }
      })
      setAviso({ ok: true, txt: base ? `${c.codigo} · ${c.razonSocial} → ${nombreBase(base)}` : `${c.codigo} · ${c.razonSocial} quedó sin base` })
    } catch (e) {
      setAviso({ ok: false, txt: e instanceof Error ? e.message : String(e) })
    } finally {
      setGuardando(null)
    }
  }

  async function agregarBase() {
    if (!nueva.base.trim()) { setAviso({ ok: false, txt: 'Poné el nombre de la base en Dragon (ej. DRAGONFISH_CFU).' }); return }
    setCreando(true)
    setAviso(null)
    try {
      await crearBase(nueva)
      setNueva({ base: '', sucursal: '', nombre: '' })
      await cargar()
      setAviso({ ok: true, txt: 'Base creada. Ya se puede asignar a los clientes.' })
    } catch (e) {
      setAviso({ ok: false, txt: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreando(false)
    }
  }

  const th = 'whitespace-nowrap px-3 py-2 text-left text-[10.5px] uppercase tracking-wide text-sub'

  return (
    <Layout>
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton />
            <h1 className="font-display truncate text-lg font-semibold text-ink md:text-xl">Franquicias · Clientes y bases</h1>
          </div>
        </div>

        <FranquiciasTabs />

        <div id="frame" className="overflow-hidden rounded-2xl border border-line bg-paper p-3">
          <div className="mb-3 mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Clientes y bases</h2>
              <p className="text-sm text-sub">Cada cliente lee sus ventas y su stock de la base asignada. El cliente elegido es el destino del pedido en Dragon.</p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Clientes activos: <b className="text-ink">{fmt(clientes.length)}</b></span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Con base: <b className="text-ink">{fmt(asignados)}</b></span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Sin base: <b className="text-ink">{fmt(clientes.length - asignados)}</b></span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-sub">Bases: <b className="text-ink">{fmt(mapa.bases.length)}</b></span>
          </div>

          {aviso && (
            <p role="status" className={`mb-3 rounded-xl border px-3 py-2 text-xs ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>{aviso.txt}</p>
          )}
          {error && (
            <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
              No se pudieron traer los datos: {error}
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-sub">
              <Search size={13} aria-hidden />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por código o razón social"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-sub"
              />
            </label>
            <select value={filtroBase} onChange={(e) => setFiltroBase(e.target.value)} className="rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs text-ink">
              <option value="">Todas las bases</option>
              <option value="__sin">Sin base</option>
              {mapa.bases.map((b) => <option key={b.base} value={b.base}>{b.nombre || b.base}</option>)}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr>
                    <th className={th}>Código</th>
                    <th className={th}>Cliente</th>
                    <th className={th}>Base</th>
                    <th className={th}>Stock del cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {cargando && (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-sub">
                        <Loader2 size={16} className="mr-2 inline animate-spin" aria-hidden />
                        Cargando clientes y bases…
                      </td>
                    </tr>
                  )}
                  {!cargando && visibles.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-10 text-center text-sub">No hay clientes para esa búsqueda.</td></tr>
                  )}
                  {visibles.map((c) => {
                    const base = baseDe(c.codigo)
                    const b = mapa.bases.find((x) => x.base === base)
                    return (
                      <tr key={c.id} className="border-t border-line/60 hover:bg-white/5">
                        <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-ink">{c.codigo}</td>
                        <td className="px-3 py-2 text-ink">{c.razonSocial || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={base}
                              onChange={(e) => void cambiarBase(c, e.target.value)}
                              disabled={guardando === c.codigo}
                              className="max-w-[240px] rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
                            >
                              <option value="">Sin base</option>
                              {mapa.bases.map((x) => <option key={x.base} value={x.base}>{x.nombre || x.base} · {x.base}</option>)}
                            </select>
                            {guardando === c.codigo && <Loader2 size={12} className="animate-spin text-sub" aria-hidden />}
                            {guardando !== c.codigo && base && <Check size={12} className="text-emerald-500" aria-hidden />}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sub">{b?.sucursal ? `${b.sucursal}` : base ? '—' : 'Sin base asignada'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface p-3">
            <h3 className="mb-2 text-sm font-semibold text-ink">Agregar una base</h3>
            <p className="mb-2 text-xs text-sub">
              <b className="text-ink">Base</b>: nombre de la base en Dragonfish (ej. DRAGONFISH_CFU). <b className="text-ink">Sucursal</b>: valor de BD_ORIGEN en el stock consolidado (ej. CAPTAIN FIN USHUAIA), de donde se lee el stock del cliente.
            </p>
            <div className="flex flex-wrap gap-2">
              <input value={nueva.base} onChange={(e) => setNueva({ ...nueva, base: e.target.value })} placeholder="DRAGONFISH_XXX" className="min-w-[150px] flex-1 rounded-lg border border-line2 bg-paper px-2 py-1.5 text-sm text-ink" />
              <input value={nueva.sucursal} onChange={(e) => setNueva({ ...nueva, sucursal: e.target.value })} placeholder="Sucursal de stock (BD_ORIGEN)" className="min-w-[180px] flex-1 rounded-lg border border-line2 bg-paper px-2 py-1.5 text-sm text-ink" />
              <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Nombre visible (CF Ushuaia)" className="min-w-[150px] flex-1 rounded-lg border border-line2 bg-paper px-2 py-1.5 text-sm text-ink" />
              <button type="button" onClick={() => void agregarBase()} disabled={creando} className="inline-flex items-center gap-1 rounded-lg border border-line2 bg-surface2 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
                {creando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plus size={13} aria-hidden />}
                Agregar base
              </button>
            </div>
            {mapa.bases.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs text-sub">
                {mapa.bases.map((b) => (
                  <li key={b.base} className="rounded-full border border-line bg-paper px-2.5 py-1">
                    <b className="text-ink">{b.nombre || b.base}</b> · {b.base} · {b.sucursal || 'sin sucursal'}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-2 text-[11px] text-sub">
            Clave de la franquicia en las propuestas: {mapa.bases.map((b) => claveFranquicia(b.base)).join(', ') || '—'}.
          </p>
        </div>
      </div>
    </Layout>
  )
}
