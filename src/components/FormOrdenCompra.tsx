import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  AREAS, BASES_DRAGON, CONDICIONES_DRAGON, IVA, LISTAS_DRAGON, MOTIVOS_DRAGON, PLAZOS, PLAZO_A_CONDICION, TIPOS,
  buscarArticulos, buscarProveedoresDragon, buscarProveedoresOc, datosArticulosDragon, datosProveedorDragon, datosProveedorHistorial, datosProveedorPorCodigo, guardarOrden, leerTxtArticulos, mandarADragon, pedirAutorizacion, pesos,
  cargarSubtipos, separarVariante, subirArchivo, totalItems, variantesArticulo, type SubtipoOc,
  type ArticuloBusqueda, type DatosProveedor, type ItemDragon, type OrdenCompra, type ProveedorDragon, type Variantes,
} from '@/lib/ordenesCompra'

/* Alta / edición de una OC. Con «Esta OC va a Dragon» se habilita el pedido de compra
   (base, proveedor y artículos de Dragon) y el monto bruto pasa a ser el total con IVA. */

type Opcion<T> = { clave: string; valor: T; render: React.ReactNode }

/** Input con buscador (lista debajo, flechas + Enter). */
function Buscador<T>({ valor, onTexto, buscar, onElegir, placeholder, className }: {
  valor: string; onTexto: (t: string) => void; buscar: (t: string) => Promise<Opcion<T>[]>; onElegir: (v: T) => void
  placeholder?: string; className?: string
}) {
  const [res, setRes] = useState<Opcion<T>[]>([])
  const [abierto, setAbierto] = useState(false)
  const [act, setAct] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const ultimo = useRef('')
  useEffect(() => {
    const t = valor.trim()
    if (!abierto || t.length < 2) { setRes([]); return }
    ultimo.current = t
    setCargando(true)
    setFallo(null)
    const h = setTimeout(() => {
      void buscar(t).then((r) => { if (ultimo.current === t) { setRes(r); setAct(0) } }).catch((e: Error) => { setRes([]); setFallo(e.message) }).finally(() => setCargando(false))
    }, 250)
    return () => clearTimeout(h)
  }, [valor, abierto, buscar])
  const elegir = (o: Opcion<T>) => { onElegir(o.valor); setAbierto(false) }
  return (
    <div className="relative">
      <input value={valor} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onTexto(e.target.value); setAbierto(true) }}
        onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (!abierto || !res.length) return
          if (e.key === 'ArrowDown') { setAct((a) => Math.min(a + 1, res.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setAct((a) => Math.max(a - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter') { elegir(res[act]); e.preventDefault() }
        }}
        className={className ?? 'h-9 w-full rounded-xl border border-line bg-surface2 px-3 text-sm text-ink outline-none'} />
      {abierto && valor.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-max min-w-full max-w-[min(560px,85vw)] overflow-auto rounded-xl border border-line bg-[#14141b] shadow-2xl">
          {cargando && !res.length && <p className="p-2.5 text-xs text-sub">Buscando…</p>}
          {!cargando && fallo && <p className="p-2.5 text-xs text-red-300">{fallo}</p>}
          {!cargando && !fallo && !res.length && <p className="p-2.5 text-xs text-sub">Sin coincidencias</p>}
          {res.map((o, i) => (
            <button type="button" key={o.clave} onMouseDown={(e) => { e.preventDefault(); elegir(o) }}
              className={`block w-full px-3 py-2 text-left text-xs hover:bg-teal-500/10 ${i === act ? 'bg-teal-500/10' : ''}`}>{o.render}</button>
          ))}
        </div>
      )}
    </div>
  )
}

const campoCls = 'h-9 w-full rounded-xl border border-line bg-surface2 px-3 text-sm text-ink outline-none'
const lbl = 'mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-sub'

export default function FormOrdenCompra({ oc, enfocarDragon, nombreUsuario, onCerrar, onGuardada }: {
  oc: OrdenCompra | null; enfocarDragon?: boolean; nombreUsuario: string; onCerrar: () => void; onGuardada: (numero: number) => void
}) {
  const { can, isAdmin } = useAuth()
  const esCompras = can('ordenes_compra.compras')
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  /* Responsable de una OC nueva: el usuario que la crea. La cuenta del admin (se llama «admin») no es una persona:
     ahí queda vacío para que se escriba quién es el responsable. */
  const responsableInicial = isAdmin ? '' : nombreUsuario.trim().toUpperCase()
  const [f, setF] = useState(() => ({
    tipo: oc?.tipo ?? 'Producto',
    subtipo_id: oc?.subtipo_id ?? null as number | null,
    planificable: oc?.planificable ?? true,
    metodo: oc?.metodo ?? 'Sin anticipo',
    area: oc?.area ?? '',
    responsable: oc ? oc.responsable ?? '' : responsableInicial,
    proveedor: oc?.proveedor ?? '',
    proveedor_cuit: oc?.proveedor_cuit ?? '',
    contacto: oc?.contacto ?? '',
    telefono: oc?.telefono ?? '',
    mail: oc?.mail ?? '',
    observacion: oc?.observacion ?? '',
    fecha_compra: oc?.fecha_compra ?? hoy,
    fecha_entrega: oc?.fecha_entrega ?? '',
    forma_pago: oc?.forma_pago ?? 'Bancos',
    plazo: oc?.plazo ?? 'Transferencias',
    monto_bruto: oc?.monto_bruto != null ? String(oc.monto_bruto) : '',
    archivo_url: oc?.archivo_url ?? '',
    archivo_path: oc?.archivo_path ?? '',
    dragon: oc?.dragon ?? Boolean(enfocarDragon),
    dragon_base: oc?.dragon_base ?? 'INDOD',
    dragon_proveedor: oc?.dragon_proveedor ?? '',
    dragon_proveedor_nombre: oc?.dragon_proveedor_nombre ?? '',
    dragon_motivo: oc?.dragon_motivo ?? '',
    dragon_condicion: oc?.dragon_condicion ?? (PLAZO_A_CONDICION[oc?.plazo ?? ''] || 'PCF3'),
    dragon_lista: oc?.dragon_lista ?? 'LISTA0',
  }))
  const [items, setItems] = useState<ItemDragon[]>(oc?.dragon_items?.length ? oc.dragon_items : [{ articulo: '', color: '', talle: '', cantidad: 1, precio: 0 }])
  const [variantes, setVariantes] = useState<Record<string, Variantes | null>>({})
  const [provDragonTxt, setProvDragonTxt] = useState(oc?.dragon_proveedor ? `${oc.dragon_proveedor} — ${oc.dragon_proveedor_nombre ?? ''}` : '')
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verJson, setVerJson] = useState(false)
  const [importando, setImportando] = useState(false)
  const [importe, setImporte] = useState<{ agregadas: number; rechazadas: Array<{ linea: number; texto: string; motivo: string }> } | null>(null)
  const boxDragon = useRef<HTMLDivElement>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const bloqueadoDragon = oc?.dragon_estado === 'ok' || oc?.dragon_estado === 'enviando' || oc?.dragon_estado === 'pendiente'

  // Si el perfil terminó de cargar después de abrir el formulario, el responsable se completa igual (si sigue vacío)
  useEffect(() => { if (!oc && responsableInicial) setF((x) => (x.responsable.trim() ? x : { ...x, responsable: responsableInicial })) }, [oc, responsableInicial])
  /** Subtipos del árbol de autorizadores (Autorizadores → «Quién autoriza cada tipo»). */
  const [subtipos, setSubtipos] = useState<SubtipoOc[]>([])
  useEffect(() => { void cargarSubtipos().then(setSubtipos).catch(() => setSubtipos([])) }, [])
  const subsDelTipo = subtipos.filter((x) => x.tipo === f.tipo)
  useEffect(() => { if (enfocarDragon) setTimeout(() => boxDragon.current?.scrollIntoView({ block: 'center' }), 100) }, [enfocarDragon])
  // Colores y talles de los artículos ya cargados
  useEffect(() => {
    for (const a of new Set(items.map((i) => i.articulo).filter(Boolean))) {
      if (!(a in variantes)) {
        setVariantes((v) => ({ ...v, [a]: null }))
        void variantesArticulo(a, f.dragon_base).then((r) => setVariantes((v) => ({ ...v, [a]: r })))
      }
    }
  }, [items, variantes, f.dragon_base])

  const subtotal = totalItems(items)
  const totalDragon = Math.round(subtotal * (1 + IVA) * 100) / 100
  const montoMostrado = f.dragon ? String(totalDragon) : f.monto_bruto

  const buscarProvOc = useMemo(() => async (t: string) => (await buscarProveedoresOc(t)).map((p) => ({
    clave: p.dragon ? `dragon:${p.dragon}` : `oc:${p.proveedor}`, valor: p,
    render: <span><b className="text-ink">{p.proveedor}</b>{p.proveedor_cuit && <span className="ml-2 text-sub">{p.proveedor_cuit}</span>}
      {p.dragon && <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">Dragon {p.dragon}</span>}</span>,
  })), [])
  /** Completa CUIT, contacto, teléfono y mail que estén vacíos (lo que ya se cargó a mano no se pisa) */
  const completarContacto = (d: Partial<DatosProveedor> | null, soloSi?: string) => {
    if (!d) return
    setF((x) => soloSi !== undefined && x.proveedor !== soloSi ? x : ({
      ...x,
      proveedor_cuit: x.proveedor_cuit.trim() || d.proveedor_cuit || '',
      contacto: x.contacto.trim() || d.contacto || '',
      telefono: x.telefono.trim() || d.telefono || '',
      mail: x.mail.trim() || d.mail || '',
    }))
  }
  const elegirProveedor = (p: DatosProveedor) => {
    setF((x) => ({ ...x, proveedor: p.proveedor }))
    completarContacto(p)
    // Si falta algún dato: primero el historial de OC (por CUIT o nombre), después el maestro de Dragon.
    // completarContacto solo llena lo vacío, así que el historial tiene prioridad.
    if (!(p.proveedor_cuit && p.contacto && p.telefono && p.mail)) {
      void (async () => {
        completarContacto(await datosProveedorHistorial(p.proveedor, p.proveedor_cuit).catch(() => null), p.proveedor)
        completarContacto(await datosProveedorDragon(p.proveedor, p.proveedor_cuit).catch(() => null), p.proveedor)
      })()
    }
  }
  const buscarProvDragon = useMemo(() => async (t: string) => (await buscarProveedoresDragon(t)).map((p) => ({
    clave: p.codigo, valor: p,
    render: <span><b className="mr-2 text-teal-300">{p.codigo}</b>{p.nombre}</span>,
  })), [])
  const buscarArt = useMemo(() => async (t: string) => (await buscarArticulos(t, f.dragon_base)).map((a) => ({
    clave: a.articulo, valor: a,
    render: <span className="grid grid-cols-[90px_1fr_auto] gap-2"><b className="text-teal-300">{a.articulo}</b><span>{a.descripcion}</span><span className="text-sub">{a.proveedor}</span></span>,
  })), [f.dragon_base])

  const setItem = (i: number, cambio: Partial<ItemDragon>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...cambio } : x)))
  const elegirArticulo = (i: number, a: ArticuloBusqueda) => {
    setItem(i, { articulo: a.articulo, descripcion: a.descripcion, color: '', talle: '' })
    void variantesArticulo(a.articulo, f.dragon_base).then((r) => {
      setVariantes((v) => ({ ...v, [a.articulo]: r }))
      if (r) setItem(i, { color: r.colores[0]?.codigo ?? '', talle: r.talles[0] ?? '' })
    })
  }
  const todosLosTalles = (i: number) => {
    const it = items[i]
    const v = variantes[it.articulo]
    if (!v) return
    const faltan = v.talles.filter((t) => !items.some((x) => x.articulo === it.articulo && x.color === it.color && x.talle === t))
    setItems((l) => [...l.slice(0, i + 1), ...faltan.map((t) => ({ ...it, talle: t, cantidad: 0 })), ...l.slice(i + 1)])
  }

  /** Txt `CANTIDAD+ARTICULO%COLORTALLE`: valida contra Dragon, suma los repetidos y deja afuera (a la vista) lo que no existe. */
  const importarTxt = async (archivo: File | undefined) => {
    if (!archivo) return
    setImportando(true)
    setImporte(null)
    setError(null)
    try {
      const { lineas, malas } = leerTxtArticulos(await archivo.text())
      const rechazadas = malas.map((m) => ({ ...m, motivo: 'No tiene el formato 24+ARTICULO%02XXL' }))
      const datos = new Map((await datosArticulosDragon(lineas.map((l) => l.articulo), f.dragon_base)).map((a) => [a.articulo.toUpperCase(), a]))
      const nuevos: ItemDragon[] = []
      for (const l of lineas) {
        const a = datos.get(l.articulo)
        if (!a) { rechazadas.push({ linea: l.linea, texto: l.texto, motivo: `El artículo no existe en ${f.dragon_base}` }); continue }
        const sku = separarVariante(l.variante, a)
        if (!sku) { rechazadas.push({ linea: l.linea, texto: l.texto, motivo: 'Ese color y talle no existen para el artículo' }); continue }
        nuevos.push({ articulo: a.articulo, descripcion: a.descripcion, color: sku.color, talle: sku.talle, cantidad: l.cantidad, precio: 0 })
      }
      setVariantes((v) => ({ ...v, ...Object.fromEntries([...datos.values()].map((a) => [a.articulo, { colores: a.colores, talles: a.talles }])) }))
      setItems((actuales) => {
        const lista = actuales.filter((i) => i.articulo)
        for (const n of nuevos) {
          const igual = lista.findIndex((x) => x.articulo === n.articulo && x.color === n.color && x.talle === n.talle)
          if (igual >= 0) lista[igual] = { ...lista[igual], cantidad: lista[igual].cantidad + n.cantidad }
          else lista.push(n)
        }
        return lista.length ? lista : actuales
      })
      setImporte({ agregadas: nuevos.length, rechazadas: rechazadas.sort((x, y) => x.linea - y.linea) })
    } catch (e) {
      setError(`No se pudo importar el txt: ${(e as Error).message}`)
    } finally {
      setImportando(false)
    }
  }

  const payload = () => ({
    ...(oc ? { numero: oc.numero } : {}),
    ...f,
    monto_bruto: montoMostrado,
    dragon_items: f.dragon ? items.filter((i) => i.articulo && Number(i.cantidad) > 0).map((i) => ({ ...i, cantidad: Number(i.cantidad), precio: Number(i.precio) })) : [],
  })

  const guardar = async (despues?: 'pedir' | 'dragon') => {
    if (subsDelTipo.length > 0 && f.subtipo_id == null) { setError(`Elegí el subtipo de ${f.tipo}: define a quién le llega la autorización.`); return }
    setGuardando(despues ?? 'guardar')
    setError(null)
    try {
      const n = await guardarOrden(payload())
      if (despues === 'dragon') await mandarADragon(n)
      if (despues === 'pedir') await pedirAutorizacion(n)
      onGuardada(n)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(null)
    }
  }

  /* Un solo botón principal según el estado de la OC (antes eran tres):
     sin autorizar → pide la autorización (al autorizarla se crea sola en Dragon, ver sql/ordenes_compra_dragon_auto.sql);
     autorizada y con Dragon → la crea en Dragon (Compras); si no, guarda. «Solo guardar» queda como acción secundaria. */
  const pie = ((): { accion: 'guardar' | 'pedir' | 'dragon'; texto: string; ayuda: string } => {
    const enDragon = f.dragon ? ' Cuando la autoricen, se crea sola en Dragon.' : ''
    if (oc?.cancelada_at) return { accion: 'guardar', texto: 'Guardar OC', ayuda: 'La OC está cancelada. Los cambios quedan en el historial.' }
    if (oc?.pasos?.autor) {
      if (f.dragon && esCompras && !bloqueadoDragon) {
        return {
          accion: 'dragon', texto: oc.dragon_estado === 'error' ? 'Guardar y reintentar en Dragon' : 'Guardar y crear en Dragon',
          ayuda: `Autorizada por ${oc.pasos.autor.por ?? '—'}. Se manda a Dragon por el puente en menos de 1 minuto.`,
        }
      }
      return { accion: 'guardar', texto: 'Guardar OC', ayuda: oc.dragon_estado === 'ok' ? 'Ya está creada en Dragon. Los cambios quedan en el historial.' : 'Ya está autorizada. Los cambios quedan en el historial.' }
    }
    if (oc?.pedida_at) {
      return { accion: 'guardar', texto: 'Guardar OC', ayuda: `Autorización pedida${oc.pedida_a?.length ? ` a ${oc.pedida_a.join(', ')}` : ''}.${enDragon}` }
    }
    return { accion: 'pedir', texto: 'Guardar y pedir autorización', ayuda: `Le avisa al autorizador por Telegram.${enDragon} «Solo guardar» la deja sin avisar.` }
  })()

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return
    setGuardando('archivo')
    try {
      set('archivo_path', await subirArchivo(oc ? String(oc.numero) : `nueva-${Date.now()}`, archivo))
    } catch (e) {
      setError(`No se pudo subir el archivo: ${(e as Error).message}`)
    } finally {
      setGuardando(null)
    }
  }

  const seg = (opciones: string[], valor: string, cambiar: (v: string) => void, deshabilitado = false) => (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map((o) => (
        <button type="button" key={o} disabled={deshabilitado} onClick={() => cambiar(o)}
          className={`h-9 rounded-xl border px-3 text-sm font-semibold transition disabled:opacity-50 ${valor === o ? 'border-lime-500 bg-lime-500/15 text-lime-200' : 'border-line bg-surface2 text-sub'}`}>{o}</button>
      ))}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="max-h-[calc(100vh-24px)] w-full max-w-4xl overflow-auto rounded-3xl border border-line bg-[#0c0c11] shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">
            {oc ? `Editar OC N° ${oc.numero}` : 'Nueva orden de compra'}
            {!oc && <span className="ml-2 rounded-full border border-lime-400/40 px-2 py-0.5 text-xs text-lime-300">N° automático</span>}
          </h2>
          <button onClick={onCerrar} className="rounded-lg border border-line p-1.5 text-sub hover:bg-surface2" aria-label="Cerrar"><X size={16} /></button>
        </div>

        <div className="grid gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-lime-400 sm:col-span-2">Qué se compra</p>
          <div className="sm:col-span-2"><span className={lbl}>Tipo de compra</span>
            {seg([...TIPOS], f.tipo, (v) => setF((x) => ({ ...x, tipo: v as typeof x.tipo, subtipo_id: v === x.tipo ? x.subtipo_id : null, ...(v === 'Servicios' || v === 'Talleres' ? { planificable: true, metodo: 'Sin anticipo' as const } : {}) })))}</div>
          {(subsDelTipo.length > 0 || f.subtipo_id != null) && (
            <div className="sm:col-span-2"><span className={lbl}>Subtipo{subsDelTipo.length > 0 && ' *'}</span>
              <select value={f.subtipo_id ?? ''} onChange={(e) => set('subtipo_id', e.target.value ? Number(e.target.value) : null)} aria-label="Subtipo"
                className={`${campoCls} ${subsDelTipo.length > 0 && f.subtipo_id == null ? 'border-amber-500/60' : ''}`}>
                <option value="">— Elegí el subtipo —</option>
                {subsDelTipo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                {f.subtipo_id != null && !subsDelTipo.some((x) => x.id === f.subtipo_id) && <option value={f.subtipo_id}>Subtipo anterior (ya no está en la lista)</option>}
              </select>
              <p className="mt-1 text-xs text-sub">Define a quién le llega el pedido de autorización.</p></div>
          )}
          <div><span className={lbl}>Planificable</span>
            {seg(['Sí', 'No'], f.planificable ? 'Sí' : 'No', (v) => set('planificable', v === 'Sí'), f.tipo === 'Servicios' || f.tipo === 'Talleres')}
            <p className={`mt-1 text-xs ${f.planificable ? 'text-lime-300' : 'text-sub'}`}>{f.planificable ? 'Se envía OC formal al proveedor.' : 'No se envía OC formal.'}</p></div>
          <div><span className={lbl}>Método</span>
            {seg(['Sin anticipo', 'Con anticipo', 'Compra directa'], f.metodo, (v) => set('metodo', v as typeof f.metodo), f.tipo === 'Servicios' || f.tipo === 'Talleres')}
            <p className="mt-1 text-xs text-sub">{f.metodo === 'Sin anticipo' ? 'Se paga después de recibir la factura.' : f.metodo === 'Con anticipo' ? 'Se paga antes de recibir la factura.' : 'Primero se compra y después se pasa el comprobante.'}</p></div>
          <div className="sm:col-span-2"><span className={lbl}>Observación (qué se compra)</span>
            <textarea value={f.observacion} onChange={(e) => set('observacion', e.target.value)} className="min-h-[60px] w-full rounded-xl border border-line bg-surface2 p-2.5 text-sm text-ink outline-none"
              placeholder="Ej.: PROCESO DE CONFECCIÓN PO5008 CF265730 // Vidrieras octubre" /></div>
          <div><span className={lbl}>Responsable</span><input value={f.responsable} onChange={(e) => set('responsable', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Área</span>
            <select value={f.area} onChange={(e) => set('area', e.target.value)} className={campoCls}>
              <option value="">—</option>{AREAS.map((a) => <option key={a}>{a}</option>)}
            </select></div>

          <p className="mt-2 border-t border-line pt-3 text-[10.5px] font-bold uppercase tracking-wide text-lime-400 sm:col-span-2">Proveedor</p>
          <div className="sm:col-span-2"><span className={lbl}>Razón social</span>
            <Buscador valor={f.proveedor} onTexto={(t) => set('proveedor', t)} buscar={buscarProvOc} placeholder="Escribí el nombre (completa CUIT y contacto de Dragon o de la última OC)"
              onElegir={elegirProveedor} /></div>
          <div><span className={lbl}>CUIT</span><input value={f.proveedor_cuit} onChange={(e) => set('proveedor_cuit', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Contacto</span><input value={f.contacto} onChange={(e) => set('contacto', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Teléfono</span><input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Mail de ventas</span><input value={f.mail} onChange={(e) => set('mail', e.target.value)} className={campoCls} /></div>

          <p className="mt-2 border-t border-line pt-3 text-[10.5px] font-bold uppercase tracking-wide text-lime-400 sm:col-span-2">Fechas, pago y monto</p>
          <div><span className={lbl}>Fecha de compra</span><input type="date" value={f.fecha_compra} onChange={(e) => set('fecha_compra', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Fecha de entrega</span><input type="date" value={f.fecha_entrega} onChange={(e) => set('fecha_entrega', e.target.value)} className={campoCls} /></div>
          <div><span className={lbl}>Forma de pago</span>
            <select value={f.forma_pago} onChange={(e) => setF((x) => ({ ...x, forma_pago: e.target.value, plazo: PLAZOS[e.target.value]?.[0] ?? '' }))} className={campoCls}>
              {Object.keys(PLAZOS).map((p) => <option key={p}>{p}</option>)}
            </select></div>
          <div><span className={lbl}>Plazo</span>
            <select value={f.plazo} onChange={(e) => setF((x) => ({ ...x, plazo: e.target.value, dragon_condicion: PLAZO_A_CONDICION[e.target.value] ?? x.dragon_condicion }))} className={campoCls}>
              {(PLAZOS[f.forma_pago] ?? []).concat(PLAZOS[f.forma_pago]?.includes(f.plazo) || !f.plazo ? [] : [f.plazo]).map((p) => <option key={p}>{p}</option>)}
            </select></div>
          <div><span className={lbl}>Monto bruto ($)</span>
            <input value={f.dragon ? pesos(totalDragon) : f.monto_bruto} readOnly={f.dragon} inputMode="decimal"
              onChange={(e) => set('monto_bruto', e.target.value.replace(',', '.'))} className={`${campoCls} ${f.dragon ? 'opacity-75' : ''}`} />
            {f.dragon && <p className="mt-1 text-xs text-lime-300">Lo trae del total de Dragon (con IVA). Se actualiza al cambiar los artículos.</p>}</div>
          <div><span className={lbl}>Archivo (presupuesto, PDF o foto)</span>
            <div className="flex gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink hover:bg-line">
                {guardando === 'archivo' ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} {f.archivo_path ? 'Cambiar' : 'Subir'}
                <input type="file" className="hidden" accept="application/pdf,image/*,.xlsx,.xls" onChange={(e) => void subir(e.target.files?.[0])} />
              </label>
              <input value={f.archivo_url} onChange={(e) => set('archivo_url', e.target.value)} placeholder="…o pegá el enlace de Drive" className={campoCls} />
            </div>
            {f.archivo_path && <p className="mt-1 text-xs text-lime-300">✓ Archivo subido</p>}</div>

          {/* ---- Dragon ---- */}
          <p className="mt-2 border-t border-line pt-3 text-[10.5px] font-bold uppercase tracking-wide text-teal-300 sm:col-span-2">DragonFish</p>
          <label className="flex items-center gap-2.5 rounded-xl border border-teal-500/35 px-3 py-2.5 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.dragon} disabled={bloqueadoDragon} onChange={(e) => set('dragon', e.target.checked)} className="h-4 w-4 accent-teal-500" />
            <b className="text-teal-200">Esta OC va a Dragon</b>
            <span className="text-xs text-sub">— habilita el pedido de compra (base, proveedor, motivo, condición y artículos)</span>
          </label>
          {f.dragon && (
            <div ref={boxDragon} className="flex flex-col gap-3 rounded-2xl border border-teal-500/30 bg-teal-500/5 p-3 sm:col-span-2">
              {bloqueadoDragon && <p className="text-xs text-teal-200">Ya se mandó a Dragon: los datos del pedido no se pueden cambiar.</p>}
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2"><span className={lbl}>Base de Dragon</span>
                  <select value={f.dragon_base} disabled={bloqueadoDragon} onChange={(e) => set('dragon_base', e.target.value)} className={campoCls}>
                    {BASES_DRAGON.map((b) => <option key={b.codigo} value={b.codigo} disabled={!b.activa}>{b.nombre}</option>)}
                  </select></div>
                <div><span className={lbl}>N° en Dragon</span><input value={oc ? `X-0164-${oc.numero}` : 'El mismo de la OC'} disabled className={campoCls} /></div>
                <div><span className={lbl}>Lista de precios</span>
                  <select value={f.dragon_lista} disabled={bloqueadoDragon} onChange={(e) => set('dragon_lista', e.target.value)} className={campoCls}>
                    {LISTAS_DRAGON.map(([c, d]) => <option key={c} value={c}>{c} · {d}</option>)}
                  </select></div>
                <div className="sm:col-span-2"><span className={lbl}>Proveedor en Dragon</span>
                  <Buscador<ProveedorDragon> valor={provDragonTxt} buscar={buscarProvDragon} placeholder="Buscá por código o nombre…"
                    onTexto={(t) => { setProvDragonTxt(t); setF((x) => ({ ...x, dragon_proveedor: '', dragon_proveedor_nombre: '' })) }}
                    onElegir={(p) => { setProvDragonTxt(`${p.codigo} — ${p.nombre}`); setF((x) => ({ ...x, dragon_proveedor: p.codigo, dragon_proveedor_nombre: p.nombre })); void datosProveedorPorCodigo(p.codigo).then((d) => completarContacto(d)).catch(() => {}) }} />
                  {!f.dragon_proveedor && provDragonTxt && <p className="mt-1 text-xs text-amber-300">Elegilo de la lista</p>}</div>
                <div><span className={lbl}>Motivo *</span>
                  <select value={f.dragon_motivo} disabled={bloqueadoDragon} onChange={(e) => set('dragon_motivo', e.target.value)} className={`${campoCls} ${!f.dragon_motivo ? 'border-amber-500/60' : ''}`}>
                    <option value="">— elegí el motivo —</option>
                    {MOTIVOS_DRAGON.map(([c, d]) => <option key={c} value={c}>{c} · {d}</option>)}
                  </select></div>
                <div><span className={lbl}>Condición de pago</span>
                  <select value={f.dragon_condicion} disabled={bloqueadoDragon} onChange={(e) => set('dragon_condicion', e.target.value)} className={campoCls}>
                    {CONDICIONES_DRAGON.map(([c, d]) => <option key={c} value={c}>{c} · {d}</option>)}
                  </select></div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-xs">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-sub">
                    <th className="p-1.5">Artículo</th><th className="p-1.5">Descripción</th><th className="w-[110px] p-1.5">Color</th><th className="w-[80px] p-1.5">Talle</th>
                    <th className="w-[80px] p-1.5">Cantidad</th><th className="w-[100px] p-1.5">Precio</th><th className="w-[100px] p-1.5 text-right">Monto</th><th className="w-[90px]" />
                  </tr></thead>
                  <tbody>
                    {items.map((it, i) => {
                      const v = variantes[it.articulo]
                      return (
                        <tr key={i} className="border-t border-line align-top">
                          <td className="w-[150px] p-1">
                            {bloqueadoDragon ? <b>{it.articulo}</b> : (
                              <Buscador<ArticuloBusqueda> valor={it.articulo} buscar={buscarArt} placeholder="Código, nombre…"
                                className="h-8 w-full rounded-lg border border-line bg-surface2 px-2 text-xs text-ink outline-none"
                                onTexto={(t) => setItem(i, { articulo: t.toUpperCase(), descripcion: '' })} onElegir={(a) => elegirArticulo(i, a)} />
                            )}
                          </td>
                          <td className="p-1.5 text-sub">{it.descripcion}</td>
                          <td className="p-1">
                            {v?.colores.length ? (
                              <select value={it.color} disabled={bloqueadoDragon} onChange={(e) => setItem(i, { color: e.target.value })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-1 text-xs text-ink">
                                {v.colores.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} {c.nombre}</option>)}
                              </select>
                            ) : <input value={it.color} disabled={bloqueadoDragon} onChange={(e) => setItem(i, { color: e.target.value.toUpperCase() })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" />}
                          </td>
                          <td className="p-1">
                            {v?.talles.length ? (
                              <select value={it.talle} disabled={bloqueadoDragon} onChange={(e) => setItem(i, { talle: e.target.value })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-1 text-xs text-ink">
                                {v.talles.map((t) => <option key={t}>{t}</option>)}
                              </select>
                            ) : <input value={it.talle} disabled={bloqueadoDragon} onChange={(e) => setItem(i, { talle: e.target.value.toUpperCase() })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" />}
                          </td>
                          <td className="p-1"><input value={it.cantidad} disabled={bloqueadoDragon} inputMode="numeric" onChange={(e) => setItem(i, { cantidad: Number(e.target.value) || 0 })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" /></td>
                          <td className="p-1"><input value={it.precio} disabled={bloqueadoDragon} inputMode="decimal" onChange={(e) => setItem(i, { precio: Number(e.target.value.replace(',', '.')) || 0 })} className="h-8 w-full rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" /></td>
                          <td className="p-1.5 text-right tabular-nums">{pesos(it.cantidad * it.precio)}</td>
                          <td className="p-1 text-right">
                            {!bloqueadoDragon && (
                              <span className="inline-flex gap-1">
                                {v?.talles.length ? <button type="button" onClick={() => todosLosTalles(i)} title="Una línea por cada talle de este color" className="rounded-md border border-line px-1.5 py-1 text-[10.5px] text-sub hover:text-ink">talles</button> : null}
                                <button type="button" onClick={() => setItems((l) => l.length > 1 ? l.filter((_, j) => j !== i) : l)} className="rounded-md border border-line p-1 text-sub hover:text-red-300" aria-label="Quitar"><Trash2 size={12} /></button>
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-start gap-3">
                {!bloqueadoDragon && (
                  <button type="button" onClick={() => setItems((l) => [...l, { articulo: '', color: '', talle: '', cantidad: 1, precio: l[l.length - 1]?.precio ?? 0 }])}
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface2"><Plus size={13} /> Agregar artículo</button>
                )}
                {!bloqueadoDragon && (
                  <label title="Una línea por artículo: 24+ZH000200%02XXL (cantidad + artículo % color y talle)"
                    className={`inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface2 ${importando ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
                    {importando ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Importar txt
                    <input type="file" accept=".txt,text/plain" className="hidden" disabled={importando}
                      onChange={(e) => { void importarTxt(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                )}
                {isAdmin && <button type="button" onClick={() => setVerJson((x) => !x)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-sub">Ver JSON</button>}
                <div className="ml-auto grid grid-cols-[auto_auto] gap-x-4 text-right text-xs text-sub">
                  <span>Subtotal</span><b className="text-ink">{pesos(subtotal)}</b>
                  <span>IVA 21 %</span><b className="text-ink">{pesos(subtotal * IVA)}</b>
                  <span className="text-sm">Total Dragon</span><b className="text-sm text-ink">{pesos(totalDragon)}</b>
                </div>
              </div>
              {importe && (
                <div className={`rounded-xl border p-2.5 text-xs ${importe.rechazadas.length ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-teal-500/30 bg-teal-500/10 text-teal-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p>{importe.agregadas} {importe.agregadas === 1 ? 'línea importada' : 'líneas importadas'}{importe.agregadas > 0 && ', con precio en 0: falta cargar los precios'}.{importe.rechazadas.length > 0 && ` ${importe.rechazadas.length} sin importar:`}</p>
                    <button type="button" onClick={() => setImporte(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Cerrar aviso"><X size={13} /></button>
                  </div>
                  {importe.rechazadas.length > 0 && (
                    <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto">
                      {importe.rechazadas.map((r) => <li key={r.linea}>Línea {r.linea}: <b>{r.texto}</b> — {r.motivo}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {verJson && (
                <pre className="max-h-60 overflow-auto rounded-xl border border-line bg-black/40 p-2.5 text-[11px] text-cyan-200">
                  {`// BaseDeDatos: ${f.dragon_base}\n` + JSON.stringify({
                    Letra: 'X', PuntoDeVenta: 164, Numero: oc?.numero ?? '(nuevo)', Proveedor: f.dragon_proveedor, ListaDePrecios: f.dragon_lista,
                    CondicionPagoPreferente: f.dragon_condicion, Motivo: f.dragon_motivo, Fecha: f.fecha_compra, FechaEntrega: f.fecha_entrega || f.fecha_compra,
                    Obs: f.observacion, FacturaDetalle: items.filter((x) => x.articulo && x.cantidad > 0).map((x, n) => ({ NroItem: n + 1, Articulo: x.articulo, Color: x.color, Talle: x.talle, Cantidad: x.cantidad, Precio: x.precio })),
                  }, null, 2)}
                </pre>
              )}
              <p className="text-xs text-sub">Se manda por la API de Dragon a través del puente (en menos de 1 minuto) con el mismo número de la OC. Queda registrado quién la mandó.</p>
            </div>
          )}
        </div>

        {error && <p className="mx-5 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <span className="max-w-md text-xs text-sub">{pie.ayuda}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onCerrar} className="h-9 rounded-xl border border-line px-4 text-sm text-ink hover:bg-surface2">Cancelar</button>
            {pie.accion !== 'guardar' && (
              <button disabled={!!guardando} onClick={() => void guardar()} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm text-sub underline-offset-2 hover:text-ink hover:underline disabled:opacity-60">
                {guardando === 'guardar' && <Loader2 size={14} className="animate-spin" />} Solo guardar
              </button>
            )}
            <button disabled={!!guardando} onClick={() => void guardar(pie.accion === 'guardar' ? undefined : pie.accion)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60 ${pie.accion === 'dragon' ? 'bg-teal-600 hover:bg-teal-700' : pie.accion === 'pedir' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-lime-600 hover:bg-lime-700'}`}>
              {guardando === pie.accion ? <Loader2 size={14} className="animate-spin" /> : pie.accion === 'pedir' ? '💬' : null} {pie.texto}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
