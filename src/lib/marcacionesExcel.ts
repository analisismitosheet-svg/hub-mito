/* Lectura del Excel del reloj para RR. HH. → Marcaciones.
 *
 * Formato principal (27/11/2026): «Reporte de Fichadas (Por Legajo)» del ClockCard 2000 de LARCON-SIA
 * (.xls): un bloque por empleado («Empleado: | 155 | - | COMBA GERMAN ARIEL»), y por cada día
 * «Día | dd/mm/aaaa | Entró | Salió | Entró | Salió…» (hasta 5 pares). Una hora con «-M» es una fichada
 * cargada a mano en el reloj: se guarda con una M al final («22:00M») y se muestra como manual.
 * Los días sin fichadas no vienen.
 *
 * Si no es ese formato, se detectan las columnas por el encabezado:
 *  - Una fila por fichada: legajo/ID y/o nombre + «fecha y hora» (o «fecha» y «hora» por separado).
 *  - Una fila por día: legajo/nombre + fecha + columnas entrada/salida (entrada 1, salida 1, entrada 2…).
 * Las fichadas de cada legajo y día se ordenan, se descartan las repetidas (≤ 2 min) y se arman de a pares.
 */
import { duracion, pad, tokens, type Emp } from '@/lib/horarios'

export interface DiaMarcado {
  clave: string // legajo o nombre tal como viene del reloj
  nombre: string
  fecha: string
  marcas: string[]
  /** Fichadas cargadas a mano en el reloj («-M») */
  manuales?: string[]
}
export interface Lectura {
  dias: DiaMarcado[]
  formato: string
  columnas: string[]
  hojas: number
  /** Período que dice el reporte (PERIODO: dd/mm/aaaa AL dd/mm/aaaa) */
  periodo?: string
}
export interface Resultado {
  legajo: string
  fecha: string
  local: string
  marcas: string
  horario: string | null
  horas: number
  incompleta: boolean
}

const norm = (v: unknown) => String(v ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const COL = {
  legajo: /^(legajo|leg\.?|nro\.? ?legajo|n[°ºo]? ?legajo|id|id empleado|id de usuario|usuario id|ac-?no\.?|no\.?|nro\.?|numero|codigo|cod\.? empleado|enroll ?(id|no)?|badge|tarjeta)$/,
  nombre: /^(nombre|apellido y nombre|nombre y apellido|empleado|name|apellido)/,
  fechaHora: /(fecha.*hora|date.?time|checktime|check time|marcaci[oó]n|fichada|registro|tiempo)/,
  fecha: /^(fecha|date|dia|d[ií]a)$/,
  hora: /^(hora|time)$/,
  entrada: /^(entrada|ingreso|in|e)\s*\d*$/,
  salida: /^(salida|egreso|out|s)\s*\d*$/,
}

/** Fecha ISO de un valor de celda (Date, número de Excel o texto dd/mm/aaaa) */
function aFecha(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  let m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return `${a}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  }
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : null
}

/** Hora HH:MM de un valor de celda (Date, fracción de día, número de Excel con fecha o texto) */
function aHora(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const r = new Date(v.getTime() + 30000) // el Excel guarda la hora con decimales: se redondea al minuto
    return `${pad(r.getHours())}:${pad(r.getMinutes())}`
  }
  if (typeof v === 'number') {
    const frac = v - Math.floor(v)
    if (v > 0 && (v < 1 || v > 20000)) {
      const min = Math.round(frac * 1440)
      return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
    }
    return null
  }
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/)
  return m && Number(m[1]) < 24 ? `${pad(Number(m[1]))}:${m[2]}` : null
}

export async function leerExcelReloj(file: File): Promise<Lectura> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const mapa = new Map<string, DiaMarcado>()
  let formato = ''
  let columnas: string[] = []
  let hojas = 0
  const agregar = (clave: string, nombre: string, fecha: string, hora: string) => {
    const k = `${clave}|${fecha}`
    if (!mapa.has(k)) mapa.set(k, { clave, nombre, fecha, marcas: [] })
    mapa.get(k)!.marcas.push(hora)
  }

  // ClockCard 2000: «Reporte de Fichadas (Por Legajo)»
  let periodo: string | undefined
  for (const nombreHoja of wb.SheetNames) {
    const txt = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[nombreHoja], { header: 1, raw: false, defval: '' })
    if (!txt.some((r) => norm(r[0]) === 'empleado:')) continue
    hojas++
    formato = 'Reporte de Fichadas por legajo (ClockCard)'
    columnas = ['Empleado', 'Día', 'Fecha', 'Entró / Salió × 5']
    let clave = '', nombre = ''
    for (const r of txt) {
      if (norm(r[0]) === 'periodo:') periodo = [r[1], r[3]].filter(Boolean).join(' al ')
      if (norm(r[0]) === 'empleado:') {
        clave = String(r[1] ?? '').replace(/[^\d]/g, '')
        nombre = String(r.slice(2).find((v) => v && v !== '-') ?? '').trim()
        continue
      }
      const fecha = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(r[1]).trim()) ? aFecha(r[1]) : null
      if (!clave || !fecha) continue
      // Las fichadas van seguidas desde la columna C o D; lo que viene después de un hueco
      // (horas normales, extras, ausencias del otro reporte) no son fichadas.
      let empezo = false
      for (let j = 2; j < Math.min(r.length, 14); j++) {
        const t = String(r[j] ?? '').trim()
        const hora = aHora(t)
        if (!hora) { if (empezo) break; if (j >= 4) break; continue }
        empezo = true
        agregar(clave, nombre, fecha, hora)
        if (/-\s*m$/i.test(t)) {
          const d = mapa.get(`${clave}|${fecha}`)!
          d.manuales = [...(d.manuales ?? []), hora]
        }
      }
    }
  }
  if (mapa.size) return { dias: [...mapa.values()], formato, columnas, hojas, periodo }

  for (const nombreHoja of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombreHoja], { header: 1, raw: true, defval: null })
    // Encabezado: la primera fila (de las 20 primeras) con columna de fecha/hora y de legajo o nombre
    let h = -1
    let idx: Record<string, number> = {}
    let ent: number[] = [], sal: number[] = []
    for (let i = 0; i < Math.min(20, filas.length) && h < 0; i++) {
      const cab = (filas[i] ?? []).map(norm)
      const buscar = (re: RegExp) => cab.findIndex((c) => re.test(c))
      const t = { legajo: buscar(COL.legajo), nombre: buscar(COL.nombre), fechaHora: buscar(COL.fechaHora), fecha: buscar(COL.fecha), hora: buscar(COL.hora) }
      ent = cab.map((c, j) => (COL.entrada.test(c) ? j : -1)).filter((j) => j >= 0)
      sal = cab.map((c, j) => (COL.salida.test(c) ? j : -1)).filter((j) => j >= 0)
      const quien = t.legajo >= 0 || t.nombre >= 0
      const cuando = t.fechaHora >= 0 || (t.fecha >= 0 && (t.hora >= 0 || ent.length > 0))
      if (quien && cuando) { h = i; idx = t; columnas = (filas[i] ?? []).map((c) => String(c ?? '')).filter(Boolean) }
    }
    if (h < 0) continue
    hojas++
    for (const f of filas.slice(h + 1)) {
      if (!f) continue
      const nombre = idx.nombre >= 0 ? String(f[idx.nombre] ?? '').trim() : ''
      const clave = (idx.legajo >= 0 ? String(f[idx.legajo] ?? '').trim() : '') || nombre
      if (!clave) continue
      if (ent.length && idx.fecha >= 0) {
        formato = 'una fila por día (entrada / salida)'
        const fecha = aFecha(f[idx.fecha])
        if (!fecha) continue
        for (const j of [...ent, ...sal].sort((a, b) => a - b)) {
          const hora = aHora(f[j])
          if (hora) agregar(clave, nombre, fecha, hora)
        }
      } else if (idx.fechaHora >= 0) {
        formato = 'una fila por fichada (fecha y hora)'
        const v = f[idx.fechaHora]
        const fecha = aFecha(v), hora = aHora(v)
        if (fecha && hora) agregar(clave, nombre, fecha, hora)
      } else {
        formato = 'una fila por fichada (fecha + hora)'
        const fecha = aFecha(f[idx.fecha]), hora = aHora(f[idx.hora])
        if (fecha && hora) agregar(clave, nombre, fecha, hora)
      }
    }
  }
  return { dias: [...mapa.values()], formato, columnas, hojas }
}

/** Busca el legajo: por número (sin ceros adelante) o por nombre */
export function cruzar(dias: DiaMarcado[], emps: Emp[]): { resultados: Resultado[]; sinLegajo: string[] } {
  const porLegajo = new Map(emps.map((e) => [e.legajo.replace(/^0+/, ''), e]))
  const cache = new Map<string, Emp | null>()
  const buscar = (clave: string, nombre: string): Emp | null => {
    const k = `${clave}|${nombre}`
    if (cache.has(k)) return cache.get(k)!
    let e = porLegajo.get(clave.replace(/^0+/, '')) ?? null
    const texto = nombre || (/\d/.test(clave) ? '' : clave)
    if (!e && texto) {
      const t = tokens(texto).filter((x) => x.length >= 3)
      const cands = emps
        .map((x) => ({ x, n: t.filter((p) => tokens(x.nombre).includes(p)).length }))
        .filter((c) => c.n >= Math.min(2, t.length))
        .sort((a, b) => b.n - a.n)
      if (cands.length && (cands.length === 1 || cands[0].n > cands[1].n)) e = cands[0].x
    }
    cache.set(k, e)
    return e
  }
  const resultados: Resultado[] = []
  const sin = new Set<string>()
  for (const d of dias) {
    const e = buscar(d.clave, d.nombre)
    if (!e) { sin.add(d.nombre ? `${d.clave} · ${d.nombre}` : d.clave); continue }
    // ordenar y sacar fichadas repetidas (≤ 2 min de la anterior)
    const ms = [...new Set(d.marcas)].sort()
    const limpias: string[] = []
    for (const m of ms) {
      const ant = limpias[limpias.length - 1]
      if (ant && duracion(ant, m) <= 2) continue
      limpias.push(m)
    }
    const pares: string[] = []
    let min = 0
    for (let i = 0; i + 1 < limpias.length; i += 2) {
      pares.push(`${limpias[i]}-${limpias[i + 1]}`)
      min += duracion(limpias[i], limpias[i + 1])
    }
    resultados.push({
      legajo: e.legajo, fecha: d.fecha, local: e.local, marcas: limpias.map((m) => (d.manuales?.includes(m) ? `${m}M` : m)).join(' '),
      horario: pares.join(' ') || null, horas: Math.round((min / 60) * 100) / 100, incompleta: limpias.length % 2 === 1,
    })
  }
  // un legajo puede venir con dos claves el mismo día (ID y nombre): se juntan
  const unico = new Map<string, Resultado>()
  for (const r of resultados) {
    const k = `${r.legajo}|${r.fecha}`
    const ya = unico.get(k)
    if (!ya || r.marcas.length > ya.marcas.length) unico.set(k, r)
  }
  return { resultados: [...unico.values()], sinLegajo: [...sin].sort() }
}
