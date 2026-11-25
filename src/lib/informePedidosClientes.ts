/**
 * Informe «Estado de pedidos de clientes» (Envío informes y reportes → Datos de la app).
 * Pedido por Facundo (25/11/2026), variante A del mockup
 * mockups/informe-estado-pedidos-clientes.html: una fila por cliente, lo atrasado arriba.
 *
 * Entran los pedidos de venta de clientes mayoristas (motivo vacío: sin VTD ni REP,
 * que son de locales), no anulados, que:
 *   - se cargaron el día del informe, o
 *   - siguen abiertos (sin armado, sin tomar o armándose) y son de los últimos 7 días, o
 *   - se terminaron de armar ese día (mayorista_armados.hecho_at).
 * Solo servidor (lo usa informesServidor).
 */
import type { BloqueImagen } from './informesImagen.js'

export type EstadoPedidoCliente = 'sin_armado' | 'pendiente' | 'aceptado' | 'hecho'

export interface PedidoCliente {
  numero: number | null
  cliente: string
  cliente_nombre: string | null
  fecha: string
  unidades: number
  total: number
  estado: EstadoPedidoCliente
  prioridad: string | null
  /** quién lo tomó / lo armó */
  nombre: string | null
  unidades_ok: number
  faltantes: number
  /** legajo o nombre de quien lo soltó (si lo soltaron) */
  liberado_nombre: string | null
}

export interface DatosPedidosClientes {
  fecha: string
  hora: string
  pedidos: PedidoCliente[]
}

/** Ancho de la imagen: a 1000 px se cortaban los nombres largos y las notas */
const ANCHO = 1250

/** Días hacia atrás que se miran los pedidos que siguen abiertos */
export const DIAS_ABIERTOS = 7

const nf = (n: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)
const corta = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}` }
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const diaLargo = (s: string) => { const [y, m, d] = s.split('-').map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${corta(s)}` }

/** Lo peor manda: un cliente con un pedido sin tomar figura «sin tomar» aunque tenga otros terminados */
const RANGO: Record<EstadoPedidoCliente, number> = { sin_armado: 0, pendiente: 1, aceptado: 2, hecho: 3 }
const COLOR = { sin_armado: '#7c3aed', pendiente: '#d97706', aceptado: '#2563eb', hecho: '#16a34a', gris: '#64748b', rojo: '#dc2626' }

/** «JOSE LUIS NASTA» → «Jose Luis Nasta»; deja S.A.S., S.R.L., SRL en mayúsculas */
function nombreLindo(s: string | null): string {
  const t = (s ?? '').trim()
  if (!t) return ''
  return t
    .toLowerCase()
    .split(/\s+/)
    // siglas (S.A.S., SRL, FGF) quedan en mayúsculas; «de», «la», «y» en minúscula
    .map((p) =>
      /^(de|del|la|las|los|y|e)$/.test(p)
        ? p
        : /^(s\.?a\.?s?\.?|s\.?r\.?l\.?|mito)$/.test(p) || (p.length <= 3 && !/[aeiou]/.test(p.slice(1)))
          ? p.toUpperCase()
          : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(' ')
}
/** «LESCANO CINDY AYELEN» → «Lescano» (el apellido alcanza en la tabla) */
const apellido = (s: string) => nombreLindo(s.split(/\s+/)[0] ?? s)

interface FilaCliente {
  cliente: string
  nombre: string
  pedidos: PedidoCliente[]
  peor: EstadoPedidoCliente
  unidades: number
  total: number
}

function porCliente(pedidos: PedidoCliente[]): FilaCliente[] {
  const m = new Map<string, FilaCliente>()
  for (const p of pedidos) {
    let f = m.get(p.cliente)
    if (!f) {
      f = { cliente: p.cliente, nombre: nombreLindo(p.cliente_nombre) || p.cliente, pedidos: [], peor: 'hecho', unidades: 0, total: 0 }
      m.set(p.cliente, f)
    }
    f.pedidos.push(p)
    f.unidades += p.unidades
    f.total += p.total
    if (RANGO[p.estado] < RANGO[f.peor]) f.peor = p.estado
  }
  return [...m.values()].sort((a, b) => RANGO[a.peor] - RANGO[b.peor] || b.unidades - a.unidades || a.cliente.localeCompare(b.cliente))
}

/** Texto de la columna Estado de un cliente */
function estadoCliente(f: FilaCliente): { texto: string; color: string } {
  const n = f.pedidos.length
  const cuenta = (e: EstadoPedidoCliente) => f.pedidos.filter((p) => p.estado === e).length
  const hechos = cuenta('hecho')
  const parcial = n > 1 && hechos > 0 && hechos < n ? ` (${hechos} de ${n} terminados)` : ''
  switch (f.peor) {
    case 'sin_armado':
      return { texto: `Sin pedir armado${parcial}`, color: COLOR.sin_armado }
    case 'pendiente': {
      const prios = new Set(f.pedidos.filter((p) => p.estado === 'pendiente').map((p) => p.prioridad || 'normal'))
      const prio = prios.has('urgente') ? 'urgente' : prios.has('normal') ? 'normal' : 'baja'
      return { texto: `Sin tomar · ${prio}${parcial}`, color: COLOR.pendiente }
    }
    case 'aceptado': {
      const enCurso = f.pedidos.filter((p) => p.estado === 'aceptado')
      const ok = enCurso.reduce((s, p) => s + p.unidades_ok, 0)
      const tot = enCurso.reduce((s, p) => s + p.unidades, 0)
      return { texto: `Armándose ${nf(ok)}/${nf(tot)} u.${parcial}`, color: COLOR.aceptado }
    }
    default:
      return { texto: 'Terminado', color: COLOR.hecho }
  }
}

/** Debajo del estado: quién, si lo soltaron, faltantes */
function detalleCliente(f: FilaCliente): string {
  const partes: string[] = []
  const quienes = [...new Set(f.pedidos.filter((p) => p.nombre && p.estado !== 'pendiente').map((p) => apellido(p.nombre!)))]
  if (quienes.length) partes.push(quienes.join(', '))
  const soltados = f.pedidos.filter((p) => p.estado === 'pendiente' && p.liberado_nombre)
  if (soltados.length) partes.push(`${soltados.length === 1 ? 'soltó' : `${soltados.length} soltados:`} ${[...new Set(soltados.map((p) => /^\d+$/.test(p.liberado_nombre!) ? `leg. ${p.liberado_nombre}` : apellido(p.liberado_nombre!)))].join(', ')}`)
  const falt = f.pedidos.reduce((s, p) => s + (p.estado === 'hecho' ? p.faltantes : 0), 0)
  if (falt) partes.push(`${falt === 1 ? 'falta' : 'faltan'} ${nf(falt)} u.`)
  return partes.join(' · ')
}

export function bloquesPedidosClientes(d: DatosPedidosClientes): { subtitulo: string; bloques: BloqueImagen[]; texto: string; ancho: number } {
  const subtitulo = `Pedidos mayoristas del ${diaLargo(d.fecha)} y abiertos de los últimos ${DIAS_ABIERTOS} días · corte ${d.hora}`
  const ps = d.pedidos
  if (!ps.length) {
    const texto = `Pedidos de clientes del ${corta(d.fecha)}: no hay pedidos cargados hoy ni abiertos. 🎉`
    return { subtitulo, bloques: [{ tipo: 'texto', texto }], texto, ancho: ANCHO }
  }

  const de = (e: EstadoPedidoCliente) => ps.filter((p) => p.estado === e)
  const u = (xs: PedidoCliente[]) => xs.reduce((s, p) => s + p.unidades, 0)
  const clientes = porCliente(ps)
  const hechos = de('hecho')
  const faltTot = hechos.reduce((s, p) => s + p.faltantes, 0)
  const enCurso = de('aceptado')

  const kpis: Extract<BloqueImagen, { tipo: 'kpis' }>['items'] = [
    { titulo: 'Pedidos', valor: nf(ps.length), pie: `${clientes.length} clientes · ${nf(u(ps))} u.`, color: COLOR.gris },
    { titulo: 'Terminados', valor: nf(hechos.length), pie: `${nf(u(hechos))} u.${faltTot ? ` · ${nf(faltTot)} faltante${faltTot === 1 ? '' : 's'}` : ''}`, color: COLOR.hecho },
  ]
  if (enCurso.length) kpis.push({ titulo: 'Armándose', valor: nf(enCurso.length), pie: `${nf(u(enCurso))} u.`, color: COLOR.aceptado })
  kpis.push({ titulo: 'Sin tomar', valor: nf(de('pendiente').length), pie: `${nf(u(de('pendiente')))} u.`, color: COLOR.pendiente })
  kpis.push({ titulo: 'Sin pedir armado', valor: nf(de('sin_armado').length), pie: `${nf(u(de('sin_armado')))} u.`, color: COLOR.sin_armado })

  const filas: string[][] = []
  const coloresCelda: Array<Array<string | null> | null> = []
  for (const f of clientes) {
    const est = estadoCliente(f)
    const det = detalleCliente(f)
    filas.push([`${f.cliente} ${f.nombre}`, nf(f.pedidos.length), nf(f.unidades), nf(f.total), est.texto, det])
    coloresCelda.push([null, null, null, null, est.color, det.includes('falta') || det.includes('solt') ? COLOR.rojo : COLOR.gris])
  }
  filas.push(['Total', nf(ps.length), nf(u(ps)), nf(ps.reduce((s, p) => s + p.total, 0)), '', ''])
  coloresCelda.push(null)

  const bloques: BloqueImagen[] = [
    { tipo: 'kpis', items: kpis },
    {
      tipo: 'tabla',
      columnas: ['Cliente', 'Ped.', 'Unid.', '$', 'Estado', 'Quién / nota'],
      filas,
      alinear: ['izq', 'der', 'der', 'der', 'izq', 'izq'],
      anchos: [3.4, 0.6, 0.8, 1.4, 2.4, 2.6],
      coloresCelda,
      total: true,
    },
  ]

  // Texto (formato texto o caption): lo que falta arriba, después los terminados
  const linea = (f: FilaCliente) => {
    const det = detalleCliente(f)
    return `• ${f.nombre} — ${f.pedidos.length} ped. · ${nf(f.unidades)} u. · ${estadoCliente(f).texto}${det ? ` (${det})` : ''}`
  }
  const abiertos = clientes.filter((f) => f.peor !== 'hecho')
  const listos = clientes.filter((f) => f.peor === 'hecho')
  const texto = [
    `*Pedidos de clientes · ${diaLargo(d.fecha)}*`,
    `📦 ${ps.length} pedidos · ${clientes.length} clientes · ${nf(u(ps))} u.`,
    `✅ Terminados: ${hechos.length} · 🔵 Armándose: ${enCurso.length} · ⏳ Sin tomar: ${de('pendiente').length} · 📝 Sin pedir armado: ${de('sin_armado').length}`,
    abiertos.length ? `\n*Falta terminar*\n${abiertos.map(linea).join('\n')}` : '',
    listos.length ? `\n*Terminados*\n${listos.map(linea).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subtitulo, bloques, texto, ancho: ANCHO }
}
