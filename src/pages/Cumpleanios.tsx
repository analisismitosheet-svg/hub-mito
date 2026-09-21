import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Cake, ChevronLeft, ChevronRight, ImagePlus } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import type { CumpleFila } from '@/components/EditorCumple'
import { supabase } from '@/lib/supabase'
import { FILTRO_EMPLEADOS_ACTIVOS } from '@/lib/empleadosActivos'
const EditorCumple = lazy(() => import('@/components/EditorCumple'))

interface EmpleadoCumple {
  id: string
  nombre: string | null
  legajo: string | null
  fecha_nacimiento: string | null
  lugar: string | null
  activo: boolean | null
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function Cumpleanios() {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
  const [empleados, setEmpleados] = useState<EmpleadoCumple[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorAbierto, setEditorAbierto] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error } = await supabase
      .from('empleados')
      .select('id,nombre,legajo,fecha_nacimiento,lugar,activo')
      .not('fecha_nacimiento', 'is', null)
      .or('estado_legajo.in.(NOMINA ACTIVA,PLANES ACTIVOS),estado_legajo.is.null')
      .or(FILTRO_EMPLEADOS_ACTIVOS)
    if (error) { setError(error.message); setCargando(false); return }
    setEmpleados((data as EmpleadoCumple[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  // Empleados que cumplen en el mes mostrado
  const delMes = useMemo(() => {
    const mapa = new Map<number, EmpleadoCumple[]>()
    for (const e of empleados) {
      if (!e.fecha_nacimiento) continue
      const d = new Date(e.fecha_nacimiento + 'T00:00:00')
      if (isNaN(d.getTime())) continue
      if (d.getMonth() !== mes) continue
      const dia = d.getDate()
      const arr = mapa.get(dia) ?? []
      arr.push(e)
      mapa.set(dia, arr)
    }
    return mapa
  }, [empleados, mes])

  const cumpleMes = useMemo(
    () => Array.from(delMes.values()).reduce((s, arr) => s + arr.length, 0),
    [delMes],
  )

  // Filas ordenadas por día para el editor de imagen
  const filasEditor = useMemo<CumpleFila[]>(() => {
    const out: CumpleFila[] = []
    for (const [dia, arr] of delMes) for (const e of arr) out.push({ nombre: (e.nombre || '').trim() || 'Sin nombre', dia, mes: mes + 1 })
    return out.sort((a, b) => a.dia - b.dia)
  }, [delMes, mes])

  // Celdas del calendario (días del mes + huecos iniciales)
  const celdas = useMemo(() => {
    const primerDia = new Date(anio, mes, 1)
    const diasEnMes = new Date(anio, mes + 1, 0).getDate()
    const offset = primerDia.getDay()
    const out: (number | null)[] = Array(offset).fill(null)
    for (let d = 1; d <= diasEnMes; d++) out.push(d)
    return out
  }, [anio, mes])

  const nombreMes = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][mes]
  const mesAnterior = () => { if (mes === 0) { setMes(11); setAnio((a) => a - 1) } else setMes((m) => m - 1) }
  const mesSiguiente = () => { if (mes === 11) { setMes(0); setAnio((a) => a + 1) } else setMes((m) => m + 1) }
  const irHoy = () => { setMes(hoy.getMonth()); setAnio(hoy.getFullYear()) }

  const hoyDia = hoy.getDate()

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Cake size={22} className="text-pink-500" aria-hidden /> Cumpleaños</h1>
          <p className="text-xs text-sub/70">Calendario mensual de cumpleaños según fecha de nacimiento.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          <button onClick={mesAnterior} className="rounded-lg p-1.5 text-sub transition hover:bg-line hover:text-ink" title="Mes anterior"><ChevronLeft size={16} aria-hidden /></button>
          <button onClick={irHoy} className="rounded-lg px-2 py-1 text-xs font-medium text-sub hover:text-ink" title="Ir al mes actual">{nombreMes} {anio}</button>
          <button onClick={mesSiguiente} className="rounded-lg p-1.5 text-sub transition hover:bg-line hover:text-ink" title="Mes siguiente"><ChevronRight size={16} aria-hidden /></button>
        </div>
        <button
          onClick={() => setEditorAbierto(true)}
          disabled={filasEditor.length === 0}
          className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          title="Generar imagen del listado"
        >
          <ImagePlus size={15} aria-hidden /> Editor imagen
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : (
        <>
          <p className="mb-2 text-sm text-sub">
            <span className="font-medium text-ink">{cumpleMes} cumpleaño{cumpleMes === 1 ? '' : 's'}</span> en {nombreMes} {anio}
          </p>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            <div className="grid grid-cols-7 border-b border-line bg-surface2 text-center text-[11px] font-semibold uppercase tracking-wider text-sub">
              {DIAS.map((d) => <div key={d} className="px-1 py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {celdas.map((dia, i) => (
                <div
                  key={i}
                  className={'min-h-[86px] border-b border-r border-line/50 p-1 ' + (dia == null ? 'bg-surface/40' : '')}
                >
                  {dia != null && (
                    <>
                      <span className={'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ' + (dia === hoyDia && mes === hoy.getMonth() && anio === hoy.getFullYear() ? 'bg-brand-600 text-white' : 'text-sub')}>{dia}</span>
                      {(delMes.get(dia) ?? []).length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {(delMes.get(dia) ?? []).map((e) => (
                            <li key={e.id} className="truncate rounded-md bg-pink-500/15 px-1 py-0.5 text-[10px] leading-tight text-pink-300" title={`${e.nombre || '-'}${e.lugar ? ` · ${e.lugar}` : ''}`}>
                              {e.nombre || '-'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {editorAbierto && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center gap-2 bg-black/70 text-sm text-white">Cargando editor... <Loader2 size={16} className="animate-spin" aria-hidden /></div>}>
          <EditorCumple
            titulo={`${nombreMes} ${anio}`}
            filas={filasEditor}
            onClose={() => setEditorAbierto(false)}
          />
        </Suspense>
      )}
    </Layout>
  )
}