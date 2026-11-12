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
  /** Objetivo del mes de objetivos entero (26 al 25) por local */
  objetivoMes?: Map<string, number>
  /** Venta acumulada del mes de objetivos hasta el día del informe, por local */
  ventaMes?: Map<string, number>
  /** Objetivo del mes de objetivos sumado hasta el día del informe: da el color de «% obj. mes» */
  objetivoMesAlDia?: Map<string, number>
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

export function bloquesConversion(d: DatosConversion): { subtitulo: string; bloques: BloqueImagen[]; texto: string; ancho?: number } {
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

  const bloques: BloqueImagen[] = []
  if (!filas.length) {
    const texto = `Tasa de conversión del ${corta(d.fecha)}: las cámaras no contaron entradas hoy.`
    return { subtitulo, bloques: [{ tipo: 'texto', texto }], texto }
  }

  const ent = filas.reduce((s, f) => s + f.entradas, 0)
  const tk = filas.reduce((s, f) => s + f.tickets, 0)
  // Comparación justa: los mismos locales, y solo si la semana pasada también contaron
  const conAnt = filas.filter((f) => (d.entradasAntes.get(f.local) ?? 0) > 0)
  const entAnt = conAnt.reduce((s, f) => s + (d.entradasAntes.get(f.local) ?? 0), 0)
  const tkAnt = conAnt.reduce((s, f) => s + (d.ventasAntes.get(f.local)?.tickets ?? 0), 0)
  const convTot = conv(tk, ent)
  const convAntTot = conAnt.length ? conv(tkAnt, entAnt) : null

  // Objetivo del día (Locales → Objetivo) al lado del facturado, con la diferencia
  const conObj = Boolean(d.objetivos?.size)
  const obj = (local: string) => d.objetivos?.get(local)
  /** verde si llegó, ámbar desde el 80%, rojo abajo (igual que la pantalla) */
  const colorDif = (v: number, o: number) => (v >= o ? '#16a34a' : o > 0 && v / o >= 0.8 ? '#d97706' : '#dc2626')
  const difTxt = (n: number) => `${n >= 0 ? '+' : '-'}${pesos(Math.abs(n))}`

  // Locales sin cámara: van en la misma tabla, con «-» en entradas y conversión
  const conCamara = new Set(filas.map((f) => f.local))
  const sinCamara = [...new Set([...(d.objetivos?.keys() ?? []), ...(d.ventasDia?.keys() ?? [])])]
    .filter((l) => !conCamara.has(l) && !LOCALES_FUERA_DEL_CONTADOR.has(l))
  type Fila = { local: string; nombre: string; entradas: number | null; tickets: number; total: number; conv: number | null }
  const todas: Fila[] = [
    ...filas.map((f) => ({ ...f, nombre: (f.nombre || f.local).toUpperCase() })),
    ...sinCamara.map((local) => ({
      local, nombre: (d.nombres[local] || local).toUpperCase(), entradas: null, conv: null,
      tickets: d.ventas.get(local)?.tickets ?? 0, total: d.ventasDia?.get(local) ?? d.ventas.get(local)?.total ?? 0,
    })),
  ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))

  const tkTodos = todas.reduce((s, f) => s + f.tickets, 0)
  const totTodos = todas.reduce((s, f) => s + f.total, 0)
  const conObjetivo = todas.filter((f) => obj(f.local) != null)
  const objTot = conObjetivo.reduce((s, f) => s + (obj(f.local) ?? 0), 0)
  const factObjTot = conObjetivo.reduce((s, f) => s + f.total, 0)
  const avanceObj = objTot > 0 ? (100 * factObjTot) / objTot : null

  bloques.push({
    tipo: 'kpis',
    items: [
      { titulo: 'Conversión', valor: pct(convTot), pie: convAntTot != null ? `${puntos(convTot, convAntTot)} vs ${diaCorto(d.antes)} (${pct(convAntTot)})` : 'sin semana anterior para comparar', color: '#16a34a' },
      { titulo: 'Entradas', valor: nf(ent), pie: `${filas.length} local${filas.length === 1 ? '' : 'es'} con cámara`, color: '#2563eb' },
      { titulo: 'Tickets', valor: nf(tkTodos), pie: tkTodos ? `ticket promedio ${pesos(totTodos / tkTodos)}` : 'sin ventas', color: '#7c3aed' },
      {
        titulo: '% del objetivo', valor: pct(avanceObj),
        pie: avanceObj != null ? `${pesos(factObjTot)} de ${pesos(objTot)}` : 'sin objetivos cargados',
        color: avanceObj != null ? colorDif(factObjTot, objTot) : '#ea580c',
      },
    ],
  })

  bloques.push({ tipo: 'seccion', texto: 'Por local', color: '#16a34a' })
  /** En la imagen «CAPTAIN FIN» va como «CF» («RIVERA INDARTE» → «R. INDARTE», «GENERAL PAZ» → «GRAL. PAZ») para que entre el nombre */
  const nombreCorto = (n: string) => n.replace(/^CAPTAIN FIN/, 'CF').replace('RIVERA INDARTE', 'R. INDARTE').replace(/^GENERAL PAZ/, 'GRAL. PAZ')
  /** Cuánto arriba o abajo del objetivo quedó: «+33%» (facturó 133%) o «-3%» (facturó 97%) */
  const desvio = (v: number, o: number | undefined, dec = 0) => {
    if (!o) return '—'
    const p = (100 * v) / o - 100
    return `${p >= 0 ? '+' : '-'}${nf(Math.abs(p), dec)}%`
  }
  /** % completado del objetivo del mes («40%») */
  const completado = (v: number | undefined, o: number | undefined) => (o && v != null ? `${nf((100 * v) / o)}%` : '—')
  // Mes de objetivos (26 al 25): venta acumulada hasta el día y objetivo del mes entero
  const conMes = Boolean(d.objetivoMes?.size)
  const acumMes = (local: string) => d.ventaMes?.get(local)
  const objMes = (local: string) => d.objetivoMes?.get(local)
  const acumMesTot = todas.reduce((s, f) => s + (acumMes(f.local) ?? 0), 0)
  const objMesTot = todas.reduce((s, f) => s + (objMes(f.local) ?? 0), 0)
  // Color del mes: lo acumulado contra lo que pedía el objetivo hasta hoy (no contra el mes entero)
  const objAlDia = (local: string) => d.objetivoMesAlDia?.get(local)
  const colorMes = (v: number | undefined, o: number | undefined) => (v != null && o ? colorDif(v, o) : null)
  const conAlDia = todas.filter((f) => objAlDia(f.local) != null)
  const colorMesTot = colorMes(conAlDia.reduce((s, f) => s + (acumMes(f.local) ?? 0), 0), conAlDia.reduce((s, f) => s + (objAlDia(f.local) ?? 0), 0))
  const fila = (f: Fila) => {
    const o = obj(f.local)
    const am = acumMes(f.local)
    const om = objMes(f.local)
    return [
      nombreCorto(f.nombre),
      f.entradas != null ? nf(f.entradas) : '-', nf(f.tickets), f.entradas != null ? pct(f.conv) : '-', pesos(f.total),
      ...(conObj ? [o != null ? pesos(o) : '—', desvio(f.total, o), o != null ? difTxt(f.total - o) : '—'] : []),
      f.tickets ? pesos(f.total / f.tickets) : '—',
      ...(conMes ? [am != null ? pesos(am) : '—', completado(am, om)] : []),
    ]
  }
  const filaTot = [
    'Total', nf(ent), nf(tkTodos), pct(convTot), pesos(totTodos),
    ...(conObj ? [pesos(objTot), conObjetivo.length ? desvio(factObjTot, objTot, 1) : '—', conObjetivo.length ? difTxt(factObjTot - objTot) : '—'] : []),
    tkTodos ? pesos(totTodos / tkTodos) : '—',
    ...(conMes ? [pesos(acumMesTot), objMesTot ? pct((100 * acumMesTot) / objMesTot) : '—'] : []),
  ]
  bloques.push({
    tipo: 'tabla',
    // Con objetivo son 9 columnas en 1000 px: «Conv.» abreviado para que entren los montos
    columnas: ['Local', 'Entradas', 'Tickets', conObj ? 'Conv.' : 'Conversión', 'Facturado', ...(conObj ? ['Objetivo', '% obj.', 'Diferencia'] : []), conObj ? 'Promedio' : 'Ticket prom.', ...(conMes ? ['Acum. mes', '% obj. mes'] : [])],
    anchos: [...(conObj ? [conMes ? 19 : 17.5, 8.5, 7.5, 6, 12.5, 12.5, 6.5, conMes ? 14 : 12.5, 9.5] : [24, 10, 10, 12, 16, 14]), ...(conMes ? [16, 10] : [])],
    alinear: ['izq', 'der', 'der', 'der', 'der', ...(conObj ? (['der', 'der', 'der'] as const) : []), 'der', ...(conMes ? (['der', 'der'] as const) : [])],
    colores: [null, '#2563eb', '#7c3aed', '#16a34a', null, ...(conObj ? ['#475569', null, null] : []), '#475569', ...(conMes ? [null, null] : [])],
    ...(conObj
      ? {
          coloresCelda: [
            ...todas.map((f) => { const o = obj(f.local); const c = o != null ? colorDif(f.total, o) : null; return [null, null, null, null, null, null, c, c, null, null, colorMes(acumMes(f.local), objAlDia(f.local))] }),
            (() => { const c = conObjetivo.length ? colorDif(factObjTot, objTot) : null; return [null, null, null, null, null, null, c, c, null, null, colorMesTot] })(),
          ],
        }
      : {}),
    total: true,
    filas: [...todas.map(fila), filaTot],
  })

  const texto = [
    `*Tasa de conversión* — ${corta(d.fecha)}`,
    `Total: ${pct(convTot)} (${nf(tk)} tickets / ${nf(ent)} entradas en locales con cámara)${convAntTot != null ? ` · ${puntos(convTot, convAntTot)} vs ${diaCorto(d.antes)}` : ''}`,
    ...(avanceObj != null ? [`Objetivo: ${pct(avanceObj)} (${pesos(factObjTot)} de ${pesos(objTot)})`] : []),
    ...(conMes && objMesTot ? [`Mes: ${pesos(acumMesTot)} acumulado, ${pct((100 * acumMesTot) / objMesTot)} del objetivo del mes`] : []),
    '',
    ...todas.map((f) => { const o = obj(f.local); return `• ${f.nombre}: ${f.entradas != null ? `${pct(f.conv)} (${nf(f.tickets)}/${nf(f.entradas)})` : `sin cámara (${nf(f.tickets)} tickets)`} · ${pesos(f.total)}${o != null ? ` (obj. ${pesos(o)}, ${desvio(f.total, o)}, ${difTxt(f.total - o)})` : ''}${completado(acumMes(f.local), objMes(f.local)) !== '—' ? ` · mes ${completado(acumMes(f.local), objMes(f.local))}` : ''}` }),
  ].join('\n')
  // Con las columnas del mes son 11: la imagen va más ancha para que entren los montos enteros
  return { subtitulo, bloques, texto, ancho: conMes ? 1300 : undefined }
}
