import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MapPin, Search, Trash2, Download, RefreshCw, ChevronDown, Layers } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  cargarMapeo, compararUbicaciones, descripcionesDeArticulos, nombrePlanta, ordenPlanta, type Mapeo,
} from '@/lib/mapeo'

const SIN_UBICACION = 'Sin ubicación'
/** Grupo para lo que no sigue el formato PLANTA-LETRA+NIVEL (ej. sin ubicación) */
const OTRAS = 'OTRAS'

interface Nivel {
  ubicacion: string
  etiqueta: string // "A1"
  items: Mapeo[]
}
interface Pasillo {
  letra: string
  niveles: Nivel[]
  total: number
}
interface Planta {
  planta: string
  pasillos: Pasillo[]
  total: number
}

/** "PB-A10" -> { planta: 'PB', letra: 'A', nivel: 10 } */
function partes(u: string): { planta: string; letra: string; nivel: number } | null {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/.exec(u.trim().toUpperCase())
  return m ? { planta: m[1], letra: m[2], nivel: Number(m[3]) } : null
}

/** Mapeo depósito · Orden mapeado: planta → pasillo (desplegables) → niveles en columnas */
export default function MapeoOrden() {
  const { can } = useAuth()
  const puedeBorrar = can('mayorista.mapeo.borrar')

  const [filas, setFilas] = useState<Mapeo[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  // Desplegables abiertos: plantas ("PB") y pasillos ("PB|A")
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const [borrar, setBorrar] = useState<Mapeo | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Descripción de cada código (maestro de artículos); llega después de la lista
  const [descripciones, setDescripciones] = useState<Map<string, string>>(new Map())
  const descDe = useCallback((codigo: string) => descripciones.get(codigo.toUpperCase()) ?? '', [descripciones])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const todas = await cargarMapeo()
      setFilas(todas)
      // No frena la carga: si falla, se ven solo los códigos
      descripcionesDeArticulos(todas.map((f) => f.codigo))
        .then(setDescripciones)
        .catch(() => { /* sin descripciones */ })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapeo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Búsqueda: por ubicación deja la ubicación entera; por código o descripción, solo lo que coincide
  const q = busqueda.trim().toUpperCase()
  const filtradas = useMemo(() => {
    if (!q) return filas
    return filas.filter(
      (f) =>
        (f.ubicacion ?? SIN_UBICACION).toUpperCase().includes(q) ||
        f.codigo.toUpperCase().includes(q) ||
        descDe(f.codigo).toUpperCase().includes(q),
    )
  }, [filas, q, descDe])

  // Árbol planta → pasillo → nivel, en el orden del depósito
  const plantas = useMemo<Planta[]>(() => {
    const porUbic = new Map<string, Mapeo[]>()
    for (const f of filtradas) {
      const u = f.ubicacion ?? SIN_UBICACION
      porUbic.set(u, [...(porUbic.get(u) ?? []), f])
    }
    const arbol = new Map<string, Map<string, Nivel[]>>()
    for (const [ubicacion, items] of porUbic) {
      const p = partes(ubicacion)
      const planta = p?.planta ?? OTRAS
      const letra = p?.letra ?? ''
      const pas = arbol.get(planta) ?? new Map<string, Nivel[]>()
      pas.set(letra, [
        ...(pas.get(letra) ?? []),
        {
          ubicacion,
          etiqueta: p ? `${p.letra}${p.nivel}` : ubicacion,
          items: [...items].sort((a, b) => a.codigo.localeCompare(b.codigo)),
        },
      ])
      arbol.set(planta, pas)
    }
    return [...arbol.entries()]
      .map(([planta, pas]) => {
        const pasillos = [...pas.entries()]
          .map(([letra, niveles]) => {
            const ordenados = niveles.sort((a, b) => compararUbicaciones(a.ubicacion, b.ubicacion))
            return { letra, niveles: ordenados, total: ordenados.reduce((s, n) => s + n.items.length, 0) }
          })
          .sort((a, b) => a.letra.localeCompare(b.letra))
        return { planta, pasillos, total: pasillos.reduce((s, x) => s + x.total, 0) }
      })
      .sort((a, b) =>
        a.planta === OTRAS ? 1 : b.planta === OTRAS ? -1 : ordenPlanta(a.planta) - ordenPlanta(b.planta) || a.planta.localeCompare(b.planta),
      )
  }, [filtradas])

  const cantUbicaciones = useMemo(() => new Set(filas.map((f) => f.ubicacion ?? SIN_UBICACION)).size, [filas])

  function alternar(k: string) {
    setAbiertas((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }
  // Buscando, todo se abre solo para mostrar lo encontrado
  const estaAbierta = (k: string) => !!q || abiertas.has(k)

  async function confirmarBorrar() {
    if (!borrar || !supabase) return
    setBorrando(true)
    setError(null)
    const { error: e } = await supabase.from('mapeo_deposito').delete().eq('id', borrar.id)
    setBorrando(false)
    if (e) {
      setError(e.message)
    } else {
      const id = borrar.id
      setFilas((prev) => prev.filter((m) => m.id !== id))
    }
    setBorrar(null)
  }

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const datos = [...filas]
      .sort(
        (a, b) =>
          compararUbicaciones(a.ubicacion ?? SIN_UBICACION, b.ubicacion ?? SIN_UBICACION) || a.codigo.localeCompare(b.codigo),
      )
      .map((f) => {
        const p = partes(f.ubicacion ?? '')
        return {
          Planta: p?.planta ?? '',
          Pasillo: p?.letra ?? '',
          Nivel: p?.nivel ?? '',
          Ubicación: f.ubicacion ?? SIN_UBICACION,
          Artículo: f.codigo,
          Descripción: descDe(f.codigo),
        }
      })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Mapeo')
    XLSX.writeFile(wb, `mapeo_deposito_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const chip = (n: number) => (
    <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-500">
      {n} {n === 1 ? 'código' : 'códigos'}
    </span>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Orden mapeado</h1>
        <p className="text-sm text-sub">
          {cantUbicaciones} {cantUbicaciones === 1 ? 'ubicación' : 'ubicaciones'} · {filas.length} códigos
        </p>
      </header>
      <div className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar ubicación, código o descripción…"
              aria-label="Buscar"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
          </div>
          <button
            onClick={() => void cargar()}
            disabled={cargando}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
            title="Actualizar"
          >
            <RefreshCw size={16} aria-hidden className={cargando ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            onClick={() => void exportar()}
            disabled={filas.length === 0}
            className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-60"
          >
            <Download size={16} aria-hidden /> Excel
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>
        )}

        {cargando && filas.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sub">
            <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando mapeo…
          </div>
        ) : plantas.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-sub">
            {busqueda ? 'No hay ubicaciones ni códigos que coincidan.' : 'Todavía no hay nada mapeado.'}
          </p>
        ) : (
          <div className="space-y-3">
            {plantas.map((pl) => {
              const abiertaPl = estaAbierta(pl.planta)
              return (
                <div key={pl.planta} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {/* Nivel 1: planta */}
                  <button
                    onClick={() => alternar(pl.planta)}
                    aria-expanded={abiertaPl}
                    className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface2"
                  >
                    <Layers size={18} aria-hidden className="shrink-0 text-amber-500" />
                    <span className="flex-1 font-display text-base font-bold text-ink">
                      {pl.planta === OTRAS ? 'Otras ubicaciones' : pl.planta}
                      {pl.planta !== OTRAS && nombrePlanta(pl.planta) !== pl.planta && (
                        <span className="ml-2 text-sm font-medium text-sub">{nombrePlanta(pl.planta)}</span>
                      )}
                    </span>
                    {chip(pl.total)}
                    <ChevronDown size={18} aria-hidden className={`shrink-0 text-sub transition-transform ${abiertaPl ? 'rotate-180' : ''}`} />
                  </button>

                  {abiertaPl && (
                    <div className="divide-y divide-line/60 border-t border-line">
                      {pl.pasillos.map((pa) => {
                        const clave = `${pl.planta}|${pa.letra}`
                        const abiertoPa = estaAbierta(clave)
                        return (
                          <div key={clave}>
                            {/* Nivel 2: pasillo */}
                            <button
                              onClick={() => alternar(clave)}
                              aria-expanded={abiertoPa}
                              className="flex min-h-[2.75rem] w-full items-center gap-3 py-2 pl-8 pr-4 text-left transition hover:bg-surface2"
                            >
                              <MapPin size={15} aria-hidden className="shrink-0 text-amber-500" />
                              <span className="flex-1 font-display text-[15px] font-semibold text-ink">
                                {pa.letra ? `Pasillo ${pa.letra}` : 'Sin pasillo'}
                                <span className="ml-2 text-xs font-medium text-sub">
                                  {pa.niveles.length} {pa.niveles.length === 1 ? 'nivel' : 'niveles'}
                                </span>
                              </span>
                              {chip(pa.total)}
                              <ChevronDown size={17} aria-hidden className={`shrink-0 text-sub transition-transform ${abiertoPa ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Nivel 3: cada nivel es una columna (A1, A2 …) */}
                            {abiertoPa && (
                              <div className="overflow-x-auto bg-surface2/50 px-3 py-3 sm:pl-8">
                                <div className="flex gap-3">
                                  {pa.niveles.map((nv) => (
                                    <div key={nv.ubicacion} className="flex w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
                                      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2" title={nv.ubicacion}>
                                        <span className="font-display text-base font-bold text-ink">{nv.etiqueta}</span>
                                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-500">
                                          {nv.items.length}
                                        </span>
                                      </div>
                                      <ul className="divide-y divide-line/40">
                                        {nv.items.map((i) => (
                                          <li key={i.id} className="flex items-start gap-1.5 py-1.5 pl-3 pr-1.5">
                                            <span className="min-w-0 flex-1">
                                              <span className="block text-sm font-semibold text-ink">{i.codigo}</span>
                                              {descDe(i.codigo) && (
                                                <span className="block text-[11px] leading-tight text-sub">{descDe(i.codigo)}</span>
                                              )}
                                            </span>
                                            {puedeBorrar && (
                                              <button
                                                onClick={() => setBorrar(i)}
                                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sub transition hover:bg-brand-600/10 hover:text-brand-400"
                                                title="Quitar de esta ubicación"
                                                aria-label={`Quitar ${i.codigo} de ${nv.ubicacion}`}
                                              >
                                                <Trash2 size={15} aria-hidden />
                                              </button>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <ConfirmDialog
          open={!!borrar}
          title="¿Quitar de la ubicación?"
          message={borrar ? `${borrar.codigo} sale de ${borrar.ubicacion ?? SIN_UBICACION}.` : ''}
          confirmLabel="Quitar"
          busy={borrando}
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </div>
    </Layout>
  )
}
