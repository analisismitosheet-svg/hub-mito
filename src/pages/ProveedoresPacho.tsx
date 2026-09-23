import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Search, Upload, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'

interface ProvPacho {
  id: string
  codigo_flexus: string | null
  codigo_dragon: string | null
  razon_social: string | null
  cuit: string | null
  direccion: string | null
  telefono: string | null
  mail: string | null
  provincia: string | null
  localidad: string | null
  tipo_proveedor: string | null
}

const CAMPOS = 'id,codigo_flexus,codigo_dragon,razon_social,cuit,direccion,telefono,mail,provincia,localidad,tipo_proveedor'
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

const CAMPOS_UI: { key: keyof ProvPacho; label: string }[] = [
  { key: 'codigo_flexus', label: 'Código Flexus' },
  { key: 'codigo_dragon', label: 'Código Dragon' },
  { key: 'razon_social', label: 'Razón Social' },
  { key: 'cuit', label: 'C.U.I.T.' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'mail', label: 'Mail' },
  { key: 'provincia', label: 'Provincia' },
  { key: 'localidad', label: 'Localidad' },
  { key: 'tipo_proveedor', label: 'Tipo proveedor' },
]

export default function ProveedoresPacho() {
  const [prov, setProv] = useState<ProvPacho[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<ProvPacho | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [importando, setImportando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error } = await supabase.from('proveedores_pacho').select(CAMPOS).order('razon_social')
    if (!error) setProv((data as ProvPacho[]) ?? [])
    setCargando(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const filtradas = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) return prov
    return prov.filter((p) => (p.razon_social || '').toUpperCase().includes(t) || (p.codigo_flexus || '').toUpperCase().includes(t) || (p.cuit || '').toUpperCase().includes(t))
  }, [prov, q])

  function abrir(n: ProvPacho | null) {
    setSel(n)
    const base: Record<string, string> = {}
    for (const c of CAMPOS_UI) base[c.key] = n ? String(n[c.key] ?? '') : ''
    setF(base)
    setModal(n ? 'edit' : 'new')
  }

  async function guardar() {
    if (!supabase) return
    setBusy(true)
    const payload: Record<string, unknown> = {}
    for (const c of CAMPOS_UI) payload[c.key] = String(f[c.key] ?? '').trim() || null
    const res = sel
      ? await supabase.from('proveedores_pacho').update(payload).eq('id', sel.id)
      : await supabase.from('proveedores_pacho').insert(payload)
    setBusy(false)
    if (res.error) return
    setModal(null); setSel(null); await cargar()
  }

  async function borrar(p: ProvPacho) {
    if (!supabase) return
    await supabase.from('proveedores_pacho').delete().eq('id', p.id)
    await cargar()
  }

  async function importar(file: File) {
    const sb = supabase
    if (!sb) return
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    const batch = rows.map((r) => {
      const val = (k: string[]) => {
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
        for (const key of Object.keys(r)) { const n = norm(key); for (const c of k) if (n.includes(c)) return String(r[key] ?? '').trim() || null }
        return null
      }
      return {
        codigo_flexus: val(['codigo flexus', 'flexus']),
        codigo_dragon: val(['codigo dragon', 'dragon']),
        razon_social: val(['razon social']),
        cuit: val(['cuit']),
        direccion: val(['direccion']),
        telefono: val(['telefono']),
        mail: val(['mail', 'email']),
        provincia: val(['provincia']),
        localidad: val(['localidad']),
        tipo_proveedor: val(['tipo proveedor']),
      }
    }).filter((r) => r.razon_social || r.codigo_flexus)
    if (!batch.length) return
    setImportando(true)
    for (let i = 0; i < batch.length; i += 200) {
      await sb.from('proveedores_pacho').insert(batch.slice(i, i + 200))
    }
    setImportando(false)
    setImportMsg(`${batch.length} proveedores importados.`)
    setTimeout(() => setImportMsg(null), 3500)
    await cargar()
  }

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Proveedores Pacho</h1>
          <p className="text-xs text-sub/70">Proveedores (hoja del Excel PROVEEDORES PACHO).</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void importar(fl); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-line"><Upload size={13} /> {importando ? 'Importando…' : 'Importar Excel'}</button>
          <button onClick={() => abrir(null)} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} /> Nuevo</button>
        </div>
      </header>
      {importMsg && <p className="mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{importMsg}</p>}
      <div className="mb-3">
        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por razón social, código o CUIT..." className={inputCls + ' pl-8'} />
        </div>
      </div>
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sub"><Loader2 size={16} className="animate-spin" /> Cargando...</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-max text-[12px]">
            <thead className="sticky top-0 bg-surface2/95 text-left text-[11px] uppercase tracking-wider text-sub">
              <tr>{CAMPOS_UI.map((c) => <th key={c.key} className="px-2 py-2 whitespace-nowrap">{c.label}</th>)}<th className="px-2 py-2 text-right">Acc</th></tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {filtradas.map((p) => (
                <tr key={p.id} className="hover:bg-line/20">
                  {CAMPOS_UI.map((c) => <td key={c.key} className="px-2 py-1 whitespace-nowrap">{p[c.key] || '-'}</td>)}
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => abrir(p)} className="rounded border border-line p-1 text-sub hover:text-ink" title="Editar"><Pencil size={11} /></button>
                      <button onClick={() => setConfirm({ message: `¿Borrar a "${p.razon_social || '-'}"?`, onConfirm: () => void borrar(p) })} className="rounded border border-line p-1 text-sub hover:text-red-400" title="Eliminar"><Trash2 size={11} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2" onClick={() => setModal(null)}>
          <div className="w-[95vw] max-w-3xl rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-lg font-semibold text-ink">{sel ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
              <button onClick={() => setModal(null)} className="rounded-lg border border-line p-1.5 text-sub hover:bg-line"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2" style={{ maxHeight: '70vh' }}>
              {CAMPOS_UI.map((c) => (
                <label key={c.key} className="block">
                  <span className="mb-0.5 block text-xs font-medium text-sub">{c.label}</span>
                  <input value={f[c.key] ?? ''} onChange={(e) => setF((p) => ({ ...p, [c.key]: e.target.value }))} className={inputCls} />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button onClick={() => setModal(null)} className="btn-press rounded-lg border border-line bg-surface2 px-4 py-2 text-sm text-ink hover:bg-line">Cancelar</button>
              <button onClick={() => void guardar()} disabled={busy} className="btn-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{busy ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}