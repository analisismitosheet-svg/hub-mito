import { useEffect, useMemo, useState } from 'react'
import { cajasDeArticulos } from '@/lib/mapeoCajas'
import { suscribirCambios } from '@/lib/realtime'

/* ------------------------------------------------------------------ */
/*  Cajas del Mapeo de cajas (Depósito), siempre al día                */
/*  Igual que useUbicacionesMapeo: si alguien mapea mientras se arma,  */
/*  el chip y el orden cambian solos. Con la pestaña oculta no         */
/*  consulta: queda pendiente y se pide al volver a verla.             */
/* ------------------------------------------------------------------ */

/** código en mayúsculas -> cajas (de menor a mayor) */
export function useCajasMapeo(codigos: string[]): Map<string, number[]> {
  const clave = useMemo(
    () => [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort().join(','),
    [codigos],
  )
  const [cajas, setCajas] = useState<Map<string, number[]>>(new Map())
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!clave) return
    let vivo = true
    cajasDeArticulos(clave.split(','))
      .then((m) => { if (vivo) setCajas(m) })
      .catch(() => { /* sin mapeo de cajas: sin chip */ })
    return () => { vivo = false }
  }, [clave, version])

  const hayCodigos = clave !== ''
  useEffect(() => {
    if (!hayCodigos) return
    let pendiente = false
    const recargar = () => setVersion((v) => v + 1)
    const desuscribir = suscribirCambios(['mapeo_cajas'], () => {
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

  return cajas
}
