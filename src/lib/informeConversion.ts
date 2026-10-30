/**
 * Informe «Tasa de conversión» (Envío informes y reportes → Datos de la app).
 * Mismos números que Locales > Tasa de conversión: entradas que contó la cámara
 * (contador_visitas) contra los tickets de la vista de ventas (config_app
 * 'contador_vista_ventas', hoy vw_ventas_TICKET). Solo cuentan los locales con
 * cámara y entradas ese día: sin conteo hay venta pero no entradas, y sumarlos
 * distorsiona el porcentaje. Se compara con el mismo día de la semana anterior.
 * Solo servidor (lo usa informesServidor).
 */
import type { BloqueImagen } from './informesImagen.js'

export interface DatosConversion {
  fecha: string
  /** fecha del mismo día de la semana anterior */
  antes: string
  /** local -> entradas del día */
  entradas: Map<string, number>
  entradasAntes: Map<string, number>
  /** local -> tickets y total facturado del día */
  ventas: Map<string, { tickets: number; total: number }>
  ventasAntes: Map<string, { tickets: number; total: number }>
  nombres: Record<string, string>
  /** Objetivo de facturación del día por local (Locales → Objetivo); sin objetivos no salen esas columnas */
  objetivos?: Map<string, number>
  /** Venta del día de todos los locales (ventas_locales_dia, vía objetivos): para los que no tienen cámara */
  ventasDia?: Map<string, number>
}

/** Locales que no van en el contador ni en la tasa de conversión (pantallas e informe) aunque tengan cámara registrada */
export const LOCALES_FUERA_DEL_CONTADOR = new Set(['MARIANOMAX'])

const nf = (n: number, dec = 0) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
const pesos = (n: number) => `$ ${nf(n)}`
const pct = (n: number | null) => (n == null ? '—' : `${nf(n, 1)}%`)
const corta = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const diaCorto = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` }
const conv = (tickets: number, entradas: number) => (entradas > 0 ? (100 * tickets) / entradas : null)
/** Diferencia en puntos porcentuales: «+2,3 pp» (sin flechas: la fuente de la imagen no las tiene) */
function puntos(act: number | null, ant: number | null): string {
  if (act == null || ant == null) return '—'
  const d = act - ant
  return `${d >= 0 ? '+' : '-'}${nf(Math.abs(d), 1)} pp`
}

export function bloquesConversion(d: DatosConversion): { subtitulo: string; bloques: BloqueImagen[]; texto: string } {
  const subtitulo = `Conversión del ${corta(d.fecha)} · vs ${diaCorto(d.antes)}`
  const filas = [...d.entradas.entries()]
    .filter(([local, e]) => e > 0 && !LOCALES_FUERA_DEL_CONTADOR.has(local))
    .map(([local, entradas]) => {
      const v = d.ventas.get(local) ?? { tickets: 0, total: 0 }
      const eAnt = d.entradasAntes.get(local) ?? 0
      const vAnt = d.ventasAntes.get(local) ?? { tickets: 0, total: 0 }
      return {
        local, nombre: d.nombres[local] || '', entradas, tickets: v.tickets, total: v.total,
        conv: conv(v.tickets, entradas), convAnt: eAnt > 0 ? conv(vAnt.tickets, eAnt) : null,
      }
    })
    .sort((a, b) => (b.conv ?? -1) - (a.conv ?? -1))

  const bloques: BloqueImagen[] = []
  if (!filas.length) {
    const texto = `Tasa de conversión del ${corta(d.fecha)}: las cámaras no contaron entradas hoy.`
    return { subtitulo, bloques: [{ tipo: 'texto', texto }], texto }
  }

  const ent = filas.reduce((s, f) => s + f.entradas, 0)
  const tk = filas.reduce((s, f) => s + f.tickets, 0)
  const tot = filas.reduce((s, f) => s + f.total, 0)
  // Comparación justa: los mismos locales, y solo si la semana pasada también contaron
  const conAnt = filas.filter((f) => (d.entradasAntes.get(f.local) ?? 0) > 0)
  const entAnt = conAnt.reduce((s, f) => s + (d.entradasAntes.get(f.local) ?? 0), 0)
  const tkAnt = conAnt.reduce((s, f) => s + (d.ventasAntes.get(f.local)?.tickets ?? 0), 0)
  const convTot = conv(tk, ent)
  const convAntTot = conAnt.length ? conv(tkAnt, entAnt) : null
  const mejor = filas[0]

  bloques.push({
    tipo: 'kpis',
    items: [
      { titulo: 'Conversión', valor: pct(convTot), pie: convAntTot != null ? `${puntos(convTot, convAntTot)} vs ${diaCorto(d.antes)} (${pct(convAntTot)})` : 'sin semana anterior para comparar', color: '#16a34a' },
      { titulo: 'Entradas', valor: nf(ent), pie: `${filas.length} local${filas.length === 1 ? '' : 'es'} con cámara`, color: '#2563eb' },
      { titulo: 'Tickets', valor: nf(tk), pie: tk ? `ticket promedio ${pesos(tot / tk)}` : 'sin ventas', color: '#7c3aed' },
      { titulo: 'Mejor local', valor: pct(mejor.conv), pie: mejor.nombre || mejor.local, color: '#ea580c' },
    ],
  })
  // Objetivo del día (Locales → Objetivo) al lado del facturado, con la diferencia
  const conObj = Boolean(d.objetivos?.size)
  const obj = (local: string) => d.objetivos?.get(local)
  /** verde si llegó, ámbar desde el 80%, rojo abajo (igual que la pantalla) */
  const colorDif = (v: number, o: number) => (v >= o ? '#16a34a' : o > 0 && v / o >= 0.8 ? '#d97706' : '#dc2626')
  const difTxt = (n: number) => `${n >= 0 ? '+' : '-'}${pesos(Math.abs(n))}`
  const conObjetivo = filas.filter((f) => obj(f.local) != null)
  const objTot = conObjetivo.reduce((s, f) => s + (obj(f.local) ?? 0), 0)
  const factObjTot = conObjetivo.reduce((s, f) => s + f.total, 0)

  bloques.push({ tipo: 'seccion', texto: 'Por local', color: '#16a34a' })
  const fila = (f: (typeof filas)[number]) => {
    const o = obj(f.local)
    return [
      f.nombre || f.local,
      nf(f.entradas), nf(f.tickets), pct(f.conv), pesos(f.total),
      ...(conObj ? [o != null ? pesos(o) : '—', o != null ? difTxt(f.total - o) : '—'] : []),
      f.tickets ? pesos(f.total / f.tickets) : '—',
    ]
  }
  const filaTot = [
    'Total', nf(ent), nf(tk), pct(convTot), pesos(tot),
    ...(conObj ? [pesos(objTot), conObjetivo.length ? difTxt(factObjTot - objTot) : '—'] : []),
    tk ? pesos(tot / tk) : '—',
  ]
  bloques.push({
    tipo: 'tabla',
    columnas: ['Local', 'Entradas', 'Tickets', 'Conversión', 'Facturado', ...(conObj ? ['Objetivo', 'Diferencia'] : []), 'Ticket prom.'],
    anchos: conObj ? [1.9, 1.05, 0.85, 1.25, 1.5, 1.45, 1.5, 1.45] : [2.4, 1, 1, 1.2, 1.6, 1.4],
    alinear: ['izq', 'der', 'der', 'der', 'der', ...(conObj ? (['der', 'der'] as const) : []), 'der'],
    colores: [null, '#2563eb', '#7c3aed', '#16a34a', null, ...(conObj ? ['#475569', null] : []), '#475569'],
    ...(conObj
      ? {
          coloresCelda: [
            ...filas.map((f) => { const o = obj(f.local); return [null, null, null, null, null, null, o != null ? colorDif(f.total, o) : null, null] }),
            [null, null, null, null, null, null, conObjetivo.length ? colorDif(factObjTot, objTot) : null, null],
          ],
        }
      : {}),
    total: true,
    filas: [...filas.map(fila), filaTot],
  })

  // Locales sin cámara: no tienen conversión, pero sí facturado contra el objetivo del día
  const conCamara = new Set(filas.map((f) => f.local))
  const sinCamara = [...new Set([...(d.objetivos?.keys() ?? []), ...(d.ventasDia?.keys() ?? [])])]
    .filter((l) => !conCamara.has(l) && !LOCALES_FUERA_DEL_CONTADOR.has(l))
    .map((local) => ({ local, nombre: (d.nombres[local] || local).toUpperCase(), total: d.ventasDia?.get(local) ?? 0, o: obj(local) }))
    .sort((a, b) => b.total - a.total)
  if (sinCamara.length) {
    const scObj = sinCamara.filter((f) => f.o != null)
    const scTot = sinCamara.reduce((s, f) => s + f.total, 0)
    const scObjTot = scObj.reduce((s, f) => s + (f.o ?? 0), 0)
    const scFactObj = scObj.reduce((s, f) => s + f.total, 0)
    const avance = (v: number, o: number | undefined) => (o ? `${nf((100 * v) / o)}%` : '—')
    bloques.push({ tipo: 'seccion', texto: 'Locales sin cámara', color: '#475569' })
    bloques.push({
      tipo: 'tabla',
      columnas: ['Local', 'Facturado', 'Objetivo', '% objetivo', 'Diferencia'],
      anchos: [2.4, 1.6, 1.6, 1.2, 1.6],
      alinear: ['izq', 'der', 'der', 'der', 'der'],
      colores: [null, null, '#475569', null, null],
      coloresCelda: [
        ...sinCamara.map((f) => { const c = f.o != null ? colorDif(f.total, f.o) : null; return [null, null, null, c, c] }),
        (() => { const c = scObj.length ? colorDif(scFactObj, scObjTot) : null; return [null, null, null, c, c] })(),
      ],
      total: true,
      filas: [
        ...sinCamara.map((f) => [f.nombre, pesos(f.total), f.o != null ? pesos(f.o) : '—', avance(f.total, f.o), f.o != null ? difTxt(f.total - f.o) : '—']),
        ['Total', pesos(scTot), scObj.length ? pesos(scObjTot) : '—', avance(scFactObj, scObjTot), scObj.length ? difTxt(scFactObj - scObjTot) : '—'],
      ],
    })
  }

  const texto = [
    `*Tasa de conversión* — ${corta(d.fecha)}`,
    `Total: ${pct(convTot)} (${nf(tk)} tickets / ${nf(ent)} entradas)${convAntTot != null ? ` · ${puntos(convTot, convAntTot)} vs ${diaCorto(d.antes)}` : ''}`,
    '',
    ...filas.map((f) => { const o = obj(f.local); return `• ${f.nombre || f.local}: ${pct(f.conv)} (${nf(f.tickets)}/${nf(f.entradas)}) · ${pesos(f.total)}${o != null ? ` (obj. ${pesos(o)}, ${difTxt(f.total - o)})` : ''}` }),
    ...(sinCamara.length ? ['', '_Sin cámara_', ...sinCamara.map((f) => `• ${f.nombre}: ${pesos(f.total)}${f.o != null ? ` (obj. ${pesos(f.o)}, ${difTxt(f.total - f.o)})` : ''}`)] : []),
  ].join('\n')
  return { subtitulo, bloques, texto }
}
