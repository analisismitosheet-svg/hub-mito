import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Building2, Check, CheckCheck, ClipboardCheck, Clock, Download,
  Link2, Loader2, Package, Pencil, Plus, RotateCcw, Search, Upload, X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import NuevaRecepcionIndo from '@/components/NuevaRecepcionIndo'
import { SelectBuscar } from '@/components/MultiselectFiltro'
import { supabase } from '@/lib/supabase'
import { leerRecepcionIndo, normalizar } from '@/lib/recepcionIndo'
import { numerosPedidoCompra, ocsDeFila, pedidosCompraParaOc, unirOcs, type PedidoCompraOc } from '@/lib/ocPedidosCompra'
import {
  cargarProveedores, opcionesProveedor, refrescarDesdeSql, type Proveedor,
} from '@/lib/proveedoresIndo'

/* ------------------------------------------------------------------ */
/*  Recepción INDO (Depósito)                                           */
/*                                                                      */
/*  Se sube el Excel "Recepción de Mercadería" una vez y queda guardado   */
/*  acá; después el depósito va marcando qué ya controló, sin volver a   */
/*  tocar el Excel. El proveedor se elige de un desplegable con el        */
/*  catálogo de DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO.                  */
/*                                                                      */
/*  Todo lo guarda public.recepcion_indo (sql/recepcion_indo.sql). Los  */
/*  permisos los aplica la RLS: alcanza deposito.view para ver, importar   */
/*  y marcar.                                                           */
/* ------------------------------------------------------------------ */

interface Fila {
  total: number
  clave: string
  n_guia: string
  transporte: string
  bultos: number
  deposito: string
  proveedor: string
  proveedor_codigo: string | null
  n_remito: string
  fecha_remito: string | null
  mes: number | null
  n_oc: string
  oc_cargada_dragon: boolean
  n_factura: string
  fecha_factura: string | null
  factura_link: string | null
  fecha_ingreso: string | null
  fecha_controlada: string | null
  dias_atraso: number | null
  estado: string
  iva: number | null
  detalle: string | null
  controlado_at: string | null
  controlado_por: string | null
}

interface Resumen {
  filas: number
  bultos: number
  controladas: number
  bultos_controlados: number
  pendientes: number
  bultos_pendientes: number
  oc_distintas: number
  atraso_prom: number | null
  iva_pendiente: number | null
  mas_viejo_pendiente: string | null
  proveedores: number
  ultimo_import: string | null
}

type Opciones = { depositos: string[] | null; proveedores: string[] | null; transportes: string[] | null; estados: string[] | null }

const VACIO: Resumen = {
  filas: 0, bultos: 0, controladas: 0, bultos_controlados: 0, pendientes: 0, bultos_pendientes: 0,
  oc_distintas: 0, atraso_prom: null, iva_pendiente: null, mas_viejo_pendiente: null, proveedores: 0,
  ultimo_import: null,
}

const POR_PAGINA = 200
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

const hoy = () => new Date().toLocaleDateString('sv-SE') // "YYYY-MM-DD" en la zona del navegador

/**
 * PostgREST contesta "Could not find the function ... in the schema cache" tanto si la
 * función no existe como si la caché quedó vieja. Son dos arreglos distintos, así que el
 * mensaje dice las dos cosas en vez de dejar que el usuario adivine.
 */
function aclarar(mensaje: string, fn: string): string {
  if (/could not find the function|does not exist/i.test(mensaje)) {
    return (
      `Falta ${fn}() en Supabase. O no se corrió sql/recepcion_indo.sql (o falló a mitad de camino y se revirtió todo), ` +
      `o la caché de PostgREST está vieja: corré "NOTIFY pgrst, 'reload schema';" en el SQL Editor. Detalle: ${mensaje}`
    )
  }
  return mensaje
}

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso + 'T00:00:00'))
  } catch {
    return iso
  }
}

/** Link de la columna "Factura" del Excel: siempre es un Drive, lo muestra más legible. */
function LinkFactura({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-sky-400 hover:bg-sky-500/15"
    >
      <Link2 size={12} aria-hidden /> Drive
    </a>
  )
}

/**
 * Columna "N° OC": cada OC es un link al detalle del pedido de compra
 * (/compras/pedidos-compra?numero=...).
 *
 * Solo se linkea si el número existe en public.pedidos_compra: de las 480 OC distintas
 * del Excel, 234 matchean. Las otras no están en la copia sincronizada (la tabla tiene
 * 601 filas y arranca en 2025-01-13, mientras el Excel entra en 2024-08), así que
 * linkearlas dejaría botones que no llevan a ningún lado.
 *
 * Cuando `conocidos` viene vacío es porque la consulta falló, y lo más probable es que
 * falte el permiso 'pedidos_compra.view' — que es lo que exige la RLS de la tabla y la
 * ruta de destino. Ahí tampoco tiene sentido linkear.
 */
function CeldaOc({ valor, conocidos }: { valor: string; conocidos: Set<string> }) {
  const ocs = ocsDeFila(valor)
  if (ocs.length === 0) return <span className="text-ink">—</span>
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {ocs.map((oc) => {
        const n = oc.replace(/\s+/g, '')
        if (!/^\d+$/.test(n)) {
          // 8 de las 480 OC no son numéricas: se muestran tal cual, sin link.
          return (
            <span key={oc} className="text-ink" title="No es un número de pedido: se muestra tal cual">
              {oc}
            </span>
          )
        }
        const existe = conocidos.has(n)
        if (!existe) {
          return (
            <span key={oc} className="text-ink" title="No hay ningún pedido de compra con este número">
              {oc}
            </span>
          )
        }
        return (
          <Link
            key={oc}
            to={`/compras/pedidos-compra?numero=${encodeURIComponent(n)}`}
            title={`Abrir el pedido de compra N° ${n}`}
            className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-semibold tabular-nums text-amber-500 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            {n} <Link2 size={11} aria-hidden />
          </Link>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Celda N° OC editable: buscar y elegir una o varias órdenes de        */
/*  compra (pedidos de compra de Dragonfish), o escribir el N° a mano    */
/*  si no aparece. Se guarda como el Excel: "15183/15347".              */
/* ------------------------------------------------------------------ */
function CeldaOcEditable({
  valor, conocidos, pedidos, proveedorCodigo, proveedorNombre, saving, onChange,
}: {
  valor: string
  conocidos: Set<string>
  pedidos: PedidoCompraOc[]
  proveedorCodigo: string | null
  proveedorNombre: string
  saving: boolean
  onChange: (nOc: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [elegidas, setElegidas] = useState<string[]>([])
  const [soloProveedor, setSoloProveedor] = useState(true)
  const botonRef = useRef<HTMLButtonElement>(null)
  const [caja, setCaja] = useState<{ top: number; left: number; width: number; arriba: boolean } | null>(null)

  // Pedidos del proveedor de la fila: por código, o si no hay código, por nombre parecido
  const delProveedor = useMemo(() => {
    const cod = (proveedorCodigo ?? '').trim().toUpperCase()
    const nom = proveedorNombre.trim().toUpperCase()
    if (!cod && !nom) return []
    return pedidos.filter((p) =>
      cod ? (p.proveedor ?? '').trim().toUpperCase() === cod : nom.length >= 3 && (p.proveedor_nombre ?? '').toUpperCase().includes(nom),
    )
  }, [pedidos, proveedorCodigo, proveedorNombre])
  const hayDelProveedor = delProveedor.length > 0

  function abrir() {
    setElegidas(ocsDeFila(valor))
    setTexto('')
    setSoloProveedor(true)
    setAbierto(true)
  }

  useLayoutEffect(() => {
    if (!abierto) return
    const medir = () => {
      const r = botonRef.current?.getBoundingClientRect()
      if (!r) return
      const alto = 400
      const abajo = window.innerHeight - r.bottom
      const arriba = abajo < alto && r.top > abajo
      const ancho = Math.max(r.width, 340)
      setCaja({
        top: arriba ? Math.max(8, r.top - 8) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 12)),
        width: ancho,
        arriba,
      })
    }
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [abierto])

  const t = texto.trim().toUpperCase()
  const base = soloProveedor && hayDelProveedor && !t ? delProveedor : pedidos
  const filtradas = useMemo(
    () =>
      (t
        ? base.filter((p) =>
            [String(p.numero), p.proveedor ?? '', p.proveedor_nombre ?? ''].some((v) => v.toUpperCase().includes(t)),
          )
        : base
      ).slice(0, 60),
    [base, t],
  )
  const manual = texto.trim().replace(/\s+/g, '')
  const puedeManual = manual !== '' && !elegidas.includes(manual) && !pedidos.some((p) => String(p.numero) === manual)

  const alternar = (n: string) =>
    setElegidas((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]))
  const guardar = () => {
    const nuevo = unirOcs(elegidas)
    if (nuevo !== unirOcs(ocsDeFila(valor))) onChange(nuevo)
    setAbierto(false)
  }

  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <CeldaOc valor={valor} conocidos={conocidos} />
      </div>
      <button
        ref={botonRef}
        type="button"
        disabled={saving}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        title="Buscar y elegir las órdenes de compra"
        aria-label="Editar N° OC"
        className="shrink-0 rounded-md p-1 text-sub hover:bg-line/40 hover:text-ink disabled:opacity-50"
      >
        <Pencil size={11} aria-hidden />
      </button>
      {abierto && caja && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setAbierto(false)} />
          <div
            style={{
              position: 'fixed',
              top: caja.top,
              left: caja.left,
              width: caja.width,
              transform: caja.arriba ? 'translateY(-100%)' : undefined,
            }}
            className="fixed z-[91] max-w-[92vw] rounded-xl border border-line bg-surface p-2 shadow-2xl"
            role="dialog"
            aria-label="Órdenes de compra"
          >
            {/* Elegidas */}
            <div className="mb-2 flex min-h-[1.75rem] flex-wrap items-center gap-1">
              {elegidas.length === 0 ? (
                <span className="px-1 text-[11px] italic text-sub/70">Ninguna OC elegida</span>
              ) : (
                elegidas.map((n) => (
                  <span key={n} className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 py-0.5 pl-1.5 pr-0.5 text-xs font-semibold tabular-nums text-amber-500">
                    {n}
                    {!pedidos.some((p) => String(p.numero) === n) && <span className="text-[9px] font-normal text-sub">(manual)</span>}
                    <button onClick={() => alternar(n)} className="rounded p-0.5 hover:bg-amber-500/20" aria-label={`Quitar OC ${n}`}>
                      <X size={11} aria-hidden />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Buscar / escribir a mano */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                // Enter: si el texto es un N° de la lista o un N° a mano, lo agrega
                const exacta = pedidos.find((p) => String(p.numero) === manual)
                if (exacta || puedeManual) {
                  if (!elegidas.includes(manual)) setElegidas((prev) => [...prev, manual])
                  setTexto('')
                }
              }}
              className="flex items-center gap-1.5 border-b border-line pb-2"
            >
              <Search size={13} className="shrink-0 text-sub/70" aria-hidden />
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="N° de OC o proveedor… (Enter agrega)"
                className="w-full bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-sub/60"
              />
              {texto && (
                <button type="button" onClick={() => setTexto('')} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
                  <X size={12} aria-hidden />
                </button>
              )}
            </form>
            {hayDelProveedor && !t && (
              <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-sub">
                <input type="checkbox" checked={soloProveedor} onChange={(e) => setSoloProveedor(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
                Solo las de {proveedorNombre || 'este proveedor'} ({delProveedor.length})
              </label>
            )}

            <div className="mt-1.5 max-h-60 overflow-y-auto">
              {puedeManual && (
                <button
                  type="button"
                  onClick={() => { setElegidas((prev) => [...prev, manual]); setTexto('') }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-brand-400 hover:bg-line/40"
                >
                  + Agregar «{manual}» a mano (no está en los pedidos de compra)
                </button>
              )}
              {filtradas.map((p) => {
                const n = String(p.numero)
                const marcada = elegidas.includes(n)
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => alternar(n)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-line/40 ${marcada ? 'bg-amber-500/10' : ''}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcada ? 'border-amber-500 bg-amber-500 text-white' : 'border-line2'}`}>
                      {marcada && <Check size={11} strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">{n}</span>
                    <span className="min-w-0 flex-1 truncate text-sub">
                      {p.proveedor_nombre || p.proveedor}
                      {p.anulado && <span className="ml-1 text-brand-400">(anulado)</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-sub/70">{fmtFecha(p.fecha)}</span>
                  </button>
                )
              })}
              {filtradas.length === 0 && !puedeManual && (
                <p className="px-2 py-1.5 text-[11px] text-sub">
                  {pedidos.length === 0 ? 'No se pudieron leer los pedidos de compra (permiso de Pedidos de compra). Escribí el N° y agregalo a mano.' : 'No hay OC que coincidan.'}
                </p>
              )}
            </div>

            <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-line pt-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-2.5 py-1 text-xs text-sub hover:text-ink">
                Cancelar
              </button>
              <button type="button" onClick={guardar} className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700">
                Guardar {elegidas.length ? `(${elegidas.length})` : ''}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Celda editable: se toca, se escribe, Enter o salir guarda, Esc cancela */
/* ------------------------------------------------------------------ */
type TipoCelda = 'texto' | 'numero' | 'fecha' | 'plata'

function CeldaEditable({
  valor, tipo = 'texto', saving, onGuardar, mostrar, lista, placeholder, clase = '', titulo,
}: {
  valor: string
  tipo?: TipoCelda
  saving: boolean
  onGuardar: (nuevo: string) => void
  /** Cómo se ve sin editar (por defecto, el valor o "—") */
  mostrar?: React.ReactNode
  /** id de un <datalist> con sugerencias */
  lista?: string
  placeholder?: string
  clase?: string
  titulo?: string
}) {
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState('')
  const listo = useRef(false)

  const abrir = () => {
    if (saving) return
    listo.current = false
    setBorrador(valor)
    setEditando(true)
  }
  const terminar = (guardar: boolean) => {
    if (listo.current) return
    listo.current = true
    setEditando(false)
    if (guardar && borrador.trim() !== valor.trim()) onGuardar(borrador.trim())
  }

  if (editando) {
    return (
      <input
        autoFocus
        type={tipo === 'fecha' ? 'date' : tipo === 'numero' ? 'number' : 'text'}
        inputMode={tipo === 'plata' ? 'decimal' : undefined}
        value={borrador}
        list={lista}
        placeholder={placeholder}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={() => terminar(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); terminar(true) }
          if (e.key === 'Escape') { e.preventDefault(); terminar(false) }
        }}
        onFocus={(e) => { if (tipo !== 'fecha') e.target.select() }}
        className={`w-full min-w-[5.5rem] rounded-md border border-brand-500/60 bg-surface2 px-1.5 py-0.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${tipo === 'numero' || tipo === 'plata' ? 'text-right' : ''}`}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={abrir}
      disabled={saving}
      title={titulo ?? 'Tocá para editar'}
      className={`block w-full rounded-md px-1 py-0.5 text-left decoration-dotted underline-offset-2 hover:bg-line/40 hover:underline disabled:opacity-50 ${clase}`}
    >
      {mostrar ?? (valor || <span className="text-sub/50">—</span>)}
    </button>
  )
}

/** Opción especial del desplegable de estado: no es un estado, abre el alta de uno nuevo. */
const NUEVO_ESTADO = '__nuevo_estado__'

/** Estado: desplegable con los que existen y, al final, "+ Agregar estado…" para crear uno nuevo. */
function CeldaEstado({
  valor, opciones, saving, onGuardar, onNuevo,
}: {
  valor: string
  opciones: string[]
  saving: boolean
  onGuardar: (estado: string) => void
  onNuevo: (estado: string) => void
}) {
  const lista = opciones.includes(valor) || !valor ? opciones : [valor, ...opciones]
  return (
    <select
      value={valor}
      disabled={saving}
      onChange={(e) => {
        const elegido = e.target.value
        if (elegido === NUEVO_ESTADO) {
          // El select vuelve solo al valor actual (es controlado): solo se abre el alta
          const nuevo = window.prompt('Nombre del estado nuevo:')?.trim().toUpperCase()
          if (nuevo) onNuevo(nuevo)
          return
        }
        if (elegido !== valor) onGuardar(elegido)
      }}
      className={`max-w-[10rem] rounded-md border border-line px-1 py-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 ${
        valor.toUpperCase().includes('FLEXXUS') ? 'bg-sky-500/15 text-sky-400' : valor ? 'bg-emerald-500/15 text-emerald-400' : 'bg-surface2 text-sub'
      }`}
    >
      <option value="">—</option>
      {lista.map((e) => <option key={e} value={e}>{e}</option>)}
      <option value={NUEVO_ESTADO}>+ Agregar estado…</option>
    </select>
  )
}

function Kpi({
  icono, label, valor, pie, color,
}: { icono: React.ReactNode; label: string; valor: string; pie?: string; color: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-soft">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-sub/70">
        <span style={{ color }} aria-hidden>{icono}</span> {label}
      </div>
      <div className="font-display text-2xl font-bold tabular-nums text-ink" style={{ color }}>{valor}</div>
      {pie && <div className="mt-0.5 text-[11px] text-sub/70">{pie}</div>}
    </div>
  )
}

/**
 * Nombre de proveedor para comparar: sin acentos, puntos, comas, guiones ni espacios.
 * El Excel trae "TARCO S.A." y el catálogo "Tarco SA": los dos quedan "TARCOSA".
 */
const compacto = (v: string) => normalizar(v).replace(/[^A-Z0-9]/g, '')

/** ¿El nombre del catálogo coincide con lo buscado? Todo junto, o cada palabra por separado. */
function coincideProveedor(nombre: string, busca: string): boolean {
  const c = compacto(busca)
  if (!c) return true
  const n = compacto(nombre)
  if (n.includes(c)) return true
  const palabras = normalizar(busca).split(/[^A-Z0-9]+/).filter((w) => w.length > 1)
  return palabras.length > 0 && palabras.every((w) => n.includes(w))
}

/* ------------------------------------------------------------------ */
/*  Celda de proveedor: desplegable con el catálogo del depósito         */
/* ------------------------------------------------------------------ */
function CeldaProveedor({
  valor, opciones, saving, onChange,
}: {
  valor: string
  opciones: Proveedor[]
  saving: boolean
  onChange: (nombre: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const botonRef = useRef<HTMLButtonElement>(null)
  // El desplegable va con position:fixed porque la tabla vive dentro de un
  // overflow-x-auto y un dropdown absolute quedaría recortado.
  const [caja, setCaja] = useState<{ top: number; left: number; width: number; arriba: boolean } | null>(null)

  useLayoutEffect(() => {
    if (!abierto) return
    const medir = () => {
      const r = botonRef.current?.getBoundingClientRect()
      if (!r) return
      const alto = 320
      const abajo = window.innerHeight - r.bottom
      const arriba = abajo < alto && r.top > abajo
      setCaja({
        top: arriba ? Math.max(8, r.top - 8) : r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - r.width - 12),
        width: Math.max(r.width, 260),
        arriba,
      })
    }
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [abierto])

  const filtradas = useMemo(() => {
    const t = texto.trim()
    return (t ? opciones.filter((o) => coincideProveedor(o.nombre, t) || compacto(o.codigo) === compacto(t)) : opciones).slice(0, 40)
  }, [opciones, texto])

  return (
    <div className="relative">
      <button
        ref={botonRef}
        type="button"
        disabled={saving}
        onClick={() => {
          setAbierto((a) => !a)
          // Si el nombre de la fila no está tal cual en el catálogo (ej. "TARCO S.A." vs "Tarco SA"),
          // se arranca buscándolo: así aparece el del catálogo para elegirlo.
          const exacto = opciones.some((o) => o.codigo && compacto(o.nombre) === compacto(valor))
          setTexto(valor && !exacto ? valor : '')
        }}
        title={valor ? `Cambiar proveedor (${valor})` : 'Elegir proveedor'}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-left text-xs text-ink hover:bg-line/40 disabled:opacity-50"
      >
        <span className={`truncate ${valor ? '' : 'italic text-sub/60'}`}>{valor || 'Elegir…'}</span>
        <Pencil size={11} className="shrink-0 text-sub" aria-hidden />
      </button>
      {/* La lista va al <body>: dentro de la tabla las filas de abajo la tapaban */}
      {abierto && caja && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setAbierto(false)} />
          <div
            style={{
              position: 'fixed',
              top: caja.top,
              left: caja.left,
              width: caja.width,
              transform: caja.arriba ? 'translateY(-100%)' : undefined,
            }}
            className="fixed z-[91] max-w-[92vw] rounded-xl border border-line bg-surface p-2 shadow-2xl"
          >
            <div className="flex items-center gap-1.5 border-b border-line pb-2">
              <Search size={13} className="shrink-0 text-sub/70" aria-hidden />
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar proveedor..."
                className="w-full bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-sub/60"
              />
              <button onClick={() => setTexto('')} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
                <X size={12} aria-hidden />
              </button>
            </div>
            <div className="mt-1.5 max-h-60 overflow-y-auto">
              <button
                type="button"
                onClick={() => { onChange(texto.trim()); setAbierto(false) }}
                disabled={!texto.trim() || texto.trim().toUpperCase() === valor.trim().toUpperCase()}
                className="block w-full rounded-lg px-2 py-1 text-left text-xs text-brand-400 hover:bg-line/40 disabled:opacity-40"
              >
                Usar «{texto.trim() || '…'}» tal cual
              </button>
              {filtradas.map((o) => (
                <button
                  key={o.codigo || o.nombre}
                  type="button"
                  onClick={() => { onChange(o.nombre); setAbierto(false) }}
                  className={`block w-full rounded-lg px-2 py-1 text-left text-xs hover:bg-line/40 ${
                    compacto(o.nombre) === compacto(valor) ? 'bg-brand-600/10 text-brand-400' : 'text-ink'
                  }`}
                >
                  <span className="block truncate">{o.nombre}</span>
                  {o.codigo && <span className="text-[10px] text-sub/70">{o.codigo.trim()}</span>}
                </button>
              ))}
              {filtradas.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-sub">No está en el catálogo: usá «Usar tal cual».</p>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

export default function RecepcionIndo() {
  const [resumen, setResumen] = useState<Resumen>(VACIO)
  const [filas, setFilas] = useState<Fila[]>([])
  const [opciones, setOpciones] = useState<Opciones>({ depositos: [], proveedores: [], transportes: [], estados: [] })
  const [catalogo, setCatalogo] = useState<Proveedor[]>([])
  const [avisoCatalogo, setAvisoCatalogo] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(true)
  // Los errores se JUNTAN, no se pisan: cada consulta que falla pierde info de las otras
  // si cada una hace setError por su cuenta, y con 3 RPC a la vez no se sabe cuál falla.
  const [errores, setErrores] = useState<string[]>([])
  const agregarError = useCallback((mensaje: string) => {
    setErrores((prev) => (prev.includes(mensaje) ? prev : [...prev, mensaje]))
  }, [])
  const limpiarErrores = useCallback(() => setErrores([]), [])
  // Error del catálogo de opciones: va aparte porque NO se limpia en cada recarga (si no,
  // el primer cambio de filtro lo borra y el síntoma reaparece solo sin explicación).
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [salvandoClave, setSalvandoClave] = useState<string | null>(null)
  // Números de pedido de compra que existen, para saber qué OC se puede linkear.
  const [numerosPedido, setNumerosPedido] = useState<Set<string>>(new Set())

  // Filtros
  const [deposito, setDeposito] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [transporte, setTransporte] = useState('')
  const [estado, setEstado] = useState('')
  const [control, setControl] = useState('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const [busca, setBusca] = useState('') // con debounce

  const archivoRef = useRef<HTMLInputElement>(null)
  const [importando, setImportando] = useState<string | null>(null)
  const [confirma, setConfirma] = useState<null | { titulo: string; texto: string; accion: () => Promise<void> }>(null)
  const [creando, setCreando] = useState(false)
  const [estadosNuevos, setEstadosNuevos] = useState<string[]>([])

  useEffect(() => {
    const t = setTimeout(() => setBusca(busqueda.trim()), 400)
    return () => clearTimeout(t)
  }, [busqueda])

  /* ---- Carga: los dos RPC que dependen de los filtros ---- */
  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    limpiarErrores()
    const args = {
      p_deposito: deposito, p_proveedor: proveedor, p_transporte: transporte, p_estado: estado,
      p_control: control, p_busqueda: busca, p_desde: pagina * POR_PAGINA, p_limite: POR_PAGINA,
    }
    const [rFilas, rResumen] = await Promise.all([
      supabase.rpc('recepcion_indo_filas', args),
      supabase.rpc('recepcion_indo_resumen', { p_deposito: deposito }),
    ])
    if (rFilas.error) agregarError(aclarar(rFilas.error.message, 'recepcion_indo_filas'))
    else {
      const datos = (rFilas.data as Fila[] | null) ?? []
      setFilas(datos.map((f) => ({ ...f, bultos: Number(f.bultos) })))
      setTotal(Number(datos[0]?.total ?? 0))
    }
    if (rResumen.error) agregarError(aclarar(rResumen.error.message, 'recepcion_indo_resumen'))
    else setResumen((rResumen.data as Resumen[] | null)?.[0] ?? VACIO)
    setCargando(false)
  }, [deposito, proveedor, transporte, estado, control, busca, pagina, agregarError, limpiarErrores])

  // Opciones de los desplegables: no dependen de los filtros, así que se piden una sola
  // vez (son 106 proveedores) y no en cada cambio de filtro.
  const cargarOpciones = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.rpc('recepcion_indo_opciones')
    if (e) { setErrorOpciones(aclarar(e.message, 'recepcion_indo_opciones')); return }
    setErrorOpciones(null)
    const o = (data as Opciones[] | null)?.[0]
    // array_agg con FILTER devuelve NULL cuando no hay valores: sin este ?? [] el
    // primer render con la tabla vacía rompe en el .map() de los filtros.
    setOpciones({
      depositos: o?.depositos ?? [],
      proveedores: o?.proveedores ?? [],
      transportes: o?.transportes ?? [],
      estados: o?.estados ?? [],
    })
  }, [])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { void cargarOpciones() }, [cargarOpciones])

  // Números de pedido de compra, una sola vez por sesión (la función cachea la promesa).
  // No avisa si falla: casi siempre es que falta 'pedidos_compra.view', y en ese caso la
  // columna N° OC queda sin links, que es lo correcto y no necesita un cartel de error.
  useEffect(() => { void numerosPedidoCompra().then(setNumerosPedido) }, [])
  // Lista de pedidos de compra para el buscador de la columna N° OC (una vez por sesión)
  const [pedidosOc, setPedidosOc] = useState<PedidoCompraOc[]>([])
  useEffect(() => { void pedidosCompraParaOc().then(setPedidosOc) }, [])

  // Catálogo de proveedores: se carga una vez y queda cacheado en el navegador.
  useEffect(() => {
    let vivo = true
    void cargarProveedores().then((lista) => {
      if (!vivo) return
      setCatalogo(lista)
      setAvisoCatalogo(
        lista.length === 0
          ? 'No hay catálogo de proveedores: corré sql/recepcion_indo_proveedores.sql en Supabase. Mientras tanto se puede escribir el nombre a mano.'
          : null,
      )
    })
    return () => { vivo = false }
  }, [])

  // Al cambiar un filtro (menos la página) se vuelve a la primera.
  const cambiarFiltro = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(0) }

  /* ---- Editar una fila ---- */
  async function guardarFila(clave: string, cambios: Record<string, unknown>, aviso?: string) {
    if (!supabase) return
    setSalvandoClave(clave)
    setMsg(null)
    const { error: e } = await supabase.from('recepcion_indo').update(cambios).eq('clave', clave)
    setSalvandoClave(null)
    if (e) { setMsg({ ok: false, texto: e.message }); return }
    if (aviso) setMsg({ ok: true, texto: aviso })
    await cargar()
  }


  async function cambiarProveedor(f: Fila, nombre: string) {
    if (!nombre.trim() || nombre.trim() === f.proveedor.trim()) return
    const codigo = catalogo.find((p) => p.nombre.toUpperCase() === nombre.trim().toUpperCase())?.codigo ?? null
    await guardarFila(f.clave, { proveedor: nombre.trim(), proveedor_codigo: codigo })
  }

  /** Guarda una columna editada en la tabla (convierte números y fechas). */
  function editarCampo(f: Fila, campo: keyof Fila, crudo: string) {
    const v = crudo.trim()
    let cambios: Record<string, unknown>
    if (campo === 'bultos') {
      const n = Number(v.replace(/\D/g, ''))
      if (!Number.isFinite(n)) { setMsg({ ok: false, texto: 'Bultos tiene que ser un número.' }); return }
      cambios = { bultos: n }
    } else if (campo === 'iva') {
      const n = v === '' ? null : Number(v.replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.'))
      if (n !== null && !Number.isFinite(n)) { setMsg({ ok: false, texto: 'IVA tiene que ser un número (ej. 125000,50).' }); return }
      cambios = { iva: n }
    } else if (campo === 'fecha_remito') {
      cambios = { fecha_remito: v || null, mes: v ? Number(v.slice(5, 7)) : null }
    } else if (campo === 'fecha_ingreso' || campo === 'fecha_factura' || campo === 'fecha_controlada') {
      cambios = { [campo]: v || null }
    } else if (campo === 'transporte') {
      cambios = { transporte: v.toUpperCase().replace(/\s+/g, ' ') }
    } else if (campo === 'factura_link' || campo === 'detalle') {
      cambios = { [campo]: v || null }
    } else {
      cambios = { [campo]: v }
    }
    void guardarFila(f.clave, cambios)
  }

  /** N° OC elegidas en el buscador (o escritas a mano), como las guarda el Excel: "15183/15347". */
  const cambiarOc = (f: Fila, nOc: string) =>
    guardarFila(f.clave, { n_oc: nOc }, nOc ? `OC de ${f.n_guia || f.clave}: ${nOc.replace(/\//g, ', ')}.` : `Sin OC: ${f.n_guia || f.clave}.`)

  /* ---- Importar el Excel ---- */
  /** Lo que quedó del Excel ya leído, esperando que el usuario confirme el guardado. */
  interface Pendiente {
    filas: ReturnType<typeof leerRecepcionIndo>['filas']
    hoja: string
    archivo: string
    avisos: string
  }

  async function leerExcel(archivo: File) {
    if (!supabase) return
    setMsg(null)
    try {
      setImportando('Leyendo el Excel…')
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array', raw: true })
      const hoja = wb.SheetNames.find((n) => normalizar(n) !== 'SEGUIMIENTO') ?? wb.SheetNames[0]
      // raw:true -> las fechas llegan como número serial y el casteo es determinístico
      const crudo = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true, defval: null, blankrows: false })
      const lectura = leerRecepcionIndo(crudo)
      if (!lectura.filas.length) throw new Error('El Excel no tiene filas de recepción.')

      const avisos = [
        lectura.faltantes.length ? `No encontré estas columnas: ${lectura.faltantes.join(', ')}.` : '',
        lectura.descartadas ? `${n0.format(lectura.descartadas)} filas sin ningún dato (van con formato pero vacías).` : '',
        lectura.duplicadas ? `${n0.format(lectura.duplicadas)} filas repetidas (se tomó la primera).` : '',
        lectura.fechasCero ? `${n0.format(lectura.fechasCero)} celdas de fecha que no eran fecha (----, SIN REMITO o links de Drive).` : '',
      ].filter(Boolean).join(' ')

      setImportando(null)
      setConfirma({
        titulo: 'Importar recepciones',
        texto:
          `Se van a guardar ${n0.format(lectura.filas.length)} recepciones de la hoja "${hoja}" (${archivo.name}).\n\n` +
          'Las que ya estén actualizan su estado, pero el control que marcaste a mano no se pisa.' +
          (avisos ? `\n\n${avisos}` : ''),
        accion: () => guardarImport({ filas: lectura.filas, hoja, archivo: archivo.name, avisos }),
      })
    } catch (e) {
      setImportando(null)
      setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) })
    } finally {
      if (archivoRef.current) archivoRef.current.value = ''
    }
  }

  async function guardarImport({ filas, avisos }: Pendiente) {
    if (!supabase) return
    setMsg(null)
    try {
      let nuevasN = 0
      let actualizadasN = 0
      for (let k = 0; k < filas.length; k += 500) {
        setImportando(`Guardando… ${n0.format(Math.min(k + 500, filas.length))} de ${n0.format(filas.length)}`)
        const { data, error: e } = await supabase.rpc('recepcion_indo_importar', { p_filas: filas.slice(k, k + 500) })
        if (e) throw new Error(`Se cortó en la fila ${k + 1}: ${e.message}`)
        const r = (data as { nuevas: number; actualizadas: number }[] | null)?.[0]
        nuevasN += r?.nuevas ?? 0
        actualizadasN += r?.actualizadas ?? 0
      }
      setImportando(null)
      setMsg({
        ok: true,
        texto: `Listo: ${n0.format(nuevasN)} recepciones nuevas y ${n0.format(actualizadasN)} actualizadas.${avisos ? ` ${avisos}` : ''}`,
      })
      setControl('pendientes')
      setPagina(0)
      await cargar()
    } catch (e) {
      setImportando(null)
      setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) })
    }
  }

  async function actualizarCatalogo() {
    setMsg(null)
    setImportando('Actualizando el catálogo de proveedores…')
    const r = await refrescarDesdeSql()
    setImportando(null)
    if (r.error) { setMsg({ ok: false, texto: `No se pudo actualizar: ${r.error}` }); return }
    const total = r.total ?? 0
    const corta = total > r.cantidad
    setCatalogo(await cargarProveedores(true))
    setMsg({
      ok: true,
      texto: corta
        ? `Se guardaron ${n0.format(r.cantidad)} proveedores, pero la vista trae ${n0.format(total)}: subí el tope de filas a ${n0.format(total)} en Configuraciones > Conexión SQL para bajarlos todos.`
        : `${n0.format(r.cantidad)} proveedores actualizados desde el SQL Server.`,
    })
  }

  /* ---- Exportar ---- */
  async function exportar() {
    setMsg(null)
    const XLSX = await import('xlsx')
    const datos = filas.map((f) => ({
      'N de Guia': f.n_guia,
      'Fecha de ingreso': f.fecha_ingreso ?? '',
      'Fecha de controlada': f.fecha_controlada ?? '',
      'Días de atraso': f.dias_atraso ?? '',
      Bultos: f.bultos,
      Deposito: f.deposito,
      Proveedor: f.proveedor,
      Transporte: f.transporte,
      'N° Remito': f.n_remito,
      'Fecha del remito': f.fecha_remito ?? '',
      'N° OC': f.n_oc,
      'N° de factura': f.n_factura,
      'Fecha de factura': f.fecha_factura ?? '',
      Estado: f.estado,
      'IVA $': f.iva ?? '',
      Detalle: f.detalle ?? '',
      'Controlada por': f.controlado_por ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Recepción')
    XLSX.writeFile(wb, `recepcion_indo_${hoy()}.xlsx`)
  }

  /* ---- Derivados ---- */
  const opcionesProveedorCelda = useMemo(
    () => opcionesProveedor(catalogo, opciones.proveedores ?? [], ''),
    [catalogo, opciones.proveedores],
  )

  // Set de nombres del catálogo: enCatalogo() sobre 200 filas x 1.518 nombres en cada
  // render es mucha comparación de strings al pedo.
  const enCatalogoMemo = useMemo(
    () => new Set(catalogo.map((p) => compacto(p.nombre))),
    [catalogo],
  )
  const conocido = (nombre: string) => enCatalogoMemo.has(compacto(nombre))

  // Estados: los que ya existen + los creados con "+" en esta sesión
  const estadosLista = useMemo(
    () => [...new Set([...(opciones.estados ?? []), ...estadosNuevos].map((e) => e.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [opciones.estados, estadosNuevos],
  )

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desde = total === 0 ? 0 : pagina * POR_PAGINA + 1
  const hasta = Math.min(total, (pagina + 1) * POR_PAGINA)
  const pctControl = resumen.filas ? Math.round((resumen.controladas / resumen.filas) * 100) : 0

  const hayFiltros = deposito || proveedor || transporte || estado || control || busca

  return (
    <Layout>
      <BackButton />

      <header className="mb-4 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Package size={22} className="text-orange-500" aria-hidden /> Recepción INDO
          </h1>
          <p className="mt-0.5 text-xs text-sub/70">
            Recepción de mercadería del depósito. Subí el Excel y después marcá lo que ya controlaste.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={archivoRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerExcel(f) }}
          />
          <button
            onClick={() => setCreando(true)}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus size={15} aria-hidden /> Nuevo registro
          </button>
          <button
            onClick={() => archivoRef.current?.click()}
            disabled={!!importando}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
            {importando ?? 'Subir Excel'}
          </button>
          <button
            onClick={exportar}
            disabled={!filas.length}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line/40 disabled:opacity-50"
          >
            <Download size={15} aria-hidden /> Exportar
          </button>
          <button
            onClick={actualizarCatalogo}
            disabled={!!importando}
            title="Relee DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO y guarda el catálogo"
            className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-line/40 disabled:opacity-50"
          >
            <RotateCcw size={15} aria-hidden /> Catalogo
          </button>
        </div>
      </header>

      {(errores.length > 0 || errorOpciones) && (
        <div role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {errores.map((e) => (
            <p key={e} className="mb-1 last:mb-0">{e}</p>
          ))}
          {errorOpciones && <p className={errores.length ? 'mb-1' : ''}>{errorOpciones}</p>}
        </div>
      )}
      {msg && (
        <p
          role="status"
          className={`mb-3 rounded-xl border p-3 text-sm ${
            msg.ok ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-400' : 'border-red-600/30 bg-red-600/10 text-red-400'
          }`}
        >
          {msg.texto}
        </p>
      )}
      {avisoCatalogo && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {avisoCatalogo}
        </p>
      )}

      {/* KPIs: los mismos tres de la hoja "Seguimiento" del Excel, más lo que importa operar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icono={<Package size={15} />} color="#ea580c"
          label="Bultos sin controlar" valor={n0.format(resumen.bultos_pendientes)}
          pie={`${n0.format(resumen.pendientes)} recepciones · ${n0.format(resumen.oc_distintas)} OC`}
        />
        <Kpi
          icono={<Clock size={15} />} color="#f59e0b"
          label="Días de atraso prom." valor={resumen.atraso_prom != null ? n2.format(Number(resumen.atraso_prom)) : '—'}
          pie="de las ya controladas"
        />
        <Kpi
          icono={<CheckCheck size={15} />} color="#16a34a"
          label="Controladas" valor={`${n0.format(resumen.controladas)} / ${n0.format(resumen.filas)}`}
          pie={`${pctControl}% de las recepciones`}
        />
        <Kpi
          icono={<Building2 size={15} />} color="#0d9488"
          label="IVA pendiente" valor={pesos.format(Number(resumen.iva_pendiente ?? 0))}
          pie={resumen.mas_viejo_pendiente ? `la más vieja del ${fmtFecha(resumen.mas_viejo_pendiente)}` : undefined}
        />
      </div>

      {resumen.filas > 0 && (
        <div className="mt-3 rounded-2xl border border-line bg-surface p-3 shadow-soft">
          <div className="flex items-center justify-between text-xs text-sub">
            <span>
              {n0.format(resumen.bultos_controlados)} de {n0.format(resumen.bultos)} bultos con ingreso controlado
            </span>
            <span>
              {n0.format(resumen.proveedores)} proveedores
              {resumen.ultimo_import ? ` · importado ${new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(resumen.ultimo_import))}` : ''}
            </span>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface2">
            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pctControl}%` }} />
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="relative min-w-52 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-sub/70" aria-hidden />
          <input
            value={busqueda}
            onChange={(e) => cambiarFiltro(setBusqueda)(e.target.value)}
            placeholder="Guía, remito, factura, OC, proveedor o detalle…"
            className="w-full rounded-lg border border-line bg-surface2 py-1.5 pl-8 pr-7 text-xs text-ink outline-none placeholder:text-sub/60 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
          {busqueda && (
            <button onClick={() => cambiarFiltro(setBusqueda)('')} className="absolute right-2 top-2 rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
              <X size={12} aria-hidden />
            </button>
          )}
        </label>
        <SelectBuscar label="Depósito" className="w-36" valor={deposito} onChange={cambiarFiltro(setDeposito)}
          opciones={(opciones.depositos ?? []).map((d) => ({ id: d, label: d }))} />
        <SelectBuscar label="Proveedor" className="w-44" valor={proveedor} onChange={cambiarFiltro(setProveedor)}
          opciones={(opciones.proveedores ?? []).map((p) => ({ id: p, label: p }))} />
        <SelectBuscar label="Transporte" className="w-36" valor={transporte} onChange={cambiarFiltro(setTransporte)}
          opciones={(opciones.transportes ?? []).map((t) => ({ id: t, label: t }))} />
        <SelectBuscar label="Estado" className="w-40" valor={estado} onChange={cambiarFiltro(setEstado)}
          opciones={(opciones.estados ?? []).map((e) => ({ id: e, label: e }))} />
        <SelectBuscar label="Control" className="w-40" valor={control} onChange={cambiarFiltro(setControl)}
          opciones={[
            { id: 'pendientes', label: 'Sin controlar' },
            { id: 'controladas', label: 'Controladas' },
            { id: '', label: 'Todas' },
          ]} />
        {hayFiltros && (
          <button
            onClick={() => {
              setDeposito(''); setProveedor(''); setTransporte(''); setEstado(''); setControl(''); setBusqueda(''); setPagina(0)
            }}
            className="btn-press rounded-lg border border-line px-2 py-1.5 text-xs text-sub hover:text-ink"
          >
            <X size={13} aria-hidden />
          </button>
        )}
      </div>

      {control === 'pendientes' && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
          <ClipboardCheck size={15} className="shrink-0 text-amber-500" aria-hidden />
          <p className="flex-1 text-xs text-sub">
            {n0.format(total)} recepciones sin controlar con estos filtros
            {resumen.mas_viejo_pendiente ? ` · la más vieja ingresó el ${fmtFecha(resumen.mas_viejo_pendiente)}` : ''}.
          </p>
        </div>
      )}

      {/* Sugerencias para editar transporte y depósito en la tabla */}
      <datalist id="ri-transportes">{(opciones.transportes ?? []).map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="ri-depositos">{(opciones.depositos ?? []).map((v) => <option key={v} value={v} />)}</datalist>

      {/* Tabla */}
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface shadow-soft">
        <table className="w-full min-w-[1000px] text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-sub/70">
              <th className="px-2.5 py-2 font-semibold">Guía</th>
              <th className="px-2.5 py-2 font-semibold">Ingreso</th>
              <th className="px-2.5 py-2 text-right font-semibold">Bultos</th>
              <th className="px-2.5 py-2 font-semibold" title="Tocá el proveedor para elegirlo del catálogo del depósito">
                Proveedor
              </th>
              <th className="px-2.5 py-2 font-semibold">Remito</th>
              <th className="px-2.5 py-2 font-semibold" title="Tocá un N° para abrir el pedido de compra">
                N° OC
              </th>
              <th className="px-2.5 py-2 font-semibold">Factura</th>
              <th className="px-2.5 py-2 font-semibold">Estado</th>
              <th className="px-2.5 py-2 text-right font-semibold">IVA</th>
              <th className="px-2.5 py-2 font-semibold">Detalle</th>
              <th className="px-2.5 py-2 font-semibold">Control</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const saving = salvandoClave === f.clave
              const controlada = !!f.fecha_controlada
              const fueraDeCatalogo = f.proveedor !== '' && !conocido(f.proveedor)
              return (
                <tr key={f.clave} className={`border-b border-line/60 align-top ${controlada ? 'bg-emerald-500/5' : ''}`}>
                  <td className="px-2.5 py-2">
                    <CeldaEditable valor={f.n_guia} saving={saving} onGuardar={(v) => editarCampo(f, 'n_guia', v)} clase="font-medium text-ink" titulo="N° de guía" />
                    <div className="mt-0.5 flex gap-1 text-[10px] text-sub/70">
                      <CeldaEditable valor={f.transporte} saving={saving} lista="ri-transportes" placeholder="Transporte" onGuardar={(v) => editarCampo(f, 'transporte', v)} titulo="Transporte" />
                      <CeldaEditable valor={f.deposito} saving={saving} lista="ri-depositos" placeholder="Depósito" onGuardar={(v) => editarCampo(f, 'deposito', v)} titulo="Depósito" />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-ink">
                    <CeldaEditable valor={f.fecha_ingreso ?? ''} tipo="fecha" saving={saving} mostrar={fmtFecha(f.fecha_ingreso)} onGuardar={(v) => editarCampo(f, 'fecha_ingreso', v)} titulo="Fecha de ingreso" />
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink">
                    <CeldaEditable valor={String(f.bultos ?? '')} tipo="numero" saving={saving} mostrar={n0.format(f.bultos)} clase="text-right" onGuardar={(v) => editarCampo(f, 'bultos', v)} titulo="Bultos" />
                  </td>
                  <td className="px-2.5 py-2">
                    <CeldaProveedor
                      valor={f.proveedor}
                      opciones={opcionesProveedorCelda}
                      saving={saving}
                      onChange={(v) => void cambiarProveedor(f, v)}
                    />
                    {fueraDeCatalogo && catalogo.length > 0 && (
                      <div className="mt-0.5 text-[10px] text-amber-500/90" title="No está en el catálogo del depósito">
                        no está en el catálogo
                      </div>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <CeldaEditable valor={f.n_remito} saving={saving} onGuardar={(v) => editarCampo(f, 'n_remito', v)} clase="text-ink" titulo="N° de remito" />
                    <CeldaEditable valor={f.fecha_remito ?? ''} tipo="fecha" saving={saving} mostrar={fmtFecha(f.fecha_remito)} onGuardar={(v) => editarCampo(f, 'fecha_remito', v)} clase="text-[10px] text-sub/70" titulo="Fecha del remito" />
                  </td>
                  <td className="px-2.5 py-2">
                    <CeldaOcEditable
                      valor={f.n_oc}
                      conocidos={numerosPedido}
                      pedidos={pedidosOc}
                      proveedorCodigo={f.proveedor_codigo}
                      proveedorNombre={f.proveedor}
                      saving={saving}
                      onChange={(v) => void cambiarOc(f, v)}
                    />
                    {f.oc_cargada_dragon && <span className="ml-1 text-[10px] text-emerald-500">dragon</span>}
                  </td>
                  <td className="px-2.5 py-2">
                    <CeldaEditable valor={f.n_factura} saving={saving} onGuardar={(v) => editarCampo(f, 'n_factura', v)} clase="text-ink" titulo="N° de factura" />
                    <CeldaEditable valor={f.fecha_factura ?? ''} tipo="fecha" saving={saving} mostrar={fmtFecha(f.fecha_factura)} onGuardar={(v) => editarCampo(f, 'fecha_factura', v)} clase="text-[10px] text-sub/70" titulo="Fecha de la factura" />
                    <div className="flex items-center gap-1">
                      {f.factura_link && <LinkFactura href={f.factura_link} />}
                      <CeldaEditable
                        valor={f.factura_link ?? ''}
                        saving={saving}
                        placeholder="https://drive.google.com/…"
                        mostrar={<span className="text-[10px] text-sub/60">{f.factura_link ? 'cambiar link' : '+ link'}</span>}
                        onGuardar={(v) => editarCampo(f, 'factura_link', v)}
                        titulo="Link de la factura (Drive)"
                      />
                    </div>
                  </td>
                  <td className="px-2.5 py-2">
                    <CeldaEstado
                      valor={f.estado}
                      opciones={estadosLista}
                      saving={saving}
                      onGuardar={(v) => editarCampo(f, 'estado', v)}
                      onNuevo={(v) => {
                        setEstadosNuevos((prev) => (prev.includes(v) ? prev : [...prev, v]))
                        editarCampo(f, 'estado', v)
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-ink">
                    <CeldaEditable
                      valor={f.iva != null ? String(f.iva).replace('.', ',') : ''}
                      tipo="plata"
                      saving={saving}
                      mostrar={f.iva != null ? pesos.format(Number(f.iva)) : undefined}
                      clase="text-right"
                      onGuardar={(v) => editarCampo(f, 'iva', v)}
                      titulo="IVA"
                    />
                  </td>
                  <td className="max-w-40 px-2.5 py-2 text-sub">
                    <CeldaEditable valor={f.detalle ?? ''} saving={saving} onGuardar={(v) => editarCampo(f, 'detalle', v)} titulo="Detalle" />
                  </td>
                  <td className="px-2.5 py-2">
                    {/* Fecha de control: con fecha = controlada, vacía = pendiente */}
                    <CeldaEditable
                      valor={f.fecha_controlada ?? ''}
                      tipo="fecha"
                      saving={saving}
                      mostrar={controlada ? <span className="text-emerald-400">{fmtFecha(f.fecha_controlada)}</span> : <span className="text-sub/50">pendiente</span>}
                      onGuardar={(v) => editarCampo(f, 'fecha_controlada', v)}
                      titulo="Fecha de control (vaciala para volver a pendiente)"
                    />
                    {controlada && f.controlado_por && (
                      <div className="mt-0.5 text-[10px] text-sub/70">{f.controlado_por}</div>
                    )}
                    {controlada && f.dias_atraso != null && f.dias_atraso > 0 && (
                      <div className="text-[10px] text-amber-500/90">{f.dias_atraso} días de atraso</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {!filas.length && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-sub">
                  {cargando
                    ? 'Cargando...'
                    : resumen.filas === 0
                      ? 'Todavía no se importó ninguna recepción. Subí el Excel "Recepción de Mercadería".'
                      : 'Ninguna recepción coincide con los filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-sub">
          <span>
            {n0.format(desde)}–{n0.format(hasta)} de {n0.format(total)}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0 || cargando}
              className="btn-press inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:bg-line/40 disabled:opacity-40"
            >
              <ArrowLeft size={13} aria-hidden /> Anterior
            </button>
            <span className="tabular-nums">página {pagina + 1} de {paginas}</span>
            <button
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina + 1 >= paginas || cargando}
              className="btn-press inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 hover:bg-line/40 disabled:opacity-40"
            >
              Siguiente <ArrowRight size={13} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {creando && (
        <NuevaRecepcionIndo
          depositos={opciones.depositos ?? []}
          transportes={opciones.transportes ?? []}
          estados={estadosLista}
          proveedores={catalogo}
          onCerrar={() => setCreando(false)}
          onGuardado={(texto) => {
            setCreando(false)
            setMsg({ ok: true, texto })
            void cargar()
            void cargarOpciones()
          }}
        />
      )}

      {confirma && (
        <ConfirmDialog
          open
          title={confirma.titulo}
          message={confirma.texto}
          confirmLabel="Importar"
          onConfirm={() => { const a = confirma.accion; setConfirma(null); void a() }}
          onCancel={() => setConfirma(null)}
        />
      )}
    </Layout>
  )
}
