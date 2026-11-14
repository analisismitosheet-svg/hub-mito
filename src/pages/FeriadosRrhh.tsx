import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarOff, Trash2, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Feriados.                                                 */
/*  Un día y las bases que no abren (varias de una vez, o todas).       */
/*  - Locales → Objetivos: ese día no llevan objetivo                   */
/*    (la RPC objetivos_locales_dia lee esta tabla).                    */
/*  - Repo automática: no corre si cierran todos, Fábrica o Polo 52     */
/*    (repo_auto_pendiente); al día siguiente suma ese día.             */
/*  - Cascada: el local con feriado ese día no dona ni recibe           */
/*    (feriados_hoy_puente → puente-sql/cascada.js).                    */
/*  Cargan y quitan rrhh.feriados.edit y el admin; rrhh.feriados.view   */
/*  solo mira. Tabla: objetivos_feriados (una fila por local; null =    */
/*  todos). sql/objetivos_locales.sql + sql/repo_auto_feriados.sql.     */
/* ------------------------------------------------------------------ */

interface Feriado { id: number; fecha: string; local: string | null; motivo: string | null }
interface Base { codigo: string; nombre: string }

/** Bases que no están en la tabla de locales (o que van aparte): sin objetivo, frenan la repo automática. */
const OTRAS: Base[] = [
  { codigo: 'INDOD', nombre: 'FÁBRICA (MITO / DEPÓSITO INDO)' },
  { codigo: 'POLO52', nombre: 'POLO 52' },
]
const FRENAN_REPO = new Set(OTRAS.map((b) => b.codigo))
/** Tiene objetivo pero no está en la tabla de locales */
const EXTRA_LOCALES: Base[] = [{ codigo: 'WEB', nombre: 'WEB (tienda online)' }]
const TODOS = '*'

const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export default function FeriadosRrhh() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('rrhh.feriados.edit')
  const [locales, setLocales] = useState<Base[]>([])
  const [lista, setLista] = useState<Feriado[]>([])
  const [fecha, setFecha] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    if (supabase) void supabase.from('locales').select('codigo,nombre').eq('activo', true).then(({ data }) => {
      const otras = new Set(OTRAS.map((b) => b.codigo))
      const ls = ((data as { codigo: string; nombre: string | null }[] | null) ?? [])
        .map((l) => ({ codigo: l.codigo.toUpperCase(), nombre: (l.nombre || l.codigo).toUpperCase() }))
        .filter((l) => !otras.has(l.codigo))
      for (const e of EXTRA_LOCALES) if (!ls.some((l) => l.codigo === e.codigo)) ls.push(e)
      setLocales(ls.sort((a, b) => a.nombre.localeCompare(b.nombre)))
    })
  }, [])
  const nom = useCallback((l: string | null) => {
    if (l == null) return 'Todos los locales'
    const c = l.toUpperCase()
    return [...OTRAS, ...locales].find((x) => x.codigo === c)?.nombre ?? l
  }, [locales])

  const cargarLista = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('objetivos_feriados').select('id,fecha,local,motivo').order('fecha', { ascending: false })
    if (e) setError(e.message)
    setLista((data as Feriado[] | null) ?? [])
  }, [])
  useEffect(() => { void cargarLista() }, [cargarLista])

  function alternar(c: string) {
    setAviso(null)
    setSel((prev) => {
      if (c === TODOS) return prev.has(TODOS) ? new Set() : new Set([TODOS])
      const n = new Set(prev)
      n.delete(TODOS)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })
  }

  const todos = sel.has(TODOS)
  const elegidos = [...sel].filter((c) => c !== TODOS)
  const otrasSel = elegidos.filter((c) => FRENAN_REPO.has(c))
  const localesSel = elegidos.filter((c) => !FRENAN_REPO.has(c))
  const cuantos = todos ? 0 : elegidos.length

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !fecha || (!todos && !elegidos.length)) return
    const ya = new Set(lista.filter((f) => f.fecha === fecha).map((f) => (f.local ?? TODOS).toUpperCase()))
    const nuevos = (todos ? [TODOS] : elegidos).filter((c) => !ya.has(c))
    if (!nuevos.length) { setAviso('Esas bases ya tienen ese feriado cargado.'); return }
    setOcupado(true)
    setError(null)
    const { error: err } = await supabase.from('objetivos_feriados').insert(
      nuevos.map((c) => ({ fecha, local: c === TODOS ? null : c, motivo: motivo.trim() || null })),
    )
    setOcupado(false)
    if (err) { setError(err.code === '23505' ? 'Ese feriado ya está cargado.' : err.message); return }
    const salteados = (todos ? 1 : elegidos.length) - nuevos.length
    setAviso(`Feriado del ${ddmmaaaa(fecha)} cargado${salteados ? ` (${salteados} ya estaba${salteados > 1 ? 'n' : ''})` : ''}.`)
    setSel(new Set())
    setMotivo('')
    await cargarLista()
  }

  async function quitar(ids: number[]) {
    if (!supabase || !ids.length) return
    const { error: err } = await supabase.from('objetivos_feriados').delete().in('id', ids)
    if (err) { setError(err.message); return }
    await cargarLista()
  }

  // Una fila por día con las bases como etiquetas
  const grupos = useMemo(() => {
    const m = new Map<string, { fecha: string; items: Feriado[]; motivos: Set<string> }>()
    for (const f of lista) {
      if (!m.has(f.fecha)) m.set(f.fecha, { fecha: f.fecha, items: [], motivos: new Set() })
      const g = m.get(f.fecha)!
      g.items.push(f)
      if (f.motivo) g.motivos.add(f.motivo)
    }
    for (const g of m.values()) g.items.sort((a, b) => (a.local == null ? -1 : b.local == null ? 1 : nom(a.local).localeCompare(nom(b.local))))
    return [...m.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [lista, nom])

  const chip = (c: string, texto: string, extra = '') => {
    const on = sel.has(c)
    return (
      <button
        key={c}
        type="button"
        onClick={() => alternar(c)}
        aria-pressed={on}
        className={`btn-press rounded-lg border px-2.5 py-1 text-xs transition ${extra} ${
          on ? 'border-orange-500/60 bg-orange-500/15 font-semibold text-orange-400' : 'border-line bg-surface text-sub hover:text-ink'
        }`}
      >
        {texto}
      </button>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <CalendarOff size={22} className="text-orange-500" aria-hidden /> Feriados
        </h1>
        <p className="mt-1 text-sm text-sub">Días que uno o varios locales no abren. Ese día no lleva objetivo: no suma al objetivo de la semana ni del mes.</p>
      </header>

      {puedeEditar && (
        <form onSubmit={(e) => void agregar(e)} className="mb-4 rounded-2xl border border-line bg-surface p-4">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-sub/70">1 · Día</p>
          <div className="flex flex-wrap items-center gap-2">
            <input id="fer-fecha" type="date" required value={fecha} onChange={(e) => { setFecha(e.target.value); setAviso(null) }} aria-label="Fecha"
              className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
            {fecha && <span className="text-sm text-sub">{DIAS_NOMBRE[dow(fecha)]}</span>}
          </div>

          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wider text-sub/70">2 · Locales</p>
            {sel.size > 0 && <button type="button" onClick={() => setSel(new Set())} className="text-xs text-sky-500 hover:underline">Limpiar</button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => alternar(TODOS)}
              aria-pressed={todos}
              className={`btn-press rounded-lg border px-2.5 py-1 text-xs font-bold transition ${todos ? 'border-orange-500 bg-orange-500 text-white' : 'border-line bg-surface text-ink hover:border-orange-500/50'}`}
            >
              Todos los locales
            </button>
            {locales.map((l) => chip(l.codigo, l.nombre))}
          </div>
          <p className="mb-1.5 mt-3 text-[11px] uppercase tracking-wider text-sub/70">Otras bases · sin objetivo</p>
          <div className="flex flex-wrap gap-1.5">{OTRAS.map((b) => chip(b.codigo, b.nombre))}</div>

          <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-ink">
            {todos ? (
              <>
                <p>Repo automática: no corre ese día; al día siguiente suma este día.</p>
                <p>Cascada: ese día no dona ni recibe ningún local.</p>
              </>
            ) : !cuantos ? (
              <p>Tocá los locales o bases que no abren ese día, o «Todos los locales».</p>
            ) : (
              <>
                <p>
                  {otrasSel.length
                    ? `Repo automática: no corre (cierra ${otrasSel.map(nom).join(' y ')}); al día siguiente suma este día.`
                    : 'Repo automática: corre igual (solo la frenan Fábrica, Polo 52 o «Todos los locales»).'}
                </p>
                {localesSel.length > 0 && (
                  <p>
                    Cascada: {localesSel.map(nom).join(', ')} no {localesSel.length === 1 ? 'dona ni recibe; lo que se le iba' : 'donan ni reciben; lo que se les iba'} a pedir lo dona otro local.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input id="fer-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
            <button type="submit" disabled={ocupado || !fecha || (!todos && !cuantos)} className="btn-press h-9 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white disabled:opacity-50">
              {ocupado ? 'Guardando…' : todos ? 'Agregar feriado · todos' : `Agregar feriado · ${cuantos} ${cuantos === 1 ? 'local' : 'locales'}`}
            </button>
          </div>
          {aviso && <p className="mt-2 text-xs text-emerald-500">{aviso}</p>}
        </form>
      )}

      <div className="rounded-2xl border border-line bg-surface p-4">
        {error && <p role="alert" className="mb-3 text-sm text-brand-400">{error}</p>}
        {grupos.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
                <tr><th className="py-1.5 pr-3">Fecha</th><th className="py-1.5 pr-3">Día</th><th className="py-1.5 pr-3">Locales</th><th className="py-1.5 pr-3">Motivo</th><th /></tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={g.fecha} className="border-t border-line align-top">
                    <td className="py-2 pr-3 tabular-nums text-ink">{ddmmaaaa(g.fecha)}</td>
                    <td className="py-2 pr-3 text-sub">{DIAS_NOMBRE[dow(g.fecha)]}</td>
                    <td className="py-1.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {g.items.map((f) => (
                          <span
                            key={f.id}
                            className={`inline-flex items-center gap-0.5 rounded-full border py-0.5 pl-2 pr-0.5 text-xs ${f.local == null ? 'border-orange-500/50 font-semibold text-orange-400' : 'border-line text-ink'}`}
                          >
                            {nom(f.local)}
                            {puedeEditar && (
                              <button type="button" onClick={() => void quitar([f.id])} className="rounded-full p-0.5 text-sub hover:bg-red-500/10 hover:text-red-400" aria-label={`Sacar ${nom(f.local)}`}>
                                <X size={11} aria-hidden />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-sub">{[...g.motivos].join(' · ')}</td>
                    <td className="py-2 text-right">
                      {puedeEditar && (
                        <button onClick={() => void quitar(g.items.map((f) => f.id))} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-red-400 hover:underline">
                          <Trash2 size={13} aria-hidden /> Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-sub">No hay feriados cargados.</p>}
      </div>
    </Layout>
  )
}
