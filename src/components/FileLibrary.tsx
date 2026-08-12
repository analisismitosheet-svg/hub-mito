import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Upload,
  Download,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  FileSpreadsheet,
  FileType2,
  Image as ImageIcon,
  File as FileIcon,
  FolderOpen,
  X,
  Check,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export interface Archivo {
  id: string
  nombre: string
  descripcion: string | null
  path: string
  mime: string | null
  tamano: number | null
  created_at: string
}

interface FileLibraryProps {
  titulo: string
  subtitulo: string
  color: string
  /** Tabla de metadatos (ej. 'documentos' | 'manuales') */
  table: string
  /** Bucket de Storage */
  bucket: string
  /** Prefijo de permisos (ej. 'documentos' | 'manuales') */
  permisoPrefix: string
  /** Columnas extra para filtrar/insertar (ej. { area_id: 'locales' }) */
  scope?: Record<string, string>
  /** Prefijo de la ruta de storage (ej. 'locales') */
  pathPrefix?: string
  backTo: string
  backLabel: string
  icon?: typeof FolderOpen
}

function iconoDe(mime: string | null) {
  const m = mime ?? ''
  if (m.startsWith('image/')) return ImageIcon
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return FileSpreadsheet
  if (m.includes('word') || m.includes('document')) return FileType2
  if (m.includes('pdf')) return FileText
  return FileIcon
}
function fmtTamano(b: number | null): string {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}
function slug(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export default function FileLibrary(props: FileLibraryProps) {
  const { table, bucket, permisoPrefix, scope, pathPrefix, color } = props
  const { can, perfil } = useAuth()
  const puedeCrear = can(`${permisoPrefix}.create`)
  const puedeEditar = can(`${permisoPrefix}.edit`)
  const puedeEliminar = can(`${permisoPrefix}.delete`)
  const Icono = props.icon ?? FolderOpen

  const [items, setItems] = useState<Archivo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [editando, setEditando] = useState<Archivo | null>(null)
  const [viendo, setViendo] = useState<{ item: Archivo; url: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scopeKey = JSON.stringify(scope ?? {})

  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    let query = supabase
      .from(table)
      .select('id,nombre,descripcion,path,mime,tamano,created_at')
      .order('nombre', { ascending: true })
    for (const [k, v] of Object.entries(JSON.parse(scopeKey) as Record<string, string>)) query = query.eq(k, v)
    const { data, error } = await query
    if (error) setError(error.message)
    setItems((data as Archivo[]) ?? [])
    setCargando(false)
  }, [table, scopeKey])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || !files.length || !supabase) return
    setSubiendo(true)
    setError(null)
    const prefix = pathPrefix ? `${pathPrefix}/` : ''
    for (const f of Array.from(files)) {
      const path = `${prefix}${crypto.randomUUID()}-${slug(f.name)}`
      const up = await supabase.storage
        .from(bucket)
        .upload(path, f, { contentType: f.type || 'application/octet-stream' })
      if (up.error) {
        setError(`No se pudo subir ${f.name}: ${up.error.message}`)
        continue
      }
      const ins = await supabase.from(table).insert({
        ...(scope ?? {}),
        nombre: f.name,
        path,
        mime: f.type || null,
        tamano: f.size,
        subido_por: perfil?.id ?? null,
      })
      if (ins.error) {
        setError(`No se pudo registrar ${f.name}: ${ins.error.message}`)
        await supabase.storage.from(bucket).remove([path])
      }
    }
    setSubiendo(false)
    if (fileRef.current) fileRef.current.value = ''
    await cargar()
  }

  async function ver(a: Archivo) {
    if (!supabase) return
    // enlace firmado (1h) para verlo en pantalla / embeberlo en el visor
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(a.path, 3600)
    if (error || !data) {
      setError(error?.message ?? 'No se pudo generar el enlace.')
      return
    }
    setViendo({ item: a, url: data.signedUrl })
  }

  async function descargar(a: Archivo) {
    if (!supabase) return
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(a.path, 120, {
      download: a.nombre,
    })
    if (error || !data) {
      setError(error?.message ?? 'No se pudo generar el enlace.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function eliminar(a: Archivo) {
    if (!supabase) return
    if (!window.confirm(`¿Eliminar "${a.nombre}"? Esta acción no se puede deshacer.`)) return
    const del = await supabase.from(table).delete().eq('id', a.id)
    if (del.error) {
      setError(del.error.message)
      return
    }
    await supabase.storage.from(bucket).remove([a.path])
    await cargar()
  }

  return (
    <Layout>
      <BackButton label={props.backLabel} />

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color, backgroundColor: `${color}24`, borderColor: `${color}40` }}>
            <Icono size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">{props.titulo}</h1>
            <p className="text-sm text-sub">{props.subtitulo}</p>
          </div>
        </div>
        {puedeCrear && (
          <>
            <input ref={fileRef} type="file" multiple onChange={onFiles} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={subiendo}
              className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-soft hover:bg-brand-700 disabled:opacity-50"
            >
              {subiendo ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Upload size={17} aria-hidden />}
              <span className="hidden sm:inline">{subiendo ? 'Subiendo…' : 'Subir archivos'}</span>
            </button>
          </>
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
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-14 text-center text-sub">
          <Icono size={28} aria-hidden />
          <p>Todavía no hay archivos.{puedeCrear ? ' Subí el primero con “Subir archivos”.' : ''}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const Icon = iconoDe(a.mime)
            return (
              <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 rounded-xl border p-2.5" style={{ color, backgroundColor: `${color}18`, borderColor: `${color}33` }}>
                    <Icon size={22} aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink" title={a.nombre}>{a.nombre}</p>
                    <p className="text-xs text-sub">{fmtTamano(a.tamano)} · {fmtFecha(a.created_at)}</p>
                    {a.descripcion && <p className="mt-1 line-clamp-2 text-xs text-sub">{a.descripcion}</p>}
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1.5">
                  <button
                    onClick={() => ver(a)}
                    className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs font-medium text-ink hover:bg-line"
                  >
                    <Eye size={14} aria-hidden /> Ver
                  </button>
                  {puedeEditar && (
                    <button onClick={() => setEditando(a)} aria-label={`Editar ${a.nombre}`} className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink">
                      <Pencil size={14} aria-hidden />
                    </button>
                  )}
                  {puedeEliminar && (
                    <button onClick={() => eliminar(a)} aria-label={`Eliminar ${a.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20">
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {viendo && (
        <Visor item={viendo.item} url={viendo.url} onClose={() => setViendo(null)} onDescargar={descargar} />
      )}

      {editando && (
        <EditarModal
          table={table}
          item={editando}
          onClose={() => setEditando(null)}
          onSaved={async () => {
            setEditando(null)
            await cargar()
          }}
        />
      )}
    </Layout>
  )
}

function Visor({
  item,
  url,
  onClose,
  onDescargar,
}: {
  item: Archivo
  url: string
  onClose: () => void
  onDescargar: (a: Archivo) => void
}) {
  const mime = item.mime ?? ''
  const esImagen = mime.startsWith('image/')
  const esPdf = mime.includes('pdf')
  const esOffice =
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.includes('officedocument') ||
    /\.(docx?|xlsx?|pptx?)$/i.test(item.nombre)
  const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate font-medium text-ink" title={item.nombre}>{item.nombre}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => onDescargar(item)} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">
            <Download size={14} aria-hidden /> Descargar
          </button>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {esImagen ? (
          <div className="flex h-full items-center justify-center p-4">
            <img src={url} alt={item.nombre} className="max-h-full max-w-full object-contain" />
          </div>
        ) : esPdf ? (
          <iframe src={url} title={item.nombre} className="h-full w-full border-0 bg-white" />
        ) : esOffice ? (
          <iframe src={officeUrl} title={item.nombre} className="h-full w-full border-0 bg-white" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sub">
            <FileIcon size={40} aria-hidden />
            <p>Este tipo de archivo no se puede previsualizar en pantalla.</p>
            <button onClick={() => onDescargar(item)} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Download size={15} aria-hidden /> Descargar archivo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function EditarModal({
  table,
  item,
  onClose,
  onSaved,
}: {
  table: string
  item: Archivo
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre, setNombre] = useState(item.nombre)
  const [descripcion, setDescripcion] = useState(item.descripcion ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputCls =
    'w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) {
      setError('El nombre es obligatorio.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from(table)
      .update({ nombre: nombre.trim(), descripcion: descripcion.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display font-semibold text-ink">Editar archivo</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        <form onSubmit={guardar} className="space-y-4 p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Descripción</span>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} className={inputCls} placeholder="Opcional" />
          </label>
          {error && <p className="text-sm text-brand-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
