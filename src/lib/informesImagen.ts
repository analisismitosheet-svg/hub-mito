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
  | { tipo: 'tabla'; columnas: string[]; filas: string[][] }

export interface ReporteImagen {
  titulo: string
  subtitulo?: string
  pie?: string
  bloques: BloqueImagen[]
}

const ANCHO = 1000
const PAD = 44
const LINEA = 26 // alto de una línea de texto
const FILA = 46 // alto de una fila de tabla
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

function celda(texto: string, header: boolean, maxChars: number) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flex: 1,
        padding: '10px 12px',
        fontSize: '17px',
        fontWeight: header ? 700 : 400,
        color: header ? '#ffffff' : '#0f172a',
        overflow: 'hidden',
      },
    },
    texto.length > maxChars ? `${texto.slice(0, maxChars - 1)}…` : texto,
  )
}

function bloqueTabla(b: { columnas: string[]; filas: string[][] }, key: number) {
  const cols = b.columnas
  const maxChars = Math.max(8, Math.floor(CAR_LINEA / Math.max(1, cols.length)))
  const val = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())

  const head = h(
    'div',
    { style: { display: 'flex', backgroundColor: '#0f172a' } },
    ...cols.map((c) => celda(val(c), true, maxChars)),
  )
  const filas = b.filas.map((fila, ri) =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          backgroundColor: ri % 2 ? '#f8fafc' : '#ffffff',
          borderTop: '1px solid #eef2f7',
        },
      },
      ...cols.map((_, ci) => celda(val(fila[ci]), false, maxChars)),
    ),
  )
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
      out.push({ tipo: 'tabla', columnas: b.columnas, filas: recorte })
      if (extra > 0) out.push({ tipo: 'texto', texto: `… y ${extra} fila(s) más` })
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
  for (const b of bloques) {
    alto += 18
    alto += b.tipo === 'texto' ? contarLineas(b.texto) * LINEA : (b.filas.length + 1) * FILA
  }
  if (r.pie) alto += 46
  alto = Math.max(320, Math.min(alto, MAX_ALTO))

  const hijos = [
    h('div', { key: 'titulo', style: { display: 'flex', fontSize: '34px', fontWeight: 700, color: '#0f172a', lineHeight: 1.25 } }, r.titulo),
    r.subtitulo
      ? h('div', { key: 'sub', style: { display: 'flex', fontSize: '18px', color: '#64748b', marginTop: '6px' } }, r.subtitulo)
      : null,
    ...bloques.map((b, i) => (b.tipo === 'texto' ? bloqueTexto(b.texto, i) : bloqueTabla(b, i))),
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
