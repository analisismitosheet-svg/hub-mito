import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Trash2, X } from 'lucide-react'
import {
  apiInforme, cargarConfig, clavesEstado, contactosAgenda, desbloquearClave, guardarClave, guardarArbol, guardarConfig, cargarSubtipos, repartoActual, TIPOS, type ConfigOc, type NodoArbol,
} from '@/lib/ordenesCompra'

/* Órdenes de compras · Autorizadores (solo admin): a quién le llega el WhatsApp para autorizar
   (de los contactos de «Envío informes y reportes»), el árbol de quién autoriza cada tipo y subtipo (sql/ordenes_compra_arbol.sql) y la plantilla de Meta. */

type Reparto = Awaited<ReturnType<typeof repartoActual>>
interface EstadoPlantilla { existe: boolean; estado?: string; motivo?: string; error?: string }

export default function AutorizadoresOc({ onCerrar }: { onCerrar: () => void }) {
  const [cfg, setCfg] = useState<ConfigOc | null>(null)
  const [contactos, setContactos] = useState<Array<{ id: string; nombre: string; fin: string; activo: boolean }>>([])
  const [reparto, setReparto] = useState<Reparto | null>(null)
  /** Árbol tipo → subtipos con quién autoriza cada nodo (se guarda entero con «Guardar»). */
  const [arbol, setArbol] = useState<NodoArbol[] | null>(null)
  const [cerrados, setCerrados] = useState<string[]>([])
  const [nuevoSub, setNuevoSub] = useState<Record<string, string>>({})
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
    void Promise.all([cargarConfig(), cargarSubtipos()]).then(([c, subs]) => {
      setCfg(c)
      setArbol(TIPOS.map((t) => ({
        tipo: t,
        autorizadores: c?.reglas?.[`tipo:${t}`] ?? [],
        subs: subs.filter((x) => x.tipo === t).map((x) => ({ id: x.id, nombre: x.nombre, autorizadores: x.autorizadores ?? [] })),
      })))
    }).catch((e: Error) => setError(e.message))
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
      if (arbol) await guardarArbol(arbol.map((t) => ({ ...t, subs: t.subs.filter((x) => x.nombre.trim()) })))
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
  const nombreDe = (id: string) => agenda.find((c) => c.id === id)?.nombre
  const cambiarTipo = (i: number, cambio: Partial<NodoArbol>) => setArbol((l) => l && l.map((t, j) => (j === i ? { ...t, ...cambio } : t)))
  const cambiarSub = (i: number, k: number, cambio: Partial<NodoArbol['subs'][number]>) =>
    setArbol((l) => l && l.map((t, j) => (j === i ? { ...t, subs: t.subs.map((x, m) => (m === k ? { ...x, ...cambio } : x)) } : t)))
  const agregarSub = (i: number) => {
    const nombre = (nuevoSub[arbol?.[i]?.tipo ?? ''] ?? '').trim()
    if (!arbol || !nombre) return
    if (arbol[i].subs.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) { setError(`Ya hay un subtipo «${nombre}» en ${arbol[i].tipo}`); return }
    cambiarTipo(i, { subs: [...arbol[i].subs, { nombre, autorizadores: [] }] })
    setNuevoSub((x) => ({ ...x, [arbol[i].tipo]: '' }))
  }
  /** Personas elegidas (etiquetas con ×) + selector con el resto de la agenda. */
  const elegir = (quienes: string[], cambiar: (l: string[]) => void, etiqueta: string) => {
    const validos = quienes.filter((id) => nombreDe(id))
    const libres = agenda.filter((c) => !validos.includes(c.id))
    return (
      <div className="flex flex-wrap items-center gap-1">
        {validos.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-lg border border-teal-500/50 bg-teal-500/15 py-0.5 pl-2 pr-1 text-xs font-semibold text-teal-100">
            {nombreDe(id)}
            <button type="button" onClick={() => cambiar(validos.filter((x) => x !== id))} aria-label={`Sacar a ${nombreDe(id)} de ${etiqueta}`} className="rounded p-0.5 opacity-70 hover:bg-teal-500/20 hover:opacity-100"><X size={11} /></button>
          </span>
        ))}
        {libres.length > 0 && (
          <select value="" onChange={(e) => e.target.value && cambiar([...validos, e.target.value])} aria-label={`Elegir quién autoriza ${etiqueta}`}
            className="h-7 rounded-lg border border-line bg-surface2 px-1.5 text-xs text-sub">
            <option value="">{validos.length ? '＋' : 'Elegir…'}</option>
            {libres.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        )}
      </div>
    )
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
            Tildados = autorizadores de respaldo: les llega cuando el tipo no tiene a nadie elegido abajo y cuando nadie responde a tiempo. La lista sale de los <b className="text-ink">Contactos de «Envío informes y reportes»</b>:
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
              <p className="font-semibold text-teal-200">Quién autoriza cada tipo</p>
              <p className="text-xs text-sub">En cada tipo y subtipo elegí una o varias personas de la agenda (les llega a todos juntos y vale la primera respuesta). Un subtipo sin nadie hereda del tipo; un tipo sin nadie va según el historial.</p>
              {!arbol ? <Loader2 size={16} className="animate-spin text-sub" /> : agenda.length === 0 ? <p className="text-xs text-amber-300">No hay contactos activos en «Envío informes y reportes».</p> : (
                <div className="flex flex-col gap-2">
                  {arbol.map((t, i) => {
                    const abierto = !cerrados.includes(t.tipo)
                    const hist = reparto?.tipo[t.tipo]
                    const delTipo = t.autorizadores.map(nombreDe).filter(Boolean).join(', ')
                    return (
                      <div key={t.tipo} className="rounded-xl border border-teal-500/25 bg-black/20 p-2.5">
                        <div className="grid grid-cols-[18px_minmax(110px,150px)_1fr] items-center gap-2">
                          <button type="button" onClick={() => setCerrados((c) => (abierto ? [...c, t.tipo] : c.filter((x) => x !== t.tipo)))} className="text-sub" aria-label={abierto ? `Cerrar ${t.tipo}` : `Abrir ${t.tipo}`}>{abierto ? '▾' : '▸'}</button>
                          <span className="font-bold text-ink">{t.tipo} <span className="text-[11px] font-normal text-sub">· {t.subs.length} subtipos</span></span>
                          <div className="flex flex-wrap items-center gap-2">
                            {elegir(t.autorizadores, (l) => cambiarTipo(i, { autorizadores: l }), t.tipo)}
                            {!delTipo && <span className="text-[11px] italic text-sub">vacío → {hist && cfg.reparto_auto ? <>historial: <b className="not-italic capitalize text-emerald-200">{hist.quien}</b> ({hist.n} de {hist.de})</> : 'a los de respaldo'}</span>}
                          </div>
                        </div>
                        {abierto && (
                          <div className="ml-[22px] mt-1.5 flex flex-col gap-1 border-l-2 border-line pl-2.5">
                            {t.subs.map((x, k) => (
                              <div key={x.id ?? `n${k}`} className="grid grid-cols-[minmax(110px,150px)_1fr] items-center gap-2">
                                <span className="flex min-w-0 items-center gap-1 text-ink">
                                  <span className="truncate" title={x.nombre}>{x.nombre}</span>
                                  <button type="button" onClick={() => cambiarTipo(i, { subs: t.subs.filter((_, m) => m !== k) })} aria-label={`Borrar el subtipo ${x.nombre}`} className="shrink-0 rounded p-0.5 text-red-400/60 hover:text-red-400"><Trash2 size={12} /></button>
                                </span>
                                <div className="flex flex-wrap items-center gap-2">
                                  {elegir(x.autorizadores, (l) => cambiarSub(i, k, { autorizadores: l }), `${t.tipo} › ${x.nombre}`)}
                                  {!x.autorizadores.some(nombreDe) && <span className="text-[11px] italic text-sub">hereda de {t.tipo}{delTipo ? <>: <b className="not-italic text-emerald-200">{delTipo}</b></> : ''}</span>}
                                </div>
                              </div>
                            ))}
                            <div className="mt-1 flex items-center gap-1.5">
                              <input value={nuevoSub[t.tipo] ?? ''} onChange={(e) => setNuevoSub((n) => ({ ...n, [t.tipo]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && agregarSub(i)}
                                placeholder={`Nuevo subtipo de ${t.tipo}`} aria-label={`Nuevo subtipo de ${t.tipo}`} className="h-7 w-48 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink outline-none" />
                              <button type="button" disabled={!(nuevoSub[t.tipo] ?? '').trim()} onClick={() => agregarSub(i)} className="h-7 rounded-lg border border-dashed border-line px-2 text-xs text-sky-300 disabled:opacity-40">＋ Agregar subtipo</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <p className="text-[11px] text-sub">Borrar un subtipo lo saca de la lista; las OC que ya lo tienen lo conservan.</p>
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-sub">
                <input type="checkbox" checked={cfg.reparto_auto} onChange={(e) => setCfg({ ...cfg, reparto_auto: e.target.checked })} className="h-4 w-4 accent-teal-500" />
                En los tipos sin nadie elegido, usar el historial (si no, les llega a los de respaldo)
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
