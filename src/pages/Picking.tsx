import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Search, ChevronRight, CheckCheck, Check, Minus, Plus, ArrowLeft, PackageCheck, RotateCcw, Boxes, ClipboardList, FileSpreadsheet,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { cruzar, leerIngresos, type RenglonPedido } from '@/lib/ingresosPicking'

/* ------------------------------------------------------------------ */
/*  Picking (Depósito): ingreso físico de los pedidos de compra.       */
/*  Se elige el proveedor, el N° de pedido y se carga lo que llegó en  */
/*  un picking; cada picking se REGISTRA aparte (#1, #2…) y la tabla    */
/*  muestra recibido y saldo (sql/picking_entregas.sql).                */
/* ------------------------------------------------------------------ */

interface PedidoPicking {
  codigo: string
  numero: number | null
  descripcion: string | null
  fecha: string | null
  proveedor: string | null
  proveedor_nombre: string | null
  anulado: boolean
  unidades: number
  recibidas: number
}

interface ItemPicking {
  /** Lo que se espera que ingrese = pedido − cancelado (con esto se marca) */
  articulo: string
  color: string
  talle: string
  cantidad: number
  recibido: number
  /** Lo pedido en la OC (sin descontar lo cancelado) */
  pedido?: number
  /** Unidades canceladas (cancelaciones de DWH) de este artículo/color/talle */
  cancelado?: number
  actualizado_at: string | null
  actualizado_por: string | null
}

/** Renglón del modo "Por artículo": un artículo/color/talle de un pedido. */
interface FilaArticulo extends ItemPicking {
  codigo: string
  numero: number | null
  descripcion: string | null
  fecha: string | null
  proveedor: string | null
  proveedor_nombre: string | null
}

/** Un picking registrado de un pedido (picking_entregas_de) */
interface Entrega {
  id: string
  nro: number
  creado_at: string
  creado_por: string | null
  origen: 'picking' | 'excel' | 'inicial'
  anulado: boolean
  unidades: number
  items: { articulo: string; color: string; talle: string; cantidad: number }[]
}

type Filtro = 'todos' | 'pendientes' | 'completos'
type Modo = 'pedido' | 'articulo'

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
const claveItem = (i: { articulo: string; color: string; talle: string }) => `${i.articulo}|${i.color}|${i.talle}`
const CLAVE_PROV = 'picking.proveedor'
const CLAVE_MODO = 'picking.modo'

/** "PEDIDODECOMPRA X 00001-00009787" -> "X 00001-00009787" */
function numeroComprobante(p: PedidoPicking): string {
  const m = /([A-Z]\s+\d{4,5}-\d{8})\s*$/.exec(p.descripcion ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
}

function Barra({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line/60">
      <span
        className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-transparent'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

/**
 * Cruza los renglones con las cancelaciones de sus pedidos (picking_cancelaciones,
 * sql/picking_cancelaciones.sql): guarda lo pedido y lo cancelado, y deja en
 * `cantidad` lo que queda por ingresar. Si falla, quedan como estaban.
 */
async function conCancelaciones<T extends ItemPicking & { codigo?: string }>(filas: T[], codigoFijo?: string): Promise<T[]> {
  const codigos = [...new Set(filas.map((f) => codigoFijo ?? f.codigo ?? '').filter(Boolean))]
  if (!supabase || !codigos.length) return filas
  const { data, error } = await supabase.rpc('picking_cancelaciones', { p_codigos: codigos })
  if (error || !Array.isArray(data)) return filas
  const canc = new Map<string, number>()
  for (const c of data as { codigo: string; articulo: string; color: string; talle: string; cancelado: number }[]) {
    canc.set(`${c.codigo}|${c.articulo}|${c.color}|${c.talle}`, Number(c.cancelado) || 0)
  }
  return filas.map((f) => {
    const cancelado = canc.get(`${codigoFijo ?? f.codigo}|${claveItem(f)}`) ?? 0
    return cancelado > 0 ? { ...f, pedido: f.cantidad, cancelado, cantidad: Math.max(0, f.cantidad - cancelado) } : f
  })
}

/** Celda "Pedido": lo que falta ingresar y, si hubo, lo pedido y lo cancelado */
function CeldaPedido({ i }: { i: { cantidad: number; pedido?: number; cancelado?: number } }) {
  if (!i.cancelado) return <>{n0.format(i.cantidad)}</>
  return (
    <span title={`Pedido ${n0.format(i.pedido ?? i.cantidad)} · cancelado ${n0.format(i.cancelado)} · queda por ingresar ${n0.format(i.cantidad)}`}>
      {n0.format(i.cantidad)}
      <span className="block text-[10px] font-medium text-red-400">
        de {n0.format(i.pedido ?? i.cantidad)} · {n0.format(i.cancelado)} cancel.
      </span>
    </span>
  )
}

const TALLES_LETRA = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']
/** Talles por tamaño: letras en orden (2XL = XXL), números de menor a mayor, el resto alfabético */
function compararTalle(a: string, b: string): number {
  const rango = (t: string): [number, number] => {
    const s = t.trim().toUpperCase().split(' - ')[0].replace(/^(\d)XL$/, (_, n: string) => `${'X'.repeat(Number(n))}L`)
    const i = TALLES_LETRA.indexOf(s)
    if (i >= 0) return [0, i]
    const n = Number(s.replace(',', '.'))
    return s !== '' && Number.isFinite(n) ? [1, n] : [2, 0]
  }
  const [ga, va] = rango(a)
  const [gb, vb] = rango(b)
  return ga - gb || va - vb || a.localeCompare(b, 'es', { numeric: true })
}

/** Fondo de la fila según lo recibido */
function colorFila(recibido: number, cantidad: number, cancelado = 0): string {
  // Cancelado entero: no hay nada que ingresar (rojo; si entró algo, rojo fuerte)
  if (cantidad === 0 && cancelado > 0) return recibido > 0 ? 'bg-red-500/20' : 'bg-red-500/5'
  return recibido > cantidad ? 'bg-brand-600/10' : recibido >= cantidad ? 'bg-emerald-500/10' : recibido > 0 ? 'bg-amber-500/10' : 'hover:bg-surface2/60'
}

/** "3 colores" o el único valor */
function resumenDe(valores: string[], uno: string, varios: string): string {
  const distintos = [...new Set(valores.filter(Boolean))]
  if (distintos.length <= 1) return distintos[0] ?? '—'
  return `${distintos.length} ${distintos.length === 1 ? uno : varios}`
}

/** − cantidad + (lo recibido) */
function Cantidad({ valor, cantidad, etiqueta, onRestar, onSumar, onFijar }: {
  valor: number
  cantidad: number
  etiqueta: string
  onRestar: () => void
  onSumar: () => void
  onFijar: (n: number) => void
}) {
  const completo = valor >= cantidad
  const demas = valor > cantidad
  return (
    <div className="mx-auto flex w-fit items-center gap-1">
      <button
        onClick={onRestar}
        disabled={valor <= 0}
        aria-label={`Restar 1: ${etiqueta}`}
        className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-30"
      >
        <Minus size={14} aria-hidden />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={valor}
        onChange={(e) => onFijar(Number(e.target.value) || 0)}
        onFocus={(e) => e.target.select()}
        aria-label={etiqueta}
        className={`h-8 w-16 rounded-lg border bg-surface2 px-1 text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${
          demas ? 'border-brand-500 text-brand-400' : completo ? 'border-emerald-500/60 text-emerald-500' : 'border-line text-ink'
        }`}
      />
      <button
        onClick={onSumar}
        aria-label={`Sumar 1: ${etiqueta}`}
        className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2"
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  )
}

/** ✓ completo / desmarcar */
function Tilde({ completo, etiqueta, onClick }: { completo: boolean; etiqueta: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={completo}
      aria-label={completo ? `Desmarcar ${etiqueta}` : `Marcar ${etiqueta} como recibido completo`}
      title={completo ? 'Desmarcar (vuelve a 0)' : 'Llegó completo'}
      className={`btn-press mx-auto flex h-8 w-8 items-center justify-center rounded-lg border-2 transition ${
        completo ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-emerald-500/60 hover:text-emerald-500/60'
      }`}
    >
      <Check size={16} strokeWidth={3} aria-hidden />
    </button>
  )
}

export default function Picking() {
  const [pedidos, setPedidos] = useState<PedidoPicking[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [proveedor, setProveedorState] = useState<string>(() => {
    try { return localStorage.getItem(CLAVE_PROV) ?? '' } catch { return '' }
  })
  const [verCompletos, setVerCompletos] = useState(false)
  const [modo, setModoState] = useState<Modo>(() => {
    try { return localStorage.getItem(CLAVE_MODO) === 'articulo' ? 'articulo' : 'pedido' } catch { return 'pedido' }
  })
  function setModo(m: Modo) {
    setModoState(m)
    setAviso(null)
    try { localStorage.setItem(CLAVE_MODO, m) } catch { /* sin almacenamiento: no pasa nada */ }
  }
  // Modo "Por artículo"
  const [codArt, setCodArt] = useState('')
  const [buscado, setBuscado] = useState('')
  const [filasArt, setFilasArt] = useState<FilaArticulo[]>([])
  const [cargandoArt, setCargandoArt] = useState(false)
  const [verCompletosArt, setVerCompletosArt] = useState(false)
  const [llegaron, setLlegaron] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string | null>(null)

  const [items, setItems] = useState<ItemPicking[]>([])
  const [cargandoItems, setCargandoItems] = useState(false)
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  // Picking en curso: lo que se está contando ahora, todavía sin registrar (clave artículo|color|talle)
  const [borrador, setBorrador] = useState<Record<string, number>>({})
  const [entregas, setEntregas] = useState<Entrega[]>([])
  const [entregaAbierta, setEntregaAbierta] = useState<string | null>(null)
  const [registrando, setRegistrando] = useState(false)

  // Importar el Excel de ingresos del picking (Dragonfish): marca lo que ya ingresó
  const archivoIngresos = useRef<HTMLInputElement>(null)
  const [importando, setImportando] = useState<string | null>(null)
  const [importe, setImporte] = useState<{ ok: boolean; texto: string; detalle?: string[] } | null>(null)

  async function importarIngresos(archivo: File) {
    if (!supabase) return
    setImporte(null)
    try {
      setImportando('Leyendo el Excel…')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await archivo.arrayBuffer())
      const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false })
      const ingresos = leerIngresos(filas)
      if (!ingresos.length) throw new Error('El Excel no tiene artículos ingresados.')

      setImportando('Buscando los pedidos…')
      const renglones: RenglonPedido[] = []
      for (let desde = 0; ; desde += 1000) {
        const { data, error: e } = await supabase.rpc('picking_items_todos').range(desde, desde + 999)
        if (e) throw new Error(e.message)
        const lote = ((data as RenglonPedido[] | null) ?? []).map((r) => ({ ...r, cantidad: Number(r.cantidad), recibido: Number(r.recibido) }))
        renglones.push(...lote)
        if (lote.length < 1000) break
      }

      const r = cruzar(ingresos, renglones)
      setImportando(null)
      const avisoNo = [
        r.sinPedido.length ? `${r.sinPedido.length} pedidos del Excel no están en el hub (anulados o de otra base).` : '',
        r.sinArticulo.length ? `${r.sinArticulo.length} artículos no figuran en su pedido.` : '',
      ].filter(Boolean).join(' ')
      if (!r.marcas.length) {
        setImporte({ ok: true, texto: `No hay nada nuevo para marcar: todo lo del Excel ya estaba marcado. ${avisoNo}`.trim() })
        return
      }
      if (!window.confirm(`Se van a registrar ${n0.format(r.unidades)} unidades en ${r.marcas.length} renglones de ${r.pedidos} pedidos (un picking por pedido).${avisoNo ? `

${avisoNo}` : ''}

¿Seguimos?`)) return

      // Un picking por pedido con lo nuevo de cada renglón (lo que el Excel suma a lo ya recibido)
      const porPedido = new Map<string, { articulo: string; color: string; talle: string; cantidad: number }[]>()
      for (const m of r.marcas) {
        const lista = porPedido.get(m.codigo) ?? []
        lista.push({ articulo: m.articulo, color: m.color, talle: m.talle, cantidad: Math.round((m.recibido - m.antes) * 100) / 100 })
        porPedido.set(m.codigo, lista)
      }
      let k = 0
      for (const [codigo, lista] of porPedido) {
        k++
        setImportando(`Registrando… ${n0.format(k)} de ${n0.format(porPedido.size)} pedidos`)
        const { error: e } = await supabase.rpc('registrar_picking', { p_codigo: codigo, p_items: lista, p_origen: 'excel' })
        if (e) throw new Error(`Se cortó en el pedido ${k} de ${porPedido.size}: ${e.message}. Lo anterior quedó registrado.`)
      }
      setImporte({
        ok: true,
        texto: `Listo: ${n0.format(r.unidades)} unidades marcadas en ${r.pedidos} pedidos. ${avisoNo}`.trim(),
        detalle: [...r.sinPedido.map((c) => `Sin pedido: ${c.replace('PEDIDODECOMPRA ', '')}`), ...r.sinArticulo.map((a) => `Sin artículo: ${a}`)],
      })
      await cargarPedidos()
      setSel(null)
    } catch (e) {
      setImporte({ ok: false, texto: e instanceof Error ? e.message : String(e) })
    } finally {
      setImportando(null)
      if (archivoIngresos.current) archivoIngresos.current.value = ''
    }
  }

  function setProveedor(p: string) {
    setProveedorState(p)
    setSel(null)
    try { localStorage.setItem(CLAVE_PROV, p) } catch { /* sin almacenamiento: no pasa nada */ }
  }

  const cargarPedidos = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('picking_pedidos')
    if (e) setError(e.message)
    setPedidos(((data as PedidoPicking[] | null) ?? []).map((p) => ({ ...p, unidades: Number(p.unidades), recibidas: Number(p.recibidas) })))
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargarPedidos()
  }, [cargarPedidos])

  // Abrir directo un pedido: /deposito/picking?oc=15183&prov=CODIGO (botón de Recepción INDO).
  // La misma OC puede existir en varias marcas: se usa el proveedor para elegir la correcta.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const oc = params.get('oc')?.trim()
    if (!oc || cargando) return
    const prov = params.get('prov')?.trim() ?? ''
    const candidatos = pedidos.filter((p) => String(p.numero ?? '') === oc && !p.anulado)
    const elegido = candidatos.find((p) => prov && p.proveedor === prov) ?? candidatos[0]
    setParams({}, { replace: true })
    if (!elegido) {
      setError(`La OC ${oc} no está en Picking: no figura en la copia de pedidos de compra o está anulada.`)
      return
    }
    setModo('pedido')
    setProveedor(elegido.proveedor ?? '')
    if (elegido.recibidas >= elegido.unidades) setVerCompletos(true)
    setSel(elegido.codigo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, cargando, pedidos])

  // Proveedores con sus pedidos (los que tienen algo pendiente primero)
  const proveedores = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string; pedidos: number; pendientes: number }>()
    for (const p of pedidos) {
      if (p.anulado) continue
      const k = p.proveedor ?? ''
      const it = m.get(k) ?? { codigo: k, nombre: p.proveedor_nombre || k, pedidos: 0, pendientes: 0 }
      it.pedidos++
      if (p.recibidas < p.unidades) it.pendientes++
      m.set(k, it)
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [pedidos])

  const pedidosProv = useMemo(
    () =>
      pedidos
        .filter((p) => p.proveedor === proveedor && !p.anulado && (verCompletos || p.recibidas < p.unidades))
        .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')) || (b.numero ?? 0) - (a.numero ?? 0)),
    [pedidos, proveedor, verCompletos],
  )
  const pedido = pedidos.find((p) => p.codigo === sel) ?? null

  /** Artículos del pedido (con lo cancelado descontado) y su historial de pickings */
  const cargarPedidoSel = useCallback(async (codigo: string): Promise<{ its: ItemPicking[]; ents: Entrega[] }> => {
    if (!supabase) return { its: [], ents: [] }
    const [ri, re] = await Promise.all([
      supabase.rpc('picking_items', { p_codigo: codigo }),
      supabase.rpc('picking_entregas_de', { p_codigo: codigo }),
    ])
    if (ri.error) setError(ri.error.message)
    if (re.error) setError(re.error.message)
    const crudos = ((ri.data as ItemPicking[] | null) ?? []).map((i) => ({ ...i, cantidad: Number(i.cantidad), recibido: Number(i.recibido) }))
    const its = await conCancelaciones(crudos, codigo)
    const ents = ((re.data as Entrega[] | null) ?? []).map((e) => ({ ...e, unidades: Number(e.unidades) }))
    return { its, ents }
  }, [])

  // Artículos del pedido elegido + historial + descripción del maestro de artículos
  useEffect(() => {
    if (!sel || !supabase) {
      setItems([])
      setEntregas([])
      return
    }
    let vivo = true
    setCargandoItems(true)
    setFiltro('todos')
    setBusqueda('')
    setBorrador({})
    setEntregaAbierta(null)
    void cargarPedidoSel(sel).then(async ({ its, ents }) => {
      if (!vivo) return
      setItems(its)
      setEntregas(ents)
      setCargandoItems(false)
      const faltan = [...new Set(its.map((i) => i.articulo))]
      if (!faltan.length || !supabase) return
      const nuevas = new Map<string, string>()
      for (let k = 0; k < faltan.length; k += 200) {
        const { data: arts } = await supabase.from('articulos').select('id_art,descripcion').in('id_art', faltan.slice(k, k + 200))
        for (const a of (arts as { id_art: string; descripcion: string | null }[] | null) ?? []) {
          if (a.descripcion) nuevas.set(a.id_art, a.descripcion)
        }
      }
      if (vivo) setDescripciones((prev) => new Map([...prev, ...nuevas]))
    })
    return () => { vivo = false }
  }, [sel, cargarPedidoSel])

  // ---------- Picking en curso (borrador): lo que se cuenta ahora, sin registrar ----------
  const esteDe = (i: ItemPicking) => borrador[claveItem(i)] ?? 0
  const saldoDe = (i: ItemPicking) => Math.max(0, i.cantidad - i.recibido)
  const hayBorrador = Object.values(borrador).some((v) => v > 0)
  const hayBorradorRef = useRef(false)
  hayBorradorRef.current = hayBorrador

  // Antes de cerrar la pestaña con un picking cargado y sin registrar: avisar
  useEffect(() => {
    const alSalir = (e: BeforeUnloadEvent) => {
      if (hayBorradorRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [])

  /** Aviso si en este picking entra algo que estaba cancelado en la OC */
  function avisarCancelado(variantes: ItemPicking[], nuevo: Record<string, number>) {
    const exc = variantes.find((v) => (v.cancelado ?? 0) > 0 && v.recibido + (nuevo[claveItem(v)] ?? 0) > v.cantidad)
    if (!exc) return
    const qué = `${exc.articulo} ${exc.color} ${exc.talle}`.trim()
    const de_mas = exc.recibido + (nuevo[claveItem(exc)] ?? 0) - exc.cantidad
    setAviso({
      ok: false,
      texto: `${qué}: ${n0.format(exc.cancelado ?? 0)} unidades están canceladas en esta OC y no deberían ingresar. Si llegaron igual, hacé una orden de compra nueva por ${n0.format(de_mas)}.`,
    })
  }

  /** Fija lo del picking para un artículo: llena el saldo de cada color/talle en orden; lo que sobra va al último. */
  function fijarEste(variantes: ItemPicking[], total: number) {
    let resto = Math.max(0, Math.round(total * 100) / 100)
    const nuevo = { ...borrador }
    variantes.forEach((v, k) => {
      const asignar = k === variantes.length - 1 ? resto : Math.min(saldoDe(v), resto)
      resto -= asignar
      nuevo[claveItem(v)] = asignar
    })
    setBorrador(nuevo)
    avisarCancelado(variantes, nuevo)
  }
  const sumarEste = (variantes: ItemPicking[], d: 1 | -1) =>
    fijarEste(variantes, Math.max(0, variantes.reduce((a, v) => a + esteDe(v), 0) + d))
  /** ✓: todo el saldo en este picking (o, si ya estaba, lo saca) */
  function tildarEste(variantes: ItemPicking[]) {
    const lleno = variantes.every((v) => esteDe(v) >= saldoDe(v))
    const nuevo = { ...borrador }
    for (const v of variantes) nuevo[claveItem(v)] = lleno ? 0 : saldoDe(v)
    setBorrador(nuevo)
  }
  function cargarTodoElSaldo() {
    const nuevo: Record<string, number> = {}
    for (const i of items) if (saldoDe(i) > 0) nuevo[claveItem(i)] = saldoDe(i)
    setBorrador(nuevo)
  }
  function limpiarBorrador() {
    if (hayBorrador && !window.confirm('¿Borrar lo cargado en este picking? (todavía no está registrado)')) return
    setBorrador({})
  }

  const descDe = (a: string) => descripciones.get(a) ?? ''
  const q = busqueda.trim().toUpperCase()
  const visibles = useMemo(
    () =>
      items.filter(
        (i) =>
          (filtro === 'todos' || (filtro === 'completos' ? i.recibido >= i.cantidad : i.recibido < i.cantidad)) &&
          (!q || [i.articulo, descDe(i.articulo), i.color, i.talle].some((v) => v.toUpperCase().includes(q))),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filtro, q, descripciones],
  )

  const tot = useMemo(
    () =>
      items.reduce(
        (a, i) => ({
          pedidas: a.pedidas + i.cantidad,
          recibidas: a.recibidas + Math.min(i.recibido, i.cantidad),
          demas: a.demas + Math.max(0, i.recibido - i.cantidad),
          este: a.este + (borrador[claveItem(i)] ?? 0),
        }),
        { pedidas: 0, recibidas: 0, demas: 0, este: 0 },
      ),
    [items, borrador],
  )
  const pct = tot.pedidas > 0 ? Math.round((tot.recibidas / tot.pedidas) * 100) : 0
  const nroSiguiente = entregas.reduce((m, e) => Math.max(m, e.nro), 0) + 1

  // Cada artículo es una fila con su total; el desplegable abre sus colores y talles
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const alternarAbierto = (a: string) =>
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(a)) n.delete(a)
      else n.add(a)
      return n
    })
  const gruposPedido = useMemo(() => {
    const m = new Map<string, ItemPicking[]>()
    for (const i of visibles) m.set(i.articulo, [...(m.get(i.articulo) ?? []), i])
    return [...m.entries()].map(([articulo, sinOrden]) => {
      // color y después talle por tamaño (XS, S, M… / 24, 26, 28…)
      const variantes = [...sinOrden].sort((a, b) => a.color.localeCompare(b.color, 'es', { numeric: true }) || compararTalle(a.talle, b.talle))
      return {
        articulo,
        variantes,
        cantidad: variantes.reduce((a, v) => a + v.cantidad, 0),
        pedido: variantes.reduce((a, v) => a + (v.pedido ?? v.cantidad), 0),
        cancelado: variantes.reduce((a, v) => a + (v.cancelado ?? 0), 0),
        recibido: variantes.reduce((a, v) => a + v.recibido, 0),
        saldo: variantes.reduce((a, v) => a + Math.max(0, v.cantidad - v.recibido), 0),
        este: variantes.reduce((a, v) => a + (borrador[claveItem(v)] ?? 0), 0),
      }
    })
  }, [visibles, borrador])

  // Subtotal de lo filtrado
  const subtotal = useMemo(
    () => ({
      articulos: new Set(visibles.map((i) => i.articulo)).size,
      pedidas: visibles.reduce((a, i) => a + i.cantidad, 0),
      recibidas: visibles.reduce((a, i) => a + i.recibido, 0),
      saldo: visibles.reduce((a, i) => a + Math.max(0, i.cantidad - i.recibido), 0),
      este: visibles.reduce((a, i) => a + (borrador[claveItem(i)] ?? 0), 0),
    }),
    [visibles, borrador],
  )

  // Cancelaciones del pedido: lo cancelado ya está descontado de lo que hay que ingresar
  const cancelPedido = useMemo(() => {
    const con = items.filter((i) => (i.cancelado ?? 0) > 0)
    return {
      articulos: new Set(con.map((i) => i.articulo)).size,
      unidades: con.reduce((a, i) => a + (i.cancelado ?? 0), 0),
      // Lo recibido (o cargado en este picking) por encima de lo que quedaba: mercadería cancelada que entró
      entraron: con
        .map((i) => ({ articulo: i.articulo, color: i.color, talle: i.talle, unidades: i.recibido + (borrador[claveItem(i)] ?? 0) - i.cantidad }))
        .filter((e) => e.unidades > 0),
    }
  }, [items, borrador])

  /** Registra el picking en curso (picking N° siguiente) y vuelve a leer el pedido */
  async function registrar() {
    if (!supabase || !sel) return
    const lista = items
      .map((i) => ({ articulo: i.articulo, color: i.color, talle: i.talle, cantidad: esteDe(i) }))
      .filter((x) => x.cantidad > 0)
    if (!lista.length) {
      setAviso({ ok: false, texto: 'No cargaste nada en este picking.' })
      return
    }
    const unidades = lista.reduce((a, x) => a + x.cantidad, 0)
    if (!window.confirm(`¿Registrar el picking #${nroSiguiente} de esta OC con ${n0.format(unidades)} unidades?`)) return
    setRegistrando(true)
    const { data, error: e } = await supabase.rpc('registrar_picking', { p_codigo: sel, p_items: lista })
    if (e) {
      setRegistrando(false)
      setAviso({ ok: false, texto: `No se pudo registrar el picking: ${e.message}` })
      return
    }
    const { its, ents } = await cargarPedidoSel(sel)
    setItems(its)
    setEntregas(ents)
    setBorrador({})
    setRegistrando(false)
    setAviso({ ok: true, texto: `Picking #${data} registrado: ${n0.format(unidades)} unidades.` })
    void cargarPedidos()
  }

  /** Anula un picking registrado: se resta de lo recibido y queda en el historial como anulado */
  async function anular(e: Entrega) {
    if (!supabase || !sel) return
    if (!window.confirm(`¿Anular el picking #${e.nro} (${n0.format(e.unidades)} unidades)? Se resta de lo recibido.`)) return
    setRegistrando(true)
    const { error: er } = await supabase.rpc('anular_picking', { p_entrega: e.id })
    if (er) {
      setRegistrando(false)
      setAviso({ ok: false, texto: `No se pudo anular: ${er.message}` })
      return
    }
    const { its, ents } = await cargarPedidoSel(sel)
    setItems(its)
    setEntregas(ents)
    setRegistrando(false)
    setAviso({ ok: true, texto: `Picking #${e.nro} anulado.` })
    void cargarPedidos()
  }

  /** Busca el artículo (código o principio del código) en todos los pedidos. */
  async function buscarArticulo(e?: React.FormEvent) {
    e?.preventDefault()
    // Código (o su principio) o parte de la descripción: lo resuelve picking_articulo
    const cod = codArt.trim().replace(/\s+/g, ' ')
    if (!supabase) return
    if (cod.length < 3) {
      setAviso({ ok: false, texto: 'Escribí al menos 3 caracteres del código o de la descripción.' })
      return
    }
    setCargandoArt(true)
    setAviso(null)
    setLlegaron({})
    const { data, error: er } = await supabase.rpc('picking_articulo', { p_articulo: cod })
    setCargandoArt(false)
    if (er) return setError(er.message)
    const filas = await conCancelaciones(((data as FilaArticulo[] | null) ?? []).map((f) => ({ ...f, cantidad: Number(f.cantidad), recibido: Number(f.recibido) })))
    setFilasArt(filas)
    setBuscado(cod)
    if (!filas.length) setAviso({ ok: false, texto: `Ningún artículo de los pedidos de compra coincide con "${cod}".` })
    const arts = [...new Set(filas.map((f) => f.articulo))].filter((a) => !descripciones.has(a))
    if (arts.length) {
      const nuevas = new Map<string, string>()
      for (let k = 0; k < arts.length; k += 200) {
        const { data: d } = await supabase.from('articulos').select('id_art,descripcion').in('id_art', arts.slice(k, k + 200))
        for (const a of (d as { id_art: string; descripcion: string | null }[] | null) ?? []) if (a.descripcion) nuevas.set(a.id_art, a.descripcion)
      }
      setDescripciones((prev) => new Map([...prev, ...nuevas]))
    }
  }

  // Grupos artículo + color + talle, cada uno con sus pedidos del más viejo al más nuevo
  const grupos = useMemo(() => {
    const m = new Map<string, { clave: string; articulo: string; color: string; talle: string; filas: FilaArticulo[] }>()
    for (const f of filasArt) {
      const k = claveItem(f)
      const g = m.get(k) ?? { clave: k, articulo: f.articulo, color: f.color, talle: f.talle, filas: [] }
      g.filas.push(f)
      m.set(k, g)
    }
    return [...m.values()].map((g) => ({
      ...g,
      pedido: g.filas.reduce((a, f) => a + f.cantidad, 0),
      recibido: g.filas.reduce((a, f) => a + Math.min(f.recibido, f.cantidad), 0),
    }))
      .sort((a, b) => a.articulo.localeCompare(b.articulo) || a.color.localeCompare(b.color, 'es', { numeric: true }) || compararTalle(a.talle, b.talle))
  }, [filasArt])

  /** Reparte lo que llegó (del pedido más viejo al más nuevo) y lo REGISTRA como un picking en cada pedido */
  async function repartir(g: (typeof grupos)[number]) {
    if (!supabase) return
    let quedan = Number(String(llegaron[g.clave] ?? '').replace(',', '.'))
    if (!Number.isFinite(quedan) || quedan <= 0) {
      setAviso({ ok: false, texto: 'Poné cuántas unidades llegaron.' })
      return
    }
    const total = quedan
    const asignaciones: { f: FilaArticulo; suma: number }[] = []
    for (const f of g.filas) {
      if (quedan <= 0) break
      const falta = Math.max(0, f.cantidad - f.recibido)
      if (!falta) continue
      const suma = Math.min(falta, quedan)
      asignaciones.push({ f, suma })
      quedan -= suma
    }
    const qué = `${g.articulo} ${g.color} ${g.talle}`.trim()
    if (!asignaciones.length) {
      setAviso({ ok: false, texto: `${qué}: no hay pedidos con saldo, no se registró nada.` })
      return
    }
    setRegistrando(true)
    const usados: string[] = []
    for (const { f, suma } of asignaciones) {
      const { data, error: er } = await supabase.rpc('registrar_picking', {
        p_codigo: f.codigo,
        p_items: [{ articulo: f.articulo, color: f.color, talle: f.talle, cantidad: suma }],
      })
      if (er) {
        setRegistrando(false)
        await buscarArticulo()
        setAviso({ ok: false, texto: `Se cortó en el pedido N° ${f.numero}: ${er.message}. Lo anterior quedó registrado.` })
        return
      }
      usados.push(`N° ${f.numero} picking #${data} (+${n0.format(suma)})`)
    }
    setRegistrando(false)
    await buscarArticulo()
    if (quedan > 0)
      setAviso({ ok: false, texto: `${qué}: ${n0.format(total - quedan)} registradas en ${usados.join(', ')}. Sobran ${n0.format(quedan)}: no hay más pedidos con saldo de ese talle.` })
    else setAviso({ ok: true, texto: `${qué}: ${n0.format(total)} registradas en ${usados.join(', ')}.` })
    void cargarPedidos()
  }
  const provActual = proveedores.find((p) => p.codigo === proveedor)

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Picking</h1>
          <p className="text-sm text-sub">Ingreso físico de los pedidos de compra: marcá lo que llegó.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        <input ref={archivoIngresos} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarIngresos(f) }} />
        <button
          onClick={() => archivoIngresos.current?.click()}
          disabled={!!importando}
          title="Excel de Dragonfish con los artículos que ya ingresaron en el picking"
          className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
        >
          {importando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileSpreadsheet size={15} className="text-emerald-500" aria-hidden />}
          {importando ?? 'Cargar Excel de ingresos'}
        </button>
        <p className="text-xs text-sub" aria-live="polite">
          {registrando && (
            <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden /> Registrando…</span>
          )}
        </p>
        </div>
      </header>

      {importe && (
        <div role="status" className={`mb-3 rounded-xl border p-3 text-sm ${importe.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
          <div className="flex items-start gap-2">
            <span className="flex-1">{importe.texto}</span>
            <button onClick={() => setImporte(null)} className="text-xs text-sub hover:text-ink">Cerrar</button>
          </div>
          {!!importe.detalle?.length && (
            <details className="mt-1.5 text-xs text-sub">
              <summary className="cursor-pointer">Ver lo que no se pudo cruzar ({importe.detalle.length})</summary>
              <ul className="mt-1 max-h-48 overflow-y-auto">{importe.detalle.map((d) => <li key={d}>{d}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      {/* Modo: por pedido (proveedor → N°) o por artículo (todos sus pedidos, del más viejo al más nuevo) */}
      <div role="tablist" aria-label="Modo" className="mb-3 flex gap-1.5">
        {([['pedido', 'Por pedido', ClipboardList], ['articulo', 'Por artículo', Boxes]] as const).map(([m, label, Icono]) => (
          <button
            key={m}
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition ${
              modo === m ? 'border-amber-500/50 bg-amber-500/15 text-amber-500' : 'border-line text-sub hover:text-ink'
            }`}
          >
            <Icono size={15} aria-hidden /> {label}
          </button>
        ))}
      </div>

      {modo === 'articulo' && (
        <div className="space-y-3 pb-4">
          <form onSubmit={(e) => void buscarArticulo(e)} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
            <label className="block min-w-[220px] flex-1">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">Artículo</span>
              <div className="relative">
                <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                <input
                  value={codArt}
                  onChange={(e) => setCodArt(e.target.value)}
                  placeholder="Código (o el principio) o descripción, y Enter"
                  aria-label="Código o descripción del artículo"
                  className="h-11 w-full rounded-xl border border-amber-500/40 bg-surface2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:ring-2 focus-visible:ring-amber-500/40"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={cargandoArt}
              className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {cargandoArt ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />} Buscar
            </button>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-sm text-sub">
              <input type="checkbox" checked={verCompletosArt} onChange={(e) => setVerCompletosArt(e.target.checked)} className="h-4 w-4 accent-amber-500" />
              Ver también los pedidos ya recibidos
            </label>
          </form>

          {aviso && (
            <p role="status" className={`rounded-xl border p-2.5 text-sm ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}>
              {aviso.texto}
            </p>
          )}

          {!buscado && !cargandoArt ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <Boxes size={28} aria-hidden />
              Buscá un artículo: aparecen todos los pedidos que lo tienen, del más viejo al más nuevo.
            </div>
          ) : (
            grupos.map((g) => {
              const falta = Math.max(0, g.pedido - g.recibido)
              const filas = g.filas.filter((f) => verCompletosArt || f.recibido < f.cantidad)
              if (!filas.length && !verCompletosArt) return null
              return (
                <div key={g.clave} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {/* Cabecera del talle: total pendiente + "Llegaron" para repartir */}
                  <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {g.articulo} <span className="text-sub">· {g.color} · talle {g.talle || '—'}</span>
                      </p>
                      <p className="truncate text-xs text-sub">{descDe(g.articulo) || '—'}</p>
                    </div>
                    <p className="text-xs tabular-nums text-sub">
                      {g.filas.length} pedido{g.filas.length === 1 ? '' : 's'} · faltan <strong className={falta ? 'text-amber-500' : 'text-emerald-500'}>{n0.format(falta)}</strong> de {n0.format(g.pedido)}
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        repartir(g)
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={llegaron[g.clave] ?? ''}
                        onChange={(e) => setLlegaron((prev) => ({ ...prev, [g.clave]: e.target.value }))}
                        placeholder="Llegaron"
                        aria-label={`Unidades que llegaron de ${g.articulo} ${g.color} ${g.talle}`}
                        className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-center text-sm font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                      />
                      <button
                        type="submit"
                        disabled={!falta || registrando}
                        title="Registra un picking en cada pedido, completando primero el más viejo"
                        className="btn-press inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <CheckCheck size={14} aria-hidden /> Registrar
                      </button>
                    </form>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                          <th className="px-3 py-1.5">Pedido</th>
                          <th className="px-3 py-1.5">Fecha</th>
                          <th className="px-3 py-1.5">Proveedor</th>
                          <th className="px-3 py-1.5 text-right">Pedido</th>
                          <th className="px-3 py-1.5 text-right">Recibido</th>
                          <th className="px-3 py-1.5 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {filas.map((f) => {
                          const saldo = Math.max(0, f.cantidad - f.recibido)
                          return (
                            <tr
                              key={f.codigo}
                              className={colorFila(f.recibido, f.cantidad, f.cancelado)}
                              title={f.actualizado_at ? `Marcado por ${f.actualizado_por ?? '—'} el ${new Date(f.actualizado_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : undefined}
                            >
                              <td className="whitespace-nowrap px-3 py-1.5 font-display font-bold tabular-nums text-ink">N° {f.numero ?? '—'}</td>
                              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-sub">{fechaCorta(f.fecha)}</td>
                              <td className="max-w-[16rem] truncate px-3 py-1.5 text-ink/90" title={f.proveedor_nombre ?? ''}>
                                <span className="text-amber-500">{f.proveedor}</span> {f.proveedor_nombre}
                              </td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink"><CeldaPedido i={f} /></td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n0.format(f.recibido)}</td>
                              <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${saldo > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                {f.cantidad === 0 && (f.cancelado ?? 0) > 0 ? <span className="text-[10px] uppercase text-red-400">Cancelado</span> : n0.format(saldo)}
                              </td>
                            </tr>
                          )
                        })}
                        {!filas.length && (
                          <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-sub">Todo recibido.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })
          )}
          {buscado && !cargandoArt && filasArt.length > 0 && grupos.every((g) => g.filas.every((f) => f.recibido >= f.cantidad)) && !verCompletosArt && (
            <p className="rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-8 text-center text-sm text-sub">
              Todos los pedidos de {buscado} ya están recibidos.{' '}
              <button onClick={() => setVerCompletosArt(true)} className="text-amber-500 hover:underline">Verlos</button>
            </p>
          )}
        </div>
      )}

      {modo === 'pedido' && (<>
      {/* Proveedor */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-3">
        <label className="block min-w-[240px] flex-1">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">Proveedor</span>
          <select
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            disabled={cargando}
            className="h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <option value="">{cargando ? 'Cargando…' : 'Elegí un proveedor…'}</option>
            {proveedores.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre} ({p.codigo}) · {p.pendientes ? `${p.pendientes} pendiente${p.pendientes > 1 ? 's' : ''}` : 'todo recibido'}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-sm text-sub">
          <input type="checkbox" checked={verCompletos} onChange={(e) => setVerCompletos(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Ver también los ya recibidos
        </label>
      </div>

      {!proveedor ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
          <PackageCheck size={28} aria-hidden />
          Elegí el proveedor para ver sus pedidos.
        </div>
      ) : (
        <div className="grid gap-4 pb-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* ---------- Pedidos del proveedor ---------- */}
          <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
            <p className="mb-2 text-xs text-sub">
              {provActual?.nombre} · {pedidosProv.length} pedido{pedidosProv.length === 1 ? '' : 's'}
              {!verCompletos && ' con algo pendiente'}
            </p>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
              {pedidosProv.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-sub">
                  No hay pedidos pendientes.
                  {!verCompletos && (
                    <button onClick={() => setVerCompletos(true)} className="mt-2 block w-full text-amber-500 hover:underline">
                      Ver los ya recibidos
                    </button>
                  )}
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {pedidosProv.map((p) => {
                    const activo = p.codigo === sel
                    return (
                      <li key={p.codigo}>
                        <button
                          onClick={() => setSel(p.codigo)}
                          className={`w-full space-y-1.5 px-3 py-2.5 text-left transition ${activo ? 'bg-amber-500/15' : 'hover:bg-surface2'}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className={`font-display text-sm font-bold tabular-nums ${activo ? 'text-amber-500' : 'text-ink'}`}>
                              N° {p.numero ?? '—'}
                            </span>
                            <span className="text-[11px] text-sub">{fechaCorta(p.fecha)}</span>
                          </span>
                          <Barra valor={p.recibidas} total={p.unidades} />
                          <span className="block text-[11px] tabular-nums text-sub">
                            {n0.format(p.recibidas)} de {n0.format(p.unidades)} unidades
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* ---------- Artículos del pedido ---------- */}
          <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
            {!pedido ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
                <PackageCheck size={28} aria-hidden />
                Elegí un N° de pedido.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 lg:hidden">
                  <button onClick={() => setSel(null)} className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink">
                    <ArrowLeft size={16} aria-hidden /> Pedidos
                  </button>
                </div>

                {/* Cabecera + avance + historial de pickings */}
                <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Pedido de compra</p>
                      <p className="font-display text-xl font-bold text-ink">N° {pedido.numero} <span className="font-mono text-sm font-semibold text-sub">{numeroComprobante(pedido)}</span></p>
                      <p className="truncate text-sm text-sub">
                        <span className="text-amber-500">{pedido.proveedor}</span> {pedido.proveedor_nombre} · {fechaCorta(pedido.fecha)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-display text-3xl font-bold tabular-nums ${pct >= 100 ? 'text-emerald-500' : 'text-amber-500'}`}>{pct}%</p>
                      <p className="text-xs tabular-nums text-sub">
                        {n0.format(tot.recibidas)} de {n0.format(tot.pedidas)} unidades recibidas · saldo {n0.format(Math.max(0, tot.pedidas - tot.recibidas))}
                        {tot.demas > 0 && <span className="text-brand-400"> · {n0.format(tot.demas)} de más</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3"><Barra valor={tot.recibidas} total={tot.pedidas} /></div>

                  <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-sub">Pickings de esta OC</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {entregas.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setEntregaAbierta(entregaAbierta === e.id ? null : e.id)}
                        aria-expanded={entregaAbierta === e.id}
                        className={`rounded-xl border px-3 py-1.5 text-left text-xs transition ${
                          e.anulado ? 'border-line text-sub/60 line-through' : entregaAbierta === e.id ? 'border-amber-500/50 bg-amber-500/10 text-ink' : 'border-line bg-surface2 text-sub hover:text-ink'
                        }`}
                        title={e.origen === 'inicial' ? 'Lo que estaba marcado antes de registrar los pickings' : e.origen === 'excel' ? 'Cargado desde el Excel de ingresos' : undefined}
                      >
                        <strong className="text-ink">Picking #{e.nro}</strong> · {new Date(e.creado_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                        {e.creado_por ? ` · ${e.creado_por}` : ''} · <strong className="tabular-nums text-ink">{n0.format(e.unidades)} u.</strong>
                        {e.origen === 'excel' && ' · Excel'}
                        {e.origen === 'inicial' && ' · inicial'}
                        {e.anulado && ' · anulado'}
                      </button>
                    ))}
                    <span className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-500">
                      <strong>Picking #{nroSiguiente}</strong> · en curso · <strong className="tabular-nums">{n0.format(tot.este)} u.</strong>
                    </span>
                  </div>
                  {(() => {
                    const e = entregas.find((x) => x.id === entregaAbierta)
                    if (!e) return null
                    return (
                      <div className="mt-2 overflow-hidden rounded-xl border border-line">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface2 px-3 py-2 text-xs text-sub">
                          <span>
                            Picking #{e.nro} · {e.items.length} renglones · {n0.format(e.unidades)} unidades
                            {e.anulado && <strong className="text-brand-400"> · ANULADO</strong>}
                          </span>
                          {!e.anulado && (
                            <button
                              onClick={() => void anular(e)}
                              disabled={registrando}
                              className="btn-press inline-flex h-7 items-center gap-1 rounded-lg border border-brand-600/40 px-2 text-xs font-medium text-brand-400 hover:bg-brand-600/15 disabled:opacity-50"
                            >
                              <RotateCcw size={12} aria-hidden /> Anular este picking
                            </button>
                          )}
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-line/50">
                              {e.items.map((it) => (
                                <tr key={`${it.articulo}|${it.color}|${it.talle}`}>
                                  <td className="px-3 py-1 font-semibold text-ink">{it.articulo}</td>
                                  <td className="max-w-[16rem] truncate px-3 py-1 text-sub">{descDe(it.articulo) || '—'}</td>
                                  <td className="px-3 py-1 text-sub">{it.color}</td>
                                  <td className="px-3 py-1 text-sub">{it.talle}</td>
                                  <td className="px-3 py-1 text-right font-semibold tabular-nums text-ink">{n0.format(Number(it.cantidad))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Buscar · filtros · cargar todo el saldo / limpiar */}
                <div className="relative">
                  <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar artículo (código, descripción, color o talle)…"
                    aria-label="Buscar artículo"
                    className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['todos', 'pendientes', 'completos'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFiltro(f)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        filtro === f ? 'border-amber-500/50 bg-amber-500/15 text-amber-500' : 'border-line text-sub hover:text-ink'
                      }`}
                    >
                      {f === 'todos' ? 'Todos' : f === 'pendientes' ? 'Con saldo' : 'Completos'}
                    </button>
                  ))}
                  <span className="ml-auto flex gap-1.5">
                    <button
                      onClick={limpiarBorrador}
                      disabled={!hayBorrador}
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-sub transition hover:text-ink disabled:opacity-40"
                    >
                      <RotateCcw size={13} aria-hidden /> Limpiar picking
                    </button>
                    <button
                      onClick={cargarTodoElSaldo}
                      disabled={!items.some((i) => saldoDe(i) > 0)}
                      title="Carga en este picking todo lo que falta"
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-500 transition hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      <CheckCheck size={14} aria-hidden /> Llegó todo el saldo
                    </button>
                  </span>
                </div>

                {aviso && (
                  <p
                    role="status"
                    className={`rounded-xl border p-2.5 text-sm ${aviso.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'}`}
                  >
                    {aviso.texto}
                  </p>
                )}

                {/* Cancelaciones de la OC: lo cancelado no se ingresa; si entró igual, OC nueva */}
                {cancelPedido.unidades > 0 && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
                    <p>
                      <strong>Esta OC tiene {n0.format(cancelPedido.unidades)} unidades canceladas</strong> en {cancelPedido.articulos} artículo
                      {cancelPedido.articulos === 1 ? '' : 's'}: ya están descontadas del saldo (se ven en rojo en cada fila). No las cargues en el picking.
                    </p>
                    {cancelPedido.entraron.length > 0 && (
                      <div className="mt-2 rounded-lg border border-red-500/30 bg-surface/60 p-2.5 text-ink">
                        <p className="font-semibold text-red-400">Entró mercadería cancelada: hacé una orden de compra nueva por esto</p>
                        <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
                          {cancelPedido.entraron.map((e) => (
                            <li key={`${e.articulo}|${e.color}|${e.talle}`}>
                              <span className="font-semibold">{e.articulo}</span> {e.color} {e.talle}: {n0.format(e.unidades)} u.
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => {
                            const texto = cancelPedido.entraron.map((e) => [e.articulo, e.color, e.talle, e.unidades].join('\t')).join('\n')
                            void navigator.clipboard?.writeText(texto).then(
                              () => setAviso({ ok: true, texto: 'Lista para la OC nueva copiada (artículo, color, talle, unidades).' }),
                              () => setAviso({ ok: false, texto: 'No se pudo copiar la lista.' }),
                            )
                          }}
                          className="btn-press mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 text-xs font-medium text-red-400 hover:bg-red-500/15"
                        >
                          Copiar lista para la OC nueva
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Subtotal de lo filtrado */}
                {q && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                    <span className="font-medium text-amber-500">Filtrado «{busqueda.trim()}»</span>
                    <span className="text-sub">{subtotal.articulos} artículo{subtotal.articulos === 1 ? '' : 's'}</span>
                    <span className="text-sub">Pedido <strong className="tabular-nums text-ink">{n0.format(subtotal.pedidas)}</strong></span>
                    <span className="text-sub">Recibido <strong className="tabular-nums text-ink">{n0.format(subtotal.recibidas)}</strong></span>
                    <span className="text-sub">Saldo <strong className="tabular-nums text-amber-500">{n0.format(subtotal.saldo)}</strong></span>
                    {subtotal.este > 0 && <span className="text-sub">Picking #{nroSiguiente} <strong className="tabular-nums text-emerald-500">{n0.format(subtotal.este)}</strong></span>}
                  </div>
                )}

                {/* Tabla: una fila por artículo; el desplegable abre color y talle */}
                <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[54rem] text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                          <th className="px-3 py-2">Artículo</th>
                          <th className="px-3 py-2">Descripción</th>
                          <th className="px-3 py-2">Color</th>
                          <th className="px-3 py-2">Talle</th>
                          <th className="px-3 py-2 text-right">Pedido</th>
                          <th className="px-3 py-2 text-right" title="Suma de los pickings registrados">Recibido</th>
                          <th className="px-3 py-2 text-right">Saldo</th>
                          <th className="px-3 py-2 text-center">Picking (#{nroSiguiente})</th>
                          <th className="px-3 py-2 text-center">✓</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {cargandoItems ? (
                          <tr>
                            <td colSpan={9} className="px-3 py-8 text-center text-sub">
                              <Loader2 size={16} className="mr-1.5 inline animate-spin" aria-hidden /> Cargando artículos…
                            </td>
                          </tr>
                        ) : gruposPedido.length === 0 ? (
                          <tr><td colSpan={9} className="px-3 py-8 text-center text-sub">No hay artículos {filtro === 'pendientes' ? 'con saldo' : filtro === 'completos' ? 'completos' : ''}.</td></tr>
                        ) : (
                          gruposPedido.flatMap((g) => {
                            const varios = g.variantes.length > 1
                            const abierto = varios && abiertos.has(g.articulo)
                            const unaSola = g.variantes[0]
                            const filaArticulo = (
                              <tr key={g.articulo} className={`${colorFila(g.recibido + g.este, g.cantidad, g.cancelado)} ${varios ? 'font-medium' : ''}`}>
                                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">
                                  {varios ? (
                                    <button
                                      onClick={() => alternarAbierto(g.articulo)}
                                      aria-expanded={abierto}
                                      title={abierto ? 'Cerrar colores y talles' : 'Marcar por color y talle'}
                                      className="inline-flex items-center gap-1 rounded-md hover:text-amber-500"
                                    >
                                      <ChevronRight size={15} aria-hidden className={`transition-transform ${abierto ? 'rotate-90' : ''}`} />
                                      {g.articulo}
                                    </button>
                                  ) : (
                                    <span className="pl-5">{g.articulo}</span>
                                  )}
                                </td>
                                <td className="max-w-[18rem] truncate px-3 py-1.5 text-ink/90" title={descDe(g.articulo)}>{descDe(g.articulo) || '—'}</td>
                                <td className="px-3 py-1.5 tabular-nums text-sub">
                                  {varios ? resumenDe(g.variantes.map((v) => v.color), 'color', 'colores') : unaSola.color}
                                </td>
                                <td className="px-3 py-1.5 text-sub">
                                  {varios ? resumenDe(g.variantes.map((v) => v.talle), 'talle', 'talles') : unaSola.talle}
                                </td>
                                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink"><CeldaPedido i={g} /></td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n0.format(g.recibido)}</td>
                                <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${g.saldo - g.este > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                  {n0.format(Math.max(0, g.saldo - g.este))}
                                </td>
                                <td className="px-3 py-1">
                                  {g.saldo === 0 && g.este === 0 ? (
                                    <span className="mx-auto block w-fit rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">COMPLETO</span>
                                  ) : (
                                    <Cantidad
                                      valor={g.este}
                                      cantidad={g.saldo}
                                      etiqueta={`Picking de ${g.articulo} (total)`}
                                      onRestar={() => sumarEste(g.variantes, -1)}
                                      onSumar={() => sumarEste(g.variantes, 1)}
                                      onFijar={(n) => fijarEste(g.variantes, n)}
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-1 text-center">
                                  {g.cantidad === 0 && g.cancelado > 0 ? (
                                    <span className="text-[11px] font-bold uppercase text-red-400" title="Cancelado entero: no debería ingresar">Cancelado</span>
                                  ) : g.saldo > 0 ? (
                                    <Tilde completo={g.este >= g.saldo} etiqueta={g.articulo} onClick={() => tildarEste(g.variantes)} />
                                  ) : null}
                                </td>
                              </tr>
                            )
                            if (!abierto) return [filaArticulo]
                            return [
                              filaArticulo,
                              ...g.variantes.map((i) => {
                                const saldo = saldoDe(i)
                                const este = esteDe(i)
                                return (
                                  <tr
                                    key={claveItem(i)}
                                    className={`${colorFila(i.recibido + este, i.cantidad, i.cancelado)} bg-surface2/40 text-[13px]`}
                                  >
                                    <td className="px-3 py-1 pl-10 text-sub">↳</td>
                                    <td className="px-3 py-1 text-sub/70">—</td>
                                    <td className="px-3 py-1 tabular-nums text-ink">{i.color}</td>
                                    <td className="px-3 py-1 text-ink">{i.talle}</td>
                                    <td className="px-3 py-1 text-right tabular-nums text-ink"><CeldaPedido i={i} /></td>
                                    <td className="px-3 py-1 text-right tabular-nums text-ink">{n0.format(i.recibido)}</td>
                                    <td className={`px-3 py-1 text-right font-bold tabular-nums ${saldo - este > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                                      {n0.format(Math.max(0, saldo - este))}
                                    </td>
                                    <td className="px-3 py-1">
                                      {saldo === 0 && este === 0 ? (
                                        <span className="mx-auto block w-fit rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">COMPLETO</span>
                                      ) : (
                                        <Cantidad
                                          valor={este}
                                          cantidad={saldo}
                                          etiqueta={`Picking de ${i.articulo} ${i.color} ${i.talle}`}
                                          onRestar={() => fijarEste([i], este - 1)}
                                          onSumar={() => fijarEste([i], este + 1)}
                                          onFijar={(n) => fijarEste([i], n)}
                                        />
                                      )}
                                    </td>
                                    <td className="px-3 py-1 text-center">
                                      {i.cantidad === 0 && (i.cancelado ?? 0) > 0 ? (
                                        <span className="text-[10px] font-bold uppercase text-red-400" title="Cancelado: no debería ingresar">Cancelado</span>
                                      ) : saldo > 0 ? (
                                        <Tilde completo={este >= saldo} etiqueta={`${i.articulo} ${i.color} ${i.talle}`} onClick={() => tildarEste([i])} />
                                      ) : null}
                                    </td>
                                  </tr>
                                )
                              }),
                            ]
                          })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line bg-surface2 text-sm font-semibold">
                          <td colSpan={4} className="px-3 py-2 text-sub">Artículos: {new Set(items.map((i) => i.articulo)).size} · renglones: {items.length}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(tot.pedidas)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(tot.recibidas + tot.demas)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-500">{n0.format(Math.max(0, tot.pedidas - tot.recibidas - tot.este))}</td>
                          <td className="px-3 py-2 text-center tabular-nums text-emerald-500">{n0.format(tot.este)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line2 bg-surface2 px-3 py-2.5">
                    <span className="text-sm text-sub">
                      Picking #{nroSiguiente}:{' '}
                      <strong className="text-ink">{tot.este > 0 ? `${n0.format(tot.este)} unidades cargadas` : 'nada cargado todavía'}</strong>. Hasta que lo
                      registres no cambia lo recibido.
                    </span>
                    <button
                      onClick={() => void registrar()}
                      disabled={!hayBorrador || registrando}
                      className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {registrando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Registrar picking #{nroSiguiente}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      </>)}
    </Layout>
  )
}
