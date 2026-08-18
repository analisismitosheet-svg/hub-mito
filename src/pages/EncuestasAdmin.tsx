import { useCallback, useEffect, useState } from 'react'
import {
  Plus,
  Trash2,
  Loader2,
  Star,
  GripVertical,
  Save,
  X,
  Info,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import StarRating from '@/components/StarRating'
import { supabase } from '@/lib/supabase'
import {
  TIPOS_PREGUNTA,
  valoresPorDefecto,
  type Encuesta,
  type Pregunta,
  type PreguntaConfig,
  type TipoPregunta,
  type OpcionConfig,
} from '@/types/encuestas'

const ESCALAS = [3, 4, 5, 7, 10]

function configPorTipo(tipo: TipoPregunta, prev?: PreguntaConfig): PreguntaConfig {
  switch (tipo) {
    case 'estrellas': {
      const max = prev?.max ?? 5
      return { max, medio_punto: prev?.medio_punto ?? false, valores: prev?.valores ?? valoresPorDefecto(max) }
    }
    case 'si_no':
      return { valor_si: prev?.valor_si ?? 1, valor_no: prev?.valor_no ?? 0 }
    case 'opcion_unica':
    case 'opcion_multiple':
      return { opciones: prev?.opciones ?? [{ label: 'Opción 1', valor: 1 }, { label: 'Opción 2', valor: 2 }] }
    case 'numero':
      return { min: prev?.min ?? 0, max_num: prev?.max_num ?? 100 }
    default:
      return {}
  }
}

export default function EncuestasAdmin() {
  const [encuestas, setEncuestas] = useState<Encuesta[]>([])
  const [encId, setEncId] = useState('')
  const [preguntas, setPreguntas] = useState<Pregunta[]>([])
  const [pregId, setPregId] = useState('')
  const [form, setForm] = useState<Pregunta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const enc = encuestas.find((e) => e.id === encId) ?? null

  const cargarEncuestas = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('encuestas')
      .select('id, nombre, descripcion, contexto, publica, estado, version, created_at, updated_at')
      .order('created_at')
    const lista = (data as Encuesta[]) ?? []
    setEncuestas(lista)
    setEncId((cur) => cur || lista[0]?.id || '')
    setCargando(false)
  }, [])

  const cargarPreguntas = useCallback(async (eId: string) => {
    if (!supabase || !eId) return
    const { data } = await supabase
      .from('encuesta_preguntas')
      .select('id, encuesta_id, orden, texto, ayuda, tipo, obligatoria, estado, config, version, created_at, updated_at')
      .eq('encuesta_id', eId)
      .order('orden')
    setPreguntas((data as Pregunta[]) ?? [])
  }, [])

  useEffect(() => {
    cargarEncuestas()
  }, [cargarEncuestas])
  useEffect(() => {
    if (encId) {
      cargarPreguntas(encId)
      setPregId('')
      setForm(null)
    }
  }, [encId, cargarPreguntas])
  useEffect(() => {
    setForm(preguntas.find((p) => p.id === pregId) ?? null)
  }, [pregId, preguntas])

  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg((m) => (m === t ? null : m)), 2500)
  }

  // ---- Encuestas ----
  async function crearEncuesta() {
    if (!supabase) return
    const { data } = await supabase
      .from('encuestas')
      .insert({ nombre: 'Nueva encuesta', contexto: 'local', publica: false, estado: 'borrador' })
      .select('id')
      .single()
    await cargarEncuestas()
    if (data) setEncId((data as { id: string }).id)
  }
  async function guardarEncuesta(patch: Partial<Encuesta>) {
    if (!supabase || !enc) return
    setEncuestas((list) => list.map((e) => (e.id === enc.id ? { ...e, ...patch } : e)))
    await supabase.from('encuestas').update(patch).eq('id', enc.id)
  }
  async function eliminarEncuesta() {
    if (!supabase || !enc) return
    if (!confirm(`¿Eliminar la encuesta "${enc.nombre}" y todas sus respuestas?`)) return
    await supabase.from('encuestas').delete().eq('id', enc.id)
    setEncId('')
    await cargarEncuestas()
  }

  // ---- Preguntas ----
  async function crearPregunta() {
    if (!supabase || !enc) return
    const orden = (preguntas[preguntas.length - 1]?.orden ?? 0) + 1
    const { data } = await supabase
      .from('encuesta_preguntas')
      .insert({
        encuesta_id: enc.id,
        orden,
        texto: 'Nueva pregunta',
        tipo: 'estrellas',
        obligatoria: true,
        estado: 'activa',
        config: configPorTipo('estrellas'),
      })
      .select('id')
      .single()
    await cargarPreguntas(enc.id)
    if (data) setPregId((data as { id: string }).id)
  }

  async function guardarPregunta() {
    if (!supabase || !form) return
    setGuardando(true)
    const patch = {
      texto: form.texto,
      ayuda: form.ayuda,
      tipo: form.tipo,
      obligatoria: form.obligatoria,
      estado: form.estado,
      orden: form.orden,
      config: form.config,
      version: form.version + 1, // versiona: respuestas nuevas usan esta versión
    }
    const { error } = await supabase.from('encuesta_preguntas').update(patch).eq('id', form.id)
    setGuardando(false)
    if (error) {
      flash('No se pudo guardar')
      return
    }
    await cargarPreguntas(form.encuesta_id)
    flash('Guardado')
  }

  async function eliminarPregunta() {
    if (!supabase || !form) return
    if (!confirm(`¿Eliminar la pregunta "${form.texto}"?`)) return
    await supabase.from('encuesta_preguntas').delete().eq('id', form.id)
    setPregId('')
    await cargarPreguntas(form.encuesta_id)
  }

  function upd(patch: Partial<Pregunta>) {
    setForm((f) => (f ? { ...f, ...patch } : f))
  }
  function updConfig(patch: Partial<PreguntaConfig>) {
    setForm((f) => (f ? { ...f, config: { ...f.config, ...patch } } : f))
  }

  if (cargando) {
    return (
      <Layout>
        <BackButton />
        <p className="mt-4 text-sm text-sub">Cargando…</p>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />

      <header className="mb-5 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Encuestas</h1>
          <p className="mt-1 text-sm text-sub">Configurá las preguntas y el tipo de respuesta de cada encuesta.</p>
        </div>
        {msg && (
          <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
            {msg}
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* ===== Columna izquierda ===== */}
        <aside className="space-y-4">
          {/* Selector + settings de encuesta */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <select
                value={encId}
                onChange={(e) => setEncId(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
              >
                {encuestas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
              <button onClick={crearEncuesta} title="Nueva encuesta" className="btn-press rounded-lg border border-line p-2 text-sub hover:text-ink">
                <Plus size={16} aria-hidden />
              </button>
            </div>

            {enc && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs text-sub">Nombre</label>
                  <input
                    value={enc.nombre}
                    onChange={(e) => setEncuestas((l) => l.map((x) => (x.id === enc.id ? { ...x, nombre: e.target.value } : x)))}
                    onBlur={(e) => guardarEncuesta({ nombre: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-sub">Descripción</label>
                  <input
                    value={enc.descripcion ?? ''}
                    onChange={(e) => setEncuestas((l) => l.map((x) => (x.id === enc.id ? { ...x, descripcion: e.target.value } : x)))}
                    onBlur={(e) => guardarEncuesta({ descripcion: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-sub">Estado</label>
                    <select
                      value={enc.estado}
                      onChange={(e) => guardarEncuesta({ estado: e.target.value as Encuesta['estado'] })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface2 px-2 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
                    >
                      <option value="borrador">Borrador</option>
                      <option value="activa">Activa</option>
                      <option value="inactiva">Inactiva</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-sub">Contexto</label>
                    <select
                      value={enc.contexto}
                      onChange={(e) => guardarEncuesta({ contexto: e.target.value as Encuesta['contexto'] })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface2 px-2 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
                    >
                      <option value="local">Por local</option>
                      <option value="general">General</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
                  <span className="text-sm text-ink">Pública (sin login)</span>
                  <button
                    type="button"
                    onClick={() => guardarEncuesta({ publica: !enc.publica })}
                    className={`relative h-6 w-11 rounded-full transition ${enc.publica ? 'bg-brand-600' : 'bg-line2'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${enc.publica ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>
                <button onClick={eliminarEncuesta} className="btn-press flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
                  <Trash2 size={14} aria-hidden /> Eliminar encuesta
                </button>
              </div>
            )}
          </div>

          {/* Lista de preguntas */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Preguntas</h2>
            <div className="space-y-1.5">
              {preguntas.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setPregId(p.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                    p.id === pregId ? 'border-brand-500 bg-brand-600/10' : 'border-line bg-surface2 hover:border-line2'
                  }`}
                >
                  <GripVertical size={14} className="shrink-0 text-sub" aria-hidden />
                  <span className="text-xs text-sub">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{p.texto}</span>
                    <span className="text-xs text-brand-400">
                      {TIPOS_PREGUNTA.find((t) => t.value === p.tipo)?.label}
                      {p.estado === 'inactiva' && ' · inactiva'}
                    </span>
                  </span>
                </button>
              ))}
              {preguntas.length === 0 && <p className="text-sm text-sub">Todavía no hay preguntas.</p>}
            </div>
            <button
              onClick={crearPregunta}
              disabled={!enc}
              className="btn-press mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line2 py-2 text-sm text-sub hover:text-ink disabled:opacity-50"
            >
              <Plus size={15} aria-hidden /> Agregar pregunta
            </button>
          </div>
        </aside>

        {/* ===== Editor de pregunta ===== */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          {!form ? (
            <div className="flex h-full min-h-[280px] items-center justify-center text-center text-sm text-sub">
              Elegí una pregunta a la izquierda o agregá una nueva.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-ink">Editar pregunta</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPregId('')} className="btn-press flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-sub hover:text-ink">
                    <X size={14} aria-hidden /> Cerrar
                  </button>
                  <button onClick={guardarPregunta} disabled={guardando} className="btn-press flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                    {guardando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}
                    Guardar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-xs text-sub">Texto de la pregunta *</label>
                  <input
                    value={form.texto}
                    onChange={(e) => upd({ texto: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-sub">Descripción / Ayuda (opcional)</label>
                  <input
                    value={form.ayuda ?? ''}
                    onChange={(e) => upd({ ayuda: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-sub">Tipo de respuesta *</label>
                  <select
                    value={form.tipo}
                    onChange={(e) => {
                      const tipo = e.target.value as TipoPregunta
                      upd({ tipo, config: configPorTipo(tipo, form.config) })
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
                  >
                    {TIPOS_PREGUNTA.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-sub">¿Es obligatoria?</label>
                  <div className="mt-1 flex gap-1 rounded-lg border border-line bg-surface2 p-1">
                    {[
                      { v: false, l: 'No' },
                      { v: true, l: 'Sí' },
                    ].map((o) => (
                      <button
                        key={o.l}
                        onClick={() => upd({ obligatoria: o.v })}
                        className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
                          form.obligatoria === o.v ? 'bg-brand-600 text-white' : 'text-sub hover:text-ink'
                        }`}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-sub">Estado</label>
                  <select
                    value={form.estado}
                    onChange={(e) => upd({ estado: e.target.value as Pregunta['estado'] })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
                  >
                    <option value="activa">Activa</option>
                    <option value="inactiva">Inactiva</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-sub">Orden</label>
                  <input
                    type="number"
                    value={form.orden}
                    onChange={(e) => upd({ orden: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
                  />
                </div>
              </div>

              {/* Config por tipo */}
              <ConfigEditor form={form} updConfig={updConfig} />

              <button onClick={eliminarPregunta} className="btn-press flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
                <Trash2 size={14} aria-hidden /> Eliminar pregunta
              </button>
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}

/* ===================== Editores de configuración por tipo ===================== */

function ConfigEditor({ form, updConfig }: { form: Pregunta; updConfig: (p: Partial<PreguntaConfig>) => void }) {
  const cfg = form.config

  if (form.tipo === 'estrellas') {
    const max = cfg.max ?? 5
    const valores = cfg.valores ?? valoresPorDefecto(max)
    return (
      <div className="rounded-xl border border-line bg-surface2 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Configuración de estrellas</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-sub">Cantidad de estrellas *</label>
              <select
                value={max}
                onChange={(e) => {
                  const nuevo = Number(e.target.value)
                  const prev = new Map((cfg.valores ?? []).map((v) => [v.estrellas, v.valor]))
                  const valoresNuevos = Array.from({ length: nuevo }, (_, i) => ({
                    estrellas: i + 1,
                    valor: prev.get(i + 1) ?? i + 1,
                  }))
                  updConfig({ max: nuevo, valores: valoresNuevos })
                }}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
              >
                {ESCALAS.map((n) => (
                  <option key={n} value={n}>
                    {n} estrellas
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <span className="text-sm text-ink">Permitir medio punto</span>
              <button
                type="button"
                onClick={() => updConfig({ medio_punto: !cfg.medio_punto })}
                className={`relative h-6 w-11 rounded-full transition ${cfg.medio_punto ? 'bg-brand-600' : 'bg-line2'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${cfg.medio_punto ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </label>
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="mb-1 text-xs text-sub">Vista previa</p>
              <StarRating value={max} max={max} readOnly size={22} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-sub">Valor por cantidad de estrellas</p>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface text-left text-xs text-sub">
                    <th className="px-3 py-2 font-medium">Estrellas</th>
                    <th className="px-3 py-2 font-medium">Valor</th>
                    <th className="px-3 py-2 font-medium">Vista previa</th>
                  </tr>
                </thead>
                <tbody>
                  {valores.map((v, idx) => (
                    <tr key={v.estrellas} className="border-t border-line">
                      <td className="px-3 py-1.5 text-ink">{v.estrellas} {v.estrellas === 1 ? 'estrella' : 'estrellas'}</td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="any"
                          value={v.valor}
                          onChange={(e) => {
                            const nv = valores.map((x, i) => (i === idx ? { ...x, valor: Number(e.target.value) } : x))
                            updConfig({ valores: nv })
                          }}
                          className="w-24 rounded-md border border-line bg-surface2 px-2 py-1 text-ink outline-none focus-visible:border-brand-500"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <StarRating value={v.estrellas} max={max} readOnly size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-sub">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
              El valor de cada estrella se usa para cálculos y estadísticas. Los resultados ya guardados no cambian.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (form.tipo === 'si_no') {
    return (
      <div className="rounded-xl border border-line bg-surface2 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Valores Sí / No</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-sub">Valor si "Sí"</label>
            <input
              type="number"
              step="any"
              value={cfg.valor_si ?? 1}
              onChange={(e) => updConfig({ valor_si: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-sub">Valor si "No"</label>
            <input
              type="number"
              step="any"
              value={cfg.valor_no ?? 0}
              onChange={(e) => updConfig({ valor_no: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
            />
          </div>
        </div>
      </div>
    )
  }

  if (form.tipo === 'opcion_unica' || form.tipo === 'opcion_multiple') {
    const opciones = cfg.opciones ?? []
    const setOpc = (nuevo: OpcionConfig[]) => updConfig({ opciones: nuevo })
    return (
      <div className="rounded-xl border border-line bg-surface2 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Opciones</h3>
        <div className="space-y-2">
          {opciones.map((o, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={o.label}
                onChange={(e) => setOpc(opciones.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                placeholder="Etiqueta"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
              />
              <input
                type="number"
                step="any"
                value={o.valor}
                onChange={(e) => setOpc(opciones.map((x, i) => (i === idx ? { ...x, valor: Number(e.target.value) } : x)))}
                className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
              />
              <button onClick={() => setOpc(opciones.filter((_, i) => i !== idx))} className="btn-press rounded-lg border border-line p-2 text-sub hover:text-brand-400">
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setOpc([...opciones, { label: `Opción ${opciones.length + 1}`, valor: opciones.length + 1 }])}
          className="btn-press mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-line2 px-3 py-1.5 text-sm text-sub hover:text-ink"
        >
          <Plus size={14} aria-hidden /> Agregar opción
        </button>
      </div>
    )
  }

  if (form.tipo === 'numero') {
    return (
      <div className="rounded-xl border border-line bg-surface2 p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Rango numérico</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-sub">Mínimo</label>
            <input
              type="number"
              step="any"
              value={cfg.min ?? 0}
              onChange={(e) => updConfig({ min: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-sub">Máximo</label>
            <input
              type="number"
              step="any"
              value={cfg.max_num ?? 100}
              onChange={(e) => updConfig({ max_num: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus-visible:border-brand-500"
            />
          </div>
        </div>
      </div>
    )
  }

  // texto, fecha: sin configuración extra
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 p-4 text-sm text-sub">
      <Star size={15} className="text-sub" aria-hidden />
      Este tipo de respuesta no necesita configuración adicional.
    </div>
  )
}
