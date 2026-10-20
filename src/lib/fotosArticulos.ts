/**
 * Fotos de artículos (captainfin + zimith).
 *
 * El mapa código -> URL vive en `public/fotos-articulos.json` (lo genera
 * `gen-fotos-articulos.mjs` recorriendo las dos tiendas) para no engordar el
 * bundle: se pide una sola vez y queda cacheado por el navegador.
 */
import { useSyncExternalStore } from 'react'

export type MapaFotos = Record<string, string>

const VACIO: MapaFotos = {}
let mapa: MapaFotos | null = null
let promesa: Promise<MapaFotos> | null = null

const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())

/** Trae el índice de fotos una sola vez (idempotente). */
export function cargarFotos(): Promise<MapaFotos> {
  if (mapa) return Promise.resolve(mapa)
  if (promesa) return promesa
  promesa = fetch(`${import.meta.env.BASE_URL}fotos-articulos.json`)
    .then((r) => (r.ok ? r.json() : VACIO))
    .then((json) => {
      mapa = json && typeof json === 'object' ? (json as MapaFotos) : VACIO
      avisar()
      return mapa
    })
    .catch(() => {
      mapa = VACIO
      avisar()
      return VACIO
    })
  return promesa
}

/** URL de la foto de un artículo (null si todavía no cargó o no tiene). */
export function fotoArticulo(art: string | null | undefined, fotos: MapaFotos): string | null {
  const codigo = String(art ?? '').trim().toUpperCase()
  if (!codigo) return null
  return fotos[codigo] ?? null
}

const suscribir = (cb: () => void) => {
  oyentes.add(cb)
  void cargarFotos()
  return () => {
    oyentes.delete(cb)
  }
}
const leer = () => mapa ?? VACIO

/** Hook: índice de fotos ya cargado (se re-renderiza cuando llega). */
export function useFotosArticulos(): MapaFotos {
  return useSyncExternalStore(suscribir, leer, leer)
}
