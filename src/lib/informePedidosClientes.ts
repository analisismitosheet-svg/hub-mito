/**
 * Informe «Estado de pedidos de clientes» (Envío informes y reportes → Datos de la app).
 * Pedido por Facundo (25/11/2026), variante A del mockup
 * mockups/informe-estado-pedidos-clientes.html, pero con un renglón por pedido (pedido el
 * mismo día): agrupados por cliente, el cliente más atrasado arriba.
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

/** Estado de un pedido (columna Estado) */
function estadoPedido(p: PedidoCliente): { texto: string; color: string } {
  switch (p.estado) {
    case 'sin_armado':
      return { texto: 'Sin pedir armado', color: COLOR.sin_armado }
    case 'pendiente':
      return { texto: `Sin tomar · ${p.prioridad || 'normal'}`, color: COLOR.pendiente }
    case 'aceptado':
      return { texto: `Armándose ${nf(p.unidades_ok)}/${nf(p.unidades)} u.`, color: COLOR.aceptado }
    default:
      return { texto: 'Terminado', color: COLOR.hecho }
  }
}

/** Quién lo tomó o armó, si lo soltaron, faltantes */
function notaPedido(p: PedidoCliente): string {
  const partes: string[] = []
  if (p.nombre && p.estado !== 'pendiente') partes.push(apellido(p.nombre))
  if (p.estado === 'pendiente' && p.liberado_nombre)
    partes.push(`soltó ${/^\d+$/.test(p.liberado_nombre) ? `leg. ${p.liberado_nombre}` : apellido(p.liberado_nombre)}`)
  if (p.estado === 'hecho' && p.faltantes) partes.push(`${p.faltantes === 1 ? 'falta' : 'faltan'} ${nf(p.faltantes)} u.`)
  return partes.join(' · ')
}

/** Dentro de cada cliente, primero lo atrasado y después por número */
const ordenPedidos = (xs: PedidoCliente[]) => [...xs].sort((a, b) => RANGO[a.estado] - RANGO[b.estado] || (a.numero ?? 0) - (b.numero ?? 0))
const cargado = (p: PedidoCliente, hoy: string) => (p.fecha === hoy ? 'hoy' : corta(p.fecha))

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

  // Un renglón por pedido, agrupados por cliente (el nombre va solo en el primero)
  const filas: string[][] = []
  const coloresCelda: Array<Array<string | null> | null> = []
  for (const f of clientes) {
    ordenPedidos(f.pedidos).forEach((p, i) => {
      const est = estadoPedido(p)
      const nota = notaPedido(p)
      filas.push([i === 0 ? `${f.cliente} ${f.nombre}` : '', String(p.numero ?? '—'), cargado(p, d.fecha), nf(p.unidades), nf(p.total), est.texto, nota])
      coloresCelda.push([null, null, COLOR.gris, null, null, est.color, /falta|solt/.test(nota) ? COLOR.rojo : COLOR.gris])
    })
  }
  filas.push(['Total', `${nf(ps.length)} ped.`, '', nf(u(ps)), nf(ps.reduce((s, p) => s + p.total, 0)), '', ''])
  coloresCelda.push(null)

  const bloques: BloqueImagen[] = [
    { tipo: 'kpis', items: kpis },
    {
      tipo: 'tabla',
      columnas: ['Cliente', 'N°', 'Cargado', 'Unid.', '$', 'Estado', 'Quién / nota'],
      filas,
      alinear: ['izq', 'izq', 'izq', 'der', 'der', 'izq', 'izq'],
      anchos: [3.2, 0.8, 0.9, 0.7, 1.3, 2.3, 2.0],
      coloresCelda,
      total: true,
    },
  ]

  // Texto (formato texto o caption): cada cliente con sus pedidos; lo que falta arriba
  const bloqueCliente = (f: FilaCliente) =>
    [
      `• ${f.nombre}`,
      ...ordenPedidos(f.pedidos).map((p) => {
        const nota = notaPedido(p)
        return `   N° ${p.numero ?? '—'} (${cargado(p, d.fecha)}) · ${nf(p.unidades)} u. · ${estadoPedido(p).texto}${nota ? ` (${nota})` : ''}`
      }),
    ].join('\n')
  const abiertos = clientes.filter((f) => f.peor !== 'hecho')
  const listos = clientes.filter((f) => f.peor === 'hecho')
  const texto = [
    `*Pedidos de clientes · ${diaLargo(d.fecha)}*`,
    `📦 ${ps.length} pedidos · ${clientes.length} clientes · ${nf(u(ps))} u.`,
    `✅ Terminados: ${hechos.length} · 🔵 Armándose: ${enCurso.length} · ⏳ Sin tomar: ${de('pendiente').length} · 📝 Sin pedir armado: ${de('sin_armado').length}`,
    abiertos.length ? `\n*Falta terminar*\n${abiertos.map(bloqueCliente).join('\n')}` : '',
    listos.length ? `\n*Terminados*\n${listos.map(bloqueCliente).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return { subtitulo, bloques, texto, ancho: ANCHO }
}
