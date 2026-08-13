import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Upload, Loader2, ChevronRight, Store, Trash2, Check, X, Plus, BarChart3, ArrowRightLeft } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

type EstadoM = 'pendiente' | 'hecho' | 'faltante'
interface Lote {
  id: string
  nombre: string
  motivo: string | null
  created_at: string
  venta_fecha: string | null
  cant_venta: number | null
  horas: number | null
  personas: number | null
  observacion: string | null
}
interface Empleado {
  id: string
  legajo: string | null
  nombre: string
}
interface Item {
  id: string
  lote_id: string
  orden: number
  prioridad: number | null
  local: string
  material: string | null
  codigo: string | null
  articulo: string | null
  color: string | null
  talle: string | null
  cantidad: number
  estado: EstadoM
  hecho_at: string | null
}

function fmtFechaHora(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}
function fmtHora(iso: string | null) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('es-AR', { timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return ''
  }
}

// Barra segmentada: verde (hecho) · rojo (faltante) · resto pendiente
function Barra({ items }: { items: Item[] }) {
  const total = items.length
  const hecho = items.filter((i) => i.estado === 'hecho').length
  const faltante = items.filter((i) => i.estado === 'faltante').length
  const resueltos = hecho + faltante
  const pct = total ? Math.round((resueltos / total) * 100) : 0
  const w = (n: number) => (total ? `${(n / total) * 100}%` : '0%')
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface2">
        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: w(hecho) }} />
        <div className="h-full bg-red-500 transition-all duration-300" style={{ width: w(faltante) }} />
      </div>
      <span className="text-xs tabular-nums text-sub">{resueltos}/{total} · {pct}%</span>
    </div>
  )
}

function Celda({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface2 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sub">{label}</div>
      {children}
    </div>
  )
}

function Estadisticas({
  lote,
  items,
  localesCount,
  puedeEditar,
  onSaved,
}: {
  lote: Lote
  items: Item[]
  localesCount: number
  puedeEditar: boolean
  onSaved: () => Promise<void>
}) {
  const total = items.length
  const faltantes = items.filter((i) => i.estado === 'faltante').length
  const [venta, setVenta] = useState(lote.venta_fecha ?? '')
  const [cantVenta, setCantVenta] = useState(lote.cant_venta != null ? String(lote.cant_venta) : '')
  const [horas, setHoras] = useState(lote.horas != null ? String(lote.horas) : '')
  const [personas, setPersonas] = useState(lote.personas != null ? String(lote.personas) : '')
  const [obs, setObs] = useState(lote.observacion ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const h = parseFloat(horas.replace(',', '.')) || 0
  const p = parseInt(personas, 10) || 0
  const hsxper = h * p
  const prendasHs = hsxper ? total / hsxper : 0
  const inputCls =
    'w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60'

  async function guardar() {
    if (!supabase) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('mayorista_lotes')
      .update({
        venta_fecha: venta || null,
        cant_venta: cantVenta ? parseInt(cantVenta, 10) : null,
        horas: horas ? parseFloat(horas.replace(',', '.')) : null,
        personas: personas ? parseInt(personas, 10) : null,
        observacion: obs.trim() || null,
      })
      .eq('id', lote.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    await onSaved()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Celda label="Venta"><input type="date" disabled={!puedeEditar} value={venta} onChange={(e) => setVenta(e.target.value)} className={inputCls} /></Celda>
        <Celda label="Cant venta"><input inputMode="numeric" disabled={!puedeEditar} value={cantVenta} onChange={(e) => setCantVenta(e.target.value.replace(/\D/g, ''))} className={inputCls} /></Celda>
        <Celda label="Cant repo"><div className="py-1 text-sm font-medium text-ink">{total}</div></Celda>
        <Celda label="Art no mandados"><div className="py-1 text-sm font-medium text-red-400">{faltantes}</div></Celda>
        <Celda label="Locales"><div className="py-1 text-sm font-medium text-ink">{localesCount}</div></Celda>
        <Celda label="Horas"><input inputMode="decimal" disabled={!puedeEditar} value={horas} onChange={(e) => setHoras(e.target.value)} className={inputCls} /></Celda>
        <Celda label="Personas"><input inputMode="numeric" disabled={!puedeEditar} value={personas} onChange={(e) => setPersonas(e.target.value.replace(/\D/g, ''))} className={inputCls} /></Celda>
        <Celda label="Hs x per"><div className="py-1 text-sm font-medium text-ink">{hsxper || '—'}</div></Celda>
        <Celda label="Prendas/hs"><div className="py-1 text-sm font-medium text-ink">{prendasHs ? prendasHs.toFixed(2) : '—'}</div></Celda>
        <Celda label="Observación"><input disabled={!puedeEditar} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="—" className={inputCls} /></Celda>
      </div>
      {err && <p className="text-sm text-brand-400">{err}</p>}
      {puedeEditar && (
        <button onClick={guardar} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Guardar estadísticas
        </button>
      )}
    </div>
  )
}

export default function Mayorista() {
  const { can, perfil, isAdmin } = useAuth()
  const puedeImportar = can('mayorista.import')
  const puedeMarcar = isAdmin || can('mayorista.mark')

  const [lotes, setLotes] = useState<Lote[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const puedeEditarStats = isAdmin || puedeImportar
  const puedeAsignar = isAdmin || puedeImportar || puedeMarcar
  const [loteAbierto, setLoteAbierto] = useState<string | null>(null)
  const [localAbierto, setLocalAbierto] = useState<string | null>(null)
  const [subAbierto, setSubAbierto] = useState<string | null>(null)
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [responsables, setResponsables] = useState<Record<string, string | null>>({})
  const [modal, setModal] = useState(false)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [motivoNuevo, setMotivoNuevo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    const { data: ld } = await supabase
      .from('mayorista_lotes')
      .select('id,nombre,motivo,created_at,venta_fecha,cant_venta,horas,personas,observacion')
      .order('created_at', { ascending: false })
      .limit(60)
    const lotesData = (ld as Lote[]) ?? []
    setLotes(lotesData)
    const { data: emp } = await supabase.from('empleados').select('id,legajo,nombre').order('nombre', { ascending: true })
    setEmpleados((emp as Empleado[]) ?? [])
    if (lotesData.length) {
      const ids = lotesData.map((l) => l.id)
      const [itR, respR] = await Promise.all([
        supabase
          .from('mayorista_items')
          .select('id,lote_id,orden,prioridad,local,material,codigo,articulo,color,talle,cantidad,estado,hecho_at')
          .in('lote_id', ids)
          .order('orden', { ascending: true }),
        supabase.from('mayorista_responsables').select('lote_id,local,empleado_id').in('lote_id', ids),
      ])
      setItems((itR.data as Item[]) ?? [])
      const m: Record<string, string | null> = {}
      for (const r of (respR.data as { lote_id: string; local: string; empleado_id: string | null }[]) ?? []) {
        m[`${r.lote_id}|${r.local}`] = r.empleado_id
      }
      setResponsables(m)
    } else {
      setItems([])
      setResponsables({})
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function marcar(item: Item, estado: EstadoM) {
    if (!supabase) return
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, estado, hecho_at: at } : x)))
    const { error } = await supabase
      .from('mayorista_items')
      .update({ estado, hecho_at: at, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null })
      .eq('id', item.id)
    if (error) {
      setError(error.message)
      await cargar()
    }
  }
  async function asignarResponsable(loteId: string, local: string, empleadoId: string | null) {
    if (!supabase) return
    setResponsables((r) => ({ ...r, [`${loteId}|${local}`]: empleadoId }))
    const { error } = await supabase
      .from('mayorista_responsables')
      .upsert({ lote_id: loteId, local, empleado_id: empleadoId }, { onConflict: 'lote_id,local' })
    if (error) setError(error.message)
  }

  async function marcarVarios(its: Item[], estado: EstadoM) {
    if (!supabase || !its.length) return
    const ids = its.map((i) => i.id)
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setItems((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, estado, hecho_at: at } : x)))
    const { error } = await supabase
      .from('mayorista_items')
      .update({ estado, hecho_at: at, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null })
      .in('id', ids)
    if (error) {
      setError(error.message)
      await cargar()
    }
  }

  function onSelectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setArchivo(f)
    if (f && !nombreNuevo) setNombreNuevo(f.name.replace(/\.(xlsx|xls)$/i, ''))
  }

  async function procesar() {
    const f = archivo
    if (!f || !supabase) return
    if (!nombreNuevo.trim()) {
      setError('Poné un nombre para el archivo.')
      return
    }
    setSubiendo(true)
    setError(null)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const nuevos: Omit<Item, 'id' | 'lote_id' | 'estado' | 'hecho_at'>[] = []
      let orden = 0
      for (const hoja of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, blankrows: false, defval: '' })
        const hidx = rows.findIndex((r) => {
          const up = r.map((c) => String(c).trim().toUpperCase())
          return up.includes('LOCAL') && up.includes('CODIGO')
        })
        if (hidx < 0) continue
        const up = rows[hidx].map((c) => String(c).trim().toUpperCase())
        const idx = (n: string) => up.indexOf(n)
        const iPri = idx('PRIORIDAD')
        const iLocal = idx('LOCAL')
        const iMat = idx('MATERIAL')
        const iCod = idx('CODIGO')
        const iArt = up.findIndex((h) => h.includes('ARTICULO') || h.includes('ARTÍCULO') || h.includes('DESC'))
        const iColor = idx('COLOR')
        const iTalle = idx('TALLE')
        const iCant = idx('CANTIDAD')
        for (let i = hidx + 1; i < rows.length; i++) {
          const row = rows[i]
          const local = String(row[iLocal] ?? '').trim()
          const cod = String(row[iCod] ?? '').trim()
          if (!local || !cod) continue
          const pri = iPri >= 0 ? parseInt(String(row[iPri]).trim(), 10) : NaN
          const cant = iCant >= 0 ? parseInt(String(row[iCant]).trim(), 10) : NaN
          nuevos.push({
            orden: orden++,
            prioridad: Number.isNaN(pri) ? null : pri,
            local,
            material: iMat >= 0 ? String(row[iMat] ?? '').trim() || null : null,
            codigo: cod,
            articulo: iArt >= 0 ? String(row[iArt] ?? '').trim() || null : null,
            color: iColor >= 0 ? String(row[iColor] ?? '').trim() || null : null,
            talle: iTalle >= 0 ? String(row[iTalle] ?? '').trim() || null : null,
            cantidad: Number.isNaN(cant) ? 1 : cant,
          })
        }
      }
      if (!nuevos.length) {
        setError('No se detectaron repos. El Excel debe tener una fila de encabezado con columnas LOCAL y CODIGO.')
      } else {
        const { data: lote, error: e1 } = await supabase
          .from('mayorista_lotes')
          .insert({ nombre: nombreNuevo.trim(), motivo: motivoNuevo.trim() || null, subido_por: perfil?.id ?? null })
          .select('id')
          .single()
        if (e1 || !lote) throw new Error(e1?.message ?? 'No se pudo crear el lote')
        const loteId = (lote as { id: string }).id
        const { error: e2 } = await supabase.from('mayorista_items').insert(nuevos.map((n) => ({ ...n, lote_id: loteId })))
        if (e2) throw new Error(e2.message)
        setModal(false)
        setArchivo(null)
        setNombreNuevo('')
        setMotivoNuevo('')
        if (fileRef.current) fileRef.current.value = ''
        await cargar()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el Excel.')
    }
    setSubiendo(false)
  }

  async function borrarLote(id: string) {
    if (!supabase) return
    if (!window.confirm('¿Borrar este archivo y todos sus repos?')) return
    const { error } = await supabase.from('mayorista_lotes').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    await cargar()
  }

  const itemsPorLote = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of items) {
      const a = m.get(it.lote_id) ?? []
      a.push(it)
      m.set(it.lote_id, a)
    }
    return m
  }, [items])

  return (
    <Layout>
      <BackButton />

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color: '#d97706', backgroundColor: '#d9770624', borderColor: '#d9770640' }}>
            <Store size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Mayorista</h1>
            <p className="text-sm text-sub">Repos por local: preparar y marcar hecho o faltante.</p>
          </div>
        </div>
        {puedeImportar && (
          <button onClick={() => setModal(true)} className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-soft hover:bg-brand-700">
            <Plus size={17} aria-hidden /> <span className="hidden sm:inline">Nuevo archivo</span>
          </button>
        )}
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : lotes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <Store size={28} aria-hidden />
          <p>{puedeImportar ? 'Subí un Excel de repo (columnas LOCAL y CODIGO).' : 'Todavía no hay repos cargados.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lotes.map((lote) => {
            const its = itemsPorLote.get(lote.id) ?? []
            const loteTodoHecho = its.length > 0 && its.every((i) => i.estado === 'hecho')
            const abierto = loteAbierto === lote.id
            // locales ordenados por prioridad (menor primero), luego alfabético
            const porLocal = new Map<string, Item[]>()
            for (const i of its) {
              const a = porLocal.get(i.local) ?? []
              a.push(i)
              porLocal.set(i.local, a)
            }
            const locales = Array.from(porLocal.entries()).sort((a, b) => {
              const pa = Math.min(...a[1].map((i) => i.prioridad ?? 9999))
              const pb = Math.min(...b[1].map((i) => i.prioridad ?? 9999))
              return pa !== pb ? pa - pb : a[0].localeCompare(b[0], 'es')
            })
            return (
              <div key={lote.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
                <button
                  onClick={() => {
                    const nuevo = abierto ? null : lote.id
                    setLoteAbierto(nuevo)
                    setLocalAbierto(null)
                    setSubAbierto(nuevo ? `${lote.id}|repo` : null)
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left ${loteTodoHecho ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-surface2'}`}
                >
                  <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition-transform ${abierto ? 'rotate-90' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{lote.nombre}</p>
                    <p className="truncate text-xs text-sub">
                      Cargado {fmtFechaHora(lote.created_at)} · {locales.length} locales
                      {lote.motivo ? ` · ${lote.motivo}` : ''}
                    </p>
                  </div>
                  <Barra items={its} />
                  {puedeImportar && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        borrarLote(lote.id)
                      }}
                      className="ml-1 rounded-lg p-1.5 text-sub hover:bg-brand-600/20 hover:text-brand-400"
                      title="Borrar archivo"
                    >
                      <Trash2 size={15} aria-hidden />
                    </span>
                  )}
                </button>

                {abierto && (
                  <div className="border-t border-line">
                    <div className="border-b border-line">
                      <button
                        onClick={() => setSubAbierto(subAbierto === `${lote.id}|stats` ? null : `${lote.id}|stats`)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-surface2"
                      >
                        <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${subAbierto === `${lote.id}|stats` ? 'rotate-90' : ''}`} />
                        <BarChart3 size={15} aria-hidden className="text-sub" />
                        <span className="font-display font-semibold text-ink">Estadísticas</span>
                      </button>
                      {subAbierto === `${lote.id}|stats` && (
                        <div className="px-4 pb-3">
                          <Estadisticas lote={lote} items={its} localesCount={locales.length} puedeEditar={puedeEditarStats} onSaved={cargar} />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setSubAbierto(subAbierto === `${lote.id}|repo` ? null : `${lote.id}|repo`)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-surface2"
                    >
                      <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${subAbierto === `${lote.id}|repo` ? 'rotate-90' : ''}`} />
                      <ArrowRightLeft size={15} aria-hidden className="text-sub" />
                      <span className="font-display font-semibold text-ink">Reposición</span>
                    </button>
                    {subAbierto === `${lote.id}|repo` && (
                    <div className="px-3 pb-2">
                    {locales.map(([local, lItems]) => {
                      const key = `${lote.id}|${local}`
                      const lAbierto = localAbierto === key
                      const resueltos = lItems.filter((i) => i.estado !== 'pendiente').length
                      const completo = lItems.length > 0 && resueltos === lItems.length
                      const todoHecho = lItems.length > 0 && lItems.every((i) => i.estado === 'hecho')
                      const pri = Math.min(...lItems.map((i) => i.prioridad ?? 9999))
                      return (
                        <div key={local} className="my-1 overflow-hidden rounded-xl border border-line">
                          <div className={`flex w-full items-center gap-3 px-3 py-2 ${todoHecho ? 'bg-emerald-500/10' : 'bg-surface2'}`}>
                            <button onClick={() => setLocalAbierto(lAbierto ? null : key)} className="flex flex-1 items-center gap-2 text-left">
                              <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${lAbierto ? 'rotate-90' : ''}`} />
                              {pri < 9999 && <span className="rounded-full bg-line px-1.5 py-0.5 text-[11px] font-semibold text-sub">P{pri}</span>}
                              <span className="flex-1 font-display font-semibold text-ink">{local}</span>
                              <Barra items={lItems} />
                            </button>
                            {puedeAsignar ? (
                              <select
                                value={responsables[key] ?? ''}
                                onChange={(e) => asignarResponsable(lote.id, local, e.target.value || null)}
                                className="max-w-[8.5rem] shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                                title="Empleado responsable"
                              >
                                <option value="">Responsable…</option>
                                {empleados.map((em) => (
                                  <option key={em.id} value={em.id}>{em.nombre}</option>
                                ))}
                              </select>
                            ) : (
                              responsables[key] && (
                                <span className="shrink-0 text-xs text-sub">{empleados.find((e) => e.id === responsables[key])?.nombre}</span>
                              )
                            )}
                            {puedeMarcar && (
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-sub" title="Marcar todo el local">
                                <input
                                  type="checkbox"
                                  ref={(cb) => {
                                    if (cb) cb.indeterminate = resueltos > 0 && !completo
                                  }}
                                  checked={completo}
                                  onChange={(e) =>
                                    marcarVarios(
                                      e.target.checked ? lItems.filter((i) => i.estado !== 'hecho') : lItems.filter((i) => i.estado !== 'pendiente'),
                                      e.target.checked ? 'hecho' : 'pendiente',
                                    )
                                  }
                                  className="h-4 w-4 accent-emerald-600"
                                />
                                todo
                              </label>
                            )}
                          </div>
                          {lAbierto && (
                            <ul className="divide-y divide-line/70 bg-surface/40">
                              {lItems.map((it) => {
                                const esHecho = it.estado === 'hecho'
                                const esFaltante = it.estado === 'faltante'
                                return (
                                  <li key={it.id} className="flex items-center gap-3 px-3 py-2 pl-8">
                                    <span className="min-w-0 flex-1">
                                      <span className={`block text-sm ${esHecho ? 'text-sub line-through' : esFaltante ? 'text-sub' : 'text-ink'}`}>
                                        {it.codigo}
                                        {it.color ? ` · ${it.color}` : ''}
                                        {it.talle ? ` · T${it.talle}` : ''}
                                        {it.cantidad > 1 ? ` · x${it.cantidad}` : ''}
                                      </span>
                                      {it.articulo && <span className="block truncate text-xs text-sub">{it.articulo}</span>}
                                    </span>
                                    {it.hecho_at && it.estado !== 'pendiente' && (
                                      <span className="hidden shrink-0 text-[11px] tabular-nums text-sub sm:inline">{fmtHora(it.hecho_at)}</span>
                                    )}
                                    <div className="flex shrink-0 items-center gap-1">
                                      <button
                                        onClick={() => marcar(it, esHecho ? 'pendiente' : 'hecho')}
                                        disabled={!puedeMarcar}
                                        title="Hecho / preparado"
                                        aria-label="Marcar hecho"
                                        className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${esHecho ? 'bg-emerald-500/20 text-emerald-400' : 'text-sub hover:bg-line hover:text-ink'}`}
                                      >
                                        <Check size={15} aria-hidden />
                                      </button>
                                      <button
                                        onClick={() => marcar(it, esFaltante ? 'pendiente' : 'faltante')}
                                        disabled={!puedeMarcar}
                                        title="Faltante / no hay"
                                        aria-label="Marcar faltante"
                                        className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${esFaltante ? 'bg-brand-600/20 text-brand-400' : 'text-sub hover:bg-line hover:text-ink'}`}
                                      >
                                        <X size={15} aria-hidden />
                                      </button>
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                    </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !subiendo && setModal(false)}>
          <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-display font-semibold text-ink">Nuevo archivo</h2>
              <button onClick={() => setModal(false)} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <span className="mb-1 block text-sm font-medium text-ink">Archivo Excel</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onSelectFile} className="block w-full text-sm text-sub file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line" />
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Nombre</span>
                <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Ej: Repo 12/08" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Motivo</span>
                <input value={motivoNuevo} onChange={(e) => setMotivoNuevo(e.target.value)} placeholder="Opcional" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </label>
              <p className="text-xs text-sub">La fecha y hora se registran automáticamente al cargar.</p>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button onClick={procesar} disabled={subiendo || !archivo || !nombreNuevo.trim()} className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {subiendo ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                {subiendo ? 'Procesando…' : 'Cargar'}
              </button>
              <button onClick={() => setModal(false)} disabled={subiendo} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
