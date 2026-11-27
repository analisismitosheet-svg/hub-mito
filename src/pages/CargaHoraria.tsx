import { CalendarClock } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import PlanillaMensual from '@/components/rrhh/PlanillaMensual'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Carga horaria (27/11/2026).                               */
/*  Planilla mensual por local y por legajo (src/components/rrhh/       */
/*  PlanillaMensual.tsx). Ver: rrhh.horarios.view. Modificar: SOLO el   */
/*  admin y el rol rr_hh (también en la base: private.es_rrhh()).       */
/*  Tablas: sql/rrhh_carga_horaria.sql. Import del Excel mensual de     */
/*  horarios: scripts/horarios-excel.                                    */
/* ------------------------------------------------------------------ */

export default function CargaHoraria() {
  const { isAdmin, perfil } = useAuth()
  const puedeEditar = isAdmin || (perfil?.roles ?? []).includes('rr_hh')

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <CalendarClock size={22} className="text-sky-500" aria-hidden /> Carga horaria
        </h1>
        <p className="mt-1 text-sm text-sub">
          Planilla mensual por local. En cada día, <b className="text-ink">entrada</b> y <b className="text-ink">salida</b> (10, 10:30, 17…); vacío = franco.
          En la entrada también va <b className="text-ink">V</b> vacaciones o <b className="text-ink">L</b> licencia; con <b className="text-ink">+</b> se agrega un turno cortado.
        </p>
      </header>
      <PlanillaMensual modo="carga" puedeEditar={puedeEditar} />
    </Layout>
  )
}
