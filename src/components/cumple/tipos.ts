// Tipos, configuración por defecto y motor de layout del editor de cumpleaños.

export interface CumpleFila {
  nombre: string
  dia: number
  mes: number
}

export type AlignH = 'left' | 'center' | 'right'
export type AlignV = 'top' | 'center'
export type ModoLista = 'unido' | 'split'
export type FormatoFecha = 'dd/mm' | 'd/m' | 'dia' | 'texto' | 'ninguno'
export type TipoFondo = 'imagen' | 'globos' | 'confeti' | 'oscuro' | 'blanco'
export type Vineta = 'ninguna' | 'punto' | 'torta' | 'globo' | 'estrella'
export type Formato = '3:4' | '1:1' | '4:3' | '9:16' | 'a4'
export type Elemento = 'encabezado' | 'titulo' | 'lista' | 'pie'

/** Texto suelto y movible. x/y/w son fracciones del lienzo; sizeRel es fracción de la altura. */
export interface TextoCfg {
  visible: boolean
  texto: string
  x: number
  y: number
  w: number
  sizeRel: number
  fuente: string
  color: string
  bold: boolean
  italic: boolean
  align: AlignH
  mayus: boolean
  sombra: boolean
  interlineado: number
}

/** Caja del listado de cumpleañeros. */
export interface ListaCfg {
  x: number
  y: number
  w: number
  h: number
  auto: boolean
  sizeRel: number
  fuente: string
  color: string
  colorFecha: string
  bold: boolean
  mayus: boolean
  align: AlignH
  alignV: AlignV
  modo: ModoLista
  columnas: 1 | 2
  interlineado: number
  espacio: number
  formato: FormatoFecha
  agrupar: boolean
  vineta: Vineta
  sombra: boolean
  /** Placa opaca detras del listado: sirve para tapar el texto de una plantilla ya impresa. */
  placa: boolean
  placaColor: string
  placaOpacidad: number
  placaRadio: number
  placaPad: number
}

export interface CumpleCfg {
  fondo: TipoFondo
  formato: Formato
  marca: boolean
  encabezado: TextoCfg
  titulo: TextoCfg
  pie: TextoCfg
  lista: ListaCfg
}

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export const FUENTES = [
  { id: 'Anton', nombre: 'Anton · impacto' },
  { id: 'Bebas Neue', nombre: 'Bebas Neue · alta' },
  { id: 'Luckiest Guy', nombre: 'Luckiest Guy · fiesta' },
  { id: 'Baloo 2', nombre: 'Baloo 2 · redonda' },
  { id: 'Pacifico', nombre: 'Pacifico · manuscrita' },
  { id: 'Poppins', nombre: 'Poppins · limpia' },
  { id: 'Montserrat', nombre: 'Montserrat · sobria' },
  { id: 'Open Sans', nombre: 'Open Sans · neutra' },
]

export const FAMILIAS_GOOGLE = [
  'Anton',
  'Bebas Neue',
  'Luckiest Guy',
  'Baloo 2:400,600,700',
  'Pacifico',
  'Poppins:400,600,700',
  'Montserrat:400,600,700',
  'Open Sans:400,600,700',
]

export const PALETA = [
  '#111111', '#ffffff', '#e11d2e', '#be185d', '#db2777', '#7c3aed',
  '#2563eb', '#0f766e', '#ea580c', '#f59e0b', '#16a34a', '#6b7280',
]

export const FORMATOS: Record<Formato, { w: number; h: number; nombre: string }> = {
  '3:4': { w: 1200, h: 1600, nombre: 'Vertical 3:4' },
  '1:1': { w: 1400, h: 1400, nombre: 'Cuadrado 1:1' },
  '4:3': { w: 1600, h: 1200, nombre: 'Horizontal 4:3' },
  '9:16': { w: 1080, h: 1920, nombre: 'Historia 9:16' },
  a4: { w: 1240, h: 1754, nombre: 'A4 vertical' },
}

const VINETAS: Record<Vineta, string> = {
  ninguna: '',
  punto: '• ',
  torta: '🎂 ',
  globo: '🎈 ',
  estrella: '★ ',
}

export function textoPorDefecto(over: Partial<TextoCfg> = {}): TextoCfg {
  return {
    visible: true,
    texto: '',
    x: 0.06,
    y: 0.06,
    w: 0.88,
    sizeRel: 0.05,
    fuente: 'Anton',
    color: '#111111',
    bold: false,
    italic: false,
    align: 'center',
    mayus: true,
    sombra: false,
    interlineado: 1.15,
    ...over,
  }
}

export function cfgPorDefecto(tituloMes: string): CumpleCfg {
  return {
    fondo: 'globos',
    formato: '4:3',
    marca: true,
    encabezado: textoPorDefecto({
      texto: '¡FELIZ CUMPLEAÑOS TEAM!',
      y: 0.17,
      sizeRel: 0.075,
      color: '#e11d2e',
      fuente: 'Luckiest Guy',
    }),
    titulo: textoPorDefecto({
      texto: tituloMes,
      y: 0.275,
      sizeRel: 0.048,
      color: '#111111',
      fuente: 'Anton',
    }),
    pie: textoPorDefecto({
      visible: false,
      texto: 'Recursos Humanos',
      y: 0.93,
      sizeRel: 0.028,
      color: '#6b7280',
      fuente: 'Poppins',
      mayus: false,
    }),
    lista: {
      x: 0.1,
      y: 0.35,
      w: 0.8,
      h: 0.53,
      auto: true,
      sizeRel: 0.032,
      fuente: 'Bebas Neue',
      color: '#1a1a1a',
      colorFecha: '#e11d2e',
      bold: false,
      mayus: true,
      align: 'center',
      alignV: 'top',
      modo: 'unido',
      columnas: 1,
      interlineado: 1.3,
      espacio: 0.14,
      formato: 'dd/mm',
      agrupar: true,
      vineta: 'ninguna',
      sombra: false,
      placa: false,
      placaColor: '#ffffff',
      placaOpacidad: 1,
      placaRadio: 0.02,
      placaPad: 0.02,
    },
  }
}

// Fechas y agrupación ────────────────────────────────────────────────────────

export function fmtFecha(dia: number, mes: number, f: FormatoFecha): string {
  const dd = String(dia).padStart(2, '0')
  const mm = String(mes).padStart(2, '0')
  switch (f) {
    case 'dd/mm': return `${dd}/${mm}`
    case 'd/m': return `${dia}/${mes}`
    case 'dia': return dd
    case 'texto': return `${dia} de ${MESES[Math.max(0, Math.min(11, mes - 1))]}`
    default: return ''
  }
}

export interface ItemLista { nombre: string; fecha: string }

function unirNombres(ns: string[]): string {
  if (ns.length <= 1) return ns[0] ?? ''
  return `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`
}

export function construirItems(filas: CumpleFila[], agrupar: boolean, formato: FormatoFecha): ItemLista[] {
  const orden = [...filas].sort((a, b) => a.dia - b.dia || a.nombre.localeCompare(b.nombre, 'es'))
  if (!agrupar) return orden.map((f) => ({ nombre: f.nombre, fecha: fmtFecha(f.dia, f.mes, formato) }))
  const mapa = new Map<string, CumpleFila[]>()
  for (const f of orden) {
    const k = `${f.mes}-${f.dia}`
    const arr = mapa.get(k)
    if (arr) arr.push(f)
    else mapa.set(k, [f])
  }
  return Array.from(mapa.values()).map((g) => ({
    nombre: unirNombres(g.map((x) => x.nombre)),
    fecha: fmtFecha(g[0].dia, g[0].mes, formato),
  }))
}

// Medición de texto ──────────────────────────────────────────────────────────

let _ctx: CanvasRenderingContext2D | null = null
function ctx2d(): CanvasRenderingContext2D | null {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d')
  return _ctx
}

export function fuenteCss(familia: string, size: number, bold = false, italic = false): string {
  return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${familia}", Poppins, sans-serif`
}

export function medir(texto: string, font: string): number {
  const c = ctx2d()
  if (!c) return texto.length * 8
  c.font = font
  return c.measureText(texto).width
}

export function cortar(texto: string, maxW: number, font: string): string[] {
  const palabras = (texto ?? '').split(/\s+/).filter(Boolean)
  if (!palabras.length) return ['']
  const out: string[] = []
  let act = ''
  for (const p of palabras) {
    const prueba = act ? `${act} ${p}` : p
    if (act && medir(prueba, font) > maxW) { out.push(act); act = p } else act = prueba
  }
  if (act) out.push(act)
  return out
}

// Layout del listado ─────────────────────────────────────────────────────────

export interface TextoRender {
  key: string
  texto: string
  x: number
  y: number
  w: number
  align: AlignH
  tipo: 'nombre' | 'fecha'
}

export interface LayoutLista {
  textos: TextoRender[]
  alto: number
  size: number
  cabe: boolean
}

/** Arma el listado dentro de una caja de w x h px con un tamaño de fuente dado. */
export function layoutLista(items: ItemLista[], cfg: ListaCfg, w: number, h: number, size: number): LayoutLista {
  const font = fuenteCss(cfg.fuente, size, cfg.bold)
  const cols = cfg.columnas
  const gap = size * 1.6
  const colW = cols > 1 ? Math.max(size, (w - gap) / 2) : w
  const lh = size * cfg.interlineado
  const extra = size * cfg.espacio
  const vin = VINETAS[cfg.vineta] ?? ''

  let fechaW = 0
  if (cfg.modo === 'split' && cfg.formato !== 'ninguno') {
    for (const it of items) fechaW = Math.max(fechaW, medir(it.fecha, font))
    if (fechaW > 0) fechaW += size * 0.6
  }
  const anchoNombre = cfg.modo === 'split' ? Math.max(size * 2, colW - fechaW) : colW

  let excede = false
  const bloques = items.map((it) => {
    const nom = cfg.mayus ? it.nombre.toLocaleUpperCase('es') : it.nombre
    const txt = vin + nom + (cfg.modo === 'unido' && it.fecha ? `   ${it.fecha}` : '')
    const lineas = cortar(txt, anchoNombre, font)
    for (const ln of lineas) if (medir(ln, font) > anchoNombre + 1) excede = true
    return { lineas, fecha: cfg.modo === 'split' ? it.fecha : '', alto: lineas.length * lh }
  })

  const total = bloques.reduce((s, b) => s + b.alto + extra, 0) - (bloques.length ? extra : 0)
  let grupos: (typeof bloques)[] = [bloques]
  if (cols > 1 && bloques.length > 1) {
    let corte = 1
    let mejor = Infinity
    let acc = 0
    for (let k = 0; k < bloques.length - 1; k++) {
      acc += bloques[k].alto + extra
      const dif = Math.abs(acc - total / 2)
      if (dif < mejor) { mejor = dif; corte = k + 1 }
    }
    grupos = [bloques.slice(0, corte), bloques.slice(corte)]
  }

  const textos: TextoRender[] = []
  let altoMax = 0
  grupos.forEach((g, ci) => {
    const colX = ci * (colW + gap)
    let y = 0
    g.forEach((b, bi) => {
      b.lineas.forEach((ln, li) => {
        textos.push({
          key: `n${ci}-${bi}-${li}`,
          texto: ln,
          x: colX,
          y: y + li * lh,
          w: anchoNombre,
          align: cfg.align,
          tipo: 'nombre',
        })
      })
      if (b.fecha) {
        textos.push({
          key: `f${ci}-${bi}`,
          texto: b.fecha,
          x: colX + colW - fechaW,
          y,
          w: fechaW,
          align: 'right',
          tipo: 'fecha',
        })
      }
      y += b.alto + extra
    })
    altoMax = Math.max(altoMax, Math.max(0, y - extra))
  })

  return { textos, alto: altoMax, size, cabe: !excede && altoMax <= h + 0.5 }
}

/** Busca el tamaño de fuente más grande que entra en la caja. */
export function autoSize(items: ItemLista[], cfg: ListaCfg, w: number, h: number): number {
  if (!items.length) return Math.round(h * 0.1)
  let lo = 8
  let hi = 160
  let best = 8
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (layoutLista(items, cfg, w, h, mid).cabe) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best
}
