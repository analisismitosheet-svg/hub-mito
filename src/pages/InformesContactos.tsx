import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { claveTelefono, CUPO_GRATIS_MES, normalizarTelefono, telefonoValido, ventanaHasta, type ContactoInforme, type Destinatario, type Informe } from '@/lib/informes'

const inputCls =
  'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

interface EstadoTelegram {
  configurado: boolean
  usuario?: string
  conectado?: boolean
  error?: string
}

async function apiTelegram(accion: 'estado' | 'conectar'): Promise<EstadoTelegram & { ok?: boolean }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/informe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ telegram: accion }),
  })
  const body = (await res.json().catch(() => null)) as (EstadoTelegram & { ok?: boolean }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status}`)
  return body
}

/** Agenda de contactos de WhatsApp (informes_contactos), compartida por todos los informes. */
export async function cargarContactos(): Promise<ContactoInforme[]> {
  if (!supabase) return []
  const { data } = await supabase.from('informes_contactos').select('id,nombre,telefono,nota,activo').order('nombre')
  return (data as ContactoInforme[]) ?? []
}

/** Alta de un contacto; devuelve el creado (o el error para mostrar). */
export async function crearContacto(nombre: string, telefono: string, nota = ''): Promise<{ contacto?: ContactoInforme; error?: string }> {
  if (!supabase) return { error: 'Supabase no está configurado.' }
  if (!nombre.trim()) return { error: 'Poné el nombre del contacto.' }
  if (!telefonoValido(telefono)) return { error: 'El número de WhatsApp no parece válido.' }
  const { data, error } = await supabase.from('informes_contactos')
    .insert({ nombre: nombre.trim(), telefono: normalizarTelefono(telefono), nota: nota.trim() || null })
    .select('id,nombre,telefono,nota,activo').single()
  if (error) return { error: error.code === '23505' ? 'Ya hay un contacto con ese número.' : error.message }
  return { contacto: data as ContactoInforme }
}

const destinoDe = (c: ContactoInforme): Destinatario => ({ nombre: c.nombre, telefono: c.telefono, contacto_id: c.id })
const tieneContacto = (i: Informe, c: ContactoInforme) =>
  (i.destinatarios ?? []).some((d) => d.contacto_id === c.id || (!d.contacto_id && normalizarTelefono(d.telefono) === c.telefono))

/**
 * Pantalla de contactos dentro de «Envío informes y reportes»: alta, edición, activar/desactivar
 * y, por cada contacto, qué informes recibe (se tocan para sumarlo o sacarlo).
 */
export default function InformesContactos({
  informes, puedeCrear, puedeEditar, puedeBorrar, onCambioInformes, onMensaje,
}: {
  informes: Informe[]
  puedeCrear: boolean
  puedeEditar: boolean
  puedeBorrar: boolean
  onCambioInformes: () => Promise<void> | void
  onMensaje: (msg: string, ok?: boolean) => void
}) {
  const [contactos, setContactos] = useState<ContactoInforme[] | null>(null)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [editando, setEditando] = useState<ContactoInforme | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  // Ventana de 24 h de cada teléfono y mensajes gratis del mes (sql/whatsapp_ventana.sql)
  const [ventanas, setVentanas] = useState<Map<string, string>>(new Map())
  const [gratisMes, setGratisMes] = useState<number | null>(null)
  // Telegram: con el bot configurado reemplaza a WhatsApp (sql/telegram_vinculos.sql)
  const [telegram, setTelegram] = useState<EstadoTelegram | null>(null)
  const [vinculados, setVinculados] = useState<Set<string>>(new Set())

  const recargar = useCallback(async () => {
    setContactos(await cargarContactos())
    if (!supabase) return
    const hoy = new Date()
    const [{ data }, { count }, { data: vin }, estado] = await Promise.all([
      supabase.from('whatsapp_ventana').select('telefono,ultimo_mensaje_at'),
      supabase.from('whatsapp_servicio_envios').select('id', { count: 'exact', head: true })
        .gte('creado_at', new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()),
      supabase.from('telegram_vinculos').select('telefono'),
      apiTelegram('estado').catch(() => null),
    ])
    setVentanas(new Map(((data ?? []) as { telefono: string; ultimo_mensaje_at: string }[]).map((v) => [v.telefono, v.ultimo_mensaje_at])))
    setGratisMes(count ?? 0)
    setVinculados(new Set(((vin ?? []) as { telefono: string }[]).map((v) => v.telefono)))
    setTelegram(estado)
  }, [])
  useEffect(() => { void recargar() }, [recargar])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    setGuardando(true)
    const r = await crearContacto(nombre, telefono, nota)
    setGuardando(false)
    if (r.error) return onMensaje(r.error, false)
    setNombre(''); setTelefono(''); setNota('')
    onMensaje('Contacto agregado')
    await recargar()
  }

  /** Los informes guardan una copia del nombre/número: se actualiza para que la lista muestre lo nuevo. */
  async function reescribirEnInformes(c: ContactoInforme, quitar = false) {
    if (!supabase) return
    for (const i of informes.filter((x) => tieneContacto(x, c))) {
      const dests = (i.destinatarios ?? []).flatMap((d) =>
        d.contacto_id === c.id || (!d.contacto_id && normalizarTelefono(d.telefono) === c.telefono) ? (quitar ? [] : [destinoDe(c)]) : [d])
      await supabase.from('informes').update({ destinatarios: dests }).eq('id', i.id)
    }
  }

  async function guardarEdicion(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !editando) return
    if (!editando.nombre.trim()) return onMensaje('Poné el nombre del contacto.', false)
    if (!telefonoValido(editando.telefono)) return onMensaje('El número de WhatsApp no parece válido.', false)
    const anterior = contactos?.find((c) => c.id === editando.id)
    const fila = { nombre: editando.nombre.trim(), telefono: normalizarTelefono(editando.telefono), nota: editando.nota?.trim() || null }
    setGuardando(true)
    const { error } = await supabase.from('informes_contactos').update(fila).eq('id', editando.id)
    if (!error && anterior) await reescribirEnInformes({ ...anterior, ...fila })
    setGuardando(false)
    if (error) return onMensaje(error.code === '23505' ? 'Ya hay un contacto con ese número.' : error.message, false)
    setEditando(null)
    onMensaje('Contacto guardado')
    await Promise.all([recargar(), onCambioInformes()])
  }

  async function alternarActivo(c: ContactoInforme) {
    if (!supabase) return
    setOcupado(c.id)
    const { error } = await supabase.from('informes_contactos').update({ activo: !c.activo }).eq('id', c.id)
    setOcupado(null)
    if (error) return onMensaje(error.message, false)
    onMensaje(c.activo ? `${c.nombre} no recibe más informes (queda asignado)` : `${c.nombre} vuelve a recibir sus informes`)
    await recargar()
  }

  async function eliminar(c: ContactoInforme) {
    if (!supabase) return
    setOcupado(c.id)
    await reescribirEnInformes(c, true)
    const { error } = await supabase.from('informes_contactos').delete().eq('id', c.id)
    setOcupado(null)
    if (error) return onMensaje(error.message, false)
    onMensaje('Contacto eliminado')
    await Promise.all([recargar(), onCambioInformes()])
  }

  /** Suma o saca al contacto de un informe. */
  async function alternarInforme(c: ContactoInforme, i: Informe) {
    if (!supabase || !puedeEditar) return
    const ya = tieneContacto(i, c)
    const dests = ya
      ? (i.destinatarios ?? []).filter((d) => !(d.contacto_id === c.id || (!d.contacto_id && normalizarTelefono(d.telefono) === c.telefono)))
      : [...(i.destinatarios ?? []), destinoDe(c)]
    setOcupado(`${c.id}:${i.id}`)
    const { error } = await supabase.from('informes').update({ destinatarios: dests }).eq('id', i.id)
    setOcupado(null)
    if (error) return onMensaje(error.message, false)
    onMensaje(ya ? `${c.nombre} ya no recibe «${i.nombre}»` : `${c.nombre} recibe «${i.nombre}»`)
    await onCambioInformes()
  }

  return (
    <div className="flex flex-col gap-3">
      {puedeCrear && (
        <form onSubmit={agregar} className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
          <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-ink">
            <Plus size={15} className="text-emerald-500" aria-hidden /> Nuevo contacto
          </h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} placeholder="Nombre" aria-label="Nombre" />
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inputCls} placeholder="WhatsApp (ej. 351 123-4567)" inputMode="tel" aria-label="Número de WhatsApp" />
            <input value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls} placeholder="Nota (opcional: puesto, área…)" aria-label="Nota" />
            <button type="submit" disabled={guardando} className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
              {guardando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Plus size={14} aria-hidden />} Agregar
            </button>
          </div>
          {telefono && (
            <p className="mt-1.5 text-[11px] text-sub">
              Se va a mandar a <b className="text-ink">+{normalizarTelefono(telefono)}</b>
              {!telefonoValido(telefono) && <span className="text-amber-300"> · no parece un número válido</span>}
            </p>
          )}
        </form>
      )}

      {telegram?.configurado && (
        <div className="rounded-2xl border border-line bg-surface p-3 text-xs text-sub shadow-soft">
          {telegram.error ? (
            <span className="text-red-300">Telegram con error: {telegram.error}</span>
          ) : telegram.conectado ? (
            <>
              Los avisos salen por <b className="text-ink">Telegram</b>. Cada persona abre{' '}
              <a href={`https://t.me/${telegram.usuario}`} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">t.me/{telegram.usuario}</a>
              {' '}y toca «Compartir mi número», una sola vez. A quien no se vincule no le llega nada.
            </>
          ) : (
            <>
              El bot <b className="text-ink">@{telegram.usuario}</b> está cargado pero falta conectarlo.{' '}
              <button
                onClick={() => void apiTelegram('conectar')
                  .then((r) => { if (r.ok) onMensaje('Bot de Telegram conectado'); else onMensaje(r.error ?? 'No se pudo conectar', false); return recargar() })
                  .catch((e: Error) => onMensaje(e.message, false))}
                className="font-medium text-ink underline underline-offset-2"
              >
                Conectar bot
              </button>
            </>
          )}
        </div>
      )}

      {gratisMes !== null && !telegram?.configurado && (
        <p className="rounded-2xl border border-line bg-surface p-3 text-xs text-sub shadow-soft">
          <b className="text-ink">{gratisMes.toLocaleString('es-AR')} de {CUPO_GRATIS_MES.toLocaleString('es-AR')}</b> mensajes gratis usados este mes.
          {' '}Para recibir gratis, cada contacto tiene que escribirle al número del hub una vez por día; si no, le llega igual con plantilla paga.
        </p>
      )}

      {contactos === null ? (
        <div className="flex items-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…</div>
      ) : contactos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/50 p-8 text-center">
          <Users size={28} className="mx-auto mb-2 text-sub/60" aria-hidden />
          <p className="text-sm text-sub">Todavía no hay contactos.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {contactos.map((c) => (
            <article key={c.id} className={`rounded-2xl border bg-surface p-3 shadow-soft ${c.activo ? 'border-line' : 'border-line/60 opacity-70'}`}>
              {editando?.id === c.id ? (
                <form onSubmit={guardarEdicion} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} className={inputCls} aria-label="Nombre" />
                  <input value={editando.telefono} onChange={(e) => setEditando({ ...editando, telefono: e.target.value })} className={inputCls} inputMode="tel" aria-label="Número de WhatsApp" />
                  <input value={editando.nota ?? ''} onChange={(e) => setEditando({ ...editando, nota: e.target.value })} className={inputCls} placeholder="Nota" aria-label="Nota" />
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={guardando} className="btn-press inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
                      {guardando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />} Guardar
                    </button>
                    <button type="button" onClick={() => setEditando(null)} className="btn-press rounded-xl border border-line bg-surface2 px-2.5 py-2 text-sub hover:bg-line" title="Cancelar">
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-sm font-semibold text-ink">{c.nombre}</h3>
                      <span className="text-sm tabular-nums text-sub">+{c.telefono}</span>
                      {!c.activo && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sub">No recibe informes</span>}
                      {telegram?.configurado ? (
                        vinculados.has(claveTelefono(c.telefono))
                          ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">Telegram vinculado</span>
                          : <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">Sin Telegram: no recibe</span>
                      ) : (() => {
                        const hasta = ventanaHasta(ventanas.get(claveTelefono(c.telefono)))
                        return hasta
                          ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">Gratis hasta {hasta.toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          : <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-sub">Con plantilla paga</span>
                      })()}
                    </div>
                    {c.nota && <p className="mt-0.5 text-xs text-sub/80">{c.nota}</p>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {informes.length === 0 && <span className="text-xs text-sub">No hay informes para asignar.</span>}
                      {informes.map((i) => {
                        const ya = tieneContacto(i, c)
                        const cargando = ocupado === `${c.id}:${i.id}`
                        return (
                          <button key={i.id} type="button" onClick={() => void alternarInforme(c, i)} disabled={!puedeEditar || cargando}
                            title={puedeEditar ? (ya ? 'Tocá para sacarlo de este informe' : 'Tocá para que reciba este informe') : undefined}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${ya
                              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                              : 'border-line bg-surface2 text-sub hover:text-ink'} ${puedeEditar ? 'btn-press' : 'cursor-default'}`}>
                            {cargando ? <Loader2 size={11} className="animate-spin" aria-hidden /> : ya ? <Check size={11} aria-hidden /> : <Plus size={11} aria-hidden />}
                            {i.nombre}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {puedeEditar && (
                      <button onClick={() => setEditando({ ...c })} className="btn-press rounded-xl border border-line bg-surface2 px-2.5 py-1.5 text-ink hover:bg-line" title="Editar">
                        <Pencil size={14} aria-hidden />
                      </button>
                    )}
                    {puedeEditar && (
                      <button onClick={() => void alternarActivo(c)} disabled={ocupado === c.id} className="btn-press rounded-xl border border-line bg-surface2 px-2.5 py-1.5 hover:bg-line"
                        title={c.activo ? 'Pausar: deja de recibir sus informes (sigue asignado)' : 'Activar: vuelve a recibir sus informes'}>
                        <Check size={14} className={c.activo ? 'text-emerald-500' : 'text-sub'} aria-hidden />
                      </button>
                    )}
                    {puedeBorrar && (
                      <button onClick={() => setConfirm({ message: `¿Eliminar a ${c.nombre}? Se saca de todos los informes.`, onConfirm: () => void eliminar(c) })}
                        disabled={ocupado === c.id} className="btn-press rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-red-300 hover:bg-red-500/20" title="Eliminar">
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </div>
  )
}
