/**
 * Informe «Km recorridos del transporte» (Envío informes y reportes → Datos de la app).
 * Mismos números que Administradores > Tracking > Km recorridos (RPC tracking_km),
 * del día pedido y comparado con el día anterior. Solo servidor (lo usa informesServidor).
 */
import type { BloqueImagen } from './informesImagen.js'

export interface FilaKmInforme { vehiculo_id: string; dia: string; km: number | string; minutos_mov: number | string; primera: string; ultima: string }
export interface VehiculoInforme { id: string; nombre: string; usuario_transporte_nombre: string | null; activo: boolean }

const num = (v: unknown) => Number(v) || 0
const nf = (n: number, dec = 0) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
const fmtKm = (km: number) => `${nf(km, km < 10 ? 1 : 0)} km`
const hm = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`)
const horaAr = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
const corta = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const sumarDia = (s: string) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
/** «lun 13/10» */
const diaCorto = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` }
function variacion(act: number, ant: number): string {
  if (ant <= 0) return '—'
  const p = ((act - ant) / ant) * 100
  return `${p >= 0 ? '+' : '-'}${nf(Math.abs(p))}%` // sin ▲▼: la fuente de la imagen no los tiene
}

export function bloquesKm(datos: {
  fecha: string; hoy: FilaKmInforme[]; ayer: FilaKmInforme[]; ayerFecha?: string | null; vehiculos: VehiculoInforme[]
  semana?: { desde: string; filas: FilaKmInforme[]; anterior: FilaKmInforme[] }
}): {
  subtitulo: string
  bloques: BloqueImagen[]
  texto: string
} {
  const kmHoy = datos.hoy.reduce((s, f) => s + num(f.km), 0)
  const kmAyer = datos.ayer.reduce((s, f) => s + num(f.km), 0)
  const mov = datos.hoy.reduce((s, f) => s + num(f.minutos_mov), 0)
  const subtitulo = `Km del ${corta(datos.fecha)}`

  const filas = datos.vehiculos
    .map((v) => {
      const h = datos.hoy.find((f) => f.vehiculo_id === v.id)
      const a = datos.ayer.find((f) => f.vehiculo_id === v.id)
      return { v, km: num(h?.km), kmAyer: num(a?.km), mov: num(h?.minutos_mov), primera: h?.primera ?? null, ultima: h?.ultima ?? null }
    })
    .filter((x) => x.km > 0 || x.v.activo)
    .sort((a, b) => b.km - a.km)

  const bloques: BloqueImagen[] = []
  if (kmHoy <= 0) {
    bloques.push({ tipo: 'texto', texto: `Sin recorridos con GPS el ${corta(datos.fecha)}.` })
  } else {
    const top = filas[0]
    bloques.push({
      tipo: 'kpis',
      items: [
        { titulo: 'Km totales', valor: fmtKm(kmHoy), pie: datos.ayerFecha ? `${variacion(kmHoy, kmAyer)} vs ${diaCorto(datos.ayerFecha)} (${fmtKm(kmAyer)})` : 'sin día anterior para comparar', color: '#0d9488' },
        { titulo: 'Tiempo andando', valor: hm(mov), pie: mov ? `${nf(kmHoy / (mov / 60))} km/h de promedio` : 'en movimiento', color: '#7c3aed' },
        { titulo: 'Vehículos', valor: String(filas.filter((x) => x.km > 0).length), pie: 'con recorrido', color: '#2563eb' },
        { titulo: 'El que más anduvo', valor: top ? fmtKm(top.km) : '—', pie: top?.v.nombre ?? '', color: '#ea580c' },
      ],
    })
    bloques.push({ tipo: 'seccion', texto: 'Por vehículo', color: '#0d9488' })
    bloques.push({
      tipo: 'tabla',
      columnas: ['Vehículo', 'Km', 'Andando', 'Primera', 'Última', datos.ayerFecha ? `vs ${diaCorto(datos.ayerFecha).slice(4)}` : 'vs anterior'],
      anchos: [3, 1.1, 1.5, 1, 1, 1.1],
      alinear: ['izq', 'der', 'der', 'der', 'der', 'der'],
      colores: [null, '#0d9488', null, '#475569', '#475569', null],
      total: true,
      filas: [
        ...filas.map((x) => [
          // el chofer solo si no es el mismo nombre que el vehículo
          x.v.usuario_transporte_nombre && x.v.usuario_transporte_nombre !== x.v.nombre ? `${x.v.nombre} (${x.v.usuario_transporte_nombre})` : x.v.nombre,
          x.km > 0 ? fmtKm(x.km) : '—',
          x.mov ? hm(x.mov) : '—',
          x.primera ? horaAr(x.primera) : '—',
          x.ultima ? horaAr(x.ultima) : '—',
          variacion(x.km, x.kmAyer),
        ]),
        ['Total', fmtKm(kmHoy), hm(mov), '', '', variacion(kmHoy, kmAyer)],
      ],
    })
  }

  // Semana: del lunes hasta ese día, contra los mismos días de la semana anterior
  const sem = datos.semana
  let textoSemana = ''
  if (sem && sem.filas.some((f) => num(f.km) > 0)) {
    const kmSem = sem.filas.reduce((s, f) => s + num(f.km), 0)
    const kmSemAnt = sem.anterior.reduce((s, f) => s + num(f.km), 0)
    const movSem = sem.filas.reduce((s, f) => s + num(f.minutos_mov), 0)
    // Vehículos que anduvieron en la semana (columnas) y un renglón por día, del lunes a ese día
    const vehs = datos.vehiculos.filter((v) => sem.filas.some((f) => f.vehiculo_id === v.id && num(f.km) > 0))
    const dias: string[] = []
    for (let d = sem.desde; d <= datos.fecha; d = sumarDia(d)) dias.push(d)
    const kmDe = (veh: string, d: string) => num(sem.filas.find((f) => f.vehiculo_id === veh && f.dia === d)?.km)
    const corto = (n: string) => n.replace(/\s+TRANSPORTE$/i, '')
    const titulo = sem.desde === datos.fecha ? `Semana (lunes ${diaCorto(sem.desde).slice(4)})` : `Semana del ${diaCorto(sem.desde)} al ${diaCorto(datos.fecha)}`
    bloques.push({ tipo: 'seccion', texto: titulo, color: '#2563eb' })
    bloques.push({
      tipo: 'tabla',
      columnas: ['Día', ...vehs.map((v) => corto(v.nombre)), 'Total'],
      anchos: [1.6, ...vehs.map(() => 1.4), 1.3],
      alinear: ['izq', ...vehs.map(() => 'der' as const), 'der'],
      colores: [null, ...vehs.map(() => null), '#2563eb'],
      total: true,
      filas: [
        ...dias.map((d) => {
          const kms = vehs.map((v) => kmDe(v.id, d))
          const tot = kms.reduce((s, k) => s + k, 0)
          return [diaCorto(d), ...kms.map((k) => (k > 0 ? fmtKm(k) : '—')), tot > 0 ? fmtKm(tot) : '—']
        }),
        ['Semana', ...vehs.map((v) => fmtKm(dias.reduce((s, d) => s + kmDe(v.id, d), 0))), fmtKm(kmSem)],
      ],
    })
    bloques.push({
      tipo: 'texto',
      texto: `Andando en la semana: ${hm(movSem)}${kmSemAnt > 0 ? ` · ${variacion(kmSem, kmSemAnt)} vs los mismos días de la semana anterior (${fmtKm(kmSemAnt)})` : ''}`,
    })
    textoSemana = `\n_${titulo}:_ ${fmtKm(kmSem)}${kmSemAnt > 0 ? ` (${variacion(kmSem, kmSemAnt)} vs semana anterior)` : ''}`
  }

  const texto = [
    `*Km recorridos del transporte — ${corta(datos.fecha)}*`,
    kmHoy > 0 ? `Total: ${fmtKm(kmHoy)}${datos.ayerFecha ? ` (${variacion(kmHoy, kmAyer)} vs ${diaCorto(datos.ayerFecha)})` : ''} · andando ${hm(mov)}` : 'Sin recorridos con GPS.',
    ...filas.filter((x) => x.km > 0).map((x) => `• ${x.v.nombre}: ${fmtKm(x.km)} · ${hm(x.mov)}`),
  ].join('\n') + textoSemana

  return { subtitulo, bloques, texto }
}
