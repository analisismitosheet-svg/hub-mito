/* ------------------------------------------------------------------ */
/*  Importar el Excel de ingresos del picking (Dragonfish) al Picking  */
/*  del hub: cruza cada artículo ingresado con su pedido de compra y   */
/*  calcula cuánto marcar como recibido en cada renglón.               */
/* ------------------------------------------------------------------ */

/** Un renglón del Excel ya leído. */
export interface Ingreso {
  comprobante: string // "PEDIDODECOMPRA X 00001-00010332"
  articulo: string
  color: string
  talle: string
  cantidad: number
}

/** Renglón de un pedido del hub (rpc picking_items_todos). */
export interface RenglonPedido {
  codigo: string
  descripcion: string | null
  articulo: string
  color: string
  talle: string
  cantidad: number
  recibido: number
}

export interface Marca {
  codigo: string
  articulo: string
  color: string
  talle: string
  recibido: number // valor nuevo (nunca menor al que ya tenía)
  antes: number
}

export interface ResultadoCruce {
  marcas: Marca[]
  pedidos: number // pedidos con algo para marcar
  unidades: number // unidades nuevas marcadas
  sinPedido: string[] // comprobantes del Excel que no están en el hub
  sinArticulo: string[] // "comprobante · artículo" que el pedido no tiene
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Lee las filas del Excel (sheet_to_json con header: 1). Las observaciones de varias líneas parten
 * algunas filas: queda el encabezado (TIPO…OBSERVACIONES) y abajo una fila corrida con
 * ARTICULO, CANTIDAD, COLOR, TALLE en las columnas B-E; esa va con el último encabezado.
 */
export function leerIngresos(filas: unknown[][]): Ingreso[] {
  const iCab = filas.findIndex((f) => f.some((c) => norm(c) === 'COMPROBANTE_PROVEEDOR'))
  if (iCab < 0) throw new Error('El Excel no tiene la columna COMPROBANTE_PROVEEDOR.')
  const cab = filas[iCab].map(norm)
  const col = (n: string) => {
    const i = cab.indexOf(n)
    if (i < 0) throw new Error(`Falta la columna ${n} en el Excel.`)
    return i
  }
  const cTipo = col('TIPO'), cComp = col('COMPROBANTE_PROVEEDOR'), cArt = col('ARTICULO')
  const cCant = col('CANTIDAD'), cColor = col('COLOR'), cTalle = col('TALLE')
  const out: Ingreso[] = []
  let comp = ''
  for (const f of filas.slice(iCab + 1)) {
    if (norm(f[cTipo]) && norm(f[cComp])) {
      comp = String(f[cComp]).trim()
      if (norm(f[cArt])) out.push({ comprobante: comp, articulo: norm(f[cArt]), color: norm(f[cColor]), talle: norm(f[cTalle]), cantidad: num(f[cCant]) })
    } else if (!norm(f[cTipo]) && norm(f[1]) && norm(f[2]) && Number.isFinite(Number(String(f[2]).replace(',', '.')))) {
      // fila corrida: B = artículo, C = cantidad, D = color, E = talle
      if (comp) out.push({ comprobante: comp, articulo: norm(f[1]), color: norm(f[3]), talle: norm(f[4]), cantidad: num(f[2]) })
    }
  }
  return out.filter((i) => i.articulo && i.cantidad > 0)
}

/**
 * Cruza los ingresos con los pedidos. Por cada pedido + artículo:
 *  1) mismo color y talle → esa cantidad;
 *  2) si no, mismo talle (el código de color de Dragonfish suele diferir: "00" vs "2");
 *  3) lo que sobra del artículo se reparte entre sus renglones pendientes, del primero al último
 *     (ej.: el pedido dice color 00 talle U 20 y el picking 01/XL 10 + 01/S 10 → 20 recibidas).
 * Nunca baja lo que ya estaba marcado.
 */
export function cruzar(ingresos: Ingreso[], renglones: RenglonPedido[]): ResultadoCruce {
  // pedido(s) por comprobante y renglones por pedido+artículo
  const porComp = new Map<string, Set<string>>()
  const porPedArt = new Map<string, RenglonPedido[]>()
  for (const r of renglones) {
    const d = norm(r.descripcion)
    if (d) porComp.set(d, (porComp.get(d) ?? new Set()).add(r.codigo))
    const k = `${r.codigo}|${r.articulo}`
    porPedArt.set(k, [...(porPedArt.get(k) ?? []), r])
  }
  // Excel agrupado por comprobante + artículo
  const grupos = new Map<string, Ingreso[]>()
  for (const i of ingresos) {
    const k = `${norm(i.comprobante)}|${i.articulo}`
    grupos.set(k, [...(grupos.get(k) ?? []), i])
  }

  const asignado = new Map<string, number>() // codigo|art|color|talle -> unidades del Excel
  const sinPedido = new Set<string>()
  const sinArticulo: string[] = []
  const claveR = (r: RenglonPedido) => `${r.codigo}|${r.articulo}|${r.color}|${r.talle}`

  for (const [k, ing] of grupos) {
    const [comp, art] = k.split('|')
    const pedidos = porComp.get(comp)
    if (!pedidos) { sinPedido.add(comp); continue }
    // si el número se repite entre proveedores, el que tiene ese artículo
    const codigo = [...pedidos].find((c) => porPedArt.has(`${c}|${art}`))
    if (!codigo) { sinArticulo.push(`${comp.replace('PEDIDODECOMPRA ', '')} · ${art}`); continue }
    const rs = porPedArt.get(`${codigo}|${art}`)!
    const suma = new Map(rs.map((r) => [claveR(r), 0]))
    const pool = ing.map((i) => ({ ...i }))
    // 1) color y talle
    for (const r of rs) for (const p of pool) {
      if (p.cantidad > 0 && norm(r.color) === p.color && norm(r.talle) === p.talle) {
        suma.set(claveR(r), suma.get(claveR(r))! + p.cantidad); p.cantidad = 0
      }
    }
    // 2) talle (solo renglones que todavía no recibieron nada)
    for (const r of rs) {
      if (suma.get(claveR(r))! > 0 || !norm(r.talle)) continue
      for (const p of pool) {
        if (p.cantidad > 0 && norm(r.talle) === p.talle) { suma.set(claveR(r), suma.get(claveR(r))! + p.cantidad); p.cantidad = 0 }
      }
    }
    // 3) el resto del artículo, completando renglones en orden; lo que sobre va al último
    let resto = pool.reduce((a, p) => a + p.cantidad, 0)
    for (const r of rs) {
      if (resto <= 0) break
      const falta = Math.max(0, r.cantidad - suma.get(claveR(r))!)
      const usa = Math.min(falta, resto)
      suma.set(claveR(r), suma.get(claveR(r))! + usa); resto -= usa
    }
    if (resto > 0) { const u = rs[rs.length - 1]; suma.set(claveR(u), suma.get(claveR(u))! + resto) }
    for (const [ck, v] of suma) asignado.set(ck, (asignado.get(ck) ?? 0) + v)
  }

  const marcas: Marca[] = []
  for (const r of renglones) {
    const v = asignado.get(claveR(r))
    if (v == null || v <= r.recibido) continue
    marcas.push({ codigo: r.codigo, articulo: r.articulo, color: r.color, talle: r.talle, recibido: Math.round(v * 100) / 100, antes: r.recibido })
  }
  return {
    marcas,
    pedidos: new Set(marcas.map((m) => m.codigo)).size,
    unidades: marcas.reduce((a, m) => a + m.recibido - m.antes, 0),
    sinPedido: [...sinPedido].sort(),
    sinArticulo,
  }
}
