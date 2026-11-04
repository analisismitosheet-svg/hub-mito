import { useState } from 'react'
import { Tags, Loader2, Plus, Pencil, Trash2, RotateCcw, Check, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { ICONOS_RUBRO, useRubros, type Rubro } from '@/lib/requerimientos'

/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos → Rubros (requerimientos.rubros).    */
/*  Crear, editar (nombre, ícono, color) y borrar los rubros del       */
/*  formulario. Un rubro con pedidos no se borra: queda oculto (sale   */
/*  del formulario, el historial lo conserva) y se puede reactivar.    */
/*  Tabla requerimientos_rubros (sql/requerimientos.sql).              */
/* ------------------------------------------------------------------ */

interface Edicion { id: number | null; nombre: string; icono: string; color: string }
const NUEVO: Edicion = { id: null, nombre: '', icono: 'Wrench', color: '#0d9488' }

export default function RequerimientosRubros() {
  const { lista, recargar } = useRubros()
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [borrando, setBorrando] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function guardar() {
    if (!supabase || !edicion) return
    setOcupado(true)
    setError(null)
    const { error: e } = await supabase.rpc('requerimiento_rubro_guardar', {
      p_id: edicion.id, p_nombre: edicion.nombre, p_icono: edicion.icono, p_color: edicion.color, p_activo: true,
    })
    setOcupado(false)
    if (e) { setError(e.message); return }
    setAviso(edicion.id ? `Rubro ${edicion.nombre.trim().toUpperCase()} actualizado.` : `Rubro ${edicion.nombre.trim().toUpperCase()} creado.`)
    setEdicion(null)
    void recargar()
  }

  async function borrar(r: Rubro) {
    if (!supabase) return
    setOcupado(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('requerimiento_rubro_borrar', { p_id: r.id })
    setOcupado(false)
    setBorrando(null)
    if (e) { setError(e.message); return }
    setAviso(data === 'ocultado'
      ? `${r.nombre} tiene pedidos cargados: quedó oculto (no aparece en el formulario, el historial lo conserva).`
      : `${r.nombre} borrado.`)
    void recargar()
  }

  async function reactivar(r: Rubro) {
    if (!supabase) return
    const { error: e } = await supabase.rpc('requerimiento_rubro_guardar', {
      p_id: r.id, p_nombre: r.nombre, p_icono: r.icono, p_color: r.color, p_activo: true,
    })
    if (e) setError(e.message)
    else { setAviso(`${r.nombre} vuelve a aparecer en el formulario.`); void recargar() }
  }

  const btn = 'btn-press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-60'

  const formulario = edicion && (
    <div className="space-y-3 rounded-2xl border border-teal-500/40 bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
          placeholder="Nombre del rubro (ej.: AIRE ACONDICIONADO)" aria-label="Nombre"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm uppercase text-ink" />
        <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface2 px-3 text-sm text-sub">
          Color
          <input type="color" value={edicion.color} onChange={(e) => setEdicion({ ...edicion, color: e.target.value })} aria-label="Color" className="h-6 w-8 cursor-pointer bg-transparent" />
        </label>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-sub">Ícono</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ICONOS_RUBRO).map(([clave, Icono]) => (
            <button key={clave} type="button" onClick={() => setEdicion({ ...edicion, icono: clave })} aria-label={clave} aria-pressed={edicion.icono === clave}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${edicion.icono === clave ? 'border-teal-500 bg-teal-500/15' : 'border-line bg-surface2'}`}>
              <Icono size={18} style={{ color: edicion.color }} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void guardar()} disabled={ocupado || edicion.nombre.trim().length < 2}
          className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}>
          {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Guardar
        </button>
        <button type="button" onClick={() => setEdicion(null)} className={`${btn} border border-line bg-surface2 text-ink`}>Cancelar</button>
      </div>
    </div>
  )

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Tags size={22} className="text-teal-500" aria-hidden /> Rubros
          </h1>
          <p className="mt-1 text-sm text-sub">Los rubros que eligen los locales al cargar un requerimiento.</p>
        </div>
        {!edicion && (
          <button type="button" onClick={() => { setEdicion(NUEVO); setAviso(null) }} className={`${btn} bg-teal-600 text-white hover:bg-teal-700`}>
            <Plus size={15} aria-hidden /> Nuevo rubro
          </button>
        )}
      </header>

      {aviso && <p role="status" className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">{aviso}</p>}
      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {edicion?.id === null && <div className="mb-3">{formulario}</div>}

      <ul className="space-y-2">
        {lista.map((r) => {
          const Icono = ICONOS_RUBRO[r.icono] ?? ICONOS_RUBRO.Wrench
          if (edicion?.id === r.id) return <li key={r.id}>{formulario}</li>
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 ${r.activo ? '' : 'opacity-60'}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${r.color}22` }}>
                <Icono size={18} style={{ color: r.color }} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 font-semibold text-ink">
                {r.nombre}
                {!r.activo && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-sub">Oculto</span>}
              </span>
              {borrando === r.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-sub">¿Borrar {r.nombre}?</span>
                  <button type="button" onClick={() => void borrar(r)} disabled={ocupado} className={`${btn} bg-brand-600 text-white`}>
                    {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />} Sí, borrar
                  </button>
                  <button type="button" onClick={() => setBorrando(null)} className={`${btn} border border-line bg-surface2 text-ink`}><X size={15} aria-hidden /></button>
                </span>
              ) : (
                <span className="flex gap-2">
                  <button type="button" onClick={() => { setEdicion({ id: r.id, nombre: r.nombre, icono: r.icono, color: r.color }); setAviso(null) }}
                    className={`${btn} border border-line bg-surface2 text-ink`}>
                    <Pencil size={14} aria-hidden /> Editar
                  </button>
                  {r.activo ? (
                    <button type="button" onClick={() => { setBorrando(r.id); setAviso(null) }} className={`${btn} border border-brand-600/40 bg-brand-600/10 text-brand-400`}>
                      <Trash2 size={14} aria-hidden /> Borrar
                    </button>
                  ) : (
                    <button type="button" onClick={() => void reactivar(r)} className={`${btn} border border-emerald-500/40 bg-emerald-500/10 text-emerald-500`}>
                      <RotateCcw size={14} aria-hidden /> Reactivar
                    </button>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Layout>
  )
}
