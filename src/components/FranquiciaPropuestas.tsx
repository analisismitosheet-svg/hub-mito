import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Loader2, Plus, Send, Trash2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { normalizarTelefono, telefonoValido } from '@/lib/informes'

/* ------------------------------------------------------------------ */
/*  Franquicias → propuesta que el cliente elige por un link.          */
/*  Contactos de WhatsApp de la franquicia, botón para mandar la        */
/*  propuesta (se guarda y el hub manda el link desde su número) e      */
/*  historial: propuesto contra lo que pidió el cliente.                */
/*  Datos: sql/franquicias_propuestas.sql · envío: /api/informe.        */
/* ------------------------------------------------------------------ */

export interface ItemPropuesta {
  art: string
  descrip: string
  material: string
  color: string
  talle: string
  stockCli: number
  vendido: number
  stock: number
  sugerido: number
  precio: number | null
}

interface Contacto { id: string; nombre: string | null; telefono: string }
interface Propuesta {
  id: string
  numero: string
  estado: 'borrador' | 'enviada' | 'confirmada' | 'en_dragon' | 'anulada'
  token: string
  desde: string | null
  hasta: string | null
  vence_at: string
  unidades_propuestas: number
  total_propuesto: number
  unidades_confirmadas: number | null
  total_confirmado: number | null
  comentario: string | null
  envio_detalle: string | null
  enviada_at: string | null
  abierta_at: string | null
  confirmada_at: string | null
  revisada_at: string | null
  dragon_pedido: string | null
  dragon_error: string | null
  dragon_enviando_at: string | null
  dragon_intentos: number
  creado_at: string
}
interface ItemGuardado { id: number; art: string; descrip: string | null; color: string | null; talle: string | null; sugerido: number; precio: number | null; elegido: boolean | null; cantidad: number | null }

const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
const fmtPesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
const fmtFecha = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—')
const linkDe = (token: string) => `${window.location.origin}/p/${token}`

function chipEstado(p: Propuesta) {
  if (p.estado === 'en_dragon') return { txt: `En Dragon · pedido ${p.dragon_pedido ?? ''}`.trim(), cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' }
  if (p.estado === 'confirmada' && p.dragon_error) return { txt: 'Confirmada · error al cargar en Dragon', cls: 'border-red-500/40 bg-red-500/10 text-red-400' }
  if (p.estado === 'confirmada' && p.dragon_enviando_at) return { txt: 'Confirmada · cargando en Dragon…', cls: 'border-violet-500/40 bg-violet-500/10 text-violet-400' }
  if (p.estado === 'confirmada') return { txt: 'Confirmada · por cargar en Dragon', cls: 'border-teal-500/40 bg-teal-500/10 text-teal-400' }
  if (p.estado === 'enviada' && new Date(p.vence_at) < new Date()) return { txt: 'Vencida', cls: 'border-line bg-surface2 text-sub' }
  if (p.estado === 'enviada') return { txt: p.abierta_at ? 'Abierta · esperando' : 'Enviada · esperando', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-400' }
  if (p.estado === 'anulada') return { txt: 'Anulada', cls: 'border-line bg-surface2 text-sub' }
  return { txt: 'Sin enviar', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-400' }
}

const fmtDia = (iso: string) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' }).format(new Date(iso))

/** Mensaje con el link: se manda desde el WhatsApp de quien toca el botón (cualquier número). */
function mensajeDe(p: { numero: string; token: string; vence_at: string; desde: string | null; hasta: string | null }, franquicia: string, contacto?: string | null) {
  const hola = contacto?.trim() ? `Hola ${contacto.trim().split(/\s+/)[0]}` : 'Hola'
  return `${hola}, te armamos la propuesta de reposición ${p.numero} para ${franquicia}${p.desde && p.hasta ? `, según tu venta del ${diaIso(p.desde)} al ${diaIso(p.hasta)}` : ''}.\nElegí qué querés y confirmá el pedido acá: ${linkDe(p.token)}\n(vale hasta el ${fmtDia(p.vence_at)})`
}
/** '2026-09-16' -> '16/09' */
const diaIso = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const urlWhatsapp = (texto: string, telefono?: string | null) => `https://wa.me/${telefono ? normalizarTelefono(telefono) : ''}?text=${encodeURIComponent(texto)}`

export default function FranquiciaPropuestas({ franquicia, nombre, desde, hasta, items, listo }: {
  franquicia: string
  nombre: string
  desde: string
  hasta: string
  /** lo que se va a proponer (lo filtrado en la pantalla) */
  items: ItemPropuesta[]
  /** false mientras cargan precios o datos */
  listo: boolean
}) {
  const [contactos, setContactos] = useState<Contacto[]>([])
  const [verContactos, setVerContactos] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTel, setNuevoTel] = useState('')
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<ItemGuardado[]>([])
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; txt: string } | null>(null)
  // A quién va: '' = elegir el chat en WhatsApp; si no, el id de un contacto guardado
  const [para, setPara] = useState('')

  const cargar = useCallback(async () => {
    if (!supabase) return
    const [c, p] = await Promise.all([
      supabase.from('franquicias_contactos').select('id,nombre,telefono').eq('franquicia', franquicia).order('creado_at'),
      supabase.from('franquicias_propuestas').select('*').eq('franquicia', franquicia).order('creado_at', { ascending: false }).limit(30),
    ])
    setContactos((c.data as Contacto[] | null) ?? [])
    setPropuestas((p.data as Propuesta[] | null) ?? [])
  }, [franquicia])
  useEffect(() => { void cargar() }, [cargar])

  async function agregarContacto() {
    if (!supabase || !telefonoValido(nuevoTel)) { setAviso({ ok: false, txt: 'El teléfono no parece válido.' }); return }
    const { error } = await supabase.from('franquicias_contactos').insert({ franquicia, nombre: nuevoNombre.trim() || null, telefono: normalizarTelefono(nuevoTel) })
    if (error) { setAviso({ ok: false, txt: `No se pudo guardar: ${error.message}` }); return }
    setNuevoNombre(''); setNuevoTel(''); setAviso(null)
    void cargar()
  }
  async function quitarContacto(id: string) {
    if (!supabase) return
    await supabase.from('franquicias_contactos').delete().eq('id', id)
    void cargar()
  }

  const contactoPara = contactos.find((c) => c.id === para) ?? null

  async function enviarPropuesta() {
    if (!supabase || !items.length) return
    const unidades = items.reduce((s, f) => s + f.sugerido, 0)
    const total = items.reduce((s, f) => s + (f.precio ?? 0) * f.sugerido, 0)
    if (!window.confirm(`Se arma la propuesta para ${nombre} con ${items.length} artículos · ${fmt(unidades)} u.${total ? ` · ${fmtPesos(total)}` : ''} y se abre WhatsApp con el link. ¿Seguir?`)) return
    // La pestaña se abre ya (con el clic); si se abre después de guardar, el navegador la bloquea
    const ventana = window.open('', '_blank')
    setEnviando(true)
    setAviso(null)
    try {
      const { data: prop, error } = await supabase
        .from('franquicias_propuestas')
        .insert({ franquicia, franquicia_nombre: nombre, desde, hasta, unidades_propuestas: unidades, total_propuesto: total })
        .select('id,numero,token,vence_at,desde,hasta')
        .single()
      if (error || !prop) throw new Error(error?.message ?? 'No se pudo guardar la propuesta')
      const { error: eItems } = await supabase.from('franquicias_propuesta_items').insert(
        items.map((f, i) => ({
          propuesta_id: prop.id, orden: i, art: f.art, descrip: f.descrip || null, material: f.material || null,
          color: f.color || null, talle: f.talle || null, stock_cli: f.stockCli, vendido: f.vendido,
          stock_mito: f.stock, sugerido: f.sugerido, precio: f.precio,
        })),
      )
      if (eItems) throw new Error(eItems.message)
      await supabase.from('franquicias_propuestas').update({ estado: 'enviada', enviada_at: new Date().toISOString() }).eq('id', prop.id)
      const url = urlWhatsapp(mensajeDe(prop, nombre, contactoPara?.nombre), contactoPara?.telefono)
      if (ventana) ventana.location.href = url
      else window.location.href = url
      setAviso({ ok: true, txt: `Propuesta ${prop.numero} lista: mandá el mensaje en WhatsApp. Si se cerró, usá "Compartir de nuevo" o "Copiar link" en el historial.` })
    } catch (e) {
      ventana?.close()
      setAviso({ ok: false, txt: (e as Error).message })
    } finally {
      setEnviando(false)
      void cargar()
    }
  }

  function compartir(p: Propuesta) {
    window.open(urlWhatsapp(mensajeDe(p, nombre, contactoPara?.nombre), contactoPara?.telefono), '_blank')
  }

  async function abrir(p: Propuesta) {
    if (abierta === p.id) { setAbierta(null); return }
    setAbierta(p.id)
    setDetalle([])
    if (!supabase) return
    const { data } = await supabase.from('franquicias_propuesta_items').select('id,art,descrip,color,talle,sugerido,precio,elegido,cantidad').eq('propuesta_id', p.id).order('orden')
    setDetalle((data as ItemGuardado[] | null) ?? [])
    // Confirmada y vista: deja de avisar en la campana
    if ((p.estado === 'confirmada' || p.estado === 'en_dragon') && !p.revisada_at) {
      await supabase.from('franquicias_propuestas').update({ revisada_at: new Date().toISOString() }).eq('id', p.id)
      void cargar()
    }
  }

  /** Libera una propuesta trabada o con error para que el puente la vuelva a cargar en Dragon */
  async function reintentarDragon(p: Propuesta) {
    if (!supabase) return
    if (p.dragon_enviando_at && !p.dragon_error && !window.confirm(`${p.numero} quedó a mitad de camino. Revisá en Dragon que NO esté cargado (Obs: "Propuesta ${p.numero}") antes de reintentar. ¿Reintentar?`)) return
    await supabase.from('franquicias_propuestas').update({ dragon_error: null, dragon_enviando_at: null, dragon_intentos: 0 }).eq('id', p.id)
    setAviso({ ok: true, txt: `${p.numero}: se vuelve a cargar en Dragon en el próximo minuto.` })
    void cargar()
  }

  function excelPedido(p: Propuesta) {
    const filas = detalle.filter((d) => (d.cantidad ?? 0) > 0)
    const header = ['Artículo', 'Descripción', 'Color', 'Talle', 'Propuesto', 'Pidió', 'Precio', 'Subtotal']
    const rows = filas.map((d) => [d.art, d.descrip ?? '', d.color ?? '', d.talle ?? '', String(d.sugerido), String(d.cantidad ?? 0), d.precio ? String(d.precio) : '', String((d.cantidad ?? 0) * (d.precio ?? 0))])
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pedido-${p.numero}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const unidades = items.reduce((s, f) => s + f.sugerido, 0)

  return (
    <section className="mt-4 rounded-2xl border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-ink">Propuesta para que elija {nombre}</h2>
          <p className="text-xs text-sub">Se abre tu WhatsApp con un link para mandárselo desde cualquier número: marca sí / no y cantidades, y confirma. Vence a los 7 días.</p>
        </div>
        <button type="button" onClick={() => setVerContactos((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-line2 bg-surface px-3 py-1.5 text-xs font-semibold text-ink">
          <Users size={13} aria-hidden /> Contactos ({contactos.length})
        </button>
        {contactos.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-sub">
            Para
            <select value={para} onChange={(e) => setPara(e.target.value)} className="rounded-full border border-line2 bg-surface px-2 py-1 text-xs text-ink">
              <option value="">Elegir en WhatsApp</option>
              {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre || `+${c.telefono}`}</option>)}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => void enviarPropuesta()}
          disabled={enviando || !listo || items.length === 0}
          title={!listo ? 'Esperá a que terminen de cargar los precios' : undefined}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {enviando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />}
          Armar link y mandar por WhatsApp ({items.length} art. · {fmt(unidades)} u.)
        </button>
      </div>

      {aviso && (
        <p role="status" className={`mt-2 rounded-xl border px-3 py-2 text-xs ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>{aviso.txt}</p>
      )}

      {verContactos && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <p className="mb-2 text-xs font-semibold text-ink">WhatsApp de {nombre} <span className="font-normal text-sub">(opcional: para abrir directo su chat)</span></p>
          {contactos.length === 0 && <p className="mb-2 text-xs text-sub">Todavía no hay contactos.</p>}
          <ul className="mb-2 flex flex-col gap-1">
            {contactos.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm text-ink">
                <span className="flex-1">{c.nombre || 'Sin nombre'} · <span className="text-sub">+{c.telefono}</span></span>
                <button type="button" onClick={() => void quitarContacto(c.id)} aria-label={`Quitar ${c.nombre || c.telefono}`} className="rounded-lg p-1 text-red-300 hover:bg-red-500/10"><Trash2 size={13} aria-hidden /></button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre" className="min-w-0 flex-1 rounded-lg border border-line2 bg-paper px-2 py-1.5 text-sm text-ink" />
            <input value={nuevoTel} onChange={(e) => setNuevoTel(e.target.value)} placeholder="Teléfono (ej. 2901 15 123456)" inputMode="tel" className="min-w-0 flex-1 rounded-lg border border-line2 bg-paper px-2 py-1.5 text-sm text-ink" />
            <button type="button" onClick={() => void agregarContacto()} className="inline-flex items-center gap-1 rounded-lg border border-line2 bg-surface2 px-3 py-1.5 text-xs font-semibold text-ink"><Plus size={13} aria-hidden /> Agregar</button>
          </div>
        </div>
      )}

      {propuestas.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface text-[10.5px] uppercase tracking-wide text-sub">
              <tr>
                <th className="w-6 px-2 py-2" />
                <th className="px-2 py-2 text-left">N°</th>
                <th className="px-2 py-2 text-left">Enviada</th>
                <th className="px-2 py-2 text-right">Propuesto</th>
                <th className="px-2 py-2 text-right">Pidió</th>
                <th className="px-2 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {propuestas.map((p) => {
                const e = chipEstado(p)
                const confirmada = p.estado === 'confirmada' || p.estado === 'en_dragon'
                return [
                  <tr key={p.id} onClick={() => void abrir(p)} className="cursor-pointer border-t border-line hover:bg-white/5">
                    <td className="px-2 py-2 text-sub">{abierta === p.id ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-semibold text-ink">
                      {p.numero}
                      {confirmada && !p.revisada_at && <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">nuevo</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-sub">{fmtFecha(p.enviada_at ?? p.creado_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-sub">{fmt(p.unidades_propuestas)} u.{p.total_propuesto ? ` · ${fmtPesos(Number(p.total_propuesto))}` : ''}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-ink">{confirmada ? `${fmt(p.unidades_confirmadas ?? 0)} u.${p.total_confirmado ? ` · ${fmtPesos(Number(p.total_confirmado))}` : ''}` : '—'}</td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${e.cls}`}>{e.txt}</span></td>
                  </tr>,
                  abierta === p.id && (
                    <tr key={`${p.id}-det`} className="border-t border-line bg-surface/50">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-sub">
                          <span>Ventas del {p.desde?.split('-').reverse().join('/')} al {p.hasta?.split('-').reverse().join('/')}</span>
                          {p.confirmada_at && <span>· confirmó {fmtFecha(p.confirmada_at)}</span>}
                          <span className="ml-auto flex flex-wrap gap-1.5">
                            <button type="button" onClick={(ev) => { ev.stopPropagation(); void navigator.clipboard?.writeText(linkDe(p.token)); setAviso({ ok: true, txt: `Link de ${p.numero} copiado.` }) }} className="inline-flex items-center gap-1 rounded-full border border-line2 bg-surface px-2.5 py-1 font-semibold text-ink"><Copy size={12} aria-hidden /> Copiar link</button>
                            {(p.estado === 'enviada' || p.estado === 'borrador') && (
                              <button type="button" onClick={(ev) => { ev.stopPropagation(); compartir(p) }} className="inline-flex items-center gap-1 rounded-full border border-line2 bg-surface px-2.5 py-1 font-semibold text-ink"><Send size={12} aria-hidden /> Compartir de nuevo</button>
                            )}
                            {confirmada && (
                              <button type="button" onClick={(ev) => { ev.stopPropagation(); excelPedido(p) }} className="inline-flex items-center gap-1 rounded-full border border-line2 bg-surface px-2.5 py-1 font-semibold text-ink">⬇ Excel del pedido</button>
                            )}
                          </span>
                        </div>
                        {p.comentario && <p className="mb-2 text-xs text-sub">Comentario del cliente: <b className="text-ink">{p.comentario}</b></p>}
                        {p.estado === 'confirmada' && (p.dragon_error || (p.dragon_enviando_at && Date.now() - new Date(p.dragon_enviando_at).getTime() > 5 * 60_000)) && (
                          <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                            {p.dragon_error ? `Dragon: ${p.dragon_error}` : 'Quedó cargando en Dragon y no terminó.'}
                            <button type="button" onClick={(ev) => { ev.stopPropagation(); void reintentarDragon(p) }} className="rounded-full border border-red-400/40 px-2 py-0.5 font-semibold text-red-200">Reintentar</button>
                          </p>
                        )}
                        {detalle.length === 0 ? (
                          <p className="flex items-center gap-2 text-xs text-sub"><Loader2 size={12} className="animate-spin" aria-hidden /> Cargando…</p>
                        ) : (
                          <table className="w-full text-[12px]">
                            <thead className="text-[10px] uppercase tracking-wide text-sub">
                              <tr><th className="py-1 text-left">Artículo</th><th className="py-1 text-left">Color / Talle</th><th className="py-1 text-right">Propuesto</th><th className="py-1 text-right">Pidió</th><th className="py-1 text-right">Subtotal</th></tr>
                            </thead>
                            <tbody>
                              {detalle.map((d) => {
                                const pidio = d.cantidad ?? 0
                                return (
                                  <tr key={d.id} className="border-t border-line/60">
                                    <td className="py-1 text-ink"><b>{d.art}</b> <span className="text-sub">{d.descrip}</span></td>
                                    <td className="py-1 text-sub">{d.color || 'U'} / {d.talle || '—'}</td>
                                    <td className="py-1 text-right tabular-nums text-sub">{d.sugerido}</td>
                                    <td className={`py-1 text-right font-bold tabular-nums ${!confirmada ? 'text-sub' : pidio === 0 ? 'text-red-400' : pidio !== d.sugerido ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {confirmada ? pidio : '—'}
                                      {confirmada && pidio > 0 && pidio === d.sugerido && <Check size={11} className="ml-1 inline" aria-hidden />}
                                    </td>
                                    <td className="py-1 text-right tabular-nums text-ink">{confirmada && d.precio ? fmtPesos(pidio * d.precio) : '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
