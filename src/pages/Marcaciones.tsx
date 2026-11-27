import { useCallback, useRef, useState, type ChangeEvent } from 'react'
import { Fingerprint, Loader2, Upload, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import PlanillaMensual from '@/components/rrhh/PlanillaMensual'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { cruzar, leerExcelReloj, type Resultado } from '@/lib/marcacionesExcel'
import { ddmm, type Emp } from '@/lib/horarios'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Marcaciones (27/11/2026).                                 */
/*  La misma planilla mensual que Carga horaria, con lo que fichó el    */
/*  reloj (rrhh_marcaciones) comparado contra lo planificado: ausente,  */
/*  tarde, salió temprano, falta una fichada.                           */
/*  Las marcaciones se suben desde el Excel del reloj                   */
/*  (src/lib/marcacionesExcel.ts detecta las columnas). Subir: solo     */
/*  admin y rol rr_hh. Ver: rrhh.marcaciones.view.                       */
/* ------------------------------------------------------------------ */

interface Previa { archivo: string; formato: string; periodo?: string; columnas: string[]; resultados: Resultado[]; sinLegajo: string[]; desde: string; hasta: string }

export default function Marcaciones() {
  const { isAdmin, perfil } = useAuth()
  const puedeSubir = isAdmin || (perfil?.roles ?? []).includes('rr_hh')
  const [emps, setEmps] = useState<Emp[]>([])
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [recargar, setRecargar] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const onEmpleados = useCallback((e: Emp[]) => setEmps(e), [])

  async function elegir(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setError(null); setAviso(null); setPrevia(null); setOcupado(true)
    try {
      const l = await leerExcelReloj(file)
      if (!l.dias.length) {
        setError('No encontré fichadas en el archivo. Necesito una columna de legajo (o nombre) y otra de fecha y hora (o fecha y hora por separado, o entrada/salida). Pasame el archivo y lo adapto.')
        return
      }
      const { resultados, sinLegajo } = cruzar(l.dias, emps)
      const fechas = resultados.map((r) => r.fecha).sort()
      setPrevia({ archivo: file.name, formato: l.formato, periodo: l.periodo, columnas: l.columnas, resultados, sinLegajo, desde: fechas[0] ?? '', hasta: fechas[fechas.length - 1] ?? '' })
    } catch (e) {
      setError(`No se pudo leer el Excel: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
    }
  }

  async function guardar() {
    if (!supabase || !previa) return
    setOcupado(true); setError(null)
    const filas = previa.resultados.map((r) => ({ ...r, archivo: previa.archivo, cargado_at: new Date().toISOString() }))
    for (let i = 0; i < filas.length; i += 500) {
      const { error: e } = await supabase.from('rrhh_marcaciones').upsert(filas.slice(i, i + 500), { onConflict: 'legajo,fecha' })
      if (e) { setError(e.message); setOcupado(false); return }
    }
    setOcupado(false)
    setAviso(`Se guardaron ${filas.length} días de marcaciones (${ddmm(previa.desde)} al ${ddmm(previa.hasta)}).`)
    setPrevia(null)
    setRecargar((n) => n + 1)
  }

  const personas = previa ? new Set(previa.resultados.map((r) => r.legajo)).size : 0
  const incompletas = previa ? previa.resultados.filter((r) => r.incompleta).length : 0
  const manuales = previa ? previa.resultados.reduce((n, r) => n + r.marcas.split(' ').filter((m) => m.endsWith('M')).length, 0) : 0

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Fingerprint size={22} className="text-fuchsia-500" aria-hidden /> Marcaciones
        </h1>
        <p className="mt-1 text-sm text-sub">
          Lo que fichó el reloj, día por día, contra la carga horaria: ausencias, llegadas tarde, salidas temprano y fichadas que faltan.
          Pasá el mouse por un día para ver lo planificado y las fichadas.
        </p>
      </header>

      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      {aviso && <p className="mb-3 text-sm text-emerald-500">{aviso}</p>}

      {previa && (
        <div className="mb-4 rounded-2xl border border-fuchsia-500/40 bg-fuchsia-500/10 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-ink">{previa.archivo}</p>
              <p className="text-xs text-sub">Formato: {previa.formato} · columnas: {previa.columnas.join(', ')}</p>
            </div>
            <button onClick={() => setPrevia(null)} className="rounded-lg p-1 text-sub hover:text-ink" aria-label="Cancelar"><X size={16} /></button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {[
              ['Días con fichadas', String(previa.resultados.length)],
              ['Personas', String(personas)],
              ['Período', previa.periodo ?? (previa.desde ? `${ddmm(previa.desde)} al ${ddmm(previa.hasta)}` : '—')],
              ['Sin pareja / manuales', `${incompletas} / ${manuales}`],
            ].map(([t, v]) => (
              <div key={t} className="rounded-xl border border-line bg-surface px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-sub/70">{t}</p>
                <p className="text-lg font-semibold tabular-nums text-ink">{v}</p>
              </div>
            ))}
          </div>
          {previa.sinLegajo.length > 0 && (
            <p className="mt-3 text-xs text-amber-500">
              Sin legajo en el hub ({previa.sinLegajo.length}, no se guardan): {previa.sinLegajo.slice(0, 30).join(' · ')}{previa.sinLegajo.length > 30 ? '…' : ''}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void guardar()} disabled={ocupado || !previa.resultados.length} className="btn-press flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {ocupado && <Loader2 size={14} className="animate-spin" />} Guardar marcaciones
            </button>
            <span className="text-xs text-sub">Si un legajo ya tenía marcaciones ese día, se reemplazan.</span>
          </div>
        </div>
      )}

      <PlanillaMensual
        modo="marcaciones"
        puedeEditar={false}
        recargar={recargar}
        onEmpleados={onEmpleados}
        acciones={puedeSubir && (
          <>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void elegir(e)} />
            <button
              onClick={() => input.current?.click()} disabled={ocupado || !emps.length}
              className="btn-press flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {ocupado ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Subir Excel del reloj
            </button>
          </>
        )}
      />
    </Layout>
  )
}
