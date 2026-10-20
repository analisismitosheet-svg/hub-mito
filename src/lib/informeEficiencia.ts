/**
 * Informe "Eficiencia mayorista" para WhatsApp (imagen): la repo del día con el
 * cuadro por local y el tiempo real en piso por empleado. Mismos cálculos que
 * la pantalla (EstadisticaVtd.tsx y EstadisticasRendimiento.tsx).
 *
 * Acá no hay red: recibe las filas ya leídas (las lee informesServidor.ts con
 * service role) y devuelve los bloques de la imagen.
 */
import type { BloqueImagen } from './informesImagen.js'

/** Fila de la RPC estadistica_vtd (por repo y local). */
export interface FilaVtd {
  lote_id: string
  fecha: string
  venta_fecha: string | null
  lote_estado: string | null
  local: string
  venta: number
  repo: number
  faltante: number
  segundos: number
  uni_crono: number
  responsable: string | null
  responsable_id: string | null
  /** Reloj de la fila: primer escaneo (aceptado) y último (hecho) */
  inicio: string | null
  fin: string | null
}

/** Fila de vw_tiempos_piso con el legajo y el nombre del empleado. */
export interface FilaPiso {
  empleado_id: string | null
  legajo: string | null
  nombre: string | null
  repos: number
  unidades: number
  segundos: number
  pendientes_fin: number
}

/** Avance de la venta diaria (RPC avance_vtd_rep, motivo VTD). */
export interface AvanceVtd {
  unidades: number
  unidades_ok: number
  no_mandados: number
}

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: unknown) => Number(v) || 0

/** dd/mm/aaaa */
export const corta = (s: string | null | undefined) => {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
/** Segundos como horas y minutos: 8 min · 1 h 40 min */
const hm = (seg: number) => {
  if (!seg || seg <= 0) return '—'
  const min = Math.round(seg / 60)
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}
const tit = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()
/** "LOPEZ MARCHESINI KAI" -> "Lopez Kai" (apellido + último nombre, para no confundir hermanos) */
const nombreCorto = (n: string | null) => {
  if (!n) return '—'
  const p = n.trim().split(/\s+/)
  return p.length > 1 ? `${tit(p[0])} ${tit(p[p.length - 1])}` : tit(p[0])
}
/** "MALDONADO RODRIGO ALEJANDRO" -> "Maldonado Rodrigo Alejandro" */
const nombreTitulo = (n: string | null) => (n ? n.trim().split(/\s+/).map(tit).join(' ') : '—')
const prendasHs = (seg: number, uni: number) => (seg > 0 ? n2.format(uni / (seg / 3600)) : '—')
/** Reloj de la repo: del primer escaneo al último, sin sumar a las personas que trabajan en paralelo. */
const relojSeg = (filas: FilaVtd[]) => {
  let ini: number | null = null
  let fin: number | null = null
  for (const f of filas) {
    const i = f.inicio ? new Date(f.inicio).getTime() : null
    const x = f.fin ? new Date(f.fin).getTime() : null
    if (i != null && (ini == null || i < ini)) ini = i
    if (x != null && (fin == null || x > fin)) fin = x
  }
  return ini != null && fin != null && fin > ini ? Math.round((fin - ini) / 1000) : 0
}
/** Lo no mandado: si la repo terminó, todo lo que no salió; si no, lo marcado como faltante. */
const noMandadosDe = (f: FilaVtd) => (f.lote_estado === 'finalizado' ? Math.max(0, num(f.venta) - num(f.repo)) : num(f.faltante))

/** % mandado / no mandado como en la pantalla (cuando no queda nada pendiente suman 100). */
export function porcentajes(total: number, ok: number, no: number) {
  if (total <= 0) return { ok: 0, no: 0, terminado: false }
  const terminado = ok + no >= total
  const pNo = Math.round((no / total) * 100)
  const pOk = terminado ? 100 - pNo : Math.min(100 - pNo, Math.floor((ok / total) * 100))
  return { ok: pOk, no: pNo, terminado }
}

const pctTxt = (p: { ok: number; no: number }) => (p.no > 0 ? `${p.ok}% + ${p.no}%` : `${p.ok}%`)

export function bloquesEficiencia(datos: { fecha: string; vtd: FilaVtd[]; piso: FilaPiso[]; avance: AvanceVtd | null }): {
  subtitulo: string
  bloques: BloqueImagen[]
} {
  const filas = datos.vtd.filter((f) => f.fecha === datos.fecha)
  const ventaFecha = filas.find((f) => f.venta_fecha)?.venta_fecha ?? null
  // HS total = reloj de la repo (del primer al último escaneo), no la suma de los cronómetros
  const reloj = relojSeg(filas)

  // Totales del día (KPIs de la pantalla)
  const tot = filas.reduce(
    (s, f) => ({
      venta: s.venta + num(f.venta),
      repo: s.repo + num(f.repo),
      no: s.no + noMandadosDe(f),
      seg: s.seg + num(f.segundos),
      uni: s.uni + num(f.uni_crono),
    }),
    { venta: 0, repo: 0, no: 0, seg: 0, uni: 0 },
  )
  const personas = new Set(filas.map((f) => f.responsable_id).filter(Boolean)).size
  const av = datos.avance ? porcentajes(num(datos.avance.unidades), num(datos.avance.unidades_ok), num(datos.avance.no_mandados)) : porcentajes(tot.venta, tot.repo, tot.no)

  const bloques: BloqueImagen[] = []
  if (!filas.length) {
    bloques.push({ tipo: 'texto', texto: `No hay repo cargada el ${corta(datos.fecha)}.` })
  } else {
    bloques.push({
      tipo: 'kpis',
      items: [
        { titulo: 'Cant venta', valor: n0.format(tot.venta), pie: `avance ${pctTxt(av)}`, color: '#16a34a' },
        { titulo: 'Cant repo', valor: n0.format(tot.repo), pie: tot.venta ? `${Math.round((tot.repo / tot.venta) * 100)}% de la venta` : '—', color: '#0284c7' },
        { titulo: 'No mandados', valor: n0.format(tot.no), pie: tot.venta ? `${n2.format((tot.no / tot.venta) * 100)}% de la venta` : '—', color: '#dc2626' },
        { titulo: 'HS total', valor: hm(reloj), pie: reloj ? `${prendasHs(reloj, tot.uni)} prendas/HS` : 'sin cronómetro', color: '#7c3aed' },
        { titulo: 'Personas', valor: String(personas), pie: 'trabajaron la repo', color: '#d97706' },
      ],
    })

    // Por local (orden alfabético, como la pantalla) + fila de total
    const porLocal = new Map<string, { venta: number; repo: number; no: number; seg: number; uni: number; resp: Set<string> }>()
    for (const f of filas) {
      let r = porLocal.get(f.local)
      if (!r) porLocal.set(f.local, (r = { venta: 0, repo: 0, no: 0, seg: 0, uni: 0, resp: new Set() }))
      r.venta += num(f.venta)
      r.repo += num(f.repo)
      r.no += noMandadosDe(f)
      r.seg += num(f.segundos)
      r.uni += num(f.uni_crono)
      if (f.responsable) r.resp.add(nombreCorto(f.responsable))
    }
    const locales = [...porLocal.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    bloques.push({ tipo: 'seccion', texto: 'Por local', color: '#0ea5e9' })
    bloques.push({
      tipo: 'tabla',
      columnas: ['Local', 'Responsable', 'Venta', 'Repo', 'No mand.', 'Avance', 'Horas', 'Prend/HS'],
      anchos: [1.1, 2.1, 0.8, 0.8, 1, 1.3, 1.2, 1],
      alinear: ['izq', 'izq', 'der', 'der', 'der', 'der', 'der', 'der'],
      colores: [null, '#475569', '#16a34a', null, '#dc2626', null, null, null],
      total: true,
      filas: [
        ...locales.map(([local, r]) => [
          local,
          [...r.resp].join(', ') || '—',
          n0.format(r.venta),
          n0.format(r.repo),
          r.no ? n0.format(r.no) : '—',
          pctTxt(porcentajes(r.venta, r.repo, r.no)),
          hm(r.seg),
          prendasHs(r.seg, r.uni),
        ]),
        ['TOTAL', `${locales.length} locales`, n0.format(tot.venta), n0.format(tot.repo), tot.no ? n0.format(tot.no) : '—', pctTxt(av), hm(reloj), prendasHs(reloj, tot.uni)],
      ],
    })
  }

  // Tiempo real en piso (por empleado, más unidades primero)
  const porEmp = new Map<string, FilaPiso>()
  for (const p of datos.piso) {
    if (!p.empleado_id) continue
    const e = porEmp.get(p.empleado_id)
    if (!e) porEmp.set(p.empleado_id, { ...p, repos: num(p.repos), unidades: num(p.unidades), segundos: num(p.segundos), pendientes_fin: num(p.pendientes_fin) })
    else {
      e.repos += num(p.repos)
      e.unidades += num(p.unidades)
      e.segundos += num(p.segundos)
      e.pendientes_fin += num(p.pendientes_fin)
    }
  }
  const emps = [...porEmp.values()].sort((a, b) => b.unidades - a.unidades)
  bloques.push({ tipo: 'seccion', texto: 'Tiempo real en piso', color: '#10b981' })
  if (!emps.length) {
    bloques.push({ tipo: 'texto', texto: 'Nadie usó el cronómetro de Mi repo ese día.' })
  } else {
    bloques.push({
      tipo: 'tabla',
      columnas: ['Empleado', 'Repos', 'Unidades', 'Tiempo real', 'Unid/h', 'Faltaron'],
      anchos: [3.4, 0.8, 1, 1.3, 0.9, 0.9],
      alinear: ['izq', 'der', 'der', 'der', 'der', 'der'],
      filas: emps.map((e) => [
        `${e.legajo ? `#${e.legajo} ` : ''}${nombreTitulo(e.nombre)}`,
        n0.format(e.repos),
        n0.format(e.unidades),
        hm(e.segundos),
        e.segundos > 0 ? (e.unidades / (e.segundos / 3600)).toFixed(1) : '—',
        e.pendientes_fin ? n0.format(e.pendientes_fin) : '—',
      ]),
    })
  }

  const estado = av.terminado ? 'repo completa' : `avance ${pctTxt(av)}`
  return {
    subtitulo: `Repo del ${corta(datos.fecha)}${ventaFecha ? ` · venta ${corta(ventaFecha)}` : ''} · ${estado}`,
    bloques,
  }
}
