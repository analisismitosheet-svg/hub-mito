import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, X } from 'lucide-react'
import {
  apiInforme, cargarConfig, clavesEstado, contactosAgenda, desbloquearClave, guardarClave, guardarConfig, repartoActual, responsablesGastos, type ConfigOc,
} from '@/lib/ordenesCompra'

/* Órdenes de compras · Autorizadores (solo admin): a quién le llega el WhatsApp para autorizar
   (de los contactos de «Envío informes y reportes»), quién autoriza cada categoría (a mano, con el historial de respaldo) y la plantilla de Meta. */

/** «TOMAS ROCA» → «Tomas Roca» (dos primeras palabras). */
const nombreCorto2 = (r: string) => r.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0] + p.slice(1).toLowerCase()).join(' ')

type Reparto = Awaited<ReturnType<typeof repartoActual>>
interface EstadoPlantilla { existe: boolean; estado?: string; motivo?: string; error?: string }

export default function AutorizadoresOc({ onCerrar }: { onCerrar: () => void }) {
  const [cfg, setCfg] = useState<ConfigOc | null>(null)
  const [contactos, setContactos] = useState<Array<{ id: string; nombre: string; fin: string; activo: boolean }>>([])
  const [reparto, setReparto] = useState<Reparto | null>(null)
  const [responsables, setResponsables] = useState<string[]>([])
  /** Personas de Gastos sumadas a mano al cuadro (todavía sin guardar). */
  const [extras, setExtras] = useState<string[]>([])
  const [plantilla, setPlantilla] = useState<EstadoPlantilla | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Contacto → bloqueada. Si no está, todavía no tiene clave. */
  const [claves, setClaves] = useState<Record<string, boolean>>({})
  const [editandoClave, setEditandoClave] = useState<string | null>(null)
  const [claveNueva, setClaveNueva] = useState('')

  const cargarClaves = () => clavesEstado().then((l) => setClaves(Object.fromEntries(l.map((c) => [c.contacto_id, c.bloqueada]))))

  useEffect(() => {
    void cargarClaves().catch((e: Error) => setError(e.message))
    void cargarConfig().then(setCfg)
    void contactosAgenda().then(setContactos).catch((e: Error) => setError(e.message))
    void repartoActual().then(setReparto).catch(() => setReparto(null))
    void responsablesGastos().then(setResponsables).catch(() => setResponsables([]))
    void apiInforme<EstadoPlantilla>({ ocPlantilla: 'estado' }).then(setPlantilla).catch((e: Error) => setPlantilla({ existe: false, error: e.message }))
  }, [])

  const guardar = async () => {
    if (!cfg) return
    setOcupado('guardar')
    setError(null)
    try {
      await guardarConfig(cfg)
      onCerrar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const cargarClave = async (contacto: string) => {
    setOcupado('clave')
    setError(null)
    try {
      await guardarClave(contacto, claveNueva)
      await cargarClaves()
      setEditandoClave(null)
      setClaveNueva('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const desbloquear = async (contacto: string) => {
    setOcupado('clave')
    setError(null)
    try {
      await desbloquearClave(contacto)
      await cargarClaves()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const crearPlantilla = async () => {
    setOcupado('plantilla')
    try {
      setPlantilla(await apiInforme<EstadoPlantilla>({ ocPlantilla: 'crear' }))
    } catch (e) {
      setPlantilla({ existe: false, error: (e as Error).message })
    } finally {
      setOcupado(null)
    }
  }

  /** Elegibles por categoría: cualquier contacto activo de la agenda (esté tildado arriba o no). */
  const agenda = contactos.filter((c) => c.activo)
  const gastosEnFilas = [...new Set([
    ...Object.keys(reparto?.gastos_responsable ?? {}),
    ...Object.keys(cfg?.reglas ?? {}).filter((k) => k.startsWith('gastos:')).map((k) => k.slice(7)),
    ...extras,
  ])]
  const filas: Array<{ clave: string; titulo: string; hist?: { quien: string; n: number; de: number } }> = [
    ...['Producto', 'Servicios', 'Talleres'].map((t) => ({ clave: `tipo:${t}`, titulo: t, hist: reparto?.tipo[t] })),
    ...gastosEnFilas.sort((x, y) => (reparto?.gastos_responsable[y]?.de ?? 0) - (reparto?.gastos_responsable[x]?.de ?? 0))
      .map((r) => ({ clave: `gastos:${r}`, titulo: `Gastos de ${nombreCorto2(r)}`, hist: reparto?.gastos_responsable[r] })),
    { clave: 'tipo:Gastos', titulo: 'Gastos, el resto', hist: reparto?.tipo.Gastos },
  ]
  const faltan = responsables.filter((r) => !gastosEnFilas.includes(r))
  const tildarRegla = (clave: string, id: string) => {
    if (!cfg) return
    const actual = cfg.reglas?.[clave] ?? []
    const nueva = actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]
    const reglas = { ...(cfg.reglas ?? {}) }
    if (nueva.length) reglas[clave] = nueva
    else delete reglas[clave]
    setCfg({ ...cfg, reglas })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-auto rounded-3xl border border-line bg-[#0c0c11] shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">🔔 Autorizadores</h2>
          <button onClick={onCerrar} className="rounded-lg border border-line p-1.5 text-sub hover:bg-surface2" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4 text-sm">
          <p className="text-xs text-sub">
            Tildados = autorizadores de respaldo: les llega cuando la categoría no tiene a nadie elegido abajo y cuando nadie responde a tiempo. La lista sale de los <b className="text-ink">Contactos de «Envío informes y reportes»</b>:
            el nombre y el número se cargan y se cambian ahí.
          </p>
          {!cfg ? <Loader2 size={16} className="animate-spin text-sub" /> : (
            <div className="flex flex-col gap-1.5">
              {contactos.map((c) => (
                <div key={c.id} className={`rounded-xl border border-line bg-surface2 px-3 py-2 ${c.activo ? '' : 'opacity-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <label className={`flex min-w-0 flex-1 items-center gap-2.5 ${c.activo ? 'cursor-pointer' : ''}`}>
                      <input type="checkbox" disabled={!c.activo} checked={cfg.autorizadores.includes(c.id)} className="h-4 w-4 accent-lime-500"
                        onChange={(e) => setCfg({ ...cfg, autorizadores: e.target.checked ? [...cfg.autorizadores, c.id] : cfg.autorizadores.filter((x) => x !== c.id) })} />
                      <b className="text-ink">{c.nombre}</b>
                      <span className="ml-auto text-xs text-sub">💬 ···· {c.fin}{!c.activo && ' · pausado'}</span>
                    </label>
                    {claves[c.id] && (
                      <button type="button" disabled={ocupado === 'clave'} onClick={() => void desbloquear(c.id)} title="Clave bloqueada por 5 intentos errados. Sigue valiendo la misma."
                        className="rounded-lg border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">Desbloquear</button>
                    )}
                    <button type="button" onClick={() => { setEditandoClave(editandoClave === c.id ? null : c.id); setClaveNueva('') }}
                      className={`rounded-lg border px-2 py-1 text-xs ${!(c.id in claves) && cfg.autorizadores.includes(c.id) ? 'border-amber-500/50 text-amber-300' : 'border-line text-sub'}`}>
                      {c.id in claves ? 'Cambiar clave' : 'Sin clave'}
                    </button>
                  </div>
                  {editandoClave === c.id && (
                    <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
                      <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={claveNueva} placeholder="4 a 6 números" aria-label={`Clave nueva de ${c.nombre}`}
                        onChange={(e) => setClaveNueva(e.target.value.replace(/\D/g, ''))}
                        className="h-8 w-32 rounded-lg border border-line bg-[#0c0c11] px-2 text-xs text-ink outline-none" />
                      <button type="button" disabled={claveNueva.length < 4 || ocupado === 'clave'} onClick={() => void cargarClave(c.id)}
                        className="h-8 rounded-lg bg-lime-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Guardar clave</button>
                      <span className="text-[11px] text-sub">Se guarda encriptada: no se puede volver a ver.</span>
                    </div>
                  )}
                </div>
              ))}
              <Link to="/informes" className="text-xs text-sky-400 hover:underline">＋ Agregar o editar contactos en Envío informes y reportes</Link>
            </div>
          )}

          {cfg && (
            <div className="flex flex-col gap-2 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3">
              <p className="font-semibold text-teal-200">Quién autoriza cada categoría</p>
              <p className="text-xs text-sub">Elegí en cada fila quién la autoriza: cualquier contacto de la agenda, uno o varios (les llega a todos juntos y vale la primera respuesta). Si una fila queda vacía, va según el historial.</p>
              {agenda.length === 0 ? <p className="text-xs text-amber-300">No hay contactos activos en «Envío informes y reportes».</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-sub">
                    <thead><tr className="text-left text-[10.5px] uppercase tracking-wide">
                      <th className="py-1 pr-3 font-bold">Categoría</th>
                      <th className="py-1 pr-3 font-bold">Autoriza</th>
                      <th className="py-1 pl-2 font-bold">Historial (90 días)</th>
                    </tr></thead>
                    <tbody>
                      {filas.map((r) => {
                        const elegidos = (cfg.reglas?.[r.clave] ?? []).map((id) => agenda.find((c) => c.id === id)).filter((c): c is (typeof agenda)[number] => !!c)
                        const libres = agenda.filter((c) => !elegidos.some((e) => e.id === c.id))
                        return (
                          <tr key={r.clave} className="border-t border-line/60 align-middle">
                            <td className="py-1.5 pr-3 text-ink">{r.titulo}</td>
                            <td className="min-w-[240px] py-1.5 pr-3">
                              <div className="flex flex-wrap items-center gap-1">
                                {elegidos.map((c) => (
                                  <span key={c.id} className="inline-flex items-center gap-1 rounded-lg border border-teal-500/50 bg-teal-500/15 py-0.5 pl-2 pr-1 font-semibold text-teal-100">
                                    {c.nombre}
                                    <button type="button" onClick={() => tildarRegla(r.clave, c.id)} aria-label={`Sacar a ${c.nombre} de ${r.titulo}`} className="rounded p-0.5 opacity-70 hover:bg-teal-500/20 hover:opacity-100"><X size={11} /></button>
                                  </span>
                                ))}
                                {libres.length > 0 && (
                                  <select value="" onChange={(e) => e.target.value && tildarRegla(r.clave, e.target.value)} aria-label={`Elegir quién autoriza ${r.titulo}`}
                                    className="h-7 rounded-lg border border-line bg-surface2 px-1.5 text-xs text-sub">
                                    <option value="">{elegidos.length ? '＋' : 'Elegir…'}</option>
                                    {libres.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                  </select>
                                )}
                              </div>
                            </td>
                            <td className={`py-1.5 pl-2 ${elegidos.length ? 'opacity-50' : ''}`}>
                              {r.hist ? <><b className="capitalize text-ink">{r.hist.quien}</b> {r.hist.n} de {r.hist.de} ({Math.round((r.hist.n / r.hist.de) * 100)} %)</> : '—'}
                              {!elegidos.length && <span className="ml-1 text-[10.5px] text-teal-300">{r.hist && cfg.reparto_auto ? '← va a este' : (r.clave.startsWith('gastos:') ? '← como «Gastos, el resto»' : '← a todos los tildados')}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {agenda.length > 0 && faltan.length > 0 && (
                <select value="" onChange={(e) => e.target.value && setExtras((x) => [...x, e.target.value])} aria-label="Agregar persona de Gastos"
                  className="self-start rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-sky-300">
                  <option value="">＋ Agregar persona (Gastos de…)</option>
                  {faltan.map((r) => <option key={r} value={r}>{nombreCorto2(r)}</option>)}
                </select>
              )}
              <label className="flex items-center gap-2 text-xs text-sub">
                <input type="checkbox" checked={cfg.reparto_auto} onChange={(e) => setCfg({ ...cfg, reparto_auto: e.target.checked })} className="h-4 w-4 accent-teal-500" />
                En las filas sin nadie tildado, usar el historial (si no, les llega a todos)
              </label>
              <p className="text-xs text-sub">
                Si no responde en{' '}
                <select value={cfg.horas_espera} onChange={(e) => setCfg({ ...cfg, horas_espera: Number(e.target.value) })} className="rounded-md border border-line bg-surface2 px-1 text-ink">
                  {[2, 4, 8, 24].map((h) => <option key={h}>{h}</option>)}
                </select>{' '}horas, el aviso les llega también a los demás tildados.
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-sub">
            <p className="mb-1 font-semibold text-emerald-200">Plantilla de WhatsApp «oc_autorizar_link»</p>
            {!plantilla ? <Loader2 size={14} className="animate-spin" /> : plantilla.existe ? (
              <p>Estado en Meta: <b className="text-ink">{plantilla.estado}</b>{plantilla.motivo && ` — ${plantilla.motivo}`}. {plantilla.estado !== 'APPROVED' && 'Hasta que Meta la apruebe, los pedidos de autorización no llegan.'}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p>{plantilla.error ?? 'Todavía no está creada en Meta.'}</p>
                <button disabled={ocupado === 'plantilla'} onClick={() => void crearPlantilla()} className="self-start rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {ocupado === 'plantilla' ? 'Creando…' : 'Crear plantilla en WhatsApp'}
                </button>
              </div>
            )}
            <p className="mt-1.5">Trae N° de OC, tipo, proveedor, monto, qué es y quién la cargó, con un botón al link donde se autoriza o no.</p>
          </div>
          {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onCerrar} className="h-9 rounded-xl border border-line px-4 text-sm text-ink hover:bg-surface2">Cancelar</button>
          <button disabled={!cfg || !!ocupado} onClick={() => void guardar()} className="h-9 rounded-xl bg-lime-600 px-4 text-sm font-semibold text-white hover:bg-lime-700 disabled:opacity-60">Guardar</button>
        </div>
      </div>
    </div>
  )
}
