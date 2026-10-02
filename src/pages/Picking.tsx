import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Search, ScanLine, CheckCheck, Check, Minus, Plus, ArrowLeft, PackageCheck, RotateCcw, Boxes, ClipboardList, FileSpreadsheet,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { cruzar, leerIngresos, type RenglonPedido } from '@/lib/ingresosPicking'

/* ------------------------------------------------------------------ */
/*  Picking (Depósito): ingreso físico de los pedidos de compra.       */
/*  Se elige el proveedor, el N° de pedido y se marca lo que llegó     */
/*  (✓ completo o la cantidad). Se guarda solo en picking_compra       */
/*  (sql/picking_compra.sql); los pedidos son la copia de Dragonfish.  */
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
  articulo: string
  color: string
  talle: string
  cantidad: number
  recibido: number
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
  const [escaneo, setEscaneo] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  // Guardado: un temporizador por artículo (se guarda 0,6 s después del último cambio)
  const pendientes = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [guardando, setGuardando] = useState(0)
  const [ultimoGuardado, setUltimoGuardado] = useState<Date | null>(null)

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
      if (!window.confirm(`Se van a marcar ${n0.format(r.unidades)} unidades en ${r.marcas.length} renglones de ${r.pedidos} pedidos.${avisoNo ? `

${avisoNo}` : ''}

¿Seguimos?`)) return

      for (let k = 0; k < r.marcas.length; k += 500) {
        setImportando(`Marcando… ${n0.format(Math.min(k + 500, r.marcas.length))} de ${n0.format(r.marcas.length)}`)
        const { error: e } = await supabase.from('picking_compra').upsert(
          r.marcas.slice(k, k + 500).map(({ codigo, articulo, color, talle, recibido }) => ({ codigo, articulo, color, talle, recibido })),
          { onConflict: 'codigo,articulo,color,talle' },
        )
        if (e) throw new Error(`Se cortó en el renglón ${k + 1}: ${e.message}`)
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

  // Artículos del pedido elegido + descripción del maestro de artículos
  useEffect(() => {
    if (!sel || !supabase) {
      setItems([])
      return
    }
    let vivo = true
    setCargandoItems(true)
    setFiltro('todos')
    setBusqueda('')
    void supabase.rpc('picking_items', { p_codigo: sel }).then(async ({ data, error: e }) => {
      if (!vivo) return
      if (e) setError(e.message)
      const its = ((data as ItemPicking[] | null) ?? []).map((i) => ({ ...i, cantidad: Number(i.cantidad), recibido: Number(i.recibido) }))
      setItems(its)
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
  }, [sel])

  /** Cambia lo recibido de un artículo de un pedido (se ve al instante y se guarda en un rato). */
  function cambiar(codigo: string, item: ItemPicking, recibido: number) {
    if (!supabase) return
    const valor = Math.max(0, Math.round(recibido * 100) / 100)
    // Se actualiza en los dos modos (el mismo renglón puede estar en pantalla en uno y en otro)
    if (codigo === sel) setItems((prev) => prev.map((i) => (claveItem(i) === claveItem(item) ? { ...i, recibido: valor } : i)))
    setFilasArt((prev) => prev.map((f) => (f.codigo === codigo && claveItem(f) === claveItem(item) ? { ...f, recibido: valor } : f)))
    // Avance del pedido en la lista (lo recibido de más no suma)
    setPedidos((prev) =>
      prev.map((p) =>
        p.codigo === codigo
          ? { ...p, recibidas: p.recibidas - Math.min(item.recibido, item.cantidad) + Math.min(valor, item.cantidad) }
          : p,
      ),
    )
    const k = `${codigo}|${claveItem(item)}`
    const previo = pendientes.current.get(k)
    if (previo) clearTimeout(previo)
    else setGuardando((g) => g + 1)
    pendientes.current.set(
      k,
      setTimeout(() => {
        void supabase!
          .from('picking_compra')
          .upsert({ codigo, articulo: item.articulo, color: item.color, talle: item.talle, recibido: valor }, { onConflict: 'codigo,articulo,color,talle' })
          .then(({ error: e }) => {
            pendientes.current.delete(k)
            setGuardando((g) => g - 1)
            if (e) setAviso({ ok: false, texto: `No se pudo guardar ${item.articulo}: ${e.message}` })
            else setUltimoGuardado(new Date())
          })
      }, 600),
    )
  }

  // Antes de cerrar la pestaña con cambios sin guardar: avisar
  useEffect(() => {
    const alSalir = (e: BeforeUnloadEvent) => {
      if (pendientes.current.size) e.preventDefault()
    }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [])

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
        (a, i) => ({ pedidas: a.pedidas + i.cantidad, recibidas: a.recibidas + Math.min(i.recibido, i.cantidad), demas: a.demas + Math.max(0, i.recibido - i.cantidad) }),
        { pedidas: 0, recibidas: 0, demas: 0 },
      ),
    [items],
  )

  /** Lector de códigos: suma 1 al primer renglón de ese artículo que todavía falta (o al primero, si ya están todos). */
  function escanear(e: React.FormEvent) {
    e.preventDefault()
    const cod = escaneo.trim().toUpperCase().replace(/\s/g, '')
    setEscaneo('')
    if (!cod) return
    const delArticulo = items.filter((i) => i.articulo === cod)
    if (!delArticulo.length) {
      setAviso({ ok: false, texto: `${cod} no está en este pedido.` })
      return
    }
    const destino = delArticulo.find((i) => i.recibido < i.cantidad) ?? delArticulo[0]
    cambiar(sel!, destino, destino.recibido + 1)
    setAviso({
      ok: destino.recibido + 1 <= destino.cantidad,
      texto: `${cod} ${destino.color} ${destino.talle}: ${n0.format(destino.recibido + 1)} de ${n0.format(destino.cantidad)}${destino.recibido + 1 > destino.cantidad ? ' (llegó de más)' : ''}`,
    })
  }

  function marcarTodo(completo: boolean) {
    const texto = completo ? '¿Marcar todos los artículos de este pedido como recibidos completos?' : '¿Volver a cero lo recibido de este pedido?'
    if (!window.confirm(texto)) return
    for (const i of items) {
      const destino = completo ? Math.max(i.recibido, i.cantidad) : 0
      if (destino !== i.recibido) cambiar(sel!, i, destino)
    }
  }

  const pct = tot.pedidas > 0 ? Math.round((tot.recibidas / tot.pedidas) * 100) : 0

  /** Busca el artículo (código o principio del código) en todos los pedidos. */
  async function buscarArticulo(e?: React.FormEvent) {
    e?.preventDefault()
    const cod = codArt.trim().toUpperCase().replace(/\s/g, '')
    if (!supabase) return
    if (cod.length < 3) {
      setAviso({ ok: false, texto: 'Escribí al menos 3 caracteres del código.' })
      return
    }
    setCargandoArt(true)
    setAviso(null)
    setLlegaron({})
    const { data, error: er } = await supabase.rpc('picking_articulo', { p_articulo: cod })
    setCargandoArt(false)
    if (er) return setError(er.message)
    const filas = ((data as FilaArticulo[] | null) ?? []).map((f) => ({ ...f, cantidad: Number(f.cantidad), recibido: Number(f.recibido) }))
    setFilasArt(filas)
    setBuscado(cod)
    if (!filas.length) setAviso({ ok: false, texto: `${cod} no está en ningún pedido de compra.` })
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
      // Talles en orden natural (3, 4, … 10, 11; S, M, L quedan alfabéticos)
      .sort((a, b) => a.articulo.localeCompare(b.articulo) || a.color.localeCompare(b.color, 'es', { numeric: true }) || a.talle.localeCompare(b.talle, 'es', { numeric: true }))
  }, [filasArt])

  /** Reparte las unidades que llegaron: completa primero el pedido más viejo, después el siguiente… */
  function repartir(g: (typeof grupos)[number]) {
    let quedan = Number(String(llegaron[g.clave] ?? '').replace(',', '.'))
    if (!Number.isFinite(quedan) || quedan <= 0) {
      setAviso({ ok: false, texto: 'Poné cuántas unidades llegaron.' })
      return
    }
    const total = quedan
    const usados: string[] = []
    for (const f of g.filas) {
      if (quedan <= 0) break
      const falta = Math.max(0, f.cantidad - f.recibido)
      if (!falta) continue
      const suma = Math.min(falta, quedan)
      cambiar(f.codigo, f, f.recibido + suma)
      usados.push(`N° ${f.numero} (+${n0.format(suma)})`)
      quedan -= suma
    }
    setLlegaron((prev) => ({ ...prev, [g.clave]: '' }))
    const qué = `${g.articulo} ${g.color} ${g.talle}`.trim()
    if (!usados.length) setAviso({ ok: false, texto: `${qué}: no hay pedidos pendientes, no se asignó nada.` })
    else if (quedan > 0)
      setAviso({ ok: false, texto: `${qué}: ${n0.format(total - quedan)} asignadas a ${usados.join(', ')}. Sobran ${n0.format(quedan)}: no hay más pedidos pendientes de ese talle.` })
    else setAviso({ ok: true, texto: `${qué}: ${n0.format(total)} asignadas a ${usados.join(', ')}.` })
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
          {guardando > 0 ? (
            <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden /> Guardando…</span>
          ) : ultimoGuardado ? (
            `Guardado ${ultimoGuardado.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
          ) : null}
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
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">Código del artículo</span>
              <div className="relative">
                <ScanLine size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                <input
                  value={codArt}
                  onChange={(e) => setCodArt(e.target.value)}
                  placeholder="Escaneá o escribí el código (o el principio) y Enter"
                  aria-label="Código del artículo"
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
                        disabled={!falta}
                        title="Completa primero el pedido más viejo"
                        className="btn-press inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <CheckCheck size={14} aria-hidden /> Repartir
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
                          <th className="px-3 py-1.5 text-center">Recibido</th>
                          <th className="px-3 py-1.5 text-center">✓</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {filas.map((f) => {
                          const completo = f.recibido >= f.cantidad
                          const demas = f.recibido > f.cantidad
                          return (
                            <tr
                              key={f.codigo}
                              className={demas ? 'bg-brand-600/10' : completo ? 'bg-emerald-500/10' : f.recibido > 0 ? 'bg-amber-500/10' : ''}
                              title={f.actualizado_at ? `Marcado por ${f.actualizado_por ?? '—'} el ${new Date(f.actualizado_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : undefined}
                            >
                              <td className="whitespace-nowrap px-3 py-1.5 font-display font-bold tabular-nums text-ink">N° {f.numero ?? '—'}</td>
                              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-sub">{fechaCorta(f.fecha)}</td>
                              <td className="max-w-[16rem] truncate px-3 py-1.5 text-ink/90" title={f.proveedor_nombre ?? ''}>
                                <span className="text-amber-500">{f.proveedor}</span> {f.proveedor_nombre}
                              </td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{n0.format(f.cantidad)}</td>
                              <td className="px-3 py-1">
                                <div className="mx-auto flex w-fit items-center gap-1">
                                  <button
                                    onClick={() => cambiar(f.codigo, f, f.recibido - 1)}
                                    disabled={f.recibido <= 0}
                                    aria-label={`Restar 1 al pedido ${f.numero}`}
                                    className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-30"
                                  >
                                    <Minus size={14} aria-hidden />
                                  </button>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    value={f.recibido}
                                    onChange={(e) => cambiar(f.codigo, f, Number(e.target.value) || 0)}
                                    onFocus={(e) => e.target.select()}
                                    aria-label={`Recibido del pedido ${f.numero}`}
                                    className={`h-8 w-16 rounded-lg border bg-surface2 px-1 text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${
                                      demas ? 'border-brand-500 text-brand-400' : completo ? 'border-emerald-500/60 text-emerald-500' : 'border-line text-ink'
                                    }`}
                                  />
                                  <button
                                    onClick={() => cambiar(f.codigo, f, f.recibido + 1)}
                                    aria-label={`Sumar 1 al pedido ${f.numero}`}
                                    className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2"
                                  >
                                    <Plus size={14} aria-hidden />
                                  </button>
                                </div>
                              </td>
                              <td className="px-3 py-1 text-center">
                                <button
                                  onClick={() => cambiar(f.codigo, f, completo ? 0 : f.cantidad)}
                                  aria-pressed={completo}
                                  aria-label={completo ? `Desmarcar el pedido ${f.numero}` : `Marcar el pedido ${f.numero} como recibido completo`}
                                  className={`btn-press mx-auto flex h-8 w-8 items-center justify-center rounded-lg border-2 transition ${
                                    completo ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-emerald-500/60 hover:text-emerald-500/60'
                                  }`}
                                >
                                  <Check size={16} strokeWidth={3} aria-hidden />
                                </button>
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

                {/* Cabecera + avance */}
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
                        {n0.format(tot.recibidas)} de {n0.format(tot.pedidas)} unidades
                        {tot.demas > 0 && <span className="text-brand-400"> · {n0.format(tot.demas)} de más</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3"><Barra valor={tot.recibidas} total={tot.pedidas} /></div>
                </div>

                {/* Escanear · buscar · filtros · marcar todo */}
                <div className="flex flex-wrap items-center gap-2">
                  <form onSubmit={escanear} className="relative min-w-[200px] flex-1">
                    <ScanLine size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                    <input
                      value={escaneo}
                      onChange={(e) => setEscaneo(e.target.value)}
                      placeholder="Escaneá o escribí el código y Enter (+1)"
                      aria-label="Escanear código"
                      className="h-11 w-full rounded-xl border border-amber-500/40 bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:ring-2 focus-visible:ring-amber-500/40"
                    />
                  </form>
                  <div className="relative min-w-[160px] flex-1">
                    <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
                    <input
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      placeholder="Buscar artículo…"
                      aria-label="Buscar artículo"
                      className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    />
                  </div>
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
                      {f === 'todos' ? 'Todos' : f === 'pendientes' ? 'Pendientes' : 'Completos'}
                    </button>
                  ))}
                  <span className="ml-auto flex gap-1.5">
                    <button
                      onClick={() => marcarTodo(false)}
                      disabled={!items.some((i) => i.recibido > 0)}
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-sub transition hover:text-ink disabled:opacity-40"
                    >
                      <RotateCcw size={13} aria-hidden /> Volver a cero
                    </button>
                    <button
                      onClick={() => marcarTodo(true)}
                      disabled={!items.length || tot.recibidas >= tot.pedidas}
                      className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <CheckCheck size={14} aria-hidden /> Todo recibido
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

                {/* Tabla */}
                <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[46rem] text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                          <th className="px-3 py-2">Artículo</th>
                          <th className="px-3 py-2">Descripción</th>
                          <th className="px-3 py-2">Color</th>
                          <th className="px-3 py-2">Talle</th>
                          <th className="px-3 py-2 text-right">Pedido</th>
                          <th className="px-3 py-2 text-center">Recibido</th>
                          <th className="px-3 py-2 text-center">✓</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {cargandoItems ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-sub">
                              <Loader2 size={16} className="mr-1.5 inline animate-spin" aria-hidden /> Cargando artículos…
                            </td>
                          </tr>
                        ) : visibles.length === 0 ? (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-sub">No hay artículos {filtro === 'pendientes' ? 'pendientes' : filtro === 'completos' ? 'completos' : ''}.</td></tr>
                        ) : (
                          visibles.map((i) => {
                            const completo = i.recibido >= i.cantidad
                            const demas = i.recibido > i.cantidad
                            return (
                              <tr
                                key={claveItem(i)}
                                className={demas ? 'bg-brand-600/10' : completo ? 'bg-emerald-500/10' : i.recibido > 0 ? 'bg-amber-500/10' : 'hover:bg-surface2/60'}
                                title={i.actualizado_at ? `Marcado por ${i.actualizado_por ?? '—'} el ${new Date(i.actualizado_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : undefined}
                              >
                                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{i.articulo}</td>
                                <td className="max-w-[18rem] truncate px-3 py-1.5 text-ink/90" title={descDe(i.articulo)}>{descDe(i.articulo) || '—'}</td>
                                <td className="px-3 py-1.5 tabular-nums text-sub">{i.color}</td>
                                <td className="px-3 py-1.5 text-sub">{i.talle}</td>
                                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{n0.format(i.cantidad)}</td>
                                <td className="px-3 py-1">
                                  <div className="mx-auto flex w-fit items-center gap-1">
                                    <button
                                      onClick={() => cambiar(sel!, i, i.recibido - 1)}
                                      disabled={i.recibido <= 0}
                                      aria-label={`Restar 1 a ${i.articulo}`}
                                      className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2 disabled:opacity-30"
                                    >
                                      <Minus size={14} aria-hidden />
                                    </button>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      min={0}
                                      value={i.recibido}
                                      onChange={(e) => cambiar(sel!, i, Number(e.target.value) || 0)}
                                      onFocus={(e) => e.target.select()}
                                      aria-label={`Recibido de ${i.articulo} ${i.color} ${i.talle}`}
                                      className={`h-8 w-16 rounded-lg border bg-surface2 px-1 text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${
                                        demas ? 'border-brand-500 text-brand-400' : completo ? 'border-emerald-500/60 text-emerald-500' : 'border-line text-ink'
                                      }`}
                                    />
                                    <button
                                      onClick={() => cambiar(sel!, i, i.recibido + 1)}
                                      aria-label={`Sumar 1 a ${i.articulo}`}
                                      className="btn-press flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-surface2"
                                    >
                                      <Plus size={14} aria-hidden />
                                    </button>
                                  </div>
                                </td>
                                <td className="px-3 py-1 text-center">
                                  <button
                                    onClick={() => cambiar(sel!, i, completo ? 0 : i.cantidad)}
                                    aria-pressed={completo}
                                    aria-label={completo ? `Desmarcar ${i.articulo}` : `Marcar ${i.articulo} como recibido completo`}
                                    title={completo ? 'Desmarcar (vuelve a 0)' : 'Llegó completo'}
                                    className={`btn-press mx-auto flex h-8 w-8 items-center justify-center rounded-lg border-2 transition ${
                                      completo ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line text-transparent hover:border-emerald-500/60 hover:text-emerald-500/60'
                                    }`}
                                  >
                                    <Check size={16} strokeWidth={3} aria-hidden />
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line bg-surface2 text-sm font-semibold">
                          <td colSpan={4} className="px-3 py-2 text-sub">Artículos: {items.length}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(tot.pedidas)}</td>
                          <td className="px-3 py-2 text-center tabular-nums text-ink">{n0.format(tot.recibidas + tot.demas)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
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
