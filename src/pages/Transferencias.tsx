import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Upload,
  Loader2,
  ChevronRight,
  ArrowRightLeft,
  Trash2,
  Check,
  Plus,
  X,
  Lock,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Lote {
  id: string
  nombre: string
  motivo: string | null
  fecha: string
  created_at: string
}
interface Item {
  id: string
  lote_id: string
  orden: number
  origen: string
  destino: string
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  hecho: boolean
  hecho_at: string | null
}

function fmtFechaHora(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

// Duración legible entre la carga del lote y el último tilde del local
function fmtDuracion(desdeIso: string, hastaIso: string): string {
  const ms = new Date(hastaIso).getTime() - new Date(desdeIso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function Barra({ hechos, total }: { hechos: number; total: number }) {
  const pct = total ? Math.round((hechos / total) * 100) : 0
  const color = pct === 100 ? '#16a34a' : pct > 0 ? '#d97706' : '#3f3f46'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs tabular-nums text-sub">{hechos}/{total} · {pct}%</span>
    </div>
  )
}

export default function Transferencias() {
  const { can, perfil, isAdmin } = useAuth()
  const puedeImportar = can('transferencias.import')
  const miLocal = (perfil?.local ?? '').toUpperCase()

  const [lotes, setLotes] = useState<Lote[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [loteAbierto, setLoteAbierto] = useState<string | null>(null)
  const [origenAbierto, setOrigenAbierto] = useState<string | null>(null)
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
    const { data: ld } = await supabase.from('transfer_lotes').select('id,nombre,motivo,fecha,created_at').order('created_at', { ascending: false }).limit(60)
    const lotesData = (ld as Lote[]) ?? []
    setLotes(lotesData)
    if (lotesData.length) {
      const { data: it } = await supabase
        .from('transfer_items')
        .select('id,lote_id,orden,origen,destino,articulo,descripcion,color,talle,cantidad,hecho,hecho_at')
        .in('lote_id', lotesData.map((l) => l.id))
        .order('orden', { ascending: true })
      setItems((it as Item[]) ?? [])
    } else {
      setItems([])
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // ¿Este origen es el local del usuario? (para tildar sus propios artículos)
  const esMiLocal = useCallback(
    (origen: string) => !!miLocal && origen.toUpperCase() === miLocal,
    [miLocal],
  )

  async function marcar(item: Item, hecho: boolean) {
    if (!supabase) return
    const ahora = new Date().toISOString()
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, hecho, hecho_at: hecho ? ahora : null } : x)))
    const { error } = await supabase
      .from('transfer_items')
      .update({ hecho, hecho_at: hecho ? ahora : null, hecho_por: hecho ? perfil?.id ?? null : null })
      .eq('id', item.id)
    if (error) {
      setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, hecho: !hecho, hecho_at: hecho ? null : ahora } : x)))
      setError(error.message)
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
      const nuevos: Omit<Item, 'id' | 'lote_id' | 'hecho' | 'hecho_at'>[] = []
      let orden = 0
      for (const hoja of wb.SheetNames) {
        // La hoja "venta"/"ventas" nunca se importa
        if (['venta', 'ventas'].includes(hoja.trim().toLowerCase())) continue
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, blankrows: false, defval: '' })
        const hidx = rows.findIndex((r) => r.some((c) => String(c).trim().toUpperCase() === 'ARTICULO'))
        if (hidx < 0) continue
        const header = rows[hidx].map((c) => String(c).trim())
        const up = header.map((h) => h.toUpperCase())
        const idxArt = up.indexOf('ARTICULO')
        const idxDesc = up.findIndex((h) => h.includes('DESC'))
        const idxColor = up.indexOf('COLOR')
        const idxTalle = up.indexOf('TALLE')
        const idxTipo = up.indexOf('TIPO')
        const idxTotal = up.indexOf('TOTAL')
        const start = idxTipo >= 0 ? idxTipo + 1 : idxArt + 6
        const end = idxTotal >= 0 ? idxTotal : header.length
        const destCols: number[] = []
        for (let j = start; j < end; j++) if (header[j]?.trim()) destCols.push(j)
        for (let i = hidx + 1; i < rows.length; i++) {
          const row = rows[i]
          const art = String(row[idxArt] ?? '').trim()
          if (!art) continue
          for (const j of destCols) {
            const raw = row[j]
            const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10)
            if (raw !== '' && raw != null && !Number.isNaN(n) && n > 0) {
              nuevos.push({
                orden: orden++,
                origen: hoja.trim(),
                destino: header[j].trim(),
                articulo: art,
                descripcion: String(row[idxDesc] ?? '').trim() || null,
                color: idxColor >= 0 ? String(row[idxColor] ?? '').trim() || null : null,
                talle: idxTalle >= 0 ? String(row[idxTalle] ?? '').trim() || null : null,
                cantidad: n,
              })
            }
          }
        }
      }
      if (!nuevos.length) {
        setError('No se detectaron transferencias en el Excel. Revisá que tenga una fila de encabezado con "ARTICULO" y columnas por local.')
      } else {
        const { data: lote, error: e1 } = await supabase
          .from('transfer_lotes')
          .insert({ nombre: nombreNuevo.trim(), motivo: motivoNuevo.trim() || null, subido_por: perfil?.id ?? null })
          .select('id')
          .single()
        if (e1 || !lote) throw new Error(e1?.message ?? 'No se pudo crear el lote')
        const loteId = (lote as { id: string }).id
        const { error: e2 } = await supabase.from('transfer_items').insert(nuevos.map((n) => ({ ...n, lote_id: loteId })))
        if (e2) throw new Error(e2.message)
        // limpiar y cerrar
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
    if (!window.confirm('¿Borrar este archivo y todas sus transferencias?')) return
    const { error } = await supabase.from('transfer_lotes').delete().eq('id', id)
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
      <Link to="/area/compras" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Compras
      </Link>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color: '#d97706', backgroundColor: '#d9770624', borderColor: '#d9770640' }}>
            <ArrowRightLeft size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Reposiciones / Transferencias</h1>
            <p className="text-sm text-sub">Subí el Excel; cada local marca lo que ya envió.</p>
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
          <ArrowRightLeft size={28} aria-hidden />
          <p>{puedeImportar ? 'Subí un Excel para empezar. Cada hoja es un local origen y cada “1” una transferencia.' : 'Todavía no hay reposiciones cargadas.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lotes.map((lote) => {
            const its = itemsPorLote.get(lote.id) ?? []
            const hechos = its.filter((i) => i.hecho).length
            const abierto = loteAbierto === lote.id
            // orígenes en el orden en que aparecen en el archivo
            const origenes: string[] = []
            for (const i of its) if (!origenes.includes(i.origen)) origenes.push(i.origen)
            return (
              <div key={lote.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
                <button
                  onClick={() => {
                    setLoteAbierto(abierto ? null : lote.id)
                    setOrigenAbierto(null)
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2"
                >
                  <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition-transform ${abierto ? 'rotate-90' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{lote.nombre}</p>
                    <p className="truncate text-xs text-sub">
                      Cargado {fmtFechaHora(lote.created_at)} · {origenes.length} locales
                      {lote.motivo ? ` · ${lote.motivo}` : ''}
                    </p>
                  </div>
                  <Barra hechos={hechos} total={its.length} />
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
                  <div className="border-t border-line px-3 py-2">
                    {origenes.map((origen) => {
                      const de = its.filter((i) => i.origen === origen)
                      const h = de.filter((i) => i.hecho).length
                      const key = `${lote.id}|${origen}`
                      const oAbierto = origenAbierto === key
                      const esMio = esMiLocal(origen)
                      const completo = de.length > 0 && h === de.length
                      const finIso = completo ? de.reduce((mx, i) => (i.hecho_at && i.hecho_at > mx ? i.hecho_at : mx), '') : ''
                      const dur = completo && finIso ? fmtDuracion(lote.created_at, finIso) : ''
                      return (
                        <div key={origen} className="my-1 overflow-hidden rounded-xl border border-line">
                          <button
                            onClick={() => setOrigenAbierto(oAbierto ? null : key)}
                            className="flex w-full items-center gap-3 bg-surface2 px-3 py-2 text-left hover:bg-line"
                          >
                            <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${oAbierto ? 'rotate-90' : ''}`} />
                            <span className="flex-1 font-display font-semibold text-ink">{origen}</span>
                            {esMio && <span className="rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-medium text-brand-400">tu local</span>}
                            {completo && dur && (
                              <span className="hidden items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 sm:inline-flex">
                                <Check size={11} aria-hidden /> {dur}
                              </span>
                            )}
                            <Barra hechos={h} total={de.length} />
                          </button>
                          {oAbierto && (
                            <ul className="divide-y divide-line/70">
                              {de.map((it) => {
                                // Marcar: solo tu local (una vez). Desmarcar/editar: solo admin.
                                const puedeTildar = it.hecho ? isAdmin : isAdmin || esMio
                                return (
                                <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                                  <label className={`flex flex-1 items-center gap-3 ${puedeTildar ? 'cursor-pointer' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={it.hecho}
                                      disabled={!puedeTildar}
                                      onChange={(e) => marcar(it, e.target.checked)}
                                      className="h-4 w-4 shrink-0 accent-emerald-600 disabled:opacity-50"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className={`block text-sm ${it.hecho ? 'text-sub line-through' : 'text-ink'}`}>
                                        {it.articulo}
                                        {it.color ? ` · ${it.color}` : ''}
                                        {it.talle ? ` · T${it.talle}` : ''}
                                        {it.cantidad > 1 ? ` · x${it.cantidad}` : ''}
                                      </span>
                                      {it.descripcion && <span className="block truncate text-xs text-sub">{it.descripcion}</span>}
                                    </span>
                                  </label>
                                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-sub">
                                    <ArrowRightLeft size={12} aria-hidden /> {it.destino}
                                  </span>
                                  {it.hecho &&
                                    (isAdmin ? (
                                      <Check size={15} className="shrink-0 text-emerald-400" aria-hidden />
                                    ) : (
                                      <span title="Bloqueado — solo el administrador puede editar" className="shrink-0">
                                        <Lock size={13} className="text-sub" aria-hidden />
                                      </span>
                                    ))}
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
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={onSelectFile}
                  className="block w-full text-sm text-sub file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
                />
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Nombre</span>
                <input
                  value={nombreNuevo}
                  onChange={(e) => setNombreNuevo(e.target.value)}
                  placeholder="Ej: Cascada por local 10/08"
                  className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Motivo</span>
                <input
                  value={motivoNuevo}
                  onChange={(e) => setMotivoNuevo(e.target.value)}
                  placeholder="Opcional (ej: reposición semanal)"
                  className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                />
              </label>
              <p className="text-xs text-sub">La fecha y hora se registran automáticamente al cargar.</p>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button
                onClick={procesar}
                disabled={subiendo || !archivo || !nombreNuevo.trim()}
                className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
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
