import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileText, Loader2, Package, Search, X } from 'lucide-react'
import { normalizar } from '@/lib/recepcionIndo'
import { avanceOcs, buscarOc, ocsDeFila, unirOcs, type AvanceOc, type CoincidenciaOc, type PedidoCompraOc } from '@/lib/ocPedidosCompra'
import DetalleOc from '@/components/DetalleOc'

/* ------------------------------------------------------------------ */
/*  Selector de N° OC (Recepción INDO: "Nuevo registro" y la tabla).    */
/*                                                                      */
/*  Lista las OC de VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA con buscador. */
/*  Cada LÍNEA (OC + proveedor) se elige por separado: el mismo número  */
/*  puede estar en varios proveedores (ej. 1042 de RUSTY, 47 STREET y   */
/*  Elordi) y tildar uno no tilda los otros. Lo que no está en la lista  */
/*  se agrega a mano. Se guarda como el Excel, solo los números:        */
/*  "15183/15347" (la recepción ya tiene su proveedor).                  */
/*                                                                      */
/*  Buscador (sql/buscar_oc.sql): cada palabra tiene que coincidir con  */
/*  el N°, el proveedor o un artículo (código o descripción); se ordena */
/*  N° exacto > N° que empieza igual > proveedor > artículo, primero las */
/*  del proveedor de la recepción. ↑ ↓ + Enter tilda; pegar "15183/15347"*/
/*  tilda todas juntas.                                                  */
/* ------------------------------------------------------------------ */

interface Elegida {
  codigo: string | null // línea de la lista; null = número escrito a mano (o que no se pudo ubicar)
  numero: string
  nombre: string | null
}

interface Fila {
  p: PedidoCompraOc
  pts: number
  arts: CoincidenciaOc['arts']
}

const compacto = (v: string) => normalizar(v).replace(/[^A-Z0-9]/g, '')
const fecha = (f: string | null) => (f ? f.split('-').reverse().join('/') : '')
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const palabrasDe = (t: string) => normalizar(t).split(/[^A-Z0-9]+/).filter(Boolean)

/** ¿La línea es de este proveedor? Por código del catálogo o, si no hay, por nombre parecido. */
function delProveedor(p: PedidoCompraOc, codigo: string, nombre: string): boolean {
  if (codigo) return (p.proveedor ?? '').trim().toUpperCase() === codigo
  return nombre.length >= 3 && compacto(p.proveedor_nombre ?? '').includes(nombre)
}

/**
 * Pasa lo guardado ("1042/15183") a líneas: si el número está en una sola línea, esa; si está en
 * varias, la del proveedor de la recepción; si no se puede saber, queda como número suelto.
 */
function resolver(valor: string, pedidos: PedidoCompraOc[], codigo: string, nombre: string): Elegida[] {
  return ocsDeFila(valor).flatMap((n): Elegida[] => {
    const lineas = pedidos.filter((p) => String(p.numero) === n)
    const delProv = lineas.length > 1 ? lineas.filter((p) => delProveedor(p, codigo, nombre)) : lineas
    if (delProv.length) return delProv.map((p) => ({ codigo: p.codigo, numero: n, nombre: p.proveedor_nombre || p.proveedor }))
    return [{ codigo: null, numero: n, nombre: null }]
  })
}

/** Puntaje local (mientras llega la búsqueda de la base): solo N° y proveedor. null = no coincide. */
function puntajeLocal(p: PedidoCompraOc, palabras: string[]): number | null {
  const num = String(p.numero)
  const prov = normalizar(`${p.proveedor_nombre ?? ''} ${p.proveedor ?? ''}`)
  let pts = 0
  for (const w of palabras) {
    const esNum = /^\d+$/.test(w)
    const v = Math.max(
      num === w ? 1000 : esNum && num.startsWith(w) ? 500 - num.length : esNum && num.includes(w) ? 100 : 0,
      prov.includes(w) ? 80 : 0,
    )
    if (!v) return null
    pts += v
  }
  return pts
}

/** Marca en el texto las palabras buscadas */
function Resaltado({ texto, palabras }: { texto: string; palabras: string[] }) {
  if (!palabras.length || !texto) return <>{texto}</>
  const re = new RegExp(`(${palabras.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const partes = texto.split(re)
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? <mark key={i} className="rounded-sm bg-yellow-400/30 px-px text-inherit">{parte}</mark> : <Fragment key={i}>{parte}</Fragment>,
      )}
    </>
  )
}

/** Pendiente · Parcial x% · Completa, según lo recibido en Picking */
function EstadoOc({ a }: { a: AvanceOc | undefined }) {
  if (!a || a.pedido <= 0) return null
  const meta = Math.max(0, a.pedido - a.cancelado)
  const saldo = Math.max(0, meta - a.recibido)
  const titulo = `${n0.format(a.recibido)} de ${n0.format(meta)} u. recibidas${a.cancelado ? ` · ${n0.format(a.cancelado)} canceladas` : ''} · saldo ${n0.format(saldo)}`
  if (saldo <= 0) return <span title={titulo} className="shrink-0 rounded px-1.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-500">Completa</span>
  if (a.recibido <= 0) return <span title={titulo} className="shrink-0 rounded px-1.5 text-[10px] font-semibold bg-amber-500/15 text-amber-500">Pendiente</span>
  return (
    <span title={titulo} className="shrink-0 rounded px-1.5 text-[10px] font-semibold bg-sky-500/15 text-sky-400">
      Parcial {Math.min(99, Math.floor((a.recibido / meta) * 100))}%
    </span>
  )
}

export default function SelectorOc({
  valor, onChange, pedidos, proveedorNombre, proveedorCodigo, invalido = false, autoFocus = false, alto = 'max-h-44',
}: {
  /** Valor inicial ("15183/15347"); después manda lo que se elige acá */
  valor: string
  onChange: (nOc: string) => void
  pedidos: PedidoCompraOc[]
  proveedorNombre: string
  proveedorCodigo: string | null
  invalido?: boolean
  autoFocus?: boolean
  /** clase de alto máximo de la lista */
  alto?: string
}) {
  const cod = (proveedorCodigo ?? '').trim().toUpperCase()
  const nom = compacto(proveedorNombre)
  const [elegidas, setElegidas] = useState<Elegida[]>(() => resolver(valor, pedidos, cod, nom))
  const tocado = useRef(false)
  // Las OC llegan después de abrir: se vuelve a ubicar lo guardado mientras no se haya tocado nada
  useEffect(() => {
    if (!tocado.current) setElegidas(resolver(valor, pedidos, cod, nom))
  }, [pedidos]) // eslint-disable-line react-hooks/exhaustive-deps

  const [texto, setTexto] = useState('')
  const [soloProveedor, setSoloProveedor] = useState(true)
  const [activo, setActivo] = useState(0)
  const [aviso, setAviso] = useState('')
  /** OC de la que se está viendo la tarjeta de detalle (por código de la lista) */
  const [verDetalle, setVerDetalle] = useState<PedidoCompraOc | null>(null)
  const [avance, setAvance] = useState<Map<string, AvanceOc>>(new Map())
  useEffect(() => { void avanceOcs().then(setAvance) }, [])
  const listaRef = useRef<HTMLDivElement>(null)

  const t = texto.trim()
  const palabras = useMemo(() => palabrasDe(t), [t])
  // "15183/15347", "15183, 15347" o "15183 15347": varios N° pegados juntos
  const pegados = palabras.length > 1 && palabras.every((w) => /^\d+$/.test(w)) ? [...new Set(palabras)] : null

  // Búsqueda en la base con debounce; mientras tanto se filtra en memoria por N° y proveedor
  const [busqueda, setBusqueda] = useState<{ texto: string; res: Map<string, CoincidenciaOc> } | null>(null)
  const [buscando, setBuscando] = useState(false)
  useEffect(() => {
    if (!t || pegados) { setBuscando(false); return }
    let vivo = true
    setBuscando(true)
    const timer = setTimeout(() => {
      void buscarOc(t).then((res) => {
        if (!vivo) return
        setBusqueda({ texto: t, res })
        setBuscando(false)
      })
    }, 250)
    return () => { vivo = false; clearTimeout(timer) }
  }, [t, !!pegados]) // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = (nuevas: Elegida[]) => {
    tocado.current = true
    setElegidas(nuevas)
    onChange(unirOcs(nuevas.map((e) => e.numero)))
  }
  const marcada = (p: PedidoCompraOc) => elegidas.some((e) => e.codigo === p.codigo)
  const conLinea = (lista: Elegida[], p: PedidoCompraOc): Elegida[] =>
    // si estaba como número suelto, pasa a ser esta línea
    [...lista.filter((e) => !(e.codigo === null && e.numero === String(p.numero))), { codigo: p.codigo, numero: String(p.numero), nombre: p.proveedor_nombre || p.proveedor }]
  const alternar = (p: PedidoCompraOc) => {
    setAviso('')
    cambiar(marcada(p) ? elegidas.filter((e) => e.codigo !== p.codigo) : conLinea(elegidas, p))
  }
  const quitar = (e: Elegida) => cambiar(elegidas.filter((x) => x !== e))

  const delProv = useMemo(() => pedidos.filter((p) => delProveedor(p, cod, nom)), [pedidos, cod, nom])
  const esDelProv = (p: PedidoCompraOc) => delProveedor(p, cod, nom)

  // Filas a mostrar, ya ordenadas: las del proveedor de la recepción primero
  const { mias, otras } = useMemo(() => {
    let filas: Fila[]
    if (!t || pegados) {
      const base = soloProveedor && delProv.length ? delProv : pedidos
      filas = base.map((p) => ({ p, pts: 0, arts: [] }))
    } else if (busqueda && busqueda.texto === t) {
      filas = pedidos.flatMap((p) => {
        const c = busqueda.res.get(p.codigo)
        return c ? [{ p, pts: c.puntaje, arts: c.arts }] : []
      })
    } else {
      filas = pedidos.flatMap((p) => {
        const pts = puntajeLocal(p, palabras)
        return pts === null ? [] : [{ p, pts, arts: [] }]
      })
    }
    filas.sort((a, b) => b.pts - a.pts || (b.p.fecha ?? '').localeCompare(a.p.fecha ?? '') || b.p.numero - a.p.numero)
    const m: Fila[] = []
    const o: Fila[] = []
    for (const f of filas) (esDelProv(f.p) ? m : o).push(f)
    return { mias: m.slice(0, 80), otras: o.slice(0, 80) }
  }, [t, pegados, soloProveedor, delProv, pedidos, busqueda, palabras]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibles = [...mias, ...otras]

  useEffect(() => { setActivo(0) }, [t])
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activo])

  const manual = t.replace(/\s+/g, '')
  const enLista = pedidos.some((p) => String(p.numero) === manual)
  const puedeManual = /^\d+$/.test(manual) && !enLista && !elegidas.some((e) => e.numero === manual)

  /** Pegados: cada N° pasa a su línea (la del proveedor de la recepción si hay varias) o queda a mano */
  function tildarPegados(nums: string[]) {
    let lista = elegidas
    let ok = 0
    const aMano: string[] = []
    for (const n of nums) {
      const lineas = pedidos.filter((p) => String(p.numero) === n)
      const linea = lineas.find(esDelProv) ?? lineas[0]
      if (linea) {
        if (!lista.some((e) => e.codigo === linea.codigo)) { lista = conLinea(lista, linea); ok++ }
      } else if (!lista.some((e) => e.numero === n)) {
        lista = [...lista, { codigo: null, numero: n, nombre: null }]
        aMano.push(n)
      }
    }
    cambiar(lista)
    setTexto('')
    setAviso(`Se tildaron ${ok}${aMano.length ? ` · a mano: ${aMano.join(', ')}` : ''}`)
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((i) => Math.min(visibles.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(0, i - 1)); return }
    if (e.key !== 'Enter') return
    e.preventDefault() // no enviar el formulario
    if (pegados) return tildarPegados(pegados)
    const f = visibles[activo]
    if (f) {
      alternar(f.p)
      e.currentTarget.select()
    } else if (puedeManual) {
      cambiar([...elegidas, { codigo: null, numero: manual, nombre: null }])
      setTexto('')
    }
  }

  const fila = (f: Fila, i: number) => {
    const p = f.p
    const si = marcada(p)
    return (
      <div
        key={p.codigo}
        data-i={i}
        onMouseEnter={() => setActivo(i)}
        className={`flex w-full items-center gap-1 rounded-lg pr-1 ${si ? 'bg-amber-500/10' : ''} ${i === activo ? 'ring-1 ring-sky-500/60 bg-sky-500/5' : 'hover:bg-line/40'}`}
      >
        <button type="button" onClick={() => alternar(p)} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1 text-left text-xs">
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${si ? 'border-amber-500 bg-amber-500 text-white' : 'border-line2'}`}>
            {si && <Check size={11} strokeWidth={3} aria-hidden />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">
                <Resaltado texto={String(p.numero)} palabras={palabras.filter((w) => /^\d+$/.test(w))} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sub">
                <Resaltado texto={p.proveedor_nombre || p.proveedor || ''} palabras={palabras} />
                {p.anulado && <span className="ml-1 text-brand-400">(anulado)</span>}
              </span>
              <EstadoOc a={avance.get(p.codigo)} />
              <span className="shrink-0 tabular-nums text-sub/70">{fecha(p.fecha)}</span>
            </span>
            {t && f.arts.length > 0 && (
              // Un artículo por renglón, con la descripción adicional completa
              <span className="mt-0.5 block space-y-0.5 pl-[3.75rem] text-[11px] leading-snug text-sky-400">
                {f.arts.slice(0, 4).map((a) => (
                  <span key={a.articulo} className="flex items-start gap-1">
                    <Package size={10} className="mt-[3px] shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      <span className="font-semibold"><Resaltado texto={a.articulo} palabras={palabras} /></span>
                      {a.descripcion && <span className="text-sky-300/90"> · <Resaltado texto={a.descripcion} palabras={palabras} /></span>}
                    </span>
                  </span>
                ))}
                {f.arts.length > 4 && <span className="block text-sub">+{f.arts.length - 4} artículos más</span>}
              </span>
            )}
          </span>
        </button>
        {/* Tarjeta de detalle: no tilda la OC, solo la muestra */}
        <button
          type="button"
          onClick={() => setVerDetalle(p)}
          title={`Ver el detalle de la OC ${p.numero}`}
          aria-label={`Ver el detalle de la OC ${p.numero}`}
          className="mt-1 shrink-0 rounded-md p-1 text-sub/60 transition hover:bg-line hover:text-ink"
        >
          <FileText size={12} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border bg-surface2 p-2 ${invalido ? 'border-brand-500' : 'border-line'}`}>
      {/* Elegidas: número + proveedor de esa línea */}
      <div className="mb-1.5 flex min-h-[1.6rem] flex-wrap items-center gap-1">
        {elegidas.length === 0 ? (
          <span className="px-1 text-xs italic text-sub/70">Ninguna OC elegida: tildalas abajo</span>
        ) : (
          elegidas.map((e) => (
            <span key={`${e.codigo ?? 'm'}-${e.numero}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-500/15 py-0.5 pl-1.5 pr-0.5 text-xs text-amber-500">
              <span className="font-semibold tabular-nums">{e.numero}</span>
              <span className="truncate text-[10px] text-amber-500/80">{e.nombre ? `· ${e.nombre}` : '(manual)'}</span>
              <button type="button" onClick={() => quitar(e)} className="rounded p-0.5 hover:bg-amber-500/20" aria-label={`Quitar OC ${e.numero}`}>
                <X size={11} aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Buscar / agregar a mano */}
      <div className="flex items-center gap-1.5 border-b border-line pb-1.5">
        {buscando ? <Loader2 size={13} className="shrink-0 animate-spin text-sub/70" aria-hidden /> : <Search size={13} className="shrink-0 text-sub/70" aria-hidden />}
        <input
          autoFocus={autoFocus}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAviso('') }}
          onKeyDown={teclas}
          placeholder="N°, proveedor, artículo o descripción… (podés pegar 15183/15347)"
          className="w-full bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-sub/60"
        />
        {texto && (
          <button type="button" onClick={() => setTexto('')} className="rounded p-0.5 text-sub hover:text-ink" aria-label="Limpiar búsqueda">
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      {delProv.length > 0 && !t && (
        <label className="mt-1 flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-sub">
          <input type="checkbox" checked={soloProveedor} onChange={(e) => setSoloProveedor(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
          Solo las de {proveedorNombre} ({delProv.length})
        </label>
      )}
      {aviso && <p className="mt-1 px-1 text-[11px] text-emerald-500">{aviso}</p>}

      <div ref={listaRef} className={`mt-1 overflow-y-auto ${alto}`}>
        {pegados ? (
          <>
            <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-sub">Pegaste {pegados.length} N° · Enter las tilda</p>
            {pegados.map((n) => {
              const lineas = pedidos.filter((p) => String(p.numero) === n)
              return (
                <p key={n} className={`px-2 py-0.5 text-xs ${lineas.length ? 'text-ink' : 'text-red-400'}`}>
                  {lineas.length ? '✓' : '✗'} <span className="font-semibold tabular-nums">{n}</span>{' '}
                  <span className="text-sub">{lineas.length ? `· ${(lineas.find(esDelProv) ?? lineas[0]).proveedor_nombre}` : 'no existe como OC · va a mano'}</span>
                </p>
              )
            })}
            <button
              type="button"
              onClick={() => tildarPegados(pegados)}
              className="mx-2 mt-1 rounded-lg bg-amber-600/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600"
            >
              Tildar {pegados.length}
            </button>
          </>
        ) : (
          <>
            {puedeManual && visibles.length === 0 && (
              <button
                type="button"
                onClick={() => { cambiar([...elegidas, { codigo: null, numero: manual, nombre: null }]); setTexto('') }}
                className="block w-full rounded-lg px-2 py-1 text-left text-xs text-brand-400 hover:bg-line/40"
              >
                + Agregar «{manual}» a mano (no está en la lista de OC)
              </button>
            )}
            {t && mias.length > 0 && otras.length > 0 && (
              <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-sub">{proveedorNombre || 'Del proveedor'} · {mias.length}</p>
            )}
            {mias.map((f, i) => fila(f, i))}
            {otras.length > 0 && (t || !(soloProveedor && delProv.length)) && mias.length > 0 && (
              <p className="px-2 pt-2 text-[10px] uppercase tracking-wide text-sub">Otros proveedores · {otras.length}</p>
            )}
            {otras.map((f, i) => fila(f, i + mias.length))}
            {visibles.length === 0 && !puedeManual && (
              <p className="px-2 py-1.5 text-[11px] text-sub">
                {pedidos.length === 0
                  ? 'Cargando las órdenes de compra… (si no aparecen, escribí el N° y Enter)'
                  : buscando
                    ? 'Buscando…'
                    : 'No hay OC con eso (se busca por N°, proveedor, código o descripción del artículo).'}
              </p>
            )}
          </>
        )}
      </div>

      {/* Tarjeta de detalle de la OC elegida (portal al body, z-[120] sobre el popup) */}
      {verDetalle && (
        <DetalleOc
          codigo={verDetalle.codigo}
          numero={String(verDetalle.numero)}
          proveedorNombre={verDetalle.proveedor_nombre || verDetalle.proveedor}
          onCerrar={() => setVerDetalle(null)}
        />
      )}
    </div>
  )
}
