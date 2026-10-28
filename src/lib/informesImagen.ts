/**
 * Render de un informe como imagen PNG, para mandarlo por WhatsApp.
 *
 * Sólo lo usa el servidor (Vercel): WebAssembly nativo no hace falta.
 *   satori -> HTML/CSS a SVG (el texto queda en vectores)
 *   sharp  -> SVG a PNG
 * La fuente va embebida en base64 (informeFuente.ts) para no depender de
 * archivos ni del tracing de fs de Vercel.
 */
import satori from 'satori'
import sharp from 'sharp'
import { createElement as h } from 'react'
import { FUENTE_GEIST_BASE64 } from './informeFuente.js'

export type BloqueImagen =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'tabla'
      columnas: string[]
      filas: string[][]
      /** 'izq' | 'der' por columna (por defecto, todo a la izquierda) */
      alinear?: Array<'izq' | 'der'>
      /** ancho relativo de cada columna (flex); por defecto, iguales */
      anchos?: number[]
      /** color de texto por columna (ej. venta en verde, no mandados en rojo) */
      colores?: Array<string | null>
      /** color de texto de una celda puntual [fila][columna]; pisa al de la columna */
      coloresCelda?: Array<Array<string | null> | null>
      /** la última fila es un total: va resaltada */
      total?: boolean
    }
  | { tipo: 'seccion'; texto: string; color?: string }
  | { tipo: 'kpis'; items: Array<{ titulo: string; valor: string; pie?: string; color: string }> }

export interface ReporteImagen {
  titulo: string
  subtitulo?: string
  pie?: string
  bloques: BloqueImagen[]
}

const ANCHO = 1000
const PAD = 44
const LINEA = 26 // alto de una línea de texto
const FILA = 43 // alto de una fila de tabla
const CAR_LINEA = 92 // caracteres estimados por línea
const MAX_ALTO = 4200
const MAX_FILAS = 48
const MAX_LINEAS = 110

const FUENTE = Buffer.from(FUENTE_GEIST_BASE64, 'base64')

function contarLineas(texto: string): number {
  return texto
    .split('\n')
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CAR_LINEA)), 0)
}

function recortarLineas(texto: string, max: number): string {
  const lineas = texto.split('\n')
  if (lineas.length <= max) return texto
  return [...lineas.slice(0, Math.max(1, max - 1)), `… y ${lineas.length - max + 1} línea(s) más`].join('\n')
}

function celda(texto: string, header: boolean, maxChars: number, opc: { der?: boolean; flex?: number; color?: string | null; negrita?: boolean } = {}) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flex: opc.flex ?? 1,
        justifyContent: opc.der ? 'flex-end' : 'flex-start',
        padding: '10px 12px',
        fontSize: '17px',
        fontWeight: header || opc.negrita ? 700 : 400,
        color: header ? '#ffffff' : opc.color || '#0f172a',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      },
    },
    texto.length > maxChars ? `${texto.slice(0, maxChars - 1)}…` : texto,
  )
}

type BloqueTabla = Extract<BloqueImagen, { tipo: 'tabla' }>

function bloqueTabla(b: BloqueTabla, key: number) {
  const cols = b.columnas
  const sumaAnchos = (b.anchos ?? cols.map(() => 1)).reduce((s, n) => s + n, 0)
  const maxCharsDe = (ci: number) =>
    Math.max(6, Math.floor((CAR_LINEA * (b.anchos?.[ci] ?? 1)) / Math.max(1, sumaAnchos)))
  const opc = (ci: number) => ({ der: b.alinear?.[ci] === 'der', flex: b.anchos?.[ci] ?? 1 })
  const val = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())

  const head = h(
    'div',
    { style: { display: 'flex', backgroundColor: '#0f172a' } },
    ...cols.map((c, ci) => celda(val(c), true, maxCharsDe(ci), opc(ci))),
  )
  const filas = b.filas.map((fila, ri) => {
    const esTotal = Boolean(b.total) && ri === b.filas.length - 1
    return h(
      'div',
      {
        style: {
          display: 'flex',
          backgroundColor: esTotal ? '#e2e8f0' : ri % 2 ? '#f8fafc' : '#ffffff',
          borderTop: esTotal ? '2px solid #94a3b8' : '1px solid #eef2f7',
        },
      },
      ...cols.map((_, ci) => celda(val(fila[ci]), false, maxCharsDe(ci), { ...opc(ci), color: b.coloresCelda?.[ri]?.[ci] ?? b.colores?.[ci], negrita: esTotal })),
    )
  })
  return h(
    'div',
    { key, style: { display: 'flex', flexDirection: 'column', marginTop: '18px', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' } },
    head,
    ...filas,
  )
}

function bloqueTexto(texto: string, key: number) {
  return h(
    'div',
    {
      key,
      style: {
        display: 'flex',
        marginTop: '18px',
        fontSize: '18px',
        lineHeight: 1.4,
        color: '#0f172a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
    },
    texto,
  )
}

function bloqueSeccion(b: { texto: string; color?: string }, key: number) {
  return h(
    'div',
    {
      key,
      style: {
        display: 'flex',
        alignItems: 'center',
        marginTop: '28px',
        fontSize: '22px',
        fontWeight: 700,
        color: '#0f172a',
        borderLeft: `6px solid ${b.color ?? '#0ea5e9'}`,
        paddingLeft: '12px',
      },
    },
    b.texto,
  )
}

function bloqueKpis(b: { items: Array<{ titulo: string; valor: string; pie?: string; color: string }> }, key: number) {
  return h(
    'div',
    { key, style: { display: 'flex', gap: '12px', marginTop: '18px' } },
    ...b.items.map((k, i) =>
      h(
        'div',
        {
          key: i,
          style: {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '12px 14px',
            borderRadius: '14px',
            border: `2px solid ${k.color}55`,
            backgroundColor: `${k.color}12`,
          },
        },
        h('div', { style: { display: 'flex', fontSize: '13px', fontWeight: 700, color: k.color, textTransform: 'uppercase' } }, k.titulo),
        h('div', { style: { display: 'flex', fontSize: '26px', fontWeight: 700, color: '#0f172a', marginTop: '4px', whiteSpace: 'nowrap' } }, k.valor),
        k.pie ? h('div', { style: { display: 'flex', fontSize: '14px', color: '#64748b', marginTop: '2px', whiteSpace: 'nowrap' } }, k.pie) : null,
      ),
    ),
  )
}

/** Alto estimado de cada bloque (para dimensionar la imagen). */
function altoBloque(b: BloqueImagen): number {
  switch (b.tipo) {
    case 'texto':
      return 18 + contarLineas(b.texto) * LINEA
    case 'tabla':
      return 18 + (b.filas.length + 1) * FILA
    case 'seccion':
      return 28 + 34
    case 'kpis':
      return 18 + 112
  }
}

/** Recorta defensivamente y devuelve los bloques ya acotados. */
function acotar(bloques: BloqueImagen[]): BloqueImagen[] {
  let filas = 0
  let lineas = 0
  const out: BloqueImagen[] = []
  for (const b of bloques) {
    if (b.tipo === 'tabla') {
      const disp = Math.max(0, MAX_FILAS - filas)
      const recorte = b.filas.slice(0, disp)
      filas += recorte.length
      const extra = b.filas.length - recorte.length
      out.push({ ...b, filas: recorte, total: extra > 0 ? false : b.total })
      if (extra > 0) out.push({ tipo: 'texto', texto: `… y ${extra} fila(s) más` })
    } else if (b.tipo !== 'texto') {
      out.push(b)
    } else {
      const disp = Math.max(1, MAX_LINEAS - lineas)
      const texto = recortarLineas(b.texto, disp)
      lineas += contarLineas(texto)
      out.push({ tipo: 'texto', texto })
    }
  }
  return out
}

export async function renderReporteImagen(r: ReporteImagen): Promise<Buffer> {
  const bloques = acotar(r.bloques)

  let alto = PAD * 2 + 44 + 12
  if (r.subtitulo) alto += 28
  for (const b of bloques) alto += altoBloque(b)
  if (r.pie) alto += 46
  alto = Math.max(320, Math.min(alto, MAX_ALTO))

  const hijos = [
    h('div', { key: 'titulo', style: { display: 'flex', fontSize: '34px', fontWeight: 700, color: '#0f172a', lineHeight: 1.25 } }, r.titulo),
    r.subtitulo
      ? h('div', { key: 'sub', style: { display: 'flex', fontSize: '18px', color: '#64748b', marginTop: '6px' } }, r.subtitulo)
      : null,
    ...bloques.map((b, i) =>
      b.tipo === 'texto'
        ? bloqueTexto(b.texto, i)
        : b.tipo === 'tabla'
          ? bloqueTabla(b, i)
          : b.tipo === 'seccion'
            ? bloqueSeccion(b, i)
            : bloqueKpis(b, i),
    ),
    r.pie ? h('div', { key: 'pie', style: { display: 'flex', marginTop: '22px', fontSize: '15px', color: '#94a3b8' } }, r.pie) : null,
  ].filter(Boolean)

  const el = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${ANCHO}px`,
        height: `${alto}px`,
        boxSizing: 'border-box',
        backgroundColor: '#ffffff',
        padding: `${PAD}px`,
        fontFamily: 'Geist',
      },
    },
    ...hijos,
  )

  const svg = await satori(el, {
    width: ANCHO,
    height: alto,
    fonts: [{ name: 'Geist', data: FUENTE, weight: 400, style: 'normal' }],
  })
  return sharp(Buffer.from(svg)).png().toBuffer()
}
