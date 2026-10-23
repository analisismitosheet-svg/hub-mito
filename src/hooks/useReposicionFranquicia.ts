import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { leerVista, leerVistaFiltrada, type FilaSql } from '@/lib/sqlApi'
import { VISTA_ARTICULOS } from '@/lib/articulosConsulta'
import { cargarStockSku, claveSku, stockSkuDe, type StockSku } from '@/lib/stockSku'
import {
  cargarClientes,
  cargarMapaFranquicias,
  clientesConBase,
  destinoDe,
  type ClienteFranquicia,
  type MapaFranquicias,
} from '@/lib/franquicias'

export type FilaReposicion = {
  precio: number | null
  art: string
  descrip: string
  color: string
  talle: string
  vendido: number
  stock: number
  stockCli: number
  sugerido: number
  material: string
}

/**
 * Las ventas salen de la vista `venta_franquicias` y el stock del cliente de
 * `vw_STOCK_SUCURSALES_REAL` (columna BD_ORIGEN). El stock de MITO es el de
 * `vw_STOCK_SKU_MITO`. Qué base y qué sucursal se usan lo define el cliente
 * elegido (tabla franquicias_clientes, se configura en Sistemas → Franquicias).
 */
const VISTA_VENTAS = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.venta_franquicias'
const VISTA_STOCK_SUC = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SUCURSALES_REAL'
const VISTA_MATERIALES = 'DWH.dbo.vw_DIM_MATERIAL'

const txt = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => Number(v) || 0
/** FFCH llega como fecha ISO (medianoche UTC): los primeros 10 caracteres son el día */
const diaDe = (v: unknown) => txt(v).slice(0, 10)
const isoLocal = (d: Date) => d.toLocaleDateString('sv-SE')
const haceDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d) }
const esIso = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v))

interface Venta { base: string; dia: string; art: string; color: string; talle: string; cant: number; txt: string }

/**
 * Motor compartido de Reposición diaria y Propuesta de reposición.
 * Trae ventas, stock del cliente, stock MITO, artículos y precios para el
 * cliente/base elegido. Las dos pantallas usan exactamente los mismos números.
 */
export function useReposicionFranquicia() {
  const [search] = useSearchParams()
  const [mapa, setMapa] = useState<MapaFranquicias>({ bases: [], clientes: {}, telefonos: {} })
  const [clientes, setClientes] = useState<ClienteFranquicia[]>([])
  const [cargandoMapa, setCargandoMapa] = useState(true)
  const [clienteSel, setClienteSel] = useState('')

  const [ventas, setVentas] = useState<Venta[]>([])
  const [stockPorSucursal, setStockPorSucursal] = useState<Map<string, Map<string, number>>>(new Map())
  const [stockMito, setStockMito] = useState<StockSku | null>(null)
  const [articulos, setArticulos] = useState<Map<string, { descripcion: string; material: string }>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Precio (columna PRECIO de vw_ARTICULOS_MITO) por SKU y por artículo
  const [precios, setPrecios] = useState<{ sku: Map<string, number>; art: Map<string, number> }>({ sku: new Map(), art: new Map() })
  const [cargandoPrecios, setCargandoPrecios] = useState(false)

  const desdeInicial = search.get('desde')
  const hastaInicial = search.get('hasta')
  const clienteInicial = search.get('cliente') ?? ''
  const [desde, setDesde] = useState(() => (esIso(desdeInicial) ? desdeInicial : haceDias(30)))
  const [hasta, setHasta] = useState(() => (esIso(hastaInicial) ? hastaInicial : isoLocal(new Date())))

  const disponibles = useMemo(() => clientesConBase(clientes, mapa), [clientes, mapa])
  const cliente = disponibles.find((c) => c.codigo === clienteSel) ?? disponibles[0] ?? null
  const franq = cliente ? destinoDe(cliente, mapa) : null

  // Clientes y bases: qué base (y sucursal de stock) usa cada cliente
  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [m, cs] = await Promise.all([cargarMapaFranquicias(), cargarClientes()])
        if (!activo) return
        setMapa(m)
        setClientes(cs)
        const con = clientesConBase(cs, m)
        setClienteSel((prev) => {
          if (con.some((c) => c.codigo === prev)) return prev
          return con.find((c) => c.codigo === clienteInicial)?.codigo
            ?? con.find((c) => c.codigo === '01140')?.codigo
            ?? con[0]?.codigo
            ?? ''
        })
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (activo) setCargandoMapa(false)
      }
    })()
    return () => { activo = false }
  }, [clienteInicial])

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [filasV, filasS, stock, filasM] = await Promise.all([
          leerVista(VISTA_VENTAS),
          leerVista(VISTA_STOCK_SUC),
          cargarStockSku(),
          leerVista(VISTA_MATERIALES).catch(() => [] as FilaSql[]),
        ])
        if (!activo) return

        // Ventas netas: facturas y tickets suman, notas de crédito restan; remitos y demás no cuentan.
        // Se guardan todas las bases y después se filtra por la del cliente elegido.
        const vs: Venta[] = []
        for (const f of filasV) {
          const tipo = txt(f.DESCFW).toUpperCase()
          const signo = /^(TICKET)?NOTADECREDITO/.test(tipo) ? -1 : /^(TICKET)?FACTURA/.test(tipo) ? 1 : 0
          if (!signo) continue
          vs.push({
            base: txt(f.BASE_DATOS).toUpperCase(),
            dia: diaDe(f.FFCH),
            art: txt(f.FART).toUpperCase(),
            color: txt(f.CCOLOR).toUpperCase(),
            talle: txt(f.TALLE).toUpperCase(),
            cant: signo * num(f.FCANT),
            txt: txt(f.FTXT),
          })
        }

        // Stock del cliente por sucursal (BD_ORIGEN) y por SKU
        const sc = new Map<string, Map<string, number>>()
        for (const f of filasS) {
          const suc = txt(f.BD_ORIGEN).toUpperCase()
          let m = sc.get(suc)
          if (!m) { m = new Map(); sc.set(suc, m) }
          const k = claveSku(f.ARTICULO, f.COLOR, f.TALLE)
          m.set(k, (m.get(k) ?? 0) + num(f.CANTIDAD_REAL))
        }

        // Descripción y material del maestro (copia en Supabase) + nombres de material del DWH
        const nombresMat = new Map(filasM.map((m) => [txt(m.ID_MATERIAL).toUpperCase(), txt(m.MATERIAL)]))
        const arts = [...new Set(vs.map((v) => v.art))]
        const info = new Map<string, { descripcion: string; material: string }>()
        for (let i = 0; supabase && i < arts.length; i += 300) {
          const { data } = await supabase.from('articulos').select('id_art,descripcion,id_material').in('id_art', arts.slice(i, i + 300))
          for (const a of (data as { id_art: string; descripcion: string | null; id_material: string | null }[] | null) ?? []) {
            const cod = txt(a.id_material).toUpperCase()
            info.set(txt(a.id_art).toUpperCase(), { descripcion: txt(a.descripcion), material: nombresMat.get(cod) || cod })
          }
        }
        if (!activo) return
        setVentas(vs)
        setStockPorSucursal(sc)
        setStockMito(stock)
        setArticulos(info)
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [])

  // Una fila por SKU con lo vendido en el rango elegido (solo la base del cliente)
  const filas = useMemo<FilaReposicion[]>(() => {
    if (!franq) return []
    const stockCli = stockPorSucursal.get(franq.origenStock) ?? new Map<string, number>()
    const porSku = new Map<string, FilaReposicion>()
    for (const v of ventas) {
      if (v.base !== franq.base.toUpperCase()) continue
      if (v.dia < desde || v.dia > hasta) continue
      const k = claveSku(v.art, v.color, v.talle)
      let f = porSku.get(k)
      if (!f) {
        const a = articulos.get(v.art)
        f = { art: v.art, descrip: a?.descripcion || v.txt, color: v.color, talle: v.talle, vendido: 0, stock: 0, stockCli: 0, sugerido: 0, material: a?.material || '', precio: null }
        porSku.set(k, f)
      }
      f.vendido += v.cant
    }
    for (const [k, f] of porSku) {
      f.stock = stockSkuDe(stockMito, f.art, f.color, f.talle) ?? 0
      f.stockCli = stockCli.get(k) ?? 0
      // Reponer lo vendido menos lo que el cliente todavía tiene, sin pasarse del stock de MITO
      f.sugerido = Math.max(0, Math.min(f.vendido - f.stockCli, f.stock))
      f.precio = precios.sku.get(k) ?? precios.art.get(f.art) ?? null
    }
    return [...porSku.values()]
  }, [ventas, desde, hasta, articulos, stockMito, stockPorSucursal, precios, franq?.base, franq?.origenStock])

  // vw_ARTICULOS_MITO pesa ~6,8 MB: no se trae entera, se pide el precio de cada
  // artículo que se va a reponer (filtro por ID_ARTICULO, de a 6 a la vez).
  const artsAReponer = useMemo(
    () => [...new Set(filas.filter((f) => f.stock > 0 && f.sugerido > 0).map((f) => f.art))].sort().join(','),
    [filas],
  )
  useEffect(() => {
    const faltan = artsAReponer.split(',').filter((a) => a && !precios.art.has(a))
    if (!faltan.length) {
      // Si la lista quedó vacía mientras había una carga anterior, no dejamos
      // el estado de precios colgado en "cargando".
      setCargandoPrecios(false)
      return
    }
    let activo = true
    setCargandoPrecios(true)
    ;(async () => {
      const sku = new Map(precios.sku), art = new Map(precios.art)
      const cola = [...faltan]
      async function trabajador() {
        for (let a = cola.shift(); a; a = cola.shift()) {
          try {
            const filasA = await leerVistaFiltrada(VISTA_ARTICULOS, { donde: ['ID_ARTICULO'], valor: a, coincide: 'igual' })
            let max = 0
            for (const r of filasA) {
              const p = num(r.PRECIO)
              if (p > 0) sku.set(claveSku(r.ID_ARTICULO, r.COLOR_CODIGO, r.TALLE_CODIGO), p)
              max = Math.max(max, p)
            }
            art.set(a, max)
          } catch {
            art.set(a, 0)
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, trabajador))
      if (!activo) return
      setPrecios({ sku, art })
      setCargandoPrecios(false)
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artsAReponer])

  return {
    mapa, clientes, cargandoMapa,
    disponibles, cliente, franq,
    clienteSel, setClienteSel,
    desde, setDesde, hasta, setHasta,
    filas, cargando, cargandoPrecios, error,
  }
}
