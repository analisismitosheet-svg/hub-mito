import { useMemo, useState } from 'react'
import { Ban, ChevronRight, Search, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Seguimiento y cancelación de pedidos de venta (VISTA PREVIA)       */
/*  Datos de ejemplo: todavía no lee Supabase ni manda nada a Dragon.  */
/*  La idea: cola en Supabase → puente cada 1 min → API de Dragon      */
/*  POST /Devolucion/ ("Alta de Cancelación de venta") con CompAfec =  */
/*  el pedido y FacturaDetalle = los SKU y cantidades que se cancelan. */
/* ------------------------------------------------------------------ */

interface Linea { id: string; sku: string; desc: string; color: string; talle: string; ped: number; rem: number; can: number; stock: number }
interface Pedido { codigo: string; num: string; cli: string; nom: string; fecha: string; entrega: string; anulado?: boolean; lineas: Linea[] }
interface EnCola { id: number; codigo: string; num: string; nom: string; tipo: 'saldo' | 'entero'; uni: number; motivo: string; hora: string; estado: 'cola' | 'env' | 'ok' }

const l = (codigo: string, i: number, sku: string, desc: string, color: string, talle: string, ped: number, rem: number, stock: number): Linea =>
  ({ id: `${codigo}-${i}`, sku, desc, color, talle, ped, rem, can: 0, stock })

const EJEMPLO: Pedido[] = [
  { codigo: 'P10231', num: '0001-00010231', cli: '01068', nom: 'Jemava S.A.S.', fecha: '2026-10-21', entrega: '2026-11-05', lineas: [
    l('P10231', 0, 'CF265726', 'Campera puffer', '02', 'M', 24, 12, 180), l('P10231', 1, 'CF265726', 'Campera puffer', '02', 'L', 24, 24, 96),
    l('P10231', 2, 'ZH060018', 'Buzo hoodie', '02', 'U', 36, 10, 0), l('P10231', 3, 'RM114502', 'Remera básica', '01', 'S', 48, 0, 12)] },
  { codigo: 'P10198', num: '0001-00010198', cli: '01068', nom: 'Jemava S.A.S.', fecha: '2026-10-09', entrega: '2026-10-20', lineas: [
    l('P10198', 0, 'JN330017', 'Jean mom', '05', '38', 20, 20, 44), l('P10198', 1, 'JN330017', 'Jean mom', '05', '40', 20, 6, 0)] },
  { codigo: 'P10244', num: '0001-00010244', cli: '01140', nom: 'Argentina S.R.L. (CF Ushuaia)', fecha: '2026-10-28', entrega: '2026-11-10', lineas: [
    l('P10244', 0, 'ZH060018', 'Buzo hoodie', '02', 'U', 30, 0, 0), l('P10244', 1, 'CF265726', 'Campera puffer', '02', 'M', 18, 0, 180)] },
  { codigo: 'P10252', num: '0001-00010252', cli: '00877', nom: 'Indumentaria del Sur', fecha: '2026-10-30', entrega: '2026-11-12', lineas: [
    l('P10252', 0, 'RM114502', 'Remera básica', '01', 'S', 60, 48, 12), l('P10252', 1, 'RM114502', 'Remera básica', '01', 'M', 60, 60, 30),
    l('P10252', 2, 'JN330017', 'Jean mom', '05', '40', 24, 0, 0)] },
  { codigo: 'P10260', num: '0001-00010260', cli: '01212', nom: 'Moda Norte', fecha: '2026-11-02', entrega: '2026-11-15', lineas: [
    l('P10260', 0, 'CF265726', 'Campera puffer', '07', 'S', 12, 12, 8)] },
]

const MOTIVOS = ['Sin stock', 'Lo pidió el cliente', 'Pedido duplicado', 'Cliente con deuda', 'Fuera de temporada', 'Otro']
const n0 = new Intl.NumberFormat('es-AR')
const fechaCorta = (f: string) => f.split('-').reverse().join('/')
const pend = (x: Linea) => Math.max(0, x.ped - x.rem - x.can)
const suma = (ls: Linea[], f: (x: Linea) => number) => ls.reduce((a, x) => a + f(x), 0)
const claveSku = (x: Linea) => `${x.sku}|${x.color}|${x.talle}`

function Barra({ ped, rem, can }: { ped: number; rem: number; can: number }) {
  const t = ped || 1
  return (
    <div className="hidden h-2 w-36 shrink-0 overflow-hidden rounded-full bg-line sm:flex">
      <i className="block h-full bg-emerald-500" style={{ width: `${(rem / t) * 100}%` }} />
      <i className="block h-full bg-red-400" style={{ width: `${(can / t) * 100}%` }} />
      <i className="block h-full bg-amber-500" style={{ width: `${(Math.max(0, ped - rem - can) / t) * 100}%` }} />
    </div>
  )
}

function Numeros({ ls }: { ls: Linea[] }) {
  const cols: [string, number, string][] = [
    ['pedido', suma(ls, (x) => x.ped), 'text-ink'],
    ['remitido', suma(ls, (x) => x.rem), 'text-emerald-500'],
    ['cancelado', suma(ls, (x) => x.can), 'text-red-400'],
    ['pendiente', suma(ls, pend), 'text-amber-500'],
  ]
  return (
    <div className="hidden gap-4 text-[11px] text-sub md:flex">
      {cols.map(([t, v, c]) => (
        <div key={t} className="text-right"><b className={`block font-display text-sm tabular-nums ${c}`}>{n0.format(v)}</b>{t}</div>
      ))}
    </div>
  )
}

const chip = 'rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide'

export default function SeguimientoPedidos() {
  const { isAdmin } = useAuth()
  const [pedidos, setPedidos] = useState<Pedido[]>(EJEMPLO)
  const [cola, setCola] = useState<EnCola[]>([])
  const [tab, setTab] = useState<'cli' | 'sku' | 'can'>('cli')
  const [busqueda, setBusqueda] = useState('')
  const [soloPend, setSoloPend] = useState(true)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set(['01068']))
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<{ items: { p: Pedido; x: Linea }[]; modo: 'saldo' | 'entero' } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [obs, setObs] = useState('')

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return pedidos.filter((p) => {
      if (soloPend && (p.anulado || p.lineas.every((x) => pend(x) === 0))) return false
      if (!q) return true
      return `${p.nom} ${p.cli} ${p.num}`.toLowerCase().includes(q) || p.lineas.some((x) => `${x.sku} ${x.desc}`.toLowerCase().includes(q))
    })
  }, [pedidos, busqueda, soloPend])

  const alternar = (set: Set<string>, k: string) => { const s = new Set(set); s.has(k) ? s.delete(k) : s.add(k); return s }
  const enCurso = (p: Pedido) => cola.some((c) => c.codigo === p.codigo && c.estado !== 'ok')

  function Estado({ p }: { p: Pedido }) {
    if (p.anulado) return <span className={`${chip} border-red-400/40 bg-red-400/10 text-red-400`}>Anulado</span>
    if (enCurso(p)) return <span className={`${chip} border-sky-400/40 bg-sky-400/10 text-sky-400`}>Cancelación en curso</span>
    const pe = suma(p.lineas, pend), can = suma(p.lineas, (x) => x.can), rem = suma(p.lineas, (x) => x.rem)
    if (pe === 0) return can
      ? <span className={`${chip} border-violet-400/40 bg-violet-400/10 text-violet-400`}>Cerrado con cancelación</span>
      : <span className={`${chip} border-emerald-500/40 bg-emerald-500/10 text-emerald-500`}>Completo</span>
    return <span className={`${chip} border-amber-500/40 bg-amber-500/10 text-amber-500`}>{rem ? 'Parcial' : 'Pendiente'}</span>
  }

  const casilla = (p: Pedido, x: Linea) => (
    <input type="checkbox" aria-label={`Marcar ${x.sku} ${x.color}/${x.talle}`} className="size-4 accent-red-500"
      checked={marcadas.has(x.id)} disabled={pend(x) === 0 || !!p.anulado || enCurso(p)}
      onChange={() => setMarcadas((m) => alternar(m, x.id))} />
  )

  function abrirModal(items: { p: Pedido; x: Linea }[], modo: 'saldo' | 'entero') {
    setMotivo(''); setObs(''); setModal({ items, modo })
  }

  function confirmar() {
    if (!modal) return
    const { modo, items } = modal
    const peds = [...new Set(items.map((i) => i.p))]
    const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    const nuevas: EnCola[] = peds.map((p, k) => {
      const mias = items.filter((i) => i.p === p)
      return { id: Date.now() + k, codigo: p.codigo, num: p.num, nom: p.nom, tipo: modo, motivo, hora, estado: 'cola',
        uni: suma(mias.map((i) => i.x), pend) }
    })
    setCola((c) => [...c, ...nuevas])
    const ids = new Set(items.map((i) => i.x.id))
    setMarcadas((m) => new Set([...m].filter((id) => !ids.has(id))))
    setModal(null)
    // Simula al puente: a los segundos pasa a "enviando" y después impacta.
    setTimeout(() => setCola((c) => c.map((e) => (nuevas.some((n) => n.id === e.id) ? { ...e, estado: 'env' } : e))), 1500)
    setTimeout(() => {
      setCola((c) => c.map((e) => (nuevas.some((n) => n.id === e.id) ? { ...e, estado: 'ok' } : e)))
      setPedidos((ps) => ps.map((p) => {
        if (!peds.includes(p)) return p
        return { ...p, lineas: p.lineas.map((x) => (ids.has(x.id) ? { ...x, can: x.can + pend(x) } : x)) }
      }))
    }, 3500)
  }

  const tablaPedido = (p: Pedido) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-sub">
          <th className="w-8 px-3 py-2" /><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">Color</th><th className="px-3 py-2">Talle</th>
          <th className="px-3 py-2 text-right">Pedido</th><th className="px-3 py-2 text-right">Remitido</th><th className="px-3 py-2 text-right">Cancelado</th><th className="px-3 py-2 text-right">Pendiente</th><th className="px-3 py-2 text-right">Stock</th>
        </tr></thead>
        <tbody className="tabular-nums">
          {p.lineas.map((x) => (
            <tr key={x.id} className={`border-b border-line/60 ${marcadas.has(x.id) ? 'bg-red-400/10' : ''} ${p.anulado ? 'text-sub line-through' : ''}`}>
              <td className="px-3 py-2">{casilla(p, x)}</td>
              <td className="px-3 py-2 font-semibold">{x.sku}</td><td className="px-3 py-2">{x.desc}</td><td className="px-3 py-2">{x.color}</td><td className="px-3 py-2">{x.talle}</td>
              <td className="px-3 py-2 text-right">{x.ped}</td>
              <td className="px-3 py-2 text-right text-emerald-500">{x.rem}</td>
              <td className="px-3 py-2 text-right text-red-400">{x.can || ''}</td>
              <td className="px-3 py-2 text-right font-bold text-amber-500">{pend(x) || '—'}</td>
              <td className={`px-3 py-2 text-right ${x.stock === 0 ? 'font-semibold text-red-400' : 'text-sub'}`}>{x.stock === 0 ? 'sin stock' : x.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const porCliente = () => {
    const grupos = new Map<string, { cli: string; nom: string; peds: Pedido[] }>()
    visibles.forEach((p) => { const g = grupos.get(p.cli) ?? { cli: p.cli, nom: p.nom, peds: [] }; g.peds.push(p); grupos.set(p.cli, g) })
    if (!grupos.size) return <p className="py-10 text-center text-sm text-sub">Nada para mostrar.</p>
    return [...grupos.values()].map((g) => {
      const ls = g.peds.flatMap((p) => p.lineas), abierto = abiertos.has(g.cli)
      return (
        <div key={g.cli} className="mb-2.5 overflow-hidden rounded-2xl border border-line bg-surface">
          <button onClick={() => setAbiertos((a) => alternar(a, g.cli))} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface2">
            <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition ${abierto ? 'rotate-90' : ''}`} />
            <span className="min-w-0 flex-1"><b className="block truncate font-display text-[15px] text-ink">{g.nom}</b><span className="text-xs text-sub">Cliente {g.cli} · {g.peds.length} pedido{g.peds.length > 1 ? 's' : ''}</span></span>
            <Numeros ls={ls} /><Barra ped={suma(ls, (x) => x.ped)} rem={suma(ls, (x) => x.rem)} can={suma(ls, (x) => x.can)} />
          </button>
          {abierto && (
            <div className="space-y-2.5 border-t border-line p-3">
              {g.peds.map((p) => {
                const marc = p.lineas.filter((x) => marcadas.has(x.id))
                const pendPed = suma(p.lineas, pend)
                return (
                  <div key={p.codigo} className="overflow-hidden rounded-xl border border-line">
                    <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2.5">
                      <b className="font-display text-sm text-ink">Pedido {p.num}</b><Estado p={p} />
                      <span className="text-xs text-sub">del {fechaCorta(p.fecha)} · entrega {fechaCorta(p.entrega)}</span>
                      <span className="flex-1" />
                      <button disabled={!marc.length} onClick={() => abrirModal(marc.map((x) => ({ p, x })), 'saldo')}
                        className="btn-press h-9 rounded-lg border border-red-400/40 bg-red-400/15 px-3 text-xs font-bold text-red-300 transition hover:bg-red-400/25 disabled:opacity-40">
                        Cancelar saldo{marc.length ? ` de ${marc.length} línea${marc.length > 1 ? 's' : ''}` : ''}
                      </button>
                      <button disabled={!!p.anulado || pendPed === 0 || enCurso(p)} onClick={() => abrirModal(p.lineas.filter((x) => pend(x) > 0).map((x) => ({ p, x })), 'entero')}
                        title="Cancela todo lo que falta remitir de este pedido"
                        className="btn-press h-9 rounded-lg border border-line bg-surface2 px-3 text-xs font-bold text-ink transition hover:bg-surface disabled:opacity-40">
                        Cancelar todo el saldo
                      </button>
                    </div>
                    {tablaPedido(p)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    })
  }

  const porSku = () => {
    const grupos = new Map<string, { k: string; x0: Linea; items: { p: Pedido; x: Linea }[] }>()
    visibles.forEach((p) => p.lineas.forEach((x) => { const k = claveSku(x); const g = grupos.get(k) ?? { k, x0: x, items: [] }; g.items.push({ p, x }); grupos.set(k, g) }))
    const lista = [...grupos.values()].sort((a, b) => suma(b.items.map((i) => i.x), pend) - suma(a.items.map((i) => i.x), pend))
    if (!lista.length) return <p className="py-10 text-center text-sm text-sub">Nada para mostrar.</p>
    return lista.map((g) => {
      const ls = g.items.map((i) => i.x), abierto = abiertos.has(g.k), falta = Math.max(0, suma(ls, pend) - g.x0.stock)
      const marc = g.items.filter((i) => marcadas.has(i.x.id))
      return (
        <div key={g.k} className="mb-2.5 overflow-hidden rounded-2xl border border-line bg-surface">
          <button onClick={() => setAbiertos((a) => alternar(a, g.k))} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface2">
            <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition ${abierto ? 'rotate-90' : ''}`} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-display text-[15px] text-ink">{g.x0.sku} · {g.x0.color}/{g.x0.talle}</b>
              <span className="text-xs text-sub">{g.x0.desc} · {g.items.length} pedido{g.items.length > 1 ? 's' : ''} · stock {g.x0.stock}
                {falta > 0 && <b className="text-red-400"> · faltan {falta} para cumplir</b>}</span>
            </span>
            <Numeros ls={ls} /><Barra ped={suma(ls, (x) => x.ped)} rem={suma(ls, (x) => x.rem)} can={suma(ls, (x) => x.can)} />
          </button>
          {abierto && (
            <div className="border-t border-line p-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-sub">
                    <th className="w-8 px-3 py-2" /><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Pedido</th><th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2 text-right">Pedido</th><th className="px-3 py-2 text-right">Remitido</th><th className="px-3 py-2 text-right">Cancelado</th><th className="px-3 py-2 text-right">Pendiente</th>
                  </tr></thead>
                  <tbody className="tabular-nums">
                    {g.items.map(({ p, x }) => (
                      <tr key={x.id} className={`border-b border-line/60 ${marcadas.has(x.id) ? 'bg-red-400/10' : ''}`}>
                        <td className="px-3 py-2">{casilla(p, x)}</td>
                        <td className="px-3 py-2"><b>{p.nom}</b> <span className="text-sub">{p.cli}</span></td>
                        <td className="px-3 py-2"><span className="mr-2">{p.num}</span><Estado p={p} /></td>
                        <td className="px-3 py-2">{fechaCorta(p.fecha)}</td>
                        <td className="px-3 py-2 text-right">{x.ped}</td><td className="px-3 py-2 text-right text-emerald-500">{x.rem}</td>
                        <td className="px-3 py-2 text-right text-red-400">{x.can || ''}</td><td className="px-3 py-2 text-right font-bold text-amber-500">{pend(x) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2.5 flex justify-end">
                <button disabled={!marc.length} onClick={() => abrirModal(marc, 'saldo')}
                  className="btn-press h-9 rounded-lg border border-red-400/40 bg-red-400/15 px-3 text-xs font-bold text-red-300 transition hover:bg-red-400/25 disabled:opacity-40">
                  Cancelar saldo en los pedidos marcados
                </button>
              </div>
            </div>
          )}
        </div>
      )
    })
  }

  const historial = () => {
    if (!cola.length) return <p className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-sub">Todavía no se mandó ninguna cancelación desde el hub.<br />Marcá líneas en «Por cliente» o «Por SKU» y tocá «Cancelar saldo».</p>
    const est = {
      cola: <span className={`${chip} border-amber-500/40 bg-amber-500/10 text-amber-500`}>En cola</span>,
      env: <span className={`${chip} border-sky-400/40 bg-sky-400/10 text-sky-400`}>Enviando a Dragon…</span>,
      ok: <span className={`${chip} border-emerald-500/40 bg-emerald-500/10 text-emerald-500`}>✓ Impactó en Dragon</span>,
    }
    return (
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-sub">
            <th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Pedido</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2 text-right">Unidades</th><th className="px-3 py-2">Motivo</th><th className="px-3 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {[...cola].reverse().map((c) => (
              <tr key={c.id} className="border-b border-line/60">
                <td className="px-3 py-2">{c.hora}</td><td className="px-3 py-2 font-semibold">{c.num}</td><td className="px-3 py-2">{c.nom}</td>
                <td className="px-3 py-2">{c.tipo === 'entero' ? 'Todo el saldo' : 'Saldo por SKU'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.uni}</td><td className="px-3 py-2">{c.motivo}</td><td className="px-3 py-2">{est[c.estado]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const activos = pedidos.filter((p) => !p.anulado).flatMap((p) => p.lineas)
  const kpis: [string, string, string][] = [
    ['Pedidos pendientes', '10.309', 'con saldo sin remitir'],
    ['Unidades pendientes', n0.format(suma(activos, pend)), 'en los clientes de abajo'],
    ['Remitos pendientes', '2.821', 'de 16.038'],
    ['Cancelados en Dragon', '286', 'pedidos enteros'],
    ['Desde el hub', String(cola.length), 'cancelaciones mandadas'],
  ]
  const tabs: [typeof tab, string][] = [['cli', 'Por cliente'], ['sku', 'Por SKU'], ['can', `Cancelaciones${cola.length ? ` (${cola.length})` : ''}`]]

  const itemsModal = modal ? modal.items : []
  const pedsModal = [...new Set(itemsModal.map((i) => i.p))]
  // Lo que el puente mandaría a Dragon: una cancelación de venta por pedido.
  const envio = pedsModal.map((p) => ({
    Cliente: p.cli,
    Motivo: motivo || '(motivo)',
    Obs: `CANCELADO DESDE HUB${obs ? ` — ${obs}` : ''}`,
    // Mismo formato que las cancelaciones que ya hay en Dragon (GET /Devolucion/): Afecta = código del pedido.
    CompAfec: [{ NroItem: 1, Afecta: p.codigo, Tipo: 'Afectado', TipoComprobante: 23, TipoCompCaracter: `Pedido De Venta X ${p.num}`, Letra: 'X', PuntoDeVenta: 1, Numero: Number(p.num.split('-')[1]) }],
    FacturaDetalle: itemsModal.filter((i) => i.p === p).map(({ x }, k) => ({ NroItem: k + 1, Articulo: x.sku, Color: x.color, Talle: x.talle, Cantidad: pend(x), Afe_Saldo: pend(x) })),
  }))

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-center gap-3">
        <div className="rounded-xl border border-red-400/30 bg-red-400/15 p-2.5 text-red-400"><Ban size={22} aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-ink">Seguimiento de pedidos</h1>
          <p className="text-sm text-sub">Cuánto se pidió, cuánto salió en remito y qué queda pendiente · las cancelaciones van a Dragon</p>
        </div>
        <span className={`${chip} border-amber-500/40 bg-amber-500/10 text-amber-500`}>Vista previa · datos de ejemplo</span>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {kpis.map(([t, v, s]) => (
          <div key={t} className="rounded-2xl border border-line bg-surface px-3.5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-sub">{t}</p>
            <p className="font-display text-2xl font-bold tabular-nums text-ink">{v}</p>
            <p className="text-xs text-sub">{s}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`btn-press h-9 rounded-full border px-4 text-sm font-semibold transition ${tab === k ? 'border-red-400/40 bg-red-400/15 text-red-300' : 'border-line bg-surface text-sub hover:text-ink'}`}>{t}</button>
        ))}
      </div>

      {tab !== 'can' && (
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Cliente, N° de pedido o SKU…" aria-label="Buscar"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
          </div>
          <select value={soloPend ? 'p' : 't'} onChange={(e) => setSoloPend(e.target.value === 'p')} aria-label="Filtrar"
            className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink">
            <option value="p">Con saldo pendiente</option><option value="t">Todos</option>
          </select>
        </div>
      )}

      <div className="pb-6">{tab === 'cli' ? porCliente() : tab === 'sku' ? porSku() : historial()}</div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setModal(null)}>
          <div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface-solid p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold text-ink">{pedsModal.length === 1 ? `Cancelar en pedido ${pedsModal[0].num}` : `Cancelar en ${pedsModal.length} pedidos`}</h2>
                <p className="text-sm text-sub">{[...new Set(pedsModal.map((p) => p.nom))].join(' · ')}</p>
              </div>
              <button onClick={() => setModal(null)} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:text-ink"><X size={18} /></button>
            </div>

            <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${modal.modo === 'entero' ? 'border-red-400/40 bg-red-400/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-400'}`}>
              {modal.modo === 'entero'
                ? 'Se carga en Dragon una cancelación de venta por todo el saldo pendiente del pedido. Lo ya remitido no se toca.'
                : 'Se carga en Dragon una cancelación de venta por el saldo de las líneas marcadas. El resto del pedido sigue pendiente.'}
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-sub">
                  <th className="px-2 py-2">Pedido</th><th className="px-2 py-2">SKU</th><th className="px-2 py-2">Color/Talle</th><th className="px-2 py-2 text-right">Pedido</th><th className="px-2 py-2 text-right">Remitido</th><th className="px-2 py-2 text-right">Se cancela</th><th className="px-2 py-2 text-right">Queda</th>
                </tr></thead>
                <tbody className="tabular-nums">
                  {itemsModal.map(({ p, x }) => {
                    const c = pend(x)
                    return (
                      <tr key={x.id} className="border-b border-line/60">
                        <td className="px-2 py-2">{p.num}</td><td className="px-2 py-2 font-semibold">{x.sku}</td><td className="px-2 py-2">{x.color}/{x.talle}</td>
                        <td className="px-2 py-2 text-right">{x.ped}</td><td className="px-2 py-2 text-right">{x.rem}</td>
                        <td className="px-2 py-2 text-right font-bold text-red-400">{c}</td><td className="px-2 py-2 text-right">{x.ped - x.can - c}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                <option value="">Motivo de la cancelación…</option>
                {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observación (va al pedido en Dragon)" aria-label="Observación"
                className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-sub/70" />
            </div>

            {isAdmin && <details className="mt-3">
              <summary className="cursor-pointer text-xs text-sub">Ver lo que se manda a Dragon</summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-line bg-black/40 p-3 text-[11px] text-emerald-300">
                {envio.map((e) => `POST /api.Dragonfish/Devolucion/\n${JSON.stringify(e, null, 2)}`).join('\n\n')}
              </pre>
            </details>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="btn-press h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink">Volver</button>
              <button disabled={!motivo} onClick={confirmar} className="btn-press h-10 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40">
Cargar cancelación en Dragon
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
