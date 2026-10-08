import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileText, Package, Search, X } from 'lucide-react'
import { normalizar } from '@/lib/recepcionIndo'
import { buscarOcsPorArticulo, ocsDeFila, unirOcs, type PedidoCompraOc } from '@/lib/ocPedidosCompra'
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
/* ------------------------------------------------------------------ */

interface Elegida {
  codigo: string | null // línea de la lista; null = número escrito a mano (o que no se pudo ubicar)
  numero: string
  nombre: string | null
}

const compacto = (v: string) => normalizar(v).replace(/[^A-Z0-9]/g, '')
const fecha = (f: string | null) => (f ? f.split('-').reverse().join('/') : '')

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
  /** OC de la que se está viendo la tarjeta de detalle (por código de la lista) */
  const [verDetalle, setVerDetalle] = useState<PedidoCompraOc | null>(null)
  /** Ítems que coincidieron con lo buscado: codigo OC -> artículos (por artículo o descripción) */
  const [porArticulo, setPorArticulo] = useState<Map<string, { articulo: string; cantidad: number }[]>>(new Map())
  const [buscandoArt, setBuscandoArt] = useState(false)

  // Búsqueda por artículo: con debounce, y solo cuando el texto no es un N° (el N° ya
  // se filtra en memoria). La caché vive en ocPedidosCompra, así repetir no cuesta nada.
  const tArt = texto.trim()
  useEffect(() => {
    if (tArt.length < 2 || /^\d+$/.test(tArt)) {
      setPorArticulo(new Map())
      setBuscandoArt(false)
      return
    }
    let vivo = true
    setBuscandoArt(true)
    const timer = setTimeout(() => {
      void buscarOcsPorArticulo(tArt).then((m) => {
        if (!vivo) return
        setPorArticulo(m)
        setBuscandoArt(false)
      })
    }, 350)
    return () => { vivo = false; clearTimeout(timer) }
  }, [tArt])

  const cambiar = (nuevas: Elegida[]) => {
    tocado.current = true
    setElegidas(nuevas)
    onChange(unirOcs(nuevas.map((e) => e.numero)))
  }
  const marcada = (p: PedidoCompraOc) => elegidas.some((e) => e.codigo === p.codigo)
  const alternar = (p: PedidoCompraOc) =>
    cambiar(
      marcada(p)
        ? elegidas.filter((e) => e.codigo !== p.codigo)
        // si estaba como número suelto, pasa a ser esta línea
        : [...elegidas.filter((e) => !(e.codigo === null && e.numero === String(p.numero))), { codigo: p.codigo, numero: String(p.numero), nombre: p.proveedor_nombre || p.proveedor }],
    )
  const quitar = (e: Elegida) => cambiar(elegidas.filter((x) => x !== e))

  const delProv = useMemo(() => pedidos.filter((p) => delProveedor(p, cod, nom)), [pedidos, cod, nom])
  const t = texto.trim().toUpperCase()
  const base = soloProveedor && delProv.length && !t ? delProv : pedidos
  // Se busca por N°, proveedor O artículo (los artículos coinciden por código o por la
  // descripción del maestro; el mapa viene de buscarOcsPorArticulo con debounce).
  const visibles = (t
    ? base.filter((p) =>
        [String(p.numero), p.proveedor ?? '', p.proveedor_nombre ?? ''].some((v) => v.toUpperCase().includes(t))
          || porArticulo.has(p.codigo),
      )
    : base
  ).slice(0, 80)
  const manual = texto.trim().replace(/\s+/g, '')
  const enLista = pedidos.some((p) => String(p.numero) === manual)
  const puedeManual = manual !== '' && !enLista && !elegidas.some((e) => e.numero === manual)

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
        <Search size={13} className="shrink-0 text-sub/70" aria-hidden />
        <input
          autoFocus={autoFocus}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault() // no enviar el formulario
            if (puedeManual) {
              cambiar([...elegidas, { codigo: null, numero: manual, nombre: null }])
              setTexto('')
            }
          }}
          placeholder="Buscar por N°, proveedor o artículo…"
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

      <div className={`mt-1 overflow-y-auto ${alto}`}>
        {puedeManual && (
          <button
            type="button"
            onClick={() => { cambiar([...elegidas, { codigo: null, numero: manual, nombre: null }]); setTexto('') }}
            className="block w-full rounded-lg px-2 py-1 text-left text-xs text-brand-400 hover:bg-line/40"
          >
            + Agregar «{manual}» a mano (no está en la lista de OC)
          </button>
        )}
        {visibles.map((p) => {
          const si = marcada(p)
          // Artículos que hicieron match (solo se muestran si hay búsqueda activa)
          const arts = t ? porArticulo.get(p.codigo) : undefined
          return (
            <div
              key={p.codigo}
              className={`flex w-full items-center gap-1 rounded-lg pr-1 hover:bg-line/40 ${si ? 'bg-amber-500/10' : ''}`}
            >
              <button
                type="button"
                onClick={() => alternar(p)}
                className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1 text-left text-xs"
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${si ? 'border-amber-500 bg-amber-500 text-white' : 'border-line2'}`}>
                  {si && <Check size={11} strokeWidth={3} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-semibold tabular-nums text-ink">{p.numero}</span>
                    <span className="min-w-0 flex-1 truncate text-sub">
                      {p.proveedor_nombre || p.proveedor}
                      {p.anulado && <span className="ml-1 text-brand-400">(anulado)</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-sub/70">{fecha(p.fecha)}</span>
                  </span>
                  {arts && arts.length > 0 && (
                    <span className="mt-0.5 block truncate pl-[3.75rem] text-[10px] text-sky-400">
                      <Package size={9} className="mr-0.5 inline align-[-1px]" aria-hidden />
                      {arts.slice(0, 3).map((a) => a.articulo).join(', ')}
                      {arts.length > 3 ? ` +${arts.length - 3}` : ''}
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
        })}
        {visibles.length === 0 && !puedeManual && (
          <p className="px-2 py-1.5 text-[11px] text-sub">
            {pedidos.length === 0
              ? 'Cargando las órdenes de compra… (si no aparecen, escribí el N° y Enter)'
              : buscandoArt
                ? 'Buscando artículos…'
                : t.length >= 2 && !/^\d+$/.test(t)
                  ? `No hay OC con el artículo «${t}» ni con ese N° o proveedor.`
                  : 'No hay OC que coincidan.'}
          </p>
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
