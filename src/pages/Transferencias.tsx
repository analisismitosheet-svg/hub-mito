import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload,
  Loader2,
  ChevronRight,
  ArrowRightLeft,
  Trash2,
  Check,
  Plus,
  X,
  Bookmark,
  Printer,
  Send,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Lote {
  id: string
  nombre: string
  motivo: string | null
  fecha: string
  created_at: string
}
type EstadoItem = 'pendiente' | 'hecho' | 'senado' | 'faltante'
interface Item {
  id: string
  lote_id: string
  orden: number
  origen: string
  destino: string
  articulo: string | null
  descripcion: string | null
  material: string | null
  color: string | null
  talle: string | null
  tipo: string | null
  cantidad: number
  estado: EstadoItem
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

function escHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
function fmtFechaCorta(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Imprime la matriz "cascada" de un origen: filas = artículos, columnas = destinos,
 * celda = cantidad, más una columna TOTAL. Formato igual al Excel de importación.
 */
function imprimirCascada(origen: string, items: Item[], lote: Lote) {
  // Columnas = destinos únicos (alfabético)
  const destinos = Array.from(new Set(items.map((i) => i.destino))).sort((a, b) => a.localeCompare(b, 'es'))

  // Filas = artículo/desc/color/talle, con cantidad por destino
  type Fila = {
    articulo: string; desc: string; color: string; talle: string
    porDestino: Record<string, number>; total: number
  }
  const mapa = new Map<string, Fila>()
  for (const i of items) {
    const articulo = i.articulo ?? ''
    const desc = i.descripcion ?? ''
    const color = i.color ?? ''
    const talle = i.talle ?? ''
    const key = [articulo, desc, color, talle].join('¦')
    let f = mapa.get(key)
    if (!f) {
      f = { articulo, desc, color, talle, porDestino: {}, total: 0 }
      mapa.set(key, f)
    }
    const q = i.cantidad || 1
    f.porDestino[i.destino] = (f.porDestino[i.destino] ?? 0) + q
    f.total += q
  }
  const filas = Array.from(mapa.values()).sort((a, b) => a.articulo.localeCompare(b.articulo, 'es'))
  const totalGeneral = filas.reduce((s, f) => s + f.total, 0)

  const th = (t: string, extra = '') => `<th class="${extra}">${escHtml(t)}</th>`
  const encabezados =
    th('ARTICULO', 'l') + th('DESC ADICIONAL MACRO', 'l') + th('COLOR') + th('TALLE') +
    destinos.map((d) => th(d, 'dest')).join('') + th('TOTAL', 'tot')

  const cuerpo = filas
    .map((f) => {
      const celdasDest = destinos
        .map((d) => `<td class="num">${f.porDestino[d] ? f.porDestino[d] : ''}</td>`)
        .join('')
      return (
        `<tr>` +
        `<td class="l">${escHtml(f.articulo)}</td>` +
        `<td class="l">${escHtml(f.desc)}</td>` +
        `<td>${escHtml(f.color)}</td>` +
        `<td>${escHtml(f.talle)}</td>` +
        celdasDest +
        `<td class="num tot">${f.total}</td>` +
        `</tr>`
      )
    })
    .join('')

  const w = window.open('', '_blank', 'width=1100,height=760')
  if (!w) return
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>CASCADA — ${escHtml(origen)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
  h1 { font-size: 13pt; margin: 0 0 2mm; }
  .sub { font-size: 9pt; color: #444; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 2px 4px; font-size: 8pt; text-align: center; white-space: nowrap; }
  th { background: #1f2d3a; color: #fff; }
  td.l, th.l { text-align: left; }
  th.dest { writing-mode: vertical-rl; transform: rotate(180deg); height: 70px; }
  .num { text-align: center; }
  .tot { font-weight: 700; background: #eef2f6; }
  tr:nth-child(even) td { background: #f7f9fb; }
  tr:nth-child(even) td.tot { background: #e6ebf1; }
  tfoot td { font-weight: 700; border-top: 2px solid #333; }
</style></head>
<body>
  <h1>CASCADA — ${escHtml(origen)}</h1>
  <div class="sub">${escHtml(lote.nombre)} · ${escHtml(fmtFechaCorta(lote.fecha))} · ${destinos.length} destinos · ${totalGeneral} unidades</div>
  <table>
    <thead><tr>${encabezados}</tr></thead>
    <tbody>${cuerpo}</tbody>
  </table>
<script>
  window.focus();
  setTimeout(function(){ window.print(); }, 250);
<\/script>
</body></html>`,
  )
  w.document.close()
}

/**
 * Arma el texto plano del mail para un local origen: la matriz de ítems que
 * ese local debe enviar, agrupados por destino (igual que la cascada impresa).
 */
function construirMailOrigen(origen: string, items: Item[], lote: Lote): string {
  const destinos = Array.from(new Set(items.map((i) => i.destino))).sort((a, b) => a.localeCompare(b, 'es'))
  const lineas: string[] = []
  lineas.push(`TRANSFERENCIA — ${origen}`)
  lineas.push(`Archivo: ${lote.nombre} · ${fmtFechaCorta(lote.fecha)}`)
  lineas.push('')
  lineas.push('ARTICULO          | DESCRIPCION            | COLOR | TALLE | ' + destinos.map((d) => d.padEnd(9)).join('| ') + '| TOTAL')
  lineas.push('-'.repeat(80))
  const porArt = new Map<string, Item[]>()
  for (const i of items) {
    const k = [i.articulo ?? '', i.descripcion ?? '', i.color ?? '', i.talle ?? ''].join('¦')
    const a = porArt.get(k) ?? []
    a.push(i)
    porArt.set(k, a)
  }
  for (const [k, grup] of porArt) {
    const [art, desc, color, talle] = k.split('¦')
    const total = grup.reduce((s, i) => s + (i.cantidad || 1), 0)
    const celdas = destinos.map((d) => {
      const q = grup.filter((i) => i.destino === d).reduce((s, i) => s + (i.cantidad || 1), 0)
      return q ? String(q) : ''
    })
    const fila =
      art.padEnd(16).slice(0, 16) +
      desc.padEnd(20).slice(0, 20) +
      color.padEnd(6).slice(0, 6) +
      talle.padEnd(6).slice(0, 6) +
      celdas.map((c) => c.padStart(9)).join('| ') +
      String(total).padStart(9)
    lineas.push(fila)
  }
  lineas.push('')
  lineas.push(`Total: ${items.reduce((s, i) => s + (i.cantidad || 1), 0)} unidades a ${destinos.length} destinos.`)
  return lineas.join('\n')
}

// Barra segmentada por UNIDADES (suma cantidad): verde (hecho) · amarillo (señado) · rojo (faltante)
function Barra({ items }: { items: Item[] }) {
  const total = items.reduce((s, i) => s + (i.cantidad || 1), 0)
  let hecho = 0,
    senado = 0,
    faltante = 0
  for (const i of items) {
    const q = i.cantidad || 1
    if (i.estado === 'hecho') hecho += q
    else if (i.estado === 'senado') senado += q
    else if (i.estado === 'faltante') faltante += q
  }
  const resueltos = hecho + senado + faltante
  const pct = total ? Math.round((resueltos / total) * 100) : 0
  const w = (n: number) => (total ? `${(n / total) * 100}%` : '0%')
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface2">
        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: w(hecho) }} />
        <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: w(senado) }} />
        <div className="h-full bg-red-500 transition-all duration-300" style={{ width: w(faltante) }} />
      </div>
      <span className="text-xs tabular-nums text-sub">{resueltos}/{total} · {pct}%</span>
    </div>
  )
}

export default function Transferencias() {
  const { can, perfil, isAdmin } = useAuth()
  const puedeImportar = can('transferencias.import')
  const verTodo = isAdmin || puedeImportar || can('transferencias.ver_todo')
  const miLocal = (perfil?.local ?? '').toUpperCase()
  // Algunos bultos se cargaron con el origen sin el sufijo "2" (ej: RUTA9D en
  // lugar de RUTA9D2). Para que el usuario vea ambos, se consultan tanto su
  // local exacto como la variante sin el "2" final.
  const origenesUsuario = useMemo(() => {
    const base = miLocal
    if (!base) return []
    const out: string[] = [base]
    // Variantes sin el sufijo "2" final (ej: RUTA9D2 -> RUTA9D)
    if (base.endsWith('2')) {
      const alt = base.slice(0, -1)
      if (!out.includes(alt)) out.push(alt)
    }
    // Variantes con/sin la "d" final (ej: WALMARTD <-> WALMART)
    if (base.endsWith('D') && base.length > 1) {
      const alt = base.slice(0, -1)
      if (!out.includes(alt)) out.push(alt)
    } else {
      const alt = base + 'D'
      if (!out.includes(alt)) out.push(alt)
    }
    return out
  }, [miLocal])

  const [lotes, setLotes] = useState<Lote[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [loteAbierto, setLoteAbierto] = useState<string | null>(null)
  const [origenAbierto, setOrigenAbierto] = useState<string | null>(null)
  const [destinoAbierto, setDestinoAbierto] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [modalEnvio, setModalEnvio] = useState<Lote | null>(null)
  const [usuariosLocales, setUsuariosLocales] = useState<{ email: string; local: string }[]>([])
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
    setError(null)
    const [ld, uRes] = await Promise.all([
      supabase.from('transfer_lotes').select('id,nombre,motivo,fecha,created_at').order('created_at', { ascending: false }).limit(60),
      supabase.from('usuarios').select('email,local').eq('estado', 'aprobado').not('local', 'is', null),
    ])
    if (ld.error) setError(`No se pudieron cargar los archivos: ${ld.error.message}`)
    setUsuariosLocales((uRes.data as { email: string; local: string }[]) ?? [])
    const lotesData = (ld.data as Lote[]) ?? []
    setLotes(lotesData)
    if (lotesData.length) {
      const ids = lotesData.map((l) => l.id)
      // Usamos la RPC SECURITY DEFINER listar_transfer_items: valida los
      // permisos UNA sola vez (no por fila) y evita que la RLS por-fila con
      // funciones no inmutables baje a timeout con tablas grandes.
      const origenes = !verTodo && origenesUsuario.length ? origenesUsuario : null
      const { data: its, error: itemsErr } = await supabase.rpc('listar_transfer_items', {
        p_lotes: ids,
        p_origenes: origenes,
      })
      if (itemsErr) setError(`No se pudieron cargar las líneas: ${itemsErr.message}`)
      setItems((its as Item[]) ?? [])
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
    (origen: string) => origenesUsuario.length > 0 && origenesUsuario.includes(origen.toUpperCase()),
    [origenesUsuario],
  )

  async function marcar(item: Item, estado: EstadoItem) {
    if (!supabase) return
    const ahora = new Date().toISOString()
    const at = estado === 'pendiente' ? null : ahora
    setItems((arr) => arr.map((x) => (x.id === item.id ? { ...x, estado, hecho_at: at } : x)))
    const { error } = await supabase
      .from('transfer_items')
      .update({ estado, hecho: estado === 'hecho', hecho_at: at, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null })
      .eq('id', item.id)
    if (error) {
      setError(error.message)
      await cargar()
    }
  }

  // Marca varios ítems de una (ej. todo un destino)
  async function marcarVarios(its: Item[], estado: EstadoItem) {
    if (!supabase || !its.length) return
    const ids = its.map((i) => i.id)
    const ahora = new Date().toISOString()
    const at = estado === 'pendiente' ? null : ahora
    setItems((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, estado, hecho_at: at } : x)))
    const { error } = await supabase
      .from('transfer_items')
      .update({ estado, hecho: estado === 'hecho', hecho_at: at, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null })
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
      const quitarAcentos = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
      for (const hoja of wb.SheetNames) {
        // La hoja "venta"/"ventas" nunca se importa
        if (['venta', 'ventas'].includes(hoja.trim().toLowerCase())) continue
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, blankrows: false, defval: '' })
        // Ignorar hojas de resumen/general (no son locales origen).
        // Los locales origen tienen el título "CASCADA — <LOCAL>" en la primera fila.
        const nom = quitarAcentos(hoja)
        const titulo = quitarAcentos(String(rows[0]?.[0] ?? ''))
        if (
          ['RESUMEN', 'GENERAL', 'PRIORIDAD', 'HOJA1', 'HOJA2'].includes(nom) ||
          titulo.startsWith('RESUMEN') ||
          titulo.startsWith('IMPORTAR') ||
          titulo.startsWith('GENERAL')
        )
          continue
        const hidx = rows.findIndex((r) => r.some((c) => String(c).trim().toUpperCase() === 'ARTICULO'))
        if (hidx < 0) continue
        const header = rows[hidx].map((c) => String(c).trim())
        const up = header.map((h) => h.toUpperCase())
        const idxArt = up.indexOf('ARTICULO')
        const idxDesc = up.findIndex((h) => h.includes('DESC'))
        const idxMaterial = up.indexOf('MATERIAL')
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
                material: idxMaterial >= 0 ? String(row[idxMaterial] ?? '').trim() || null : null,
                color: idxColor >= 0 ? String(row[idxColor] ?? '').trim() || null : null,
                talle: idxTalle >= 0 ? String(row[idxTalle] ?? '').trim() || null : null,
                tipo: idxTipo >= 0 ? String(row[idxTipo] ?? '').trim() || null : null,
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
      <BackButton />

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
            // usuario de local (sin "ver todo"): no mostrar archivos que no incluyen su local
            if (its.length === 0 && !verTodo) return null
            const loteTodoHecho = its.length > 0 && its.every((i) => i.estado === 'hecho')
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
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left ${loteTodoHecho ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-surface2'}`}
                >
                  <ChevronRight size={16} aria-hidden className={`shrink-0 text-sub transition-transform ${abierto ? 'rotate-90' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{lote.nombre}</p>
                    <p className="truncate text-xs text-sub">
                      Cargado {fmtFechaHora(lote.created_at)} · {origenes.length} locales
                      {lote.motivo ? ` · ${lote.motivo}` : ''}
                    </p>
                  </div>
                  <Barra items={its} />
                  {puedeImportar && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setModalEnvio(lote)
                        }}
                        className="btn-press ml-1 flex shrink-0 items-center gap-1 rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                        title="Enviar cada hoja a su local por mail"
                      >
                        <Send size={14} aria-hidden />
                      </button>
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
                    </>
                  )}
                </button>

                {abierto && (
                  <div className="border-t border-line px-3 py-2">
                    {origenes.map((origen) => {
                      const de = its.filter((i) => i.origen === origen)
                      const resueltos = de.filter((i) => i.estado !== 'pendiente').length
                      const origTodoHecho = de.length > 0 && de.every((i) => i.estado === 'hecho')
                      const key = `${lote.id}|${origen}`
                      const oAbierto = origenAbierto === key
                      const esMio = esMiLocal(origen)
                      const completo = de.length > 0 && resueltos === de.length
                      const finIso = completo ? de.reduce((mx, i) => (i.hecho_at && i.hecho_at > mx ? i.hecho_at : mx), '') : ''
                      const dur = completo && finIso ? fmtDuracion(lote.created_at, finIso) : ''
                      return (
                        <div key={origen} className="my-1 overflow-hidden rounded-xl border border-line">
                          <div className={`flex w-full items-center gap-3 px-3 py-2 ${origTodoHecho ? 'bg-emerald-500/10' : 'bg-surface2'}`}>
                            <button
                              onClick={() => setOrigenAbierto(oAbierto ? null : key)}
                              className="flex flex-1 items-center gap-3 text-left"
                            >
                              <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${oAbierto ? 'rotate-90' : ''}`} />
                              <span className="flex-1 font-display font-semibold text-ink">{origen}</span>
                              {esMio && <span className="rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-medium text-brand-400">tu local</span>}
                              {completo && dur && (
                                <span className="hidden items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 sm:inline-flex">
                                  <Check size={11} aria-hidden /> {dur}
                                </span>
                              )}
                              <Barra items={de} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                imprimirCascada(origen, de, lote)
                              }}
                              title="Imprimir cascada de este local"
                              className="btn-press shrink-0 rounded-lg border border-line p-1.5 text-sub hover:text-ink"
                            >
                              <Printer size={14} aria-hidden />
                            </button>
                            {(isAdmin || esMio) && (
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-sub" title="Marcar todo el local">
                                <input
                                  type="checkbox"
                                  ref={(cb) => {
                                    if (cb) cb.indeterminate = resueltos > 0 && resueltos < de.length
                                  }}
                                  checked={completo}
                                  disabled={!isAdmin && completo}
                                  onChange={(e) =>
                                    marcarVarios(
                                      e.target.checked ? de.filter((i) => i.estado === 'pendiente') : de.filter((i) => i.estado !== 'pendiente'),
                                      e.target.checked ? 'hecho' : 'pendiente',
                                    )
                                  }
                                  className="h-4 w-4 accent-emerald-600 disabled:opacity-50"
                                />
                                todo
                              </label>
                            )}
                          </div>
                          {oAbierto && (
                            <div className="divide-y divide-line/70">
                              {Array.from(
                                de.reduce((m, i) => {
                                  const a = m.get(i.destino) ?? []
                                  a.push(i)
                                  m.set(i.destino, a)
                                  return m
                                }, new Map<string, Item[]>()),
                              )
                                .sort((a, b) => a[0].localeCompare(b[0], 'es', { sensitivity: 'base' }))
                                .map(([destino, dItems]) => {
                                  const dHechos = dItems.filter((i) => i.estado !== 'pendiente').length
                                  const dAll = dItems.length > 0 && dHechos === dItems.length
                                  const dSome = dHechos > 0 && !dAll
                                  const dTodoHecho = dItems.length > 0 && dItems.every((i) => i.estado === 'hecho')
                                  const dKey = `${key}|${destino}`
                                  const dAbierto = destinoAbierto === dKey
                                  const puedeGrupo = isAdmin || esMio
                                  return (
                                    <div key={destino}>
                                      <div className={`flex items-center gap-2 px-3 py-2 ${dTodoHecho ? 'bg-emerald-500/10' : 'bg-surface'}`}>
                                        <button
                                          onClick={() => setDestinoAbierto(dAbierto ? null : dKey)}
                                          className="flex flex-1 items-center gap-2 text-left"
                                        >
                                          <ChevronRight size={14} aria-hidden className={`shrink-0 text-sub transition-transform ${dAbierto ? 'rotate-90' : ''}`} />
                                          <span className="flex items-center gap-1 text-sm font-medium text-ink">
                                            <ArrowRightLeft size={12} aria-hidden /> {destino}
                                          </span>
                                          <Barra items={dItems} />
                                        </button>
                                        {puedeGrupo && (
                                          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-sub" title="Marcar todo este destino">
                                            <input
                                              type="checkbox"
                                              ref={(cb) => {
                                                if (cb) cb.indeterminate = dSome
                                              }}
                                              checked={dAll}
                                              disabled={!isAdmin && dAll}
                                              onChange={(e) =>
                                                marcarVarios(
                                                  e.target.checked
                                                    ? dItems.filter((i) => i.estado === 'pendiente')
                                                    : dItems.filter((i) => i.estado !== 'pendiente'),
                                                  e.target.checked ? 'hecho' : 'pendiente',
                                                )
                                              }
                                              className="h-4 w-4 accent-emerald-600 disabled:opacity-50"
                                            />
                                            todo
                                          </label>
                                        )}
                                      </div>
                                      {dAbierto && (
                                        <ul className="divide-y divide-line/70 bg-surface/40">
                                          {dItems.map((it) => {
                                            // Acciona: tu local (una vez, si está pendiente) o el admin (siempre)
                                            const puedeAccionar = isAdmin || (esMio && it.estado === 'pendiente')
                                            const esHecho = it.estado === 'hecho'
                                            const esSenado = it.estado === 'senado'
                                            const esFaltante = it.estado === 'faltante'
                                            return (
                                              <li key={it.id} className="flex items-center gap-3 px-3 py-2 pl-8">
                                                <span className="min-w-0 flex-1">
                                                  <span className={`block text-sm ${esHecho ? 'text-sub line-through' : esSenado || esFaltante ? 'text-sub' : 'text-ink'}`}>
                                                    {it.articulo}
                                                    {it.color ? ` · ${it.color}` : ''}
                                                    {it.talle ? ` · T${it.talle}` : ''}
                                                    {it.cantidad > 1 ? ` · x${it.cantidad}` : ''}
                                                  </span>
                                                  {it.descripcion && <span className="block truncate text-xs text-sub">{it.descripcion}</span>}
                                                </span>
                                                {it.hecho_at && it.estado !== 'pendiente' && (
                                                  <span className="hidden shrink-0 text-[11px] tabular-nums text-sub sm:inline">{fmtHora(it.hecho_at)}</span>
                                                )}
                                                <div className="flex shrink-0 items-center gap-1">
                                                  <button
                                                    onClick={() => marcar(it, esHecho ? 'pendiente' : 'hecho')}
                                                    disabled={!puedeAccionar}
                                                    title="Hecho / enviado"
                                                    aria-label="Marcar hecho"
                                                    className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${esHecho ? 'bg-emerald-500/20 text-emerald-400' : 'text-sub hover:bg-line hover:text-ink'}`}
                                                  >
                                                    <Check size={15} aria-hidden />
                                                  </button>
                                                  <button
                                                    onClick={() => marcar(it, esSenado ? 'pendiente' : 'senado')}
                                                    disabled={!puedeAccionar}
                                                    title="Señado / separado (no se puede mandar)"
                                                    aria-label="Marcar señado"
                                                    className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${esSenado ? 'bg-amber-500/20 text-amber-400' : 'text-sub hover:bg-line hover:text-ink'}`}
                                                  >
                                                    <Bookmark size={15} aria-hidden />
                                                  </button>
                                                  <button
                                                    onClick={() => marcar(it, esFaltante ? 'pendiente' : 'faltante')}
                                                    disabled={!puedeAccionar}
                                                    title="Faltante / no enviado"
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
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalEnvio && (
        <EnviarTransferencia
          lote={modalEnvio}
          items={itemsPorLote.get(modalEnvio.id) ?? []}
          usuariosLocales={usuariosLocales}
          onClose={() => setModalEnvio(null)}
        />
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

/* ------------------------------------------------------------------ */
/*  Enviar transferencia (mail)                                        */
/* ------------------------------------------------------------------ */

function EnviarTransferencia({ lote, items, usuariosLocales, onClose }: {
  lote: Lote
  items: Item[]
  usuariosLocales: { email: string; local: string }[]
  onClose: () => void
}) {
  // Agrupar los ítems del lote por ORIGEN (cada hoja = un local origen)
  const porOrigen = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of items) {
      const a = m.get(it.origen) ?? []
      a.push(it)
      m.set(it.origen, a)
    }
    return m
  }, [items])

  // Resolve los mails de cada origen desde el backend (service role, sin RLS).
  // Esto evita que usuarios sin permiso de lectura a "usuarios" vean "Sin email".
  const [destRemotos, setDestRemotos] = useState<Map<string, string[]> | null>(null)
  const [cargandoMails, setCargandoMails] = useState(true)
  useEffect(() => {
    if (!supabase || !lote.id) { setCargandoMails(false); return }
    let abortado = false
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) { if (!abortado) setCargandoMails(false); return }
        const r = await fetch('/api/enviar-transferencia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lote_id: lote.id, dry_run: true }),
        })
        if (!r.ok) {
          const cuerpo = await r.text().catch(() => '')
          console.error('[dry-run] HTTP', r.status, cuerpo)
          if (!abortado) setCargandoMails(false)
          return
        }
        const json = await r.json().catch(() => null) as { destinatarios?: { origen: string; mails: string[] }[] } | null
        if (abortado || !json?.destinatarios) { if (!abortado) setCargandoMails(false); return }
        const m = new Map<string, string[]>()
        for (const d of json.destinatarios) m.set(d.origen, d.mails)
        console.log('[dry-run] ok:', json.destinatarios.length, 'orígenes con mails')
        if (!abortado) { setDestRemotos(m); setCargandoMails(false) }
      } catch (e) { console.error('[dry-run] error:', e); if (!abortado) setCargandoMails(false) }
    })()
    return () => { abortado = true }
  }, [supabase, lote.id])

  // Alias de local: agrupa nombres que corresponden al mismo local (depósito). El canónico es INDOD.
  const ALIAS_LOCAL: Record<string, string> = {
    DEPO: 'INDOD',
    DEPOSITO: 'INDOD',
    INDO: 'INDOD',
    INDOD: 'INDOD',
  }

  // Normaliza el código de un local aplicando los alias (solo afecta depósito).
  function canonLocal(local: string): string {
    return ALIAS_LOCAL[(local ?? '').trim().toUpperCase()] ?? (local ?? '').trim().toUpperCase()
  }

  // Variantes posibles de un local para matchear el mail del usuario, sobre el
  // canónico del local, en AMBOS sentidos:
  // - quita "d" final  (WALMARTD -> WALMART) y también agrega "d" (WALMART -> WALMARTD)
  // - quita "2" final  (RUTA9D2  -> RUTA9D)  y también agrega "2" (RUTA9D -> RUTA9D2)
  function variantesLocal(local: string): string[] {
    const base = canonLocal(local)
    const out = [base]
    const ayadir = (s: string) => { if (!out.includes(s)) out.push(s) }
    if (base.endsWith('D') && base.length > 1) {
      ayadir(base.slice(0, -1))
    } else {
      ayadir(base + 'D')
    }
    if (base.endsWith('2') && base.length > 1) {
      ayadir(base.slice(0, -1))
    } else {
      ayadir(base + '2')
    }
    return out
  }

  // Para cada origen, los emails de los usuarios aprobados con ese local.
  // Si el backend devolvió los mails, los usa (sin RLS). Sino, fallback a usuariosLocales.
  const origenes = useMemo(() => {
    const res: { origen: string; mails: string[]; preview: string }[] = []
    porOrigen.forEach((its, origen) => {
      const mailsRemoto = destRemotos?.get(origen)
      const mails = mailsRemoto ?? (() => {
        const variantes = variantesLocal(origen)
        return usuariosLocales
          .filter((u) => variantes.includes(canonLocal(u.local)))
          .map((u) => u.email)
          .filter((e, i, ar) => e && ar.indexOf(e) === i)
      })()
      res.push({ origen, mails, preview: construirMailOrigen(origen, its, lote) })
    })
    return res
  }, [porOrigen, usuariosLocales, destRemotos, lote])

  const conMail = origenes.filter((o) => o.mails.length > 0)
  const sinMail = origenes.filter((o) => o.mails.length === 0)

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{
    ok: boolean
    mensaje: string
  } | null>(null)

  // Arma el enlace de redacción de Outlook Web (navegador autenticado).
  function enlaceOutlook(origen: string, mails: string[], preview: string): string {
    const asunto = encodeURIComponent(`TRANSFERENCIA — ${origen} — ${lote.nombre}`)
    const cuerpo = encodeURIComponent(preview)
    const to = mails.join(',')
    return `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${asunto}&body=${cuerpo}`
  }

  // Abre una hoja en Outlook Web.
  function enviar(origen: string, mails: string[], preview: string) {
    const w = window.open(enlaceOutlook(origen, mails, preview))
    if (w) w.opener = null
  }

  // Envía TODAS las hojas automáticamente desde el backend (SMTP Outlook).
  // No depende del navegador: manda un mail real a cada local con su hoja.
  async function enviarTodo() {
    if (enviando) return
    if (conMail.length === 0) {
      window.confirm('Ningún local tiene mail registrado.')
      return
    }
    if (!window.confirm(`¿Enviar automáticamente ${conMail.length} mail(s) a los locales?`)) return
    setEnviando(true)
    setResultado(null)
    try {
      if (!supabase) throw new Error('Supabase no configurado')
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/api/enviar-transferencia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lote_id: lote.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setResultado({ ok: true, mensaje: json.resumen ?? 'Enviado' })
      } else {
        setResultado({ ok: false, mensaje: json.error ?? `Error ${res.status}` })
      }
    } catch {
      setResultado({ ok: false, mensaje: 'No se pudo enviar. Revisá la configuración de Graph.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display font-semibold text-ink">Enviar transferencia</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={enviarTodo}
              disabled={enviando || cargandoMails || conMail.length === 0}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              title={cargandoMails ? 'Cargando destinatarios…' : 'Envía automáticamente un mail a cada local con su hoja (Microsoft Graph)'}
            >
              {enviando || cargandoMails ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} aria-hidden />}
              {enviando ? 'Enviando…' : cargandoMails ? 'Cargando mails…' : `Enviar todo (${conMail.length})`}
            </button>
            <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 'calc(88vh - 120px)' }}>
          <p className="text-xs text-sub">
            Usá <span className="font-semibold text-emerald-400">Enviar todo</span> para mandar por mail de forma
            automática un correo a cada hoja/local con su contenido. O redactá cada uno manualmente en Outlook abajo.
          </p>
          {resultado && (
            <div
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                resultado.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              {resultado.mensaje}
            </div>
          )}
          {origenes.length === 0 && <p className="py-6 text-center text-sm text-sub">No hay hojas para este archivo.</p>}
          {origenes.map((o) => (
            <div key={o.origen} className="rounded-xl border border-line bg-surface2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{o.origen}</p>
                  <p className="truncate text-xs text-sub">
                    {o.mails.length
                      ? `→ ${o.mails.join(', ')}`
                      : 'Sin email / usuario registrado para este local'}
                  </p>
                </div>
                <button
                  onClick={() => o.mails.length && enviar(o.origen, o.mails, o.preview)}
                  disabled={o.mails.length === 0}
                  className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  <Send size={13} aria-hidden /> Redactar mail
                </button>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-sub hover:text-ink">Ver contenido</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre rounded-lg bg-black/30 p-2 text-[10px] leading-snug text-zinc-300">{o.preview}</pre>
              </details>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <p className="text-xs text-sub">
            {origenes.length - sinMail.length}/{origenes.length} con mail{sinMail.length > 0 ? ` · ${sinMail.length} sin mail` : ''}
          </p>
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
