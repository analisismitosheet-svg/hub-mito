import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WorkBook } from 'xlsx'
import {
  ArrowLeft,
  Upload,
  Send,
  Loader2,
  Check,
  AlertTriangle,
  FileSpreadsheet,
  X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

type Estado = 'pendiente' | 'enviando' | 'ok' | 'error' | 'sin-usuario'

interface Fila {
  hoja: string
  email: string | null
  nombre: string | null
  estado: Estado
  detalle?: string
}

export default function RepoDiaria() {
  const { can, perfil } = useAuth()
  const puedeEnviar = can('repo_diaria.send')
  const [mapa, setMapa] = useState<Record<string, { email: string; nombre: string }>>({})
  const [filas, setFilas] = useState<Fila[]>([])
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [workbook, setWorkbook] = useState<WorkBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviandoTodo, setEnviandoTodo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Mapa local(código) → usuario, desde los usuarios registrados con Local asignado
  const cargarMapa = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('usuarios').select('local,email,nombre').not('local', 'is', null)
    const m: Record<string, { email: string; nombre: string }> = {}
    for (const u of (data as { local: string; email: string; nombre: string }[]) ?? []) {
      if (u.local) m[u.local.trim().toUpperCase()] = { email: u.email, nombre: u.nombre }
    }
    setMapa(m)
  }, [])

  useEffect(() => {
    void cargarMapa()
  }, [cargarMapa])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null)
    try {
      const XLSX = await import('xlsx')
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      setWorkbook(wb)
      setNombreArchivo(f.name)
      setFilas(
        wb.SheetNames.map((hoja) => {
          const match = mapa[hoja.trim().toUpperCase()]
          return {
            hoja,
            email: match?.email ?? null,
            nombre: match?.nombre ?? null,
            estado: match ? ('pendiente' as Estado) : ('sin-usuario' as Estado),
          }
        }),
      )
    } catch {
      setError('No se pudo leer el Excel. ¿Es un archivo .xlsx válido?')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function enviarUno(idx: number) {
    if (!supabase || !workbook) return
    const fila = filas[idx]
    if (!fila.email || fila.estado === 'sin-usuario') return
    setFilas((f) => f.map((x, i) => (i === idx ? { ...x, estado: 'enviando' } : x)))

    // Armar un Excel con solo esa hoja
    const XLSX = await import('xlsx')
    const nwb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(nwb, workbook.Sheets[fila.hoja], fila.hoja.slice(0, 31))
    const contentBase64 = XLSX.write(nwb, { type: 'base64', bookType: 'xlsx' })

    const { data, error: fnErr } = await supabase.functions.invoke('enviar-repo', {
      body: {
        to: fila.email,
        subject: `Repo diaria - ${fila.hoja}`,
        filename: `${fila.hoja}.xlsx`,
        contentBase64,
        mensaje: `Hola ${fila.nombre ?? ''}, adjuntamos tu planilla de repo diaria (${fila.hoja}).`,
      },
    })
    const res = (data as { sent?: boolean; reason?: string } | null) ?? null
    const ok = !fnErr && res?.sent === true
    const detalle = fnErr?.message ?? res?.reason

    setFilas((f) => f.map((x, i) => (i === idx ? { ...x, estado: ok ? 'ok' : 'error', detalle } : x)))
    await supabase.from('repo_envios').insert({
      lote: nombreArchivo,
      local: fila.hoja,
      email: fila.email,
      archivo: `${fila.hoja}.xlsx`,
      enviado: ok,
      error: ok ? null : (detalle ?? 'error'),
      enviado_por: perfil?.id ?? null,
    })
  }

  async function enviarTodos() {
    setEnviandoTodo(true)
    for (let i = 0; i < filas.length; i++) {
      if (filas[i].estado === 'pendiente' || filas[i].estado === 'error') {
        await enviarUno(i)
      }
    }
    setEnviandoTodo(false)
  }

  function limpiar() {
    setFilas([])
    setWorkbook(null)
    setNombreArchivo('')
    setError(null)
  }

  const conMatch = filas.filter((f) => f.estado !== 'sin-usuario').length
  const sinMatch = filas.length - conMatch
  const enviados = filas.filter((f) => f.estado === 'ok').length

  return (
    <Layout>
      <Link to="/area/compras" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Compras
      </Link>

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color: '#65a30d', backgroundColor: '#65a30d24', borderColor: '#65a30d40' }}>
            <FileSpreadsheet size={26} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Repo Diaria</h1>
            <p className="text-sm text-sub">Subí el Excel: cada hoja se manda al local correspondiente.</p>
          </div>
        </div>
        {puedeEnviar && filas.length === 0 && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="btn-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-sm font-medium text-white shadow-soft hover:bg-brand-700">
              <Upload size={17} aria-hidden /> <span className="hidden sm:inline">Subir Excel</span>
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {filas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 py-16 text-center text-sub">
          <FileSpreadsheet size={30} aria-hidden />
          <p>
            {puedeEnviar
              ? 'Subí el Excel (una hoja por local). La app matchea cada hoja con el usuario que tenga ese Local asignado.'
              : 'No tenés permiso para enviar la repo diaria.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
            <div className="text-sm text-sub">
              <span className="font-medium text-ink">{nombreArchivo}</span> · {filas.length} hojas ·{' '}
              <span className="text-emerald-400">{conMatch} con local</span>
              {sinMatch > 0 && <span className="text-amber-400"> · {sinMatch} sin usuario</span>}
              {enviados > 0 && <span className="text-emerald-400"> · {enviados} enviadas</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={limpiar} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-sm text-ink hover:bg-line">
                <X size={15} aria-hidden /> Cancelar
              </button>
              {puedeEnviar && conMatch > 0 && (
                <button onClick={enviarTodos} disabled={enviandoTodo} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {enviandoTodo ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
                  {enviandoTodo ? 'Enviando…' : 'Enviar a todos'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filas.map((fila, idx) => (
              <div key={fila.hoja} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold text-ink">{fila.hoja}</span>
                  <EstadoBadge estado={fila.estado} />
                </div>
                {fila.estado === 'sin-usuario' ? (
                  <p className="flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertTriangle size={13} aria-hidden /> Ningún usuario tiene el Local “{fila.hoja}”.
                  </p>
                ) : (
                  <p className="truncate text-xs text-sub" title={fila.email ?? ''}>
                    {fila.nombre} · {fila.email}
                  </p>
                )}
                {fila.detalle && fila.estado === 'error' && (
                  <p className="line-clamp-2 text-xs text-brand-400" title={fila.detalle}>{fila.detalle}</p>
                )}
                {puedeEnviar && fila.estado !== 'sin-usuario' && (
                  <button
                    onClick={() => enviarUno(idx)}
                    disabled={fila.estado === 'enviando' || fila.estado === 'ok'}
                    className="btn-press mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50"
                  >
                    {fila.estado === 'enviando' ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : fila.estado === 'ok' ? (
                      <Check size={14} aria-hidden />
                    ) : (
                      <Send size={14} aria-hidden />
                    )}
                    {fila.estado === 'ok' ? 'Enviado' : fila.estado === 'enviando' ? 'Enviando…' : 'Enviar'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  )
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const map: Record<Estado, { txt: string; cls: string }> = {
    pendiente: { txt: 'Pendiente', cls: 'bg-surface2 text-sub border-line2' },
    enviando: { txt: 'Enviando', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    ok: { txt: 'Enviado', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    error: { txt: 'Error', cls: 'bg-brand-600/15 text-brand-400 border-brand-600/30' },
    'sin-usuario': { txt: 'Sin usuario', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  }
  const s = map[estado]
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.txt}</span>
}
