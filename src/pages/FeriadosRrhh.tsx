import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarOff, Trash2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  RR. HH. → Feriados.                                                 */
/*  Días que un local (o todos) no abre: ese día no lleva objetivo en   */
/*  Locales → Objetivos (la RPC objetivos_locales_dia lee esta tabla).  */
/*  Cargan y quitan rrhh.feriados.edit y el admin; rrhh.feriados.view   */
/*  solo mira. Tabla: objetivos_feriados (sql/objetivos_locales.sql).   */
/* ------------------------------------------------------------------ */

interface Feriado { id: number; fecha: string; local: string | null; motivo: string | null }

const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const ddmmaaaa = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export default function FeriadosRrhh() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('rrhh.feriados.edit')
  const [locales, setLocales] = useState<{ codigo: string; nombre: string }[]>([])
  const [lista, setLista] = useState<Feriado[]>([])
  const [fecha, setFecha] = useState('')
  const [local, setLocal] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (supabase) void supabase.from('locales').select('codigo,nombre').eq('activo', true).then(({ data }) =>
      setLocales(((data as { codigo: string; nombre: string | null }[] | null) ?? [])
        .map((l) => ({ codigo: l.codigo, nombre: l.nombre || l.codigo }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))))
  }, [])
  const nom = (l: string) => locales.find((x) => x.codigo.toUpperCase() === l.toUpperCase())?.nombre ?? l

  const cargarLista = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('objetivos_feriados').select('id,fecha,local,motivo').order('fecha', { ascending: false })
    if (e) setError(e.message)
    setLista((data as Feriado[] | null) ?? [])
  }, [])
  useEffect(() => { void cargarLista() }, [cargarLista])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !fecha) return
    setOcupado(true)
    setError(null)
    const { error: err } = await supabase.from('objetivos_feriados').insert({ fecha, local: local || null, motivo: motivo.trim() || null })
    setOcupado(false)
    if (err) { setError(err.code === '23505' ? 'Ese feriado ya está cargado.' : err.message); return }
    setFecha(''); setMotivo('')
    await cargarLista()
  }

  async function quitar(id: number) {
    if (!supabase) return
    const { error: err } = await supabase.from('objetivos_feriados').delete().eq('id', id)
    if (err) { setError(err.message); return }
    await cargarLista()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <CalendarOff size={22} className="text-orange-500" aria-hidden /> Feriados
        </h1>
        <p className="mt-1 text-sm text-sub">Días que un local (o todos) no abre. Ese día no lleva objetivo: no suma al objetivo de la semana ni del mes.</p>
      </header>

      <div className="rounded-2xl border border-line bg-surface p-4">
        {puedeEditar && (
          <form onSubmit={(e) => void agregar(e)} className="mb-4 flex flex-wrap items-center gap-2">
            <input id="fer-fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha"
              className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
            <select id="fer-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Local" className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
              <option value="">Todos los locales</option>
              {locales.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
            </select>
            <input id="fer-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
            <button type="submit" disabled={ocupado || !fecha} className="btn-press h-9 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white disabled:opacity-50">
              {ocupado ? 'Guardando…' : 'Agregar feriado'}
            </button>
          </form>
        )}
        {error && <p role="alert" className="mb-3 text-sm text-brand-400">{error}</p>}
        {lista.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
                <tr><th className="py-1.5 pr-3">Fecha</th><th className="py-1.5 pr-3">Día</th><th className="py-1.5 pr-3">Local</th><th className="py-1.5 pr-3">Motivo</th><th /></tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 tabular-nums text-ink">{ddmmaaaa(f.fecha)}</td>
                    <td className="py-1.5 pr-3 text-sub">{DIAS_NOMBRE[dow(f.fecha)]}</td>
                    <td className="py-1.5 pr-3 text-ink">{f.local ? nom(f.local) : 'Todos los locales'}</td>
                    <td className="py-1.5 pr-3 text-sub">{f.motivo ?? ''}</td>
                    <td className="py-1.5 text-right">
                      {puedeEditar && <button onClick={() => void quitar(f.id)} className="inline-flex items-center gap-1 text-xs text-red-400 hover:underline"><Trash2 size={13} aria-hidden /> Quitar</button>}
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
