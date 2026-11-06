import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, X } from 'lucide-react'
import {
  apiInforme, cargarConfig, clavesEstado, contactosAgenda, desbloquearClave, guardarClave, guardarConfig, repartoActual, type ConfigOc,
} from '@/lib/ordenesCompra'

/* Órdenes de compras · Autorizadores (solo admin): a quién le llega el WhatsApp para autorizar
   (de los contactos de «Envío informes y reportes»), reparto por historial y la plantilla de Meta. */

type Reparto = Awaited<ReturnType<typeof repartoActual>>
interface EstadoPlantilla { existe: boolean; estado?: string; motivo?: string; error?: string }

export default function AutorizadoresOc({ onCerrar }: { onCerrar: () => void }) {
  const [cfg, setCfg] = useState<ConfigOc | null>(null)
  const [contactos, setContactos] = useState<Array<{ id: string; nombre: string; fin: string; activo: boolean }>>([])
  const [reparto, setReparto] = useState<Reparto | null>(null)
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

  const fila = (titulo: string, r?: { quien: string; n: number; de: number }) => r && (
    <tr key={titulo} className="border-t border-line/60">
      <td className="py-1 pr-3">{titulo}</td>
      <td className="py-1 pr-3 font-semibold capitalize text-ink">{r.quien}</td>
      <td className="py-1 text-right tabular-nums">{r.n} de {r.de} ({Math.round((r.n / r.de) * 100)} %)</td>
    </tr>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="max-h-[calc(100vh-24px)] w-full max-w-xl overflow-auto rounded-3xl border border-line bg-[#0c0c11] shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">🔔 Autorizadores</h2>
          <button onClick={onCerrar} className="rounded-lg border border-line p-1.5 text-sub hover:bg-surface2" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4 text-sm">
          <p className="text-xs text-sub">
            Tildá a quién le llega el WhatsApp para autorizar. La lista sale de los <b className="text-ink">Contactos de «Envío informes y reportes»</b>:
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
              <label className="flex items-center gap-2 font-semibold text-teal-200">
                <input type="checkbox" checked={cfg.reparto_auto} onChange={(e) => setCfg({ ...cfg, reparto_auto: e.target.checked })} className="h-4 w-4 accent-teal-500" />
                Mandarle el aviso al que corresponde según el historial
              </label>
              {reparto && (
                <table className="w-full text-xs text-sub"><tbody>
                  {fila('Producto', reparto.tipo.Producto)}
                  {fila('Servicios', reparto.tipo.Servicios)}
                  {fila('Talleres', reparto.tipo.Talleres)}
                  {Object.entries(reparto.gastos_responsable).sort((a, b) => b[1].de - a[1].de).slice(0, 6)
                    .map(([r, v]) => fila(`Gastos de ${r.split(' ').slice(0, 2).map((p) => p[0] + p.slice(1).toLowerCase()).join(' ')}`, v))}
                  {fila('Gastos, el resto', reparto.tipo.Gastos)}
                </tbody></table>
              )}
              <p className="text-xs text-sub">
                Últimos 90 días; se recalcula solo con cada OC que se autoriza. Si no responde en{' '}
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
