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
/** «lun 13/10» */
const diaCorto = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` }
function variacion(act: number, ant: number): string {
  if (ant <= 0) return '—'
  const p = ((act - ant) / ant) * 100
  return `${p >= 0 ? '+' : '-'}${nf(Math.abs(p))}%` // sin ▲▼: la fuente de la imagen no los tiene
}

export function bloquesKm(datos: { fecha: string; hoy: FilaKmInforme[]; ayer: FilaKmInforme[]; ayerFecha?: string | null; vehiculos: VehiculoInforme[] }): {
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

  const texto = [
    `*Km recorridos del transporte — ${corta(datos.fecha)}*`,
    kmHoy > 0 ? `Total: ${fmtKm(kmHoy)}${datos.ayerFecha ? ` (${variacion(kmHoy, kmAyer)} vs ${diaCorto(datos.ayerFecha)})` : ''} · andando ${hm(mov)}` : 'Sin recorridos con GPS.',
    ...filas.filter((x) => x.km > 0).map((x) => `• ${x.v.nombre}: ${fmtKm(x.km)} · ${hm(x.mov)}`),
  ].join('\n')

  return { subtitulo, bloques, texto }
}
