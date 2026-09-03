import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Upload, Loader2, ChevronRight, Store, Trash2, Check, X, Plus, BarChart3, ArrowRightLeft, Link as LinkIcon, Printer } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
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
  responsable1: string | null
  responsable2: string | null
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
  venta_local: number | null
  estado: EstadoM
  hecho_at: string | null
  picking: string | null
}

function fmtFechaHora(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

// Barra segmentada por UNIDADES (suma cantidad): verde (hecho) · rojo (faltante)
function Barra({ items }: { items: Item[] }) {
  const total = items.reduce((s, i) => s + (i.cantidad || 1), 0)
  const hecho = items.filter((i) => i.estado === 'hecho').reduce((s, i) => s + (i.cantidad || 1), 0)
  const faltante = items.filter((i) => i.estado === 'faltante').reduce((s, i) => s + (i.cantidad || 1), 0)
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

function fmtFechaCorta(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso + 'T00:00:00'))
  } catch {
    return iso
  }
}

function Estadisticas({
  lote,
  items,
  localesCount,
  personasCount,
  puedeEditar,
  onSaved,
}: {
  lote: Lote
  items: Item[]
  localesCount: number
  personasCount: number
  puedeEditar: boolean
  onSaved: () => Promise<void>
}) {
  const total = items.reduce((s, i) => s + (i.cantidad || 1), 0)
  const faltantes = items.filter((i) => i.estado === 'faltante').reduce((s, i) => s + (i.cantidad || 1), 0)
  const [obs, setObs] = useState(lote.observacion ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Horas: desde que se cargó hasta que se completó todo (o el tiempo transcurrido si sigue en curso)
  const allDone = total > 0 && items.every((i) => i.estado !== 'pendiente')
  const inicio = new Date(lote.created_at).getTime()
  const fin = allDone ? Math.max(...items.map((i) => (i.hecho_at ? new Date(i.hecho_at).getTime() : inicio))) : Date.now()
  const horas = Math.max(0, (fin - inicio) / 3600000)
  const personas = personasCount
  const hsxper = horas * personas
  const prendasHs = hsxper ? total / hsxper : 0

  async function guardar() {
    if (!supabase) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('deposito_lotes').update({ observacion: obs.trim() || null }).eq('id', lote.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    await onSaved()
  }

  const dato = 'py-1 text-sm font-medium text-ink'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Celda label="Venta"><div className={dato}>{fmtFechaCorta(lote.venta_fecha)}</div></Celda>
        <Celda label="Cant venta"><div className={dato}>{lote.cant_venta ?? '—'}</div></Celda>
        <Celda label="Cant repo"><div className={dato}>{total}</div></Celda>
        <Celda label="Art no mandados"><div className="py-1 text-sm font-medium text-red-400">{faltantes}</div></Celda>
        <Celda label="Locales"><div className={dato}>{localesCount}</div></Celda>
        <Celda label="Horas"><div className={dato}>{horas.toFixed(2)}{!allDone && total > 0 ? ' · en curso' : ''}</div></Celda>
        <Celda label="Personas"><div className={dato}>{personas || '—'}</div></Celda>
        <Celda label="Hs x per"><div className={dato}>{hsxper ? hsxper.toFixed(2) : '—'}</div></Celda>
        <Celda label="Prendas/hs"><div className={dato}>{prendasHs ? prendasHs.toFixed(2) : '—'}</div></Celda>
        <Celda label="Observación">
          <input
            disabled={!puedeEditar}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="—"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-60"
          />
        </Celda>
      </div>
      {err && <p className="text-sm text-brand-400">{err}</p>}
      {puedeEditar && (
        <button onClick={guardar} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />} Guardar observación
        </button>
      )}
    </div>
  )
}

export default function Deposito() {
  const { can, perfil, isAdmin } = useAuth()
  const puedeImportar = can('deposito.import')
  const puedeMarcar = isAdmin || can('deposito.mark')

  const [lotes, setLotes] = useState<Lote[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const puedeEditarStats = isAdmin || puedeImportar
  const [loteAbierto, setLoteAbierto] = useState<string | null>(null)
  const [subAbierto, setSubAbierto] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string }[]>([])
  const [modal, setModal] = useState(false)
  const [modalSheet, setModalSheet] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1N0tBAmXyFu9Wh3sby4l6o3u1JNUe01jwDotM8M61xfc/export?format=csv&gid=1571559083')
  const [sheetNombre, setSheetNombre] = useState(() => {
    const d = new Date()
    return `Repo ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`
  })
  const [sheetMotivo, setSheetMotivo] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState(() => {
    const d = new Date()
    return `Repo ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`
  })
  const [motivoNuevo, setMotivoNuevo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg((m) => (m === t ? null : m)), 3000)
  }

  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    const { data: ld } = await supabase
      .from('deposito_lotes')
      .select('id,nombre,motivo,created_at,venta_fecha,cant_venta,horas,personas,observacion,responsable1,responsable2')
      .order('created_at', { ascending: false })
      .limit(60)
    const lotesData = (ld as Lote[]) ?? []
    setLotes(lotesData)
    const { data: emp } = await supabase.from('empleados').select('id,nombre').order('nombre')
    setEmpleados((emp as { id: string; nombre: string }[]) ?? [])
    if (lotesData.length) {
      const ids = lotesData.map((l) => l.id)
      // Paginar los ítems: Supabase corta en 1000 filas por consulta
      const all: Item[] = []
      const PAGE = 1000
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase
          .from('deposito_items')
          .select('id,lote_id,orden,prioridad,local,material,codigo,articulo,color,talle,cantidad,venta_local,estado,hecho_at,picking')
          .in('lote_id', ids)
          .order('lote_id', { ascending: true })
          .order('orden', { ascending: true })
          .range(desde, desde + PAGE - 1)
        const chunk = (data as Item[]) ?? []
        all.push(...chunk)
        if (error || chunk.length < PAGE) break
      }
      setItems(all)
    } else {
      setItems([])
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
      .from('deposito_items')
      .update({ estado, hecho_at: at, hecho_por: estado === 'pendiente' ? null : perfil?.id ?? null })
      .eq('id', item.id)
    if (error) {
      setError(error.message)
      await cargar()
    }
  }

  async function marcarTodo(its: Item[]) {
    if (!supabase || !its.length) return
    const pendientes = its.filter((i) => i.estado !== 'hecho')
    if (!pendientes.length) return
    const ids = pendientes.map((i) => i.id)
    const at = new Date().toISOString()
    setItems((arr) => arr.map((x) => (ids.includes(x.id) ? { ...x, estado: 'hecho' as const, hecho_at: at } : x)))
    const { error } = await supabase
      .from('deposito_items')
      .update({ estado: 'hecho', hecho_at: at, hecho_por: perfil?.id ?? null })
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
      const nuevos: Omit<Item, 'id' | 'lote_id' | 'estado' | 'hecho_at' | 'venta_local'>[] = []
      let orden = 0
      // normaliza encabezados: mayúsculas, sin acentos, espacios colapsados
      const norm = (c: unknown) =>
        String(c ?? '')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, ' ')
      const esLocal = (h: string) => h === 'LOCAL' || h === 'CLIENTE REPO' || h === 'CLIENTE'
      const esCodigo = (h: string) => h === 'CODIGO' || h === 'ARTICULO'
      const tieneEncabezado = (rows: unknown[][]) =>
        rows.some((r) => {
          const up = r.map(norm)
          return up.some(esLocal) && up.some(esCodigo)
        })
      const leer = (hoja: string) =>
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, blankrows: false, defval: '' })

      // Preferir la hoja "ORDENADA POR LOCAL"; si no está, la primera con columnas válidas
      let hojaElegida = wb.SheetNames.find((n) => norm(n) === 'ORDENADA POR LOCAL')
      if (!hojaElegida) hojaElegida = wb.SheetNames.find((n) => tieneEncabezado(leer(n)))

      if (hojaElegida) {
        const rows = leer(hojaElegida)
        const hidx = rows.findIndex((r) => {
          const up = r.map(norm)
          return up.some(esLocal) && up.some(esCodigo)
        })
        if (hidx >= 0) {
          const up = rows[hidx].map(norm)
          const find = (pred: (h: string) => boolean) => up.findIndex(pred)
          const iLocal = find(esLocal)
          const iCod = find(esCodigo)
          const iPri = find((h) => h === 'PRIORIDAD')
          const iMat = find((h) => h === 'MATERIAL' || h === 'DESCRIPCION')
          const iName = find((h) => h.includes('ADICIONAL') || h === 'ARTICULO_ADICIONAL')
          const iColor = find((h) => h === 'COLOR')
          const iTalle = find((h) => h === 'TALLE')
          const iCant = find((h) => h === 'CANTIDAD' || h === 'A REPONER')
          for (let i = hidx + 1; i < rows.length; i++) {
            const row = rows[i]
            const local = String(row[iLocal] ?? '').trim()
            const cod = String(row[iCod] ?? '').trim()
            if (!local || !cod) continue
            // saltar filas de encabezado repetidas dentro de la hoja
            if (esLocal(norm(local)) || esCodigo(norm(cod))) continue
            const pri = iPri >= 0 ? parseInt(String(row[iPri]).trim(), 10) : NaN
            const cant = iCant >= 0 ? parseInt(String(row[iCant]).trim(), 10) : NaN
            nuevos.push({
              orden: orden++,
              prioridad: Number.isNaN(pri) ? null : pri,
              local,
              material: iMat >= 0 ? String(row[iMat] ?? '').trim() || null : null,
              codigo: cod,
              articulo: iName >= 0 ? String(row[iName] ?? '').trim() || null : null,
              color: iColor >= 0 ? String(row[iColor] ?? '').trim() || null : null,
              talle: iTalle >= 0 ? String(row[iTalle] ?? '').trim() || null : null,
              cantidad: Number.isNaN(cant) ? 1 : cant,
              picking: null,
            })
          }
        }
      }
      // Fecha del repo: primer dd/mm/aaaa que aparezca en los títulos de las hojas
      let fechaRepo: string | null = null
      buscarFecha: for (const hoja of wb.SheetNames) {
        const rs = leer(hoja)
        for (let i = 0; i < Math.min(rs.length, 3); i++) {
          for (const c of rs[i]) {
            const m = String(c ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
            if (m) {
              const y = m[3].length === 2 ? `20${m[3]}` : m[3]
              fechaRepo = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
              break buscarFecha
    }
  }

        }
      }
      // Cant venta (total) y venta por local: suma de "VENTA LOCAL" en la hoja REPO POR DIA
      let cantVenta: number | null = null
      const ventaPorLocal: Record<string, number> = {}
      const hojaRepo = wb.SheetNames.find((n) => norm(n) === 'REPO POR DIA')
      if (hojaRepo) {
        const rs = leer(hojaRepo)
        const hi = rs.findIndex((r) => {
          const upp = r.map(norm)
          return upp.some(esLocal) && upp.some(esCodigo)
        })
        if (hi >= 0) {
          const upp = rs[hi].map(norm)
          const iVL = upp.findIndex((h) => h === 'VENTA LOCAL')
          const iLo = upp.findIndex(esLocal)
          if (iVL >= 0) {
            let s = 0
            for (let i = hi + 1; i < rs.length; i++) {
              const lo = String(rs[i][iLo] ?? '').trim()
              if (!lo || esLocal(norm(lo))) continue
              const v = parseInt(String(rs[i][iVL]).trim(), 10)
              if (!Number.isNaN(v)) {
                s += v
                ventaPorLocal[lo] = (ventaPorLocal[lo] ?? 0) + v
              }
            }
            cantVenta = s
          }
        }
      }

      if (!nuevos.length) {
        setError('No encontré los datos. Debe existir la hoja "ORDENADA POR LOCAL" (o columnas CLIENTE REPO/LOCAL y ARTÍCULO/CODIGO).')
      } else {
        const { data: lote, error: e1 } = await supabase
          .from('deposito_lotes')
          .insert({ nombre: nombreNuevo.trim(), motivo: motivoNuevo.trim() || null, subido_por: perfil?.id ?? null, venta_fecha: fechaRepo, cant_venta: cantVenta })
          .select('id')
          .single()
        if (e1 || !lote) throw new Error(e1?.message ?? 'No se pudo crear el lote')
        const loteId = (lote as { id: string }).id
        const { error: e2 } = await supabase
          .from('deposito_items')
          .insert(nuevos.map((n) => ({ ...n, lote_id: loteId, venta_local: ventaPorLocal[n.local] ?? null })))
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
    const { error } = await supabase.from('deposito_lotes').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    await cargar()
  }

  async function importarSheet() {
    if (!supabase) return
    const url = sheetUrl.trim()
    if (!url) { setError('Pegá la URL del Google Sheet.'); return }
    if (!sheetNombre.trim()) { setError('Poné un nombre para el repo.'); return }
    setSubiendo(true)
    setError(null)
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`No se pudo leer el Sheet (${resp.status})`)
      const csv = await resp.text()
      // Strip BOM if present
      const raw = csv.charCodeAt(0) === 0xFEFF ? csv.slice(1) : csv
      const lines = raw.split('\n').filter((l) => l.trim())
      if (lines.length < 2) throw new Error('El Sheet está vacío o no tiene datos.')
      const parseCsvLine = (line: string): string[] => {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
            else if (ch === '"') inQuotes = false
            else current += ch
          } else {
            if (ch === '"') inQuotes = true
            else if (ch === ',') { result.push(current); current = '' }
            else current += ch
          }
        }
        result.push(current)
        return result
      }
      const normH = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ')
      // Buscar la fila de encabezados: la que tenga "Articulo" o "Codigo"
      let hIdx = 0
      let headers: string[] = []
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const row = parseCsvLine(lines[i]).map((h) => h.trim())
        const up = row.map(normH)
        const hasArt = up.some((h) => h.includes('ARTICULO') || h.includes('ARTICULO'))
        const hasCod = up.some((h) => h.includes('CODIGO') || h === 'COD')
        if (hasArt || hasCod) { hIdx = i; headers = row; break }
      }
      if (!headers.length) throw new Error('No encontré la fila de encabezados (Artículo/Código).')
      const up = headers.map(normH)
      // Columnas fijas
      const iArt = up.findIndex((h) => h.includes('ARTICULO') || h.includes('CODIGO') || h === 'COD')
      const iDesc = up.findIndex((h) => h.includes('DESCRIPCION'))
      const iColor = up.findIndex((h) => h === 'COLOR')
      const iTalle = up.findIndex((h) => h === 'TALLE')
      if (iArt < 0) throw new Error('No encontré la columna Artículo/Código.')
      // Columnas de locales: todo lo que no sea fijo ni STOCK ni PICKING
      const fijas = new Set([iArt, iDesc, iColor, iTalle].filter((i) => i >= 0))
      const iPicking = up.findIndex((h) => h.includes('📍') || h.includes('PICKING'))
      const iStock = up.findIndex((h) => h.includes('STOCK'))
      const locales: { idx: number; nombre: string }[] = []
      up.forEach((h, idx) => {
        if (fijas.has(idx)) return
        if (idx === iPicking || idx === iStock) return
        if (!h) return
        locales.push({ idx, nombre: headers[idx] })
      })
      // REPARTIDO siempre al final
      const repIdx = locales.findIndex((l) => l.nombre.toUpperCase().includes('REPARTIDO'))
      if (repIdx >= 0) {
        const [rep] = locales.splice(repIdx, 1)
        locales.push(rep)
      }
      if (!locales.length) throw new Error('No encontré columnas de locales.')
      const nuevos: Omit<Item, 'id' | 'lote_id' | 'estado' | 'hecho_at' | 'venta_local'>[] = []
      let orden = 0
      for (let i = hIdx + 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i])
        const cod = (row[iArt] ?? '').trim()
        if (!cod) continue
        const desc = iDesc >= 0 ? (row[iDesc] ?? '').trim() : ''
        const col = iColor >= 0 ? (row[iColor] ?? '').trim() : null
        const tal = iTalle >= 0 ? (row[iTalle] ?? '').trim() : null
        const picking = iPicking >= 0 ? (row[iPicking] ?? '').trim() || null : null
        for (const loc of locales) {
          const cant = parseInt(String(row[loc.idx] ?? '0').trim(), 10)
          if (!cant || cant <= 0) continue
          nuevos.push({
            orden: orden++,
            prioridad: null,
            local: loc.nombre,
            material: desc || null,
            codigo: cod,
            articulo: null,
            color: col,
            talle: tal,
            cantidad: cant,
            picking,
          })
        }
      }
      if (!nuevos.length) throw new Error('No encontré artículos con cantidades en el Sheet.')
      const { data: lote, error: e1 } = await supabase
        .from('deposito_lotes')
        .insert({ nombre: sheetNombre.trim(), motivo: sheetMotivo.trim() || null, subido_por: perfil?.id ?? null })
        .select('id')
        .single()
      if (e1 || !lote) throw new Error(e1?.message ?? 'No se pudo crear el lote')
      const loteId = (lote as { id: string }).id
      const { error: e2 } = await supabase
        .from('deposito_items')
        .insert(nuevos.map((n) => ({ ...n, lote_id: loteId })))
      if (e2) throw new Error(e2.message)
      setModalSheet(false)
      setSheetNombre('')
      setSheetMotivo('')
      flash(`Importado: ${nuevos.length} ítems de ${locales.length} locales`)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar el Sheet.')
    }
    setSubiendo(false)
  }

  async function guardarResponsable(loteId: string, field: 'responsable1' | 'responsable2', empleadoId: string | null) {
    if (!supabase) return
    setLotes((ls) => ls.map((l) => l.id === loteId ? { ...l, [field]: empleadoId } : l))
    const { error } = await supabase.from('deposito_lotes').update({ [field]: empleadoId }).eq('id', loteId)
    if (error) setError(error.message)
  }

  function ordenarLocales(locs: string[]) {
    const sorted = [...locs]
    const ri = sorted.findIndex((l) => l.toUpperCase().includes('REPARTIDO'))
    if (ri >= 0) { const [rep] = sorted.splice(ri, 1); sorted.push(rep) }
    return sorted
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

  function imprimirLote(lote: Lote, its: Item[]) {
    // Agrupar por (codigo, desc, color, talle, picking)
    const rowMap = new Map<string, { codigo: string; desc: string; color: string; talle: string; picking: string; porLocal: Map<string, number>; items: Item[] }>()
    for (const it of its) {
      const desc = it.material ?? it.articulo ?? ''
      const key = `${it.codigo}|${desc}|${it.color}|${it.talle}|${it.picking}`
      let r = rowMap.get(key)
      if (!r) {
        r = { codigo: it.codigo ?? '', desc, color: it.color ?? '', talle: it.talle ?? '', picking: it.picking ?? '', porLocal: new Map(), items: [] }
        rowMap.set(key, r)
      }
      r.porLocal.set(it.local, (r.porLocal.get(it.local) ?? 0) + it.cantidad)
      r.items.push(it)
    }
    const allLocales = ordenarLocales([...new Set(its.map((i) => i.local))])
    const rows = Array.from(rowMap.values()).sort((a, b) => {
      const ap = a.picking.replace(/[()0-9]/g, '')
      const bp = b.picking.replace(/[()0-9]/g, '')
      if (ap !== bp) return ap.localeCompare(bp)
      const an = parseInt(a.picking.match(/\d+/)?.[0] ?? '0', 10)
      const bn = parseInt(b.picking.match(/\d+/)?.[0] ?? '0', 10)
      return an - bn
    })
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
    const total = its.reduce((s, i) => s + (i.cantidad || 1), 0)
    const hecho = its.filter((i) => i.estado === 'hecho').reduce((s, i) => s + (i.cantidad || 1), 0)
    const faltante = its.filter((i) => i.estado === 'faltante').reduce((s, i) => s + (i.cantidad || 1), 0)
    const thLocales = allLocales.map((l) => `<th style="text-align:center">${esc(l)}</th>`).join('')
    const tdRows = rows.map((r) => {
      const tds = allLocales.map((l) => {
        const c = r.porLocal.get(l)
        return `<td style="text-align:center;${!c ? 'color:#bbb' : ''}">${c ?? ''}</td>`
      }).join('')
      return `<tr>
        <td>${esc(r.codigo)}</td>
        <td>${esc(r.desc)}</td>
        <td>${esc(r.color)}</td>
        <td>${esc(r.talle)}</td>
        ${tds}
        <td style="text-align:center;font-weight:bold">${esc(r.picking)}</td>
      </tr>`
    }).join('')
    const resp = [lote.responsable1, lote.responsable2].filter(Boolean).map((id) => empleados.find((e) => e.id === id)?.nombre ?? id).join(', ')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(lote.nombre)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2px; }
  .meta { font-size: 8pt; color: #555; margin-bottom: 8px; }
  .stats { display: flex; gap: 12px; margin-bottom: 8px; font-size: 8pt; }
  .stats span { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; text-align: left; padding: 3px 4px; font-size: 7pt; text-transform: uppercase; border-bottom: 2px solid #000; border-right: 1px solid #ccc; white-space: nowrap; }
  th:last-child, td:last-child { border-right: none; }
  td { padding: 2px 4px; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #ccc; font-size: 8pt; white-space: nowrap; }
  @media screen { body { padding: 12px; background: #ddd; } }
</style></head><body>
<h1>${esc(lote.nombre)}${resp ? ` — ${esc(resp)}` : ''}</h1>
<div class="meta">${esc(lote.motivo ?? '')} · ${allLocales.length} locales · ${rows.length} artículos · ${new Date(lote.created_at).toLocaleDateString('es-AR')}</div>
<div class="stats">
  <span>Total: ${total}</span>
  <span>Hecho: ${hecho}</span>
  <span>Faltante: ${faltante}</span>
  <span>Pendiente: ${total - hecho - faltante}</span>
</div>
<table>
  <thead><tr><th>Código</th><th>Descripción</th><th>Color</th><th>Talle</th>${thLocales}<th>Picking</th></tr></thead>
  <tbody>${tdRows}</tbody>
</table>
<script>window.onload=function(){window.print()}</script>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  return (
    <Layout>
      <BackButton />

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color: '#d97706', backgroundColor: '#d9770624', borderColor: '#d9770640' }}>
            <Store size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Depósito</h1>
            <p className="text-sm text-sub">Gestión de depósito: preparar y marcar hecho o faltante.</p>
          </div>
        </div>
        {puedeImportar && (
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setModalSheet(true)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-soft hover:bg-line">
              <LinkIcon size={17} aria-hidden /> <span className="hidden sm:inline">Importar de Sheet</span>
            </button>
            <button onClick={() => setModal(true)} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-soft hover:bg-brand-700">
              <Plus size={17} aria-hidden /> <span className="hidden sm:inline">Nuevo archivo</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {msg && (
        <p className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          {msg}
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
            // personas = 0 (ya no se asignan responsables por local)
            const personasLote = 0
            return (
              <div key={lote.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
                <button
                  onClick={() => {
                    const nuevo = abierto ? null : lote.id
                    setLoteAbierto(nuevo)
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
                        imprimirLote(lote, its)
                      }}
                      className="ml-1 rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"
                      title="Imprimir repo"
                    >
                      <Printer size={15} aria-hidden />
                    </span>
                  )}
                  {puedeImportar && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirm({ message: '¿Borrar este archivo y todos sus repos?', onConfirm: () => void borrarLote(lote.id) })
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
                    <div className="flex items-center gap-3 border-b border-line px-4 py-2">
                      <span className="text-[11px] font-medium text-sub">Responsables:</span>
                      <select value={lote.responsable1 ?? ''} onChange={(e) => guardarResponsable(lote.id, 'responsable1', e.target.value || null)} className="max-w-[9rem] rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                        <option value="">—</option>
                        {empleados.map((em) => <option key={em.id} value={em.id}>{em.nombre}</option>)}
                      </select>
                      <select value={lote.responsable2 ?? ''} onChange={(e) => guardarResponsable(lote.id, 'responsable2', e.target.value || null)} className="max-w-[9rem] rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                        <option value="">—</option>
                        {empleados.map((em) => <option key={em.id} value={em.id}>{em.nombre}</option>)}
                      </select>
                    </div>
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
                          <Estadisticas lote={lote} items={its} localesCount={locales.length} personasCount={personasLote} puedeEditar={puedeEditarStats} onSaved={cargar} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center border-b border-line">
                      <button
                        onClick={() => setSubAbierto(subAbierto === `${lote.id}|repo` ? null : `${lote.id}|repo`)}
                        className="flex flex-1 items-center gap-2 px-4 py-2.5 text-left hover:bg-surface2"
                      >
                        <ChevronRight size={15} aria-hidden className={`shrink-0 text-sub transition-transform ${subAbierto === `${lote.id}|repo` ? 'rotate-90' : ''}`} />
                        <ArrowRightLeft size={15} aria-hidden className="text-sub" />
                        <span className="font-display font-semibold text-ink">Reposición</span>
                      </button>
                      {puedeMarcar && its.some((i) => i.estado !== 'hecho') && (
                        <button
                          onClick={() => marcarTodo(its)}
                          className="flex shrink-0 items-center gap-1 border-l border-line px-3 py-2.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10"
                          title="Marcar todo listo"
                        >
                          <Check size={14} aria-hidden /> Todo listo
                        </button>
                      )}
                    </div>
                    {subAbierto === `${lote.id}|repo` && (() => {
    const allLocales = ordenarLocales([...new Set(its.map((i) => i.local))])
                      const rowMap = new Map<string, { codigo: string; desc: string; color: string; talle: string; picking: string; porLocal: Map<string, Item> }>()
                      for (const it of its) {
                        const desc = it.material ?? it.articulo ?? ''
                        const key = `${it.codigo}|${desc}|${it.color}|${it.talle}|${it.picking}`
                        let r = rowMap.get(key)
                        if (!r) {
                          r = { codigo: it.codigo ?? '', desc, color: it.color ?? '', talle: it.talle ?? '', picking: it.picking ?? '', porLocal: new Map() }
                          rowMap.set(key, r)
                        }
                        r.porLocal.set(it.local, it)
                      }
                      const rows = Array.from(rowMap.values()).sort((a, b) => {
                        const ap = a.picking.replace(/[()0-9]/g, '')
                        const bp = b.picking.replace(/[()0-9]/g, '')
                        if (ap !== bp) return ap.localeCompare(bp)
                        const an = parseInt(a.picking.match(/\d+/)?.[0] ?? '0', 10)
                        const bn = parseInt(b.picking.match(/\d+/)?.[0] ?? '0', 10)
                        return an - bn
                      })
                      return (
                        <div className="px-3 pb-2 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-line text-left text-[11px] uppercase text-sub">
                                <th className="px-2 py-1.5">Código</th>
                                <th className="px-2 py-1.5">Descripción</th>
                                <th className="px-2 py-1.5">Color</th>
                                <th className="px-2 py-1.5">Talle</th>
                                {allLocales.map((l) => <th key={l} className="px-2 py-1.5 text-center">{l}</th>)}
                                <th className="px-2 py-1.5 text-center">Picking</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, ri) => {
                                return (
                                  <tr key={ri} className="border-b border-line/50">
                                    <td className="px-2 py-1 font-mono text-xs">{r.codigo}</td>
                                    <td className="px-2 py-1 text-xs">{r.desc}</td>
                                    <td className="px-2 py-1 text-xs">{r.color}</td>
                                    <td className="px-2 py-1 text-xs">{r.talle}</td>
                                    {allLocales.map((l) => {
                                      const it = r.porLocal.get(l)
                                      if (!it) return <td key={l} className="px-2 py-1 text-center text-sub/30">—</td>
                                      const esHecho = it.estado === 'hecho'
                                      const esFaltante = it.estado === 'faltante'
                                      return (
                                        <td key={l} className="px-2 py-1 text-center">
                                          <div className="flex items-center justify-center gap-0.5">
                                            <span className={`tabular-nums ${esHecho ? 'text-emerald-400 line-through' : esFaltante ? 'text-brand-400 line-through' : ''}`}>{it.cantidad}</span>
                                            {puedeMarcar && (
                                              <>
                                                <button onClick={() => marcar(it, esHecho ? 'pendiente' : 'hecho')} title="Hecho" className={`rounded p-0.5 transition-colors ${esHecho ? 'bg-emerald-500/20 text-emerald-400' : 'text-sub/40 hover:text-emerald-400'}`}>
                                                  <Check size={11} aria-hidden />
                                                </button>
                                                <button onClick={() => marcar(it, esFaltante ? 'pendiente' : 'faltante')} title="Faltante" className={`rounded p-0.5 transition-colors ${esFaltante ? 'bg-brand-600/20 text-brand-400' : 'text-sub/40 hover:text-brand-400'}`}>
                                                  <X size={11} aria-hidden />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      )
                                    })}
                                    <td className="px-2 py-1 text-center font-mono text-xs font-bold">{r.picking}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
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
      {modalSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !subiendo && setModalSheet(false)}>
          <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-display font-semibold text-ink">Importar de Google Sheet</h2>
              <button onClick={() => setModalSheet(false)} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">URL del Sheet (export CSV)</span>
                <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Nombre del repo</span>
                <input value={sheetNombre} onChange={(e) => setSheetNombre(e.target.value)} placeholder="Ej: Repo 20/08" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Motivo</span>
                <input value={sheetMotivo} onChange={(e) => setSheetMotivo(e.target.value)} placeholder="Opcional" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
              </label>
              <p className="text-xs text-sub">El Sheet debe ser público (Anyone with link can view). Se leen las columnas de locales con cantidades.</p>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button onClick={importarSheet} disabled={subiendo || !sheetUrl.trim() || !sheetNombre.trim()} className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {subiendo ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LinkIcon size={16} aria-hidden />}
                {subiendo ? 'Importando…' : 'Importar'}
              </button>
              <button onClick={() => setModalSheet(false)} disabled={subiendo} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}
