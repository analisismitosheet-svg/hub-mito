import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Copy, Loader2, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import {
  cargarReplicas,
  codigoDe,
  estadoChip,
  formatearFecha,
  formatearInstante,
  haceTexto,
  nombreDe,
  type Estado,
  type EstadoReplicas,
  type Replica,
} from '@/lib/replicas'

/**
 * Sistemas > Réplicas: una tarjeta por base copiada por el Replicador SQL de
 * la PC central (DESKTOP-OA4GU6I), con su última actualización.
 * Sale de /api/replicas → Puente SQL → dbo._sync_estado + historial.csv.
 */

const REFRESCO_MS = 60_000

const ESTADO_UI: Record<Estado | 'error', { chip: string; punto: string; fecha: string }> = {
  ok: { chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500', punto: 'bg-emerald-500', fecha: 'text-emerald-500' },
  atraso: { chip: 'border-amber-500/30 bg-amber-500/10 text-amber-500', punto: 'bg-amber-500', fecha: 'text-amber-500' },
  viejo: { chip: 'border-rose-500/30 bg-rose-500/10 text-rose-500', punto: 'bg-rose-500', fecha: 'text-rose-500' },
  error: { chip: 'border-rose-500/40 bg-rose-500/15 text-rose-400', punto: 'bg-rose-400', fecha: 'text-ink' },
  'sin-dato': { chip: 'border-line bg-surface2 text-sub', punto: 'bg-sub/50', fecha: 'text-ink' },
}

export default function Replicas() {
  const [datos, setDatos] = useState<EstadoReplicas | null>(null)
  const [locales, setLocales] = useState<Record<string, string | null>>({})
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setDatos(await cargarReplicas())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
    }, REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])

  // Nombres de los locales (tabla editable desde Sistemas > Locales); best effort.
  useEffect(() => {
    if (!supabase) return
    void supabase.from('locales').select('codigo,nombre').then(({ data }) => {
      const map: Record<string, string | null> = {}
      for (const l of (data ?? [])) map[String(l.codigo ?? '').toUpperCase()] = (l.nombre as string | null) ?? null
      setLocales(map)
    })
  }, [])

  const lista = datos?.replicas ?? []

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((r) =>
      [nombreDe(r, locales), codigoDe(r.base), r.base, r.origen, r.sucursal].some((v) =>
        String(v ?? '').toLowerCase().includes(q),
      ),
    )
  }, [lista, locales, busqueda])

  const resumen = useMemo(() => {
    const chips = lista.map(estadoChip)
    return {
      total: lista.length,
      alDia: chips.filter((c) => c.clave === 'ok').length,
      conErrores: chips.filter((c) => c.clave === 'error').length,
      sinFecha: chips.filter((c) => c.clave === 'sin-dato').length,
    }
  }, [lista])

  const agente = datos?.agente

  const btnChico =
    'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Copy size={22} className="text-cyan-500" aria-hidden /> Réplicas
        </h1>
        <span className="text-xs text-sub/70">
          {datos?.servidor ? `Replicador SQL · ${datos.servidor}` : 'Replicador SQL'} · se actualiza cada 60 s
        </span>
        {agente && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              agente.vivo ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-rose-500/30 bg-rose-500/10 text-rose-500'
            }`}
            title={agente.ultimo_latido ? `Último latido: ${formatearInstante(agente.ultimo_latido)}` : 'Sin latido'}
          >
            <Activity size={12} aria-hidden /> {agente.vivo ? 'agente activo' : 'agente caído'}
          </span>
        )}
        <button onClick={() => void cargar()} className={`${btnChico} ml-auto`} type="button">
          <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {!datos ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando réplicas...
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Resumen label="Réplicas" valor={String(resumen.total)} nota="bases copiadas en la PC central" />
            <Resumen
              label="Actualizadas (< 15 min)"
              valor={`${resumen.alDia}/${resumen.total}`}
              nota="última actualización"
              tono="emerald"
            />
            <Resumen label="Con errores" valor={String(resumen.conErrores)} nota="última corrida del agente" tono="rose" />
            <Resumen label="Sin fecha" valor={String(resumen.sinFecha)} nota="sin registro de actualización" tono="sub" />
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <Search size={15} className="text-sub" aria-hidden />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por local, código, base u origen..."
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-sub/70"
            />
          </div>

          {visibles.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-sub">
              {lista.length === 0
                ? 'El Replicador SQL no tiene bases copiadas todavía (o no se pudo leer el estado local).'
                : 'Ninguna réplica coincide con la búsqueda.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibles.map((r) => (
                <Tarjeta key={r.base} r={r} locales={locales} />
              ))}
            </div>
          )}

          <p className="text-xs text-sub/70">
            Fuente: Replicador SQL en <code className="mx-1 rounded bg-surface2 px-1">{datos.servidor || 'PC central'}</code>
            · <code className="mx-1 rounded bg-surface2 px-1">dbo._sync_estado</code> +{' '}
            <code className="mx-1 rounded bg-surface2 px-1">historial.csv</code>
            {datos.consultado ? ` · consultado ${formatearInstante(datos.consultado)}` : ''}
          </p>
        </div>
      )}
    </Layout>
  )
}

function Resumen({
  label,
  valor,
  nota,
  tono = 'ink',
}: {
  label: string
  valor: string
  nota?: string
  tono?: 'ink' | 'emerald' | 'rose' | 'sub'
}) {
  const color =
    tono === 'emerald' ? 'text-emerald-500' : tono === 'rose' ? 'text-rose-500' : tono === 'sub' ? 'text-sub' : 'text-ink'
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-sub/70">{label}</p>
      <p className={`font-display text-xl font-semibold ${color}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-sub/70">{nota}</p>}
    </div>
  )
}

function Tarjeta({ r, locales }: { r: Replica; locales: Record<string, string | null> }) {
  const chip = estadoChip(r)
  const ui = ESTADO_UI[chip.clave]
  const codigo = codigoDe(r.base)
  const conError = chip.clave === 'error'

  return (
    <article className="rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-semibold text-ink">{nombreDe(r, locales)}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-line bg-surface2 px-2 py-0.5 text-[11px] font-semibold text-ink">
              {codigo}
            </span>
            <span className="truncate text-[11px] text-sub/70" title={r.base}>
              {r.base}
            </span>
          </div>
        </div>
        <span
          className={`ml-auto inline-flex shrink-0 items-center gap-1 self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${ui.chip}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${ui.punto}`} aria-hidden />
          {chip.texto}
        </span>
      </div>

      <div className="mt-3 rounded-xl bg-surface2 p-3">
        <p className="text-[10px] uppercase tracking-wide text-sub/70">Última actualización</p>
        <p className={`font-mono text-xl font-semibold tabular-nums ${ui.fecha}`}>{formatearFecha(r.actualizacion)}</p>
        <p className={`text-xs ${ui.fecha}`}>{haceTexto(r.actualizacion)}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sub">
        {r.tablas > 0 && <span>{r.tablas} tablas</span>}
        {r.origen && (
          <span className="truncate" title={`Origen: ${r.origen}`}>
            {r.origen}
          </span>
        )}
        {r.corrida_fin && <span>corrida {r.corrida_fin.slice(0, 16)}</span>}
      </div>

      {conError && r.ultimo_error && (
        <p
          className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] leading-snug text-rose-400"
          title={r.ultimo_error}
        >
          <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden />
          <span className="line-clamp-2">{r.ultimo_error}</span>
        </p>
      )}
    </article>
  )
}
