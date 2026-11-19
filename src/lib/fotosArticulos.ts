/**
 * Fotos de artículos (captainfin + zimith).
 *
 * El mapa código -> fotos vive en `public/fotos-articulos.json` (lo genera
 * `gen-fotos-articulos.mjs` recorriendo las dos tiendas) para no engordar el
 * bundle: se pide una sola vez y queda cacheado por el navegador.
 *
 * Cada artículo tiene varias fotos (varios colores / ángulos). La primera es
 * la que se usa como miniatura y el zoom muestra la galería completa.
 */
import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'

export type MapaFotos = Record<string, string[]>

const HOST = 'https://bunny-cdn.ventasxmayor.com/'
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

/*
 * Respaldo: si el código no está en el JSON, se busca en Supabase (public.articulos_fotos),
 * que el puente actualiza todos los días con las fotos de indonesiashop.com.ar y de
 * Captain Fin / Zimith (sync-fotos-tiendanube.js). Se pide de a lotes y queda en memoria.
 */
const extra = new Map<string, string[]>()
const pedidos = new Set<string>()
let cola: string[] = []
let temporizador: ReturnType<typeof setTimeout> | null = null
const ORIGEN_ORDEN: Record<string, number> = { ventasxmayor: 0, indonesiashop: 1 }

function pedirExtra(codigo: string) {
  if (!supabase || pedidos.has(codigo)) return
  pedidos.add(codigo)
  cola.push(codigo)
  if (temporizador) return
  temporizador = setTimeout(() => {
    temporizador = null
    const lote = cola
    cola = []
    void (async () => {
      for (let i = 0; i < lote.length; i += 200) {
        const parte = lote.slice(i, i + 200)
        const { data, error } = await supabase!.from('articulos_fotos').select('id_art,origen,fotos').in('id_art', parte)
        if (error) continue
        const filas = ((data ?? []) as { id_art: string; origen: string; fotos: string[] | null }[])
          .sort((a, b) => (ORIGEN_ORDEN[a.origen] ?? 9) - (ORIGEN_ORDEN[b.origen] ?? 9))
        for (const f of filas) {
          const k = String(f.id_art).toUpperCase()
          const previas = extra.get(k) ?? []
          extra.set(k, [...previas, ...(f.fotos ?? []).filter((u) => u && !previas.includes(u))])
        }
      }
      // nueva referencia del mapa para que los componentes se vuelvan a dibujar
      if (mapa) mapa = { ...mapa }
      avisar()
    })()
  }, 60)
}

/** URLs completas de las fotos de un artículo (vacío si todavía no cargó o no tiene). */
export function fotosArticulo(art: string | null | undefined, fotos: MapaFotos): string[] {
  const codigo = String(art ?? '').trim().toUpperCase()
  if (!codigo) return []
  const lista = fotos[codigo]
  if (!lista || !lista.length) {
    if (mapa) {
      const otras = extra.get(codigo)
      if (otras) return otras.map((u) => (u.startsWith('http') ? u : HOST + u))
      pedirExtra(codigo)
    }
    return []
  }
  return lista.map((u) => (u.startsWith('http') ? u : HOST + u))
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
