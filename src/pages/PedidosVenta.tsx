import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Search, ChevronLeft, ChevronRight, RefreshCw, Download, ClipboardList, Ban, ArrowLeft, Printer,
  PackageCheck, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { descripcionesMaestro } from '@/lib/descripcionArticulos'
import { imprimirPedido } from '@/lib/imprimirPedido'
import { cargarStockSku, stockSkuDe, stockArticuloDe, type StockSku } from '@/lib/stockSku'
import { avisarArmados } from '@/lib/push'
import {
  COLUMNAS_ARMADO, PRIORIDADES, avanceDeArmados,
  type Armado, type AvanceArmado, type PrioridadArmado,
} from '@/lib/armados'

/* ------------------------------------------------------------------ */
/*  Pedidos de venta (Mayorista)                                       */
/*  Copia de los comprobantes PEDIDO de Dragonfish MITO                */
/*  (sql/pedidos_venta.sql), actualizada cada 15 minutos por          */
/*  puente-sql/scripts/sync-pedidos-venta.js. Mismo diseño que         */
/*  Pedidos de compra.                                                 */
/* ------------------------------------------------------------------ */

interface Pedido {
  codigo: string
  /** código de motivo de Dragonfish (REP, VTD, D…) y su nombre; null = sin motivo */
  motivo: string | null
  motivo_nombre: string | null
  numero: number | null
  descripcion: string | null
  fecha: string | null
  fecha_alta: string | null
  cliente: string | null
  cliente_nombre: string | null
  vendedor: string | null
  observacion: string | null
  total: number | null
  anulado: boolean
  usuario: string | null
}

/** Filtro "sin motivo" (los demás usan el código de Dragonfish) */
const SIN_MOTIVO = '__sin'

/** "REPOSICION LOCALES" -> "Reposición locales" */
function nombreMotivo(p: Pick<Pedido, 'motivo' | 'motivo_nombre'>): string {
  if (!p.motivo) return 'Sin motivo'
  const n = (p.motivo_nombre || p.motivo).trim().toLowerCase().replace('reposicion', 'reposición')
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/** Un color distinto por motivo (los conocidos fijos, el resto de una paleta) */
const COLOR_MOTIVO: Record<string, string> = { REP: '#38bdf8', VTD: '#22c55e', D: '#a78bfa', [SIN_MOTIVO]: '#94a3b8' }
const PALETA_MOTIVO = ['#f472b6', '#f59e0b', '#2dd4bf', '#f87171']
function colorMotivo(clave: string, orden: number): string {
  return COLOR_MOTIVO[clave] ?? PALETA_MOTIVO[orden % PALETA_MOTIVO.length]
}

interface ItemPedido {
  linea: number
  articulo: string | null
  descripcion: string | null
  color: string | null
  color_nombre: string | null
  talle: string | null
  cantidad: number | null
  precio: number | null
  neto: number | null
  iva: number | null
  bruto: number | null
}

const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
const PAGINA = 1000 // filas por pedido a Supabase (su tope por consulta)
const MAX_PEDIDOS = 20000

/** Qué pedidos se listan (como los repos de Mayorista). Por defecto la semana vigente, lunes a domingo. */
type Periodo = 'semana' | 'anterior' | 'cuatro' | 'todas'
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'anterior', label: 'Semana pasada' },
  { id: 'cuatro', label: 'Últimas 4 semanas' },
  { id: 'todas', label: 'Todas' },
]

/** Lunes (AAAA-MM-DD, hora Argentina) de la semana actual menos `semanasAtras`. */
function lunesAR(semanasAtras = 0): string {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - semanasAtras * 7)
  return d.toISOString().slice(0, 10)
}

/** Hoy (AAAA-MM-DD, hora Argentina) — el filtro "Hoy" de al lado del período. */
function hoyAR(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function rangoDe(p: Periodo): { desde: string | null; hasta: string | null } {
  if (p === 'semana') return { desde: lunesAR(0), hasta: null }
  if (p === 'anterior') return { desde: lunesAR(1), hasta: lunesAR(0) }
  if (p === 'cuatro') return { desde: lunesAR(3), hasta: null }
  return { desde: null, hasta: null }
}

/** "PEDIDO X 0001-00009878" -> "X 0001-00009878" */
function numeroComprobante(p: Pedido): string {
  const m = /([A-Z]\s+\d{4,5}-\d{8})\s*$/.exec(p.descripcion ?? '')
  return m ? m[1] : p.numero != null ? String(p.numero) : p.codigo
}

const colorDe = (i: ItemPedido) => [i.color, i.color_nombre].filter(Boolean).join(' ')

export default function PedidosVenta() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  // Motivo elegido ('' = todos); queda guardado en este navegador
  const [fMotivo, setFMotivoState] = useState<string>(() => {
    try { return localStorage.getItem('pedidosVenta.motivo') ?? '' } catch { return '' }
  })
  function setFMotivo(m: string) {
    setFMotivoState(m)
    try { localStorage.setItem('pedidosVenta.motivo', m) } catch { /* sin almacenamiento */ }
  }
  const [sel, setSel] = useState<string | null>(null)
  const [periodo, setPeriodoState] = useState<Periodo>(() => {
    try {
      const g = localStorage.getItem('pedidosVenta.periodo') as Periodo | null
      return g && PERIODOS.some((x) => x.id === g) ? g : 'semana'
    } catch {
      return 'semana'
    }
  })
  function setPeriodo(p: Periodo) {
    setPeriodoState(p)
    setSel(null)
    try { localStorage.setItem('pedidosVenta.periodo', p) } catch { /* sin almacenamiento: no pasa nada */ }
  }

  // Botón "Actualizar datos": fuerza la copia desde el SQL (api/pedidos-venta-sync.ts)
  const [forzando, setForzando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ ok: boolean; texto: string } | null>(null)
  // Sube al actualizar: vuelve a traer los artículos del pedido abierto
  const [version, setVersion] = useState(0)

  const [items, setItems] = useState<ItemPedido[]>([])
  const [cargandoItems, setCargandoItems] = useState(false)

  const [stock, setStock] = useState<StockSku | null>(null)
  const [cargandoStock, setCargandoStock] = useState(true)
  const [stockNota, setStockNota] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    try {
      // Solo el período elegido; "Todas" son miles: se traen de a PAGINA (tope de Supabase por consulta)
      const { desde: fDesde, hasta: fHasta } = rangoDe(periodo)
      const lista: Pedido[] = []
      for (let desde = 0; desde < MAX_PEDIDOS; desde += PAGINA) {
        let consulta = supabase
          .from('pedidos_venta')
          .select('codigo,motivo,motivo_nombre,numero,descripcion,fecha,fecha_alta,cliente,cliente_nombre,vendedor,observacion,total,anulado,usuario')
        if (fDesde) consulta = consulta.gte('fecha', fDesde)
        if (fHasta) consulta = consulta.lt('fecha', fHasta)
        const { data, error: e } = await consulta
          .order('fecha', { ascending: false })
          .order('numero', { ascending: false })
          .order('codigo', { ascending: true })
          .range(desde, desde + PAGINA - 1)
        if (e) throw new Error(e.message)
        const pagina = (data as Pedido[] | null) ?? []
        lista.push(...pagina)
        if (pagina.length < PAGINA) break
      }
      const { data: sync } = await supabase.from('pedidos_venta_sync').select('ultima_at').maybeSingle()
      setPedidos(lista)
      setActualizado((sync as { ultima_at: string | null } | null)?.ultima_at ?? null)
      setSel((prev) => prev ?? (window.matchMedia('(min-width: 1024px)').matches ? lista[0]?.codigo ?? null : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos.')
    } finally {
      setCargando(false)
    }
  }, [periodo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* ------------------------------------------------------------------ */
  /*  Pedir armado (sql/mayorista_armados.sql)                           */
  /*  Se pide desde el pedido abierto o en bloque con la selección.      */
  /*  Se refresca cada 12 s: así el pedido se pone en verde en vivo      */
  /*  a medida que el legajo escanea.                                    */
  /* ------------------------------------------------------------------ */
  const [armados, setArmados] = useState<Record<string, Armado>>({}) // por código de pedido
  const [avanceArmados, setAvanceArmados] = useState<Record<string, AvanceArmado>>({})
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [soloHoy, setSoloHoy] = useState(false)
  const [pedirA, setPedirA] = useState<string[] | null>(null)
  const [prioridadElegida, setPrioridadElegida] = useState<PrioridadArmado>('normal')
  const [obsArmado, setObsArmado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [avisoArmado, setAvisoArmado] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargarArmados = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('mayorista_armados')
      .select(COLUMNAS_ARMADO)
      .order('creado_at', { ascending: false })
      .limit(500)
    if (error || !data) return
    const lista = data as unknown as Armado[]
    const porCodigo: Record<string, Armado> = {}
    for (const a of lista) {
      // Con dos del mismo pedido (uno cerrado y otro nuevo) manda el más nuevo
      if (!porCodigo[a.pedido_codigo]) porCodigo[a.pedido_codigo] = a
    }
    const avances = await avanceDeArmados(lista.filter((a) => a.estado !== 'hecho').map((a) => a.id))

    // Pedidos VTD = repo diaria: su avance sale de la repo de ese día y local
    // (sql/repos_de_pedidos_vtd.sql) y se muestra igual que un armado.
    const desde = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const { data: reposVtd } = await supabase.rpc('repos_de_pedidos_vtd', { p_desde: desde })
    type RepoVtd = {
      codigo: string; lote_id: string; local: string; lineas: number; lineas_ok: number; unidades: number
      unidades_ok: number; faltantes: number; pendientes: number; responsable: string | null; legajo: string | null; ultimo_at: string | null
    }
    for (const r of (reposVtd as RepoVtd[] | null) ?? []) {
      if (porCodigo[r.codigo]) continue // si además le pidieron un armado, manda el armado
      const id = `repo:${r.lote_id}:${r.local}`
      const estado = r.pendientes === 0 ? 'hecho' : r.lineas_ok > 0 ? 'aceptado' : 'pendiente'
      porCodigo[r.codigo] = {
        id, pedido_codigo: r.codigo, pedido_numero: null, cliente: r.local, cliente_nombre: null, prioridad: 'normal',
        estado, obs: null, creado_at: r.ultimo_at ?? '', creado_por: null, aceptado_at: null, aceptado_por: null,
        aceptado_legajo: r.legajo, aceptado_nombre: r.responsable, hecho_at: estado === 'hecho' ? r.ultimo_at : null,
        faltantes: r.faltantes, asignado_legajo: r.legajo, asignado_nombre: r.responsable, asignado_local: r.local, repo: true,
      }
      avances[id] = { lineas: r.lineas, lineasOk: r.lineas_ok, unidades: r.unidades, unidadesOk: r.unidades_ok }
    }
    setArmados(porCodigo)
    setAvanceArmados(avances)
  }, [])

  useEffect(() => {
    void cargarArmados()
    const id = window.setInterval(() => void cargarArmados(), 12000)
    return () => window.clearInterval(id)
  }, [cargarArmados])

  /** Abre el selector de prioridad para esos pedidos (sin los que ya están pedidos). */
  function pedirArmadoDe(codigos: string[]) {
    const nuevos = codigos.filter((c) => !armados[c] || armados[c].estado === 'hecho')
    if (nuevos.length === 0) {
      setAvisoArmado({ ok: false, texto: 'Esos pedidos ya tienen un armado activo.' })
      return
    }
    setAvisoArmado(null)
    setPrioridadElegida('normal')
    setObsArmado('')
    setPedirA(nuevos)
  }

  async function enviarArmado() {
    if (!supabase || !pedirA || enviando) return
    setEnviando(true)
    try {
      const { data, error } = await supabase.rpc('pedir_armado', {
        p_codigos: pedirA,
        p_prioridad: prioridadElegida,
        p_obs: obsArmado.trim() ? obsArmado.trim() : null,
      })
      if (error) throw new Error(error.message)
      const n = typeof data === 'number' ? data : 0
      // Aviso push a los celulares de los legajos (suena aunque estén bloqueados)
      if (n > 0) void avisarArmados()
      const descartados = pedirA.length - n
      setAvisoArmado(
        n > 0
          ? {
              ok: true,
              texto:
                `Se pidió el armado de ${n} pedido${n === 1 ? '' : 's'} · prioridad ${PRIORIDADES[prioridadElegida].label}. ` +
                'Le llega a todos los legajos con el celular sonando.' +
                (descartados ? ` ${descartados} no se pidieron (anulados o ya pedidos).` : ''),
            }
          : { ok: false, texto: 'Ningún pedido se pudo pedir: ya tienen un armado activo.' },
      )
      setSeleccion(new Set())
      setPedirA(null)
      await cargarArmados()
    } catch (e) {
      setAvisoArmado({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo pedir el armado.' })
    } finally {
      setEnviando(false)
    }
  }

  // Ítems del pedido elegido. La descripción es la ADICIONAL del maestro de artículos
  // (public.articulos, igual que en todo el hub); si no está, la del renglón de Dragonfish.
  useEffect(() => {
    if (!sel || !supabase) {
      setItems([])
      return
    }
    let vivo = true
    setCargandoItems(true)
    void supabase
      .from('pedidos_venta_items')
      .select('linea,articulo,descripcion,color,color_nombre,talle,cantidad,precio,neto,iva,bruto')
      .eq('codigo', sel)
      .order('linea', { ascending: true })
      .range(0, 4999)
      .then(async ({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(e.message)
        const its = (data as ItemPedido[] | null) ?? []
        setItems(its)
        setCargandoItems(false)
        const desc = await descripcionesMaestro(its.map((i) => i.articulo ?? '')).catch(() => new Map<string, string>())
        if (vivo && desc.size) {
          setItems(its.map((i) => ({ ...i, descripcion: desc.get(String(i.articulo ?? '').toUpperCase()) || i.descripcion })))
        }
      })
    return () => { vivo = false }
  }, [sel, version])

  // Stock por SKU (color y talle) de las líneas: la lib lo baja una vez por
  // sesión y lo guarda; mientras no llegue, la columna muestra "—".
  useEffect(() => {
    let vivo = true
    setCargandoStock(true)
    cargarStockSku()
      .then((st) => {
        if (vivo) {
          setStock(st)
          setStockNota(null)
        }
      })
      .catch((e) => {
        if (!vivo) return
        const m = e instanceof Error ? e.message : 'No se pudo cargar el stock.'
        setStockNota(
          /vista no habilitada/i.test(m)
            ? 'No se pudo cargar el stock: habilitá DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_MITO en Configuraciones > Conexión SQL.'
            : m,
        )
      })
      .finally(() => {
        if (vivo) setCargandoStock(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  async function actualizarDatos() {
    if (!supabase || forzando) return
    setForzando(true)
    setAvisoSync(null)
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch('/api/pedidos-venta-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !cuerpo?.ok) throw new Error(cuerpo?.error ?? `Error ${r.status}`)
      await cargar()
      setAvisoSync({ ok: true, texto: 'Datos actualizados desde el SQL.' })
      setVersion((v) => v + 1)
    } catch (e) {
      setAvisoSync({ ok: false, texto: e instanceof Error ? e.message : 'No se pudieron actualizar los datos.' })
    } finally {
      setForzando(false)
    }
  }

  // Motivos del período con su cantidad (para los chips): los conocidos primero
  const motivos = useMemo(() => {
    const m = new Map<string, { clave: string; nombre: string; n: number }>()
    for (const p of pedidos) {
      const clave = p.motivo || SIN_MOTIVO
      const actual = m.get(clave) ?? { clave, nombre: nombreMotivo(p), n: 0 }
      actual.n++
      m.set(clave, actual)
    }
    const orden = ['REP', 'VTD', 'D']
    return [...m.values()].sort((a, b) => {
      const ia = a.clave === SIN_MOTIVO ? 99 : orden.indexOf(a.clave) === -1 ? 50 : orden.indexOf(a.clave)
      const ib = b.clave === SIN_MOTIVO ? 99 : orden.indexOf(b.clave) === -1 ? 50 : orden.indexOf(b.clave)
      return ia - ib || a.nombre.localeCompare(b.nombre, 'es')
    })
  }, [pedidos])
  const colorDeMotivo = (clave: string) => colorMotivo(clave, Math.max(0, motivos.findIndex((m) => m.clave === clave)))

  const q = busqueda.trim().toUpperCase()

  // Búsqueda por artículo (código o descripción): la hace la base sobre los
  // renglones de todos los pedidos; desde 3 letras y después de una pausa
  const [porArticulo, setPorArticulo] = useState<Set<string> | null>(null)
  const [buscandoArticulo, setBuscandoArticulo] = useState(false)
  useEffect(() => {
    setPorArticulo(null)
    if (!supabase || q.length < 3) {
      setBuscandoArticulo(false)
      return
    }
    let activo = true
    setBuscandoArticulo(true)
    const t = setTimeout(() => {
      void supabase!.rpc('pedidos_venta_por_articulo', { q }).then(({ data, error }) => {
        if (!activo) return
        setBuscandoArticulo(false)
        if (!error && Array.isArray(data)) setPorArticulo(new Set(data as string[]))
      })
    }, 400)
    return () => {
      activo = false
      clearTimeout(t)
    }
  }, [q])

  const visibles = useMemo(() => {
    const porFecha = soloHoy ? pedidos.filter((p) => p.fecha === hoyAR()) : pedidos
    const porMotivo = fMotivo ? porFecha.filter((p) => (p.motivo || SIN_MOTIVO) === fMotivo) : porFecha
    if (!q) return porMotivo
    return porMotivo.filter(
      (p) =>
        [String(p.numero ?? ''), p.descripcion, p.cliente, p.cliente_nombre, p.observacion, fechaCorta(p.fecha)]
          .some((v) => String(v ?? '').toUpperCase().includes(q)) || !!porArticulo?.has(p.codigo),
    )
  }, [pedidos, q, fMotivo, porArticulo, soloHoy])

  // Selección múltiple para pedir el armado de varios pedidos de una
  const alternarSeleccion = (codigo: string) =>
    setSeleccion((prev) => {
      const s = new Set(prev)
      if (s.has(codigo)) s.delete(codigo)
      else s.add(codigo)
      return s
    })
  const tildarTodo = () => setSeleccion(new Set(visibles.map((p) => p.codigo)))
  const limpiarSeleccion = () => setSeleccion(new Set())

  const idx = visibles.findIndex((p) => p.codigo === sel)
  const pedido = pedidos.find((p) => p.codigo === sel) ?? null
  /** Estado del armado de este pedido (si está pedido a armar). */
  const armPedido = pedido ? (armados[pedido.codigo] ?? null) : null
  const avancePedido = armPedido ? avanceArmados[armPedido.id] : undefined
  const ir = (d: number) => {
    const p = visibles[idx + d]
    if (p) setSel(p.codigo)
  }

  const tot = useMemo(
    () =>
      items.reduce(
        (a, i) => ({
          cant: a.cant + (i.cantidad ?? 0),
          neto: a.neto + (i.neto ?? 0),
          iva: a.iva + (i.iva ?? 0),
          bruto: a.bruto + (i.bruto ?? 0),
        }),
        { cant: 0, neto: 0, iva: 0, bruto: 0 },
      ),
    [items],
  )

  async function exportar() {
    if (!pedido) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const filas = items.map((i) => ({
      Artículo: i.articulo ?? '',
      Descripción: i.descripcion ?? '',
      Color: colorDe(i),
      Talle: i.talle ?? '',
      Cantidad: i.cantidad ?? 0,
      Stock: stockSkuDe(stock, i.articulo, i.color, i.talle) ?? '',
      Precio: i.precio ?? 0,
      Neto: i.neto ?? 0,
      IVA: i.iva ?? 0,
      Total: i.bruto ?? 0,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Pedido')
    XLSX.writeFile(wb, `pedido_venta_${pedido.numero ?? pedido.codigo}.xlsx`)
  }

  function imprimir() {
    if (!pedido) return
    // Solo los artículos con stock de ese color y talle. Si de una línea no hay dato de stock
    // (la vista no cargó o vino cortada) se imprime igual: no se esconde lo que no se puede confirmar.
    const conStock = items.filter((i) => {
      const s = stockSkuDe(stock, i.articulo, i.color, i.talle)
      return s === null || s > 0
    })
    const omitidas = items.length - conStock.length
    const sinDato = conStock.filter((i) => stockSkuDe(stock, i.articulo, i.color, i.talle) === null).length
    if (!conStock.length) {
      window.alert('Ningún artículo de este pedido tiene stock: no hay nada para imprimir.')
      return
    }
    void imprimirPedido(
      {
        titulo: 'Pedido de venta',
        comprobante: numeroComprobante(pedido),
        fecha: pedido.fecha,
        persona: { etiqueta: 'Cliente', codigo: pedido.cliente, nombre: pedido.cliente_nombre },
        datos: [
          { etiqueta: 'Vendedor', valor: pedido.vendedor },
          { etiqueta: 'Usuario', valor: pedido.usuario },
          { etiqueta: 'Observación', valor: pedido.observacion },
        ],
        total: pedido.total,
        anulado: pedido.anulado,
        aviso: [
          omitidas ? `Solo con stock: se omitieron ${omitidas} sin stock` : '',
          sinDato ? `${sinDato} sin dato de stock` : '',
        ].filter(Boolean).join(' · ') || undefined,
      },
      conStock.map((i) => ({ ...i, color: colorDe(i) })),
    )
  }

  const campo = (etiqueta: string, valor: React.ReactNode, ancho = '') => (
    <div className={`min-w-0 ${ancho}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-sub">{etiqueta}</p>
      <p className="truncate text-sm font-semibold text-ink">{valor || '—'}</p>
    </div>
  )

  /**
   * Celda de Stock: el del color y talle EXACTOS de la línea, no el del
   * artículo entero. Rojo si está en 0, ámbar si no alcanza para la
   * cantidad pedida. El total del artículo va en el título.
   */
  const celdaStock = (i: ItemPedido) => {
    const s = stockSkuDe(stock, i.articulo, i.color, i.talle)
    if (s === null) {
      return (
        <span className="text-sub" title="Sin dato de ese color y talle: la vista no lo trae o no se pudo verificar">
          —
        </span>
      )
    }
    const falta = (i.cantidad ?? 0) - s
    const total = stockArticuloDe(stock, i.articulo)
    const detalle = [
      `Color y talle: ${n0.format(s)}`,
      total != null ? `Artículo completo: ${n0.format(total)}` : null,
      falta > 0 ? `Faltan ${n0.format(falta)} para la cantidad pedida` : 'Alcanza para la cantidad pedida',
    ]
      .filter(Boolean)
      .join(' · ')
    const clase =
      s === 0 ? 'font-semibold text-brand-400' : falta > 0 ? 'font-semibold text-amber-500' : 'text-emerald-500'
    return (
      <span className={clase} title={detalle}>
        {n0.format(s)}
      </span>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Pedidos de venta</h1>
          <p className="text-sm text-sub">
            {pedidos.length} pedidos
            {actualizado && ` · actualizado ${new Date(actualizado).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          onClick={() => void actualizarDatos()}
          disabled={forzando}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-60"
          title="Trae los pedidos de los últimos 7 días del SQL ahora (tarda unos segundos)"
        >
          <RefreshCw size={15} aria-hidden className={forzando ? 'animate-spin' : ''} />
          {forzando ? 'Actualizando…' : 'Actualizar datos'}
        </button>
      </header>

      {avisoSync && (
        <p
          role="status"
          className={`mb-3 rounded-xl border p-3 text-sm ${
            avisoSync.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-brand-600/30 bg-brand-600/10 text-brand-400'
          }`}
        >
          {avisoSync.texto}
        </p>
      )}

      {avisoArmado && (
        <p
          role="status"
          className={`mb-3 rounded-xl border p-3 text-sm ${
            avisoArmado.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-brand-600/30 bg-brand-600/10 text-brand-400'
          }`}
        >
          {avisoArmado.texto}
        </p>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
      )}

      {/* Si no se pudo cargar el stock, la columna queda en "—" y se avisa acá */}
      {stockNota && (
        <p role="status" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          {stockNota}
        </p>
      )}

      {/* Período: por defecto la semana vigente (la elección queda guardada en este navegador) */}
      <div role="tablist" aria-label="Período" className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={periodo === p.id}
            onClick={() => setPeriodo(p.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              periodo === p.id
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                : 'border-line text-sub hover:border-line2 hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
        {/* Al lado del período: sólo los pedidos de hoy (para mandarlos a armar de una) */}
        <span aria-hidden className="self-center px-0.5 text-sub">·</span>
        <button
          type="button"
          role="tab"
          aria-selected={soloHoy}
          onClick={() => setSoloHoy((v) => !v)}
          title="Ver sólo los pedidos de hoy"
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            soloHoy
              ? 'border-brand-500/50 bg-brand-500/15 text-brand-400'
              : 'border-line text-sub hover:border-line2 hover:text-ink'
          }`}
        >
          📅 Hoy
        </button>
      </div>

      {/* Motivo: separa los pedidos por el motivo de Dragonfish */}
      {motivos.length > 0 && (
        <div role="tablist" aria-label="Motivo" className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs font-medium text-sub">Motivo:</span>
          {[{ clave: '', nombre: 'Todos', n: pedidos.length }, ...motivos].map((m) => {
            const activo = fMotivo === m.clave
            const color = m.clave ? colorDeMotivo(m.clave) : '#f59e0b'
            return (
              <button
                key={m.clave || 'todos'}
                role="tab"
                aria-selected={activo}
                onClick={() => setFMotivo(m.clave)}
                className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={
                  activo
                    ? { borderColor: `${color}80`, backgroundColor: `${color}26`, color }
                    : undefined
                }
              >
                <span className={activo ? '' : 'text-sub'}>{m.nombre}</span>
                <span className="ml-1.5 tabular-nums opacity-70">{m.n.toLocaleString('es-AR')}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 pb-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        {/* ---------- Lista de pedidos ---------- */}
        <aside className={`${sel ? 'hidden lg:block' : ''} min-w-0`}>
          <div className="relative mb-2">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            {buscandoArticulo && (
              <Loader2 size={15} aria-label="Buscando en los artículos" className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-sub" />
            )}
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Número, cliente, fecha, artículo…"
              aria-label="Buscar pedido"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>

          {/* Selección múltiple: para pedir el armado de varios pedidos de una */}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={tildarTodo}
              disabled={visibles.length === 0}
              className="btn-press rounded-lg border border-line px-2.5 py-1.5 font-medium text-sub transition hover:border-line2 hover:text-ink disabled:opacity-40"
            >
              Tildar todo ({visibles.length.toLocaleString('es-AR')})
            </button>
            {seleccion.size > 0 && (
              <>
                <span className="font-semibold tabular-nums text-amber-500">
                  {seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={limpiarSeleccion}
                  className="rounded-lg px-1.5 py-1 font-medium text-sub transition hover:text-ink"
                >
                  Limpiar
                </button>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
            {cargando ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sub">
                <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…
              </div>
            ) : visibles.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-sub">
                {q ? 'No hay pedidos que coincidan.' : fMotivo ? 'No hay pedidos con ese motivo en este período.' : 'No hay pedidos en este período.'}
                {periodo !== 'todas' && (
                  <button onClick={() => setPeriodo('todas')} className="mt-2 block w-full text-amber-500 hover:underline">
                    Buscar en todos los pedidos
                  </button>
                )}
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {visibles.map((p) => {
                  const activo = p.codigo === sel
                  const arm = armados[p.codigo]
                  const av = arm ? avanceArmados[arm.id] : undefined
                  const enCurso = arm?.estado === 'aceptado'
                  const terminado = arm?.estado === 'hecho'
                  const estaSel = seleccion.has(p.codigo)
                  // El pedido se pone en verde a medida que el legajo lo va armando
                  const fondo = terminado
                    ? 'bg-emerald-500/20'
                    : enCurso
                      ? 'bg-emerald-500/10'
                      : activo
                        ? 'bg-amber-500/15'
                        : 'hover:bg-surface2'
                  return (
                    <li key={p.codigo} className="flex items-stretch">
                      <label
                        className="flex shrink-0 cursor-pointer items-center pl-3"
                        title="Seleccionar para pedir el armado"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={estaSel}
                          onChange={() => alternarSeleccion(p.codigo)}
                          aria-label={`Seleccionar pedido N° ${p.numero ?? p.codigo}`}
                          className="h-4 w-4 cursor-pointer accent-amber-500"
                        />
                      </label>
                      <button
                        onClick={() => setSel(p.codigo)}
                        className={`flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left transition ${fondo}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`font-display text-sm font-bold tabular-nums ${activo ? 'text-amber-500' : 'text-ink'}`}>
                              N° {p.numero ?? '—'}
                            </span>
                            {p.anulado && (
                              <span className="rounded-md bg-brand-600/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-400">ANULADO</span>
                            )}
                            {terminado && (
                              <span className="rounded-md bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                                {arm?.repo ? 'REPO ✓' : 'ARMADO 🏁'}{av ? ` ${arm?.repo ? `${av.unidadesOk}/${av.unidades}` : `${av.lineasOk}/${av.lineas}`}` : ''}
                              </span>
                            )}
                            {!terminado && enCurso && (
                              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                                {arm?.repo ? 'REPO EN CURSO' : 'EN CURSO ✓'}{av ? ` ${av.unidadesOk}/${av.unidades}` : ''}
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs font-medium text-ink/90">{p.cliente_nombre || p.cliente}</span>
                          <span className="flex items-center gap-1.5 text-[11px] text-sub">
                            {fechaCorta(p.fecha)}
                            <span
                              className="truncate rounded-md px-1.5 py-px text-[10px] font-semibold"
                              style={{ color: colorDeMotivo(p.motivo || SIN_MOTIVO), backgroundColor: `${colorDeMotivo(p.motivo || SIN_MOTIVO)}1f` }}
                            >
                              {nombreMotivo(p)}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-ink">$ {plata(p.total)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ---------- Pedido (formato remito) ---------- */}
        <section className={`${sel ? '' : 'hidden lg:block'} min-w-0`}>
          {!pedido ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-16 text-center text-sub">
              <ClipboardList size={28} aria-hidden />
              Elegí un pedido de la lista.
            </div>
          ) : (
            <div className="space-y-3">
              {/* Barra: volver (celular) · anterior/siguiente · Excel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSel(null)}
                  className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-sub hover:text-ink lg:hidden"
                >
                  <ArrowLeft size={16} aria-hidden /> Pedidos
                </button>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => ir(-1)}
                    disabled={idx <= 0}
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40"
                    title="Pedido anterior (más nuevo)"
                    aria-label="Pedido anterior"
                  >
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <button
                    onClick={() => ir(1)}
                    disabled={idx === -1 || idx >= visibles.length - 1}
                    className="btn-press flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition hover:bg-surface2 disabled:opacity-40"
                    title="Pedido siguiente (más viejo)"
                    aria-label="Pedido siguiente"
                  >
                    <ChevronRight size={18} aria-hidden />
                  </button>
                  <button
                    onClick={() => void exportar()}
                    disabled={items.length === 0}
                    className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
                  >
                    <Download size={15} aria-hidden /> Excel
                  </button>
                  <button
                    onClick={imprimir}
                    disabled={items.length === 0 || cargandoItems || cargandoStock}
                    className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
                  >
                    <Printer size={15} aria-hidden /> Imprimir
                  </button>
                  <button
                    onClick={() => pedirArmadoDe([pedido.codigo])}
                    disabled={!!armPedido && armPedido.estado !== 'hecho'}
                    className={`btn-press inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-50 ${
                      armPedido && armPedido.estado !== 'hecho'
                        ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                        : 'bg-brand-600 text-white shadow-soft hover:bg-brand-700'
                    }`}
                    title={
                      armPedido && armPedido.estado !== 'hecho'
                        ? 'Este pedido ya está pedido a armar'
                        : 'Pedir el armado de este pedido a los legajos'
                    }
                  >
                    <PackageCheck size={15} aria-hidden />
                    {armPedido && armPedido.estado === 'aceptado'
                      ? 'En curso ✓'
                      : armPedido && armPedido.estado === 'pendiente'
                        ? 'Pedido a armar'
                        : 'Pedir armado'}
                  </button>
                </div>
              </div>

              {/* Cabecera */}
              <div className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {campo(
                      'Cliente',
                      <>
                        <span className="text-amber-500">{pedido.cliente}</span>
                        {pedido.cliente_nombre && <span className="ml-1.5 font-medium">{pedido.cliente_nombre}</span>}
                      </>,
                      'col-span-2',
                    )}
                    {campo('Motivo', nombreMotivo(pedido))}
                    {campo('Vendedor', pedido.vendedor)}
                    {campo('Observación', pedido.observacion, 'col-span-2')}
                    {campo('Usuario', pedido.usuario)}
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-ink/80 font-display text-2xl font-bold text-ink">
                      {numeroComprobante(pedido).charAt(0)}
                    </div>
                    <div className="space-y-2 text-right">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Número</p>
                        <p className="font-mono text-sm font-semibold text-ink">{numeroComprobante(pedido)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-sub">Fecha</p>
                        <p className="text-sm font-semibold tabular-nums text-ink">{fechaCorta(pedido.fecha)}</p>
                      </div>
                    </div>
                  </div>
                </div>
                {pedido.anulado && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400">
                    <Ban size={13} aria-hidden /> Pedido anulado
                  </p>
                )}

                {/* Armado: lo pide el mayorista y lo va marcando el legajo */}
                {armPedido && (
                  <p
                    className={`mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      armPedido.estado === 'hecho'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : armPedido.estado === 'aceptado'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-500'
                    }`}
                  >
                    <PackageCheck size={13} aria-hidden />
                    {armPedido.estado === 'pendiente' && (
                      <>
                        {armPedido.repo ? 'Repo diaria ·' : <>{PRIORIDADES[armPedido.prioridad]?.icono} Armado {PRIORIDADES[armPedido.prioridad]?.label} ·</>}
                        {armPedido.asignado_legajo
                          ? `para ${armPedido.asignado_nombre ?? `#${armPedido.asignado_legajo}`} (responsable de ${armPedido.asignado_local})`
                          : 'esperando que alguien lo acepte'}
                      </>
                    )}
                    {armPedido.estado === 'aceptado' && (
                      <>
                        ✓ {armPedido.repo ? 'Repo en curso' : 'En curso'} con {armPedido.aceptado_nombre || 'un legajo'}
                        {armPedido.aceptado_legajo ? ` (#${armPedido.aceptado_legajo})` : ''}
                        {avancePedido ? ` · ${avancePedido.unidadesOk}/${avancePedido.unidades} unidades` : ''}
                      </>
                    )}
                    {armPedido.estado === 'hecho' && (
                      <>
                        {armPedido.repo
                          ? `🏁 Repo terminada por ${armPedido.aceptado_nombre || 'el responsable'}${armPedido.aceptado_legajo ? ` (#${armPedido.aceptado_legajo})` : ''}`
                          : '🏁 Armado terminado'}
                        {armPedido.faltantes > 0 ? ` con ${armPedido.faltantes} faltante${armPedido.faltantes === 1 ? '' : 's'}` : ''}
                        {avancePedido ? ` · ${avancePedido.unidadesOk}/${avancePedido.unidades} unidades` : ''}
                      </>
                    )}
                  </p>
                )}
              </div>

              {/* Artículos */}
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[54rem] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface2 text-left text-[11px] font-semibold uppercase tracking-wide text-sub">
                        <th className="px-3 py-2">Artículo</th>
                        <th className="px-3 py-2">Descripción</th>
                        <th className="px-3 py-2">Color</th>
                        <th className="px-3 py-2">Talle</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                        <th className="px-3 py-2 text-right">
                          Stock
                          {cargandoStock && <Loader2 size={12} className="ml-1 inline animate-spin" aria-hidden />}
                        </th>
                        <th className="px-3 py-2 text-right">Precio</th>
                        <th className="px-3 py-2 text-right">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {cargandoItems ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-sub">
                            <Loader2 size={16} className="mr-1.5 inline animate-spin" aria-hidden /> Cargando artículos…
                          </td>
                        </tr>
                      ) : (
                        items.map((i) => (
                          <tr key={i.linea} className="hover:bg-surface2/60">
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{i.articulo}</td>
                            <td className="max-w-[18rem] truncate px-3 py-1.5 text-ink/90" title={i.descripcion ?? ''}>{i.descripcion || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-sub">{colorDe(i)}</td>
                            <td className="px-3 py-1.5 text-sub">{i.talle}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{n0.format(i.cantidad ?? 0)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{celdaStock(i)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{plata(i.precio)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{plata(i.neto)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-surface2 text-sm font-semibold">
                        <td colSpan={4} className="px-3 py-2 text-sub">Items: {items.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{n0.format(tot.cant)}</td>
                        <td />
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{plata(tot.neto)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Totales */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm space-y-1.5 rounded-2xl border border-line bg-surface p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-sub">Subtotal neto</span>
                    <span className="font-semibold tabular-nums text-ink">$ {plata(tot.neto)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-sub">I.V.A.</span>
                    <span className="font-semibold tabular-nums text-ink">$ {plata(tot.iva)}</span>
                  </div>
                  {/* El total de Dragonfish ya trae el descuento del pedido: la diferencia se muestra aparte */}
                  {pedido.total != null && tot.neto + tot.iva - pedido.total > 1 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-sub">Descuento / ajustes</span>
                      <span className="font-semibold tabular-nums text-emerald-500">− $ {plata(tot.neto + tot.iva - pedido.total)}</span>
                    </div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                    <span className="font-display text-lg font-bold text-ink">Total</span>
                    <span className="font-display text-2xl font-bold tabular-nums text-amber-500">$ {plata(pedido.total ?? tot.bruto)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ---------- Barra de selección: pedir el armado de varios de una ---------- */}
      {seleccion.size > 0 && !pedirA && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">
              {seleccion.size} pedido{seleccion.size === 1 ? '' : 's'} seleccionado{seleccion.size === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => pedirArmadoDe([...seleccion])}
              className="btn-press ml-auto inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-700"
            >
              <PackageCheck size={16} aria-hidden /> Pedir armado
            </button>
            <button
              type="button"
              onClick={limpiarSeleccion}
              className="btn-press inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-sub transition hover:text-ink"
              aria-label="Quitar la selección"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {/* ---------- Elegir la prioridad del armado ---------- */}
      {pedirA && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Pedir armado"
        >
          <div className="w-full max-w-md animate-enter rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink">Pedir armado</h3>
                <p className="text-xs text-sub">
                  {pedirA.length} pedido{pedirA.length === 1 ? '' : 's'} · le llega a todos los legajos con el celular
                  sonando hasta que alguien lo acepte
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPedirA(null)}
                className="rounded-lg p-1 text-sub transition hover:bg-line hover:text-ink"
                aria-label="Cerrar"
              >
                <X size={16} aria-hidden />
              </button>
            </div>

            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-sub">Prioridad</p>
            <div className="grid gap-2">
              {(['urgente', 'normal', 'baja'] as PrioridadArmado[]).map((p) => {
                const P = PRIORIDADES[p]
                const on = prioridadElegida === p
                const detalle =
                  p === 'urgente'
                    ? 'Suena 3 veces y aparece arriba de todo'
                    : p === 'normal'
                      ? 'Suena 2 veces'
                      : 'Un pitido, después de las otras prioridades'
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrioridadElegida(p)}
                    aria-pressed={on}
                    className="flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition"
                    style={
                      on
                        ? { borderColor: `${P.color}99`, backgroundColor: `${P.color}1f` }
                        : { borderColor: 'var(--line)' }
                    }
                  >
                    <span className="text-xl" aria-hidden>
                      {P.icono}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink">{P.label}</span>
                      <span className="block text-xs text-sub">{detalle}</span>
                    </span>
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border-2"
                      style={on ? { borderColor: P.color, backgroundColor: P.color } : { borderColor: 'var(--line2)' }}
                      aria-hidden
                    />
                  </button>
                )
              })}
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
                Observación (opcional)
              </span>
              <textarea
                value={obsArmado}
                onChange={(e) => setObsArmado(e.target.value)}
                rows={2}
                placeholder="Ej: armar y dejar en puerta 1"
                className="w-full resize-none rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPedirA(null)}
                disabled={enviando}
                className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink transition hover:bg-line disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void enviarArmado()}
                disabled={enviando}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                <PackageCheck size={15} aria-hidden />
                {enviando ? 'Enviando…' : `Pedir armado (${pedirA.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
