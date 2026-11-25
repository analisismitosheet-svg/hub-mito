/**
 * Polo 52 > Mapeo de bultos (ver sql/polo_mapeo.sql y puente-sql/poloBulto.js).
 *
 * Posición = palet con QR «POLO:<codigo>». Bulto = QR de Transporte ORIGEN-NRO-DESTINO[-SI/NO]
 * (ej. MITO-16050(1/2)-POLO52, GPAZD-0013-23735-POLO52, MITO-16050/16051-POLO52).
 * Lo de parsear no importa nada del navegador: lo usa también la API (Vercel).
 */

export const PREFIJO_POSICION = /^\s*POLO\s*[:Ñ;]\s*/i

/** Lo que lleva el QR impreso de una posición */
export function qrPosicion(codigo: string) {
  return `POLO:${codigo}`
}

/** "POLO:A-01" -> "A-01"; null si no tiene el prefijo */
export function leerPosicion(texto: string): string | null {
  if (!PREFIJO_POSICION.test(texto)) return null
  const c = texto.replace(PREFIJO_POSICION, '').trim().toUpperCase().replace(/'/g, '-')
  return /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(c) ? c : null
}

/** Código válido de posición (lo mismo que acepta la base) */
export function posicionValida(c: string) {
  return /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(c)
}

const FLAGS_WEB = new Set(['TRUE', 'FALSE', 'NO', 'SI'])

export interface BultoParseado {
  /** ORIGEN-NRO-DESTINO (sin la marca web): identifica el bulto */
  bulto: string
  origen: string
  destino: string
  nro: string
  /** Remitos del bulto: punto de venta (si vino) y número */
  numeros: { pv: number | null; num: number }[]
  bulto_n: number | null
  bultos_total: number | null
}

/**
 * Lee el QR de un bulto. El NRO es todo lo del medio entre origen y destino: puede traer
 * (n/total), varios remitos con «/» y punto de venta con guion (0013-23735).
 * La pistola con teclado mal configurado cambia «-» por «'» y «(» «)» por «*» «)»: se corrige lo común.
 */
export function parsearBulto(texto: string): BultoParseado | null {
  const limpio = texto.trim().toUpperCase().replace(/\s+/g, '').replace(/'/g, '-')
  const partes = limpio.split('-').filter(Boolean)
  if (partes.length >= 4 && FLAGS_WEB.has(partes[partes.length - 1])) partes.pop()
  if (partes.length < 3) return null
  const origen = partes[0]
  const destino = partes[partes.length - 1]
  const nro = partes.slice(1, -1).join('-')
  if (!/^[A-Z0-9]{1,20}$/.test(origen) || !/^[A-Z0-9]{1,20}$/.test(destino) || !/\d/.test(nro)) return null

  let bulto_n: number | null = null
  let bultos_total: number | null = null
  const m = nro.match(/\((\d+)\/(\d+)\)$/)
  const base = m ? nro.slice(0, m.index) : nro
  if (m) {
    bulto_n = Number(m[1])
    bultos_total = Number(m[2])
  }
  const numeros: BultoParseado['numeros'] = []
  for (const pedazo of base.split('/')) {
    const pm = pedazo.match(/^(?:(\d{1,5})-)?(\d{1,9})$/)
    if (!pm) return null
    numeros.push({ pv: pm[1] ? Number(pm[1]) : null, num: Number(pm[2]) })
  }
  if (numeros.length === 0 || numeros.length > 10) return null
  return { bulto: `${origen}-${nro}-${destino}`, origen, destino, nro, numeros, bulto_n, bultos_total }
}

export interface ItemBulto {
  remito: string
  articulo: string
  descripcion: string | null
  color: string | null
  color_nombre: string | null
  talle: string | null
  cantidad: number
}

export interface RespuestaBulto {
  remitos: { remito: string; origen: string; base: string; fecha: string }[]
  items: ItemBulto[]
  aviso?: string | null
  error?: string | null
}
