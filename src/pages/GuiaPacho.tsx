import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Search, Upload, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'

interface GuiaPacho {
  id: string
  fecha: string | null
  n_dragon: string | null
  n_flexus: string | null
  planilla_excel: string | null
  mail: string | null
  numero_gestion: string | null
  despacho: string | null
  nc: string | null
}

const CAMPOS = 'id,fecha,n_dragon,n_flexus,planilla_excel,mail,numero_gestion,despacho,nc'
const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

const CAMPOS_UI: { key: keyof GuiaPacho; label: string }[] = [
  { key: 'fecha', label: 'Fecha' },
  { key: 'n_dragon', label: 'N de Dragon' },
  { key: 'n_flexus', label: 'N de Flexus' },
  { key: 'planilla_excel', label: 'Planilla Excel' },
  { key: 'mail', label: 'Mail' },
  { key: 'numero_gestion', label: 'Número de Gestión' },
  { key: 'despacho', label: 'Despacho' },
  { key: 'nc', label: 'NC' },
]

export default function GuiaPacho() {
  const [guias, setGuias] = useState<GuiaPacho[]>([])
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<GuiaPacho | null>(null)
  const [f, setF] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [importando, setImportando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error } = await supabase.from('proveedores_pacho_guia').select(CAMPOS).order('fecha', { ascending: false })
    if (!error) setGuias((data as GuiaPacho[]) ?? [])
    setCargando(false)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const filtradas = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) return guias
    return guias.filter((g) => (g.n_dragon || '').toUpperCase().includes(t) || (g.n_flexus || '').toUpperCase().includes(t) || (g.mail || '').toUpperCase().includes(t) || (g.numero_gestion || '').toUpperCase().includes(t))
  }, [guias, q])

  function abrir(n: GuiaPacho | null) {
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
      ? await supabase.from('proveedores_pacho_guia').update(payload).eq('id', sel.id)
      : await supabase.from('proveedores_pacho_guia').insert(payload)
    setBusy(false)
    if (res.error) return
    setModal(null); setSel(null); await cargar()
  }

  async function borrar(g: GuiaPacho) {
    if (!supabase) return
    await supabase.from('proveedores_pacho_guia').delete().eq('id', g.id)
    await cargar()
  }

  async function importar(file: File) {
    const sb = supabase
    if (!sb) return
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const hoja = wb.SheetNames.find((s) => s.toLowerCase().includes('guia')) ?? wb.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[hoja], { defval: '' })
    const batch = rows.map((r) => {
      const val = (k: string[]) => {
        const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
        for (const key of Object.keys(r)) { const n = norm(key); for (const c of k) if (n.includes(c)) return String(r[key] ?? '').trim() || null }
        return null
      }
      return {
        fecha: val(['fecha']),
        n_dragon: val(['n de dragon', 'dragon']),
        n_flexus: val(['n de flexus', 'flexus']),
        planilla_excel: val(['planilla']),
        mail: val(['mail', 'email']),
        numero_gestion: val(['numero de gestion', 'gestion']),
        despacho: val(['despacho']),
        nc: val(['nc']),
      }
    }).filter((r) => r.n_dragon || r.n_flexus || r.fecha)
    if (!batch.length) return
    setImportando(true)
    for (let i = 0; i < batch.length; i += 200) {
      await sb.from('proveedores_pacho_guia').insert(batch.slice(i, i + 200))
    }
    setImportando(false)
    setImportMsg(`${batch.length} guías importadas.`)
    setTimeout(() => setImportMsg(null), 3500)
    await cargar()
  }

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Guía Pacho</h1>
          <p className="text-xs text-sub/70">Guía de despacho (hoja del Excel PROVEEDORES PACHO).</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void importar(fl); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-line"><Upload size={13} /> {importando ? 'Importando…' : 'Importar Excel'}</button>
          <button onClick={() => abrir(null)} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} /> Nueva</button>
        </div>
      </header>
      {importMsg && <p className="mb-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{importMsg}</p>}
      <div className="mb-3">
        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N dragon, flexus, mail o gestión..." className={inputCls + ' pl-8'} />
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
              {filtradas.map((g) => (
                <tr key={g.id} className="hover:bg-line/20">
                  {CAMPOS_UI.map((c) => <td key={c.key} className="px-2 py-1 whitespace-nowrap">{g[c.key] || '-'}</td>)}
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => abrir(g)} className="rounded border border-line p-1 text-sub hover:text-ink" title="Editar"><Pencil size={11} /></button>
                      <button onClick={() => setConfirm({ message: '¿Borrar esta guía?', onConfirm: () => void borrar(g) })} className="rounded border border-line p-1 text-sub hover:text-red-400" title="Eliminar"><Trash2 size={11} /></button>
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
              <h2 className="text-lg font-semibold text-ink">{sel ? 'Editar guía' : 'Nueva guía'}</h2>
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