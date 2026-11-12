import { useEffect, useState } from 'react'
import { Banknote, ChevronLeft, ChevronRight } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { ArqueosHoyLocal } from '@/components/AvisoArqueo'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ahoraCordoba } from '@/lib/arqueos'

/* ------------------------------------------------------------------ */
/*  Locales → Arqueos de mi local. La cuenta del local ve sus horarios */
/*  de hoy y sus arqueos con el detalle por billete (RLS: solo los      */
/*  suyos). Admin / Tesorería (arqueos.view) eligen el local.           */
/* ------------------------------------------------------------------ */

interface Local { codigo: string; nombre: string }
/** Suma días a una fecha aaaa-mm-dd */
const moverDia = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())

export default function MisArqueos() {
  const { perfil, isAdmin, can } = useAuth()
  const propio = perfil?.local?.toUpperCase() ?? null
  const veTodos = isAdmin || can('arqueos.view')
  const [locales, setLocales] = useState<Local[]>([])
  const [elegido, setElegido] = useState<string>('')
  const hoy = ahoraCordoba().fecha
  const [fecha, setFecha] = useState(hoy)

  useEffect(() => {
    if (!veTodos || !supabase) return
    void supabase.from('arqueos_locales').select('local').gte('fecha', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)).limit(2000)
      .then(async ({ data }) => {
        const cods = [...new Set(((data ?? []) as { local: string }[]).map((x) => x.local))]
        const { data: ls } = await supabase!.from('locales').select('codigo,nombre')
        const nom = new Map(((ls ?? []) as Local[]).map((l) => [l.codigo.toUpperCase(), titulo(l.nombre || l.codigo)]))
        const lista = cods.map((c) => ({ codigo: c, nombre: nom.get(c) ?? c })).sort((a, b) => a.nombre.localeCompare(b.nombre))
        setLocales(lista)
        setElegido((x) => x || propio || lista[0]?.codigo || '')
      })
  }, [veTodos, propio])

  const local = veTodos ? elegido || propio : propio

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Banknote size={22} className="text-yellow-500" aria-hidden /> Arqueos de mi local
          </h1>
          <p className="mt-1 text-sm text-sub">Horarios del día y lo que contaste en cada arqueo, por billete.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setFecha(moverDia(fecha, -1))} aria-label="Día anterior" title="Día anterior"
            className="btn-press grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface2 text-ink">
            <ChevronLeft size={18} aria-hidden />
          </button>
          <input type="date" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Día"
            className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
          <button type="button" onClick={() => setFecha(moverDia(fecha, 1))} disabled={fecha >= hoy} aria-label="Día siguiente" title="Día siguiente"
            className="btn-press grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface2 text-ink disabled:opacity-30">
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
        {veTodos && locales.length > 0 && (
          <select value={local ?? ''} onChange={(e) => setElegido(e.target.value)} aria-label="Local"
            className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
            {locales.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
          </select>
        )}
        </div>
      </header>
      {local ? (
        <div className="max-w-xl"><ArqueosHoyLocal key={local} local={local} fecha={fecha} /></div>
      ) : (
        <p className="py-10 text-center text-sm text-sub">{veTodos ? 'Cargando locales…' : 'Tu cuenta no tiene un local asignado.'}</p>
      )}
    </Layout>
  )
}
