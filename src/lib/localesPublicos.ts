/**
 * Locales al público de la consulta de precios (/precios): nombre y ubicación.
 *
 * La lista y las coordenadas vienen EN VIVO de la RPC `precios_publicos_locales`
 * (sql/precios_publicos.sql), que lee el mapa del tracking de transporte (`tracking_bases`):
 * si se corrige un punto en el mapa, la consulta lo toma. Los códigos son los de
 * `public.locales` y los mismos de STOCK_PUBLICO_LOCALES del puente (sin MITO, INDO, fábrica,
 * Polo 52 ni franquicias). Mientras carga (o si falla) se usa la lista de abajo, sin coordenadas.
 *
 * La ubicación del cliente se usa SOLO en su celular para elegir el local más cercano:
 * nunca se manda al servidor.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface LocalPublico {
  codigo: string
  nombre: string
  lat: number | null
  lng: number | null
}

const RESPALDO: LocalPublico[] = [
  ['9DEJULIO', '9 de Julio'], ['BUSTOD', 'Bustos'], ['CFD', 'Captain Fin Bustos'],
  ['CFPO', 'Captain Fin Patio Olmos'], ['CFRA', 'Captain Fin Rivera Indarte'], ['CFR4', 'Captain Fin Río Cuarto'],
  ['CFR9', 'Captain Fin Ruta 9'], ['VCPD', 'Carlos Paz'], ['DINOD', 'Dino R20'],
  ['ESPINOD', 'Espinosa'], ['GPAZD', 'General Paz Outlet'], ['LIBERD', 'Libertad'], ['MUNOZ', 'Muñoz'],
  ['NVOCED', 'Nuevo Centro'], ['RIVERAD', 'Rivera'], ['RUTA9D2', 'Ruta 9'], ['WALMARTD', 'Walmart'],
].map(([codigo, nombre]) => ({ codigo, nombre, lat: null, lng: null }))

/** Locales de la consulta (la lista de respaldo hasta que llega la del mapa). */
export function useLocalesPublicos(): LocalPublico[] {
  const [locales, setLocales] = useState<LocalPublico[]>(RESPALDO)
  useEffect(() => {
    if (!supabase) return
    let vivo = true
    void supabase.rpc('precios_publicos_locales').then(({ data }) => {
      if (!vivo || !Array.isArray(data) || !data.length) return
      const lista = (data as Array<Record<string, unknown>>)
        .map((l) => ({
          codigo: String(l.codigo ?? ''),
          nombre: String(l.nombre ?? l.codigo ?? ''),
          lat: typeof l.lat === 'number' ? l.lat : null,
          lng: typeof l.lng === 'number' ? l.lng : null,
        }))
        .filter((l) => l.codigo)
      if (lista.length) setLocales(lista)
    })
    return () => {
      vivo = false
    }
  }, [])
  return locales
}

export const localPorCodigo = (locales: LocalPublico[], cod: string | null | undefined) =>
  locales.find((l) => l.codigo === String(cod ?? '').toUpperCase()) ?? null

/** Distancia en metros (haversine). */
export function metros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Locales ordenados por distancia a un punto (los que no tienen ubicación en el mapa van al final). */
export function porCercania(locales: LocalPublico[], lat: number, lng: number): Array<LocalPublico & { distancia: number }> {
  return locales
    .map((l) => ({ ...l, distancia: l.lat != null && l.lng != null ? metros(lat, lng, l.lat, l.lng) : Infinity }))
    .sort((a, b) => a.distancia - b.distancia)
}

/** Dentro de esta distancia (más la precisión del GPS) se considera que el cliente está en el local. */
export const RADIO_EN_LOCAL_M = 250
