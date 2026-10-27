import { useEffect, useMemo, useState } from 'react'
import { ubicacionesDeArticulos } from '@/lib/mapeo'
import { suscribirCambios } from '@/lib/realtime'

/* ------------------------------------------------------------------ */
/*  Ubicaciones del Mapeo depósito, siempre al día                     */
/*                                                                     */
/*  Carga las ubicaciones de esos artículos y las vuelve a pedir cada  */
/*  vez que alguien mapea (Realtime sobre mapeo_deposito,              */
/*  sql/mapeo_realtime.sql): si mueven un artículo mientras están      */
/*  usando Mi repo / el armado, el chip y el orden cambian solos.      */
/*  Con la pestaña oculta no consulta: queda pendiente y se pide al    */
/*  volver a verla (la base no aguanta sondeos de PCs en segundo plano)*/
/* ------------------------------------------------------------------ */

/** código en mayúsculas -> ubicaciones ordenadas (PB-A1, …) */
export function useUbicacionesMapeo(codigos: string[]): Map<string, string[]> {
  const clave = useMemo(
    () => [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort().join(','),
    [codigos],
  )
  const [ubicaciones, setUbicaciones] = useState<Map<string, string[]>>(new Map())
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!clave) return
    let vivo = true
    ubicacionesDeArticulos(clave.split(','))
      .then((m) => { if (vivo) setUbicaciones(m) })
      .catch(() => { /* sin mapeo: sin ubicaciones */ })
    return () => { vivo = false }
  }, [clave, version])

  const hayCodigos = clave !== ''
  useEffect(() => {
    if (!hayCodigos) return
    let pendiente = false
    const recargar = () => setVersion((v) => v + 1)
    // Una ráfaga de escaneos del mapeo = una sola recarga
    const desuscribir = suscribirCambios(['mapeo_deposito'], () => {
      if (document.visibilityState === 'visible') recargar()
      else pendiente = true
    }, { espera: 1500 })
    const alVolver = () => {
      if (document.visibilityState === 'visible' && pendiente) {
        pendiente = false
        recargar()
      }
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      desuscribir()
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [hayCodigos])

  return ubicaciones
}
