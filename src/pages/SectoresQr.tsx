import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Store,
  QrCode,
  Copy,
  Check,
  Printer,
  RotateCw,
  X,
  Download,
  MapPin,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  buildLabelHtml,
  qrImgUrl,
  QR_LABEL_DEFAULT,
  type QrLabelConfig,
} from '@/components/QrEtiqueta'
import type { Sector, QrToken } from '@/types/encuestas'

interface Local {
  codigo: string
  nombre: string | null
}

function slugToken(token: string) {
  return token.slice(0, 8) + '…' + token.slice(-4)
}

function urlPublico(token: string) {
  return `${window.location.origin}/opinar/qr/${token}`
}

/** Página de administración de Sectores y QR únicos por (Local + Sector). */
export default function SectoresQr() {
  const { can, isAdmin } = useAuth()
  const puedeRegenerar = isAdmin || can('qr.regenerar')

  const [locales, setLocales] = useState<Local[]>([])
  const [sectores, setSectores] = useState<Sector[]>([])
  const [tokens, setTokens] = useState<QrToken[]>([])
  const [qrCfg, setQrCfg] = useState<QrLabelConfig>(QR_LABEL_DEFAULT)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

  // Filtros
  const [localFiltro, setLocalFiltro] = useState<string>('')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  // Modales
  const [qrVer, setQrVer] = useState<{ token: string; local: string; sector: string } | null>(null)
  const [nuevoSector, setNuevoSector] = useState<{ nombre: string } | null>(null)
  const [editSector, setEditSector] = useState<Sector | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const [lc, sc, qt, cfg] = await Promise.all([
      supabase.from('locales').select('codigo,nombre').order('codigo'),
      supabase.from('sectores').select('*').order('local').order('orden').order('nombre'),
      supabase.from('qr_tokens').select('*').eq('activo', true),
      supabase.from('config_app').select('valor').eq('clave', 'qr_etiqueta').maybeSingle(),
    ])
    if (lc.error) setError(lc.error.message)
    setLocales((lc.data as Local[]) ?? [])
    setSectores((sc.data as Sector[]) ?? [])
    setTokens((qt.data as QrToken[]) ?? [])
    if (cfg.data?.valor) setQrCfg({ ...QR_LABEL_DEFAULT, ...(cfg.data.valor as Partial<QrLabelConfig>) })
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  function flash(t: string) {
    setMsg(t)
    setTimeout(() => setMsg((m) => (m === t ? null : m)), 2500)
  }

  const nombreLocal = useMemo(() => {
    const m = new Map<string, string>()
    locales.forEach((l) => m.set(l.codigo, l.nombre ?? l.codigo))
    return m
  }, [locales])

  const tokenActivoPorSector = useMemo(() => {
    const m = new Map<string, QrToken>()
    tokens.forEach((t) => m.set(t.sector_id, t))
    return m
  }, [tokens])

  const sectoresPorLocal = useMemo(() => {
    const m = new Map<string, Sector[]>()
    sectores.forEach((s) => {
      const arr = m.get(s.local) ?? []
      arr.push(s)
      m.set(s.local, arr)
    })
    return m
  }, [sectores])

  const localesVisibles = useMemo(() => {
    if (localFiltro) return locales.filter((l) => l.codigo === localFiltro)
    return locales
  }, [locales, localFiltro])

  // ---------- Sectores ----------
  async function crearSector(nombre: string) {
    if (!supabase) return
    const n = nombre.trim()
    if (!n) {
      setError('Poné un nombre para el sector.')
      return
    }
    if (locales.length === 0) {
      setError('No hay locales cargados. Agregalos desde Configuraciones → Locales.')
      return
    }

    const nuevos: Sector[] = []
    const nuevosTokens: QrToken[] = []
    let errores = 0

    for (const l of locales) {
      const { data, error } = await supabase
        .from('sectores')
        .insert({ local: l.codigo, nombre: n, orden: (sectoresPorLocal.get(l.codigo)?.length ?? 0) + 1 })
        .select('*')
        .single()
      if (error) {
        errores++
        continue
      }
      nuevos.push(data as Sector)
      // Crear QR sin refresh intermedio
      const { data: tokenStr, error: qrErr } = await supabase.rpc('crear_qr_sector', {
        p_local: l.codigo,
        p_sector_id: (data as Sector).id,
      })
      if (!qrErr && tokenStr) {
        nuevosTokens.push({
          token: tokenStr as string,
          local: l.codigo,
          sector_id: (data as Sector).id,
          activo: true,
          created_at: new Date().toISOString(),
          revoked_at: null,
        })
      }
    }

    if (nuevos.length > 0) {
      setSectores((s) => [...s, ...nuevos])
    }
    if (nuevosTokens.length > 0) {
      setTokens((t) => [...t, ...nuevosTokens])
    }
    setNuevoSector(null)
    if (errores === 0) {
      flash(`Sector "${n}" creado en ${nuevos.length} local${nuevos.length === 1 ? '' : 'es'}`)
    } else {
      flash(`Sector creado en ${nuevos.length} locales (${errores} error${errores === 1 ? '' : 'es'})`)
    }
  }

  async function guardarSector(s: Sector, nombre: string, activo: boolean) {
    if (!supabase) return
    const { error } = await supabase
      .from('sectores')
      .update({ nombre: nombre.trim(), activo, updated_at: new Date().toISOString() })
      .eq('id', s.id)
    if (error) {
      setError(error.message)
      return
    }
    setSectores((all) => all.map((x) => (x.id === s.id ? { ...x, nombre: nombre.trim(), activo } : x)))
    setEditSector(null)
    flash('Sector actualizado')
  }

  async function borrarSector(s: Sector) {
    if (!supabase) return
    if (
      !window.confirm(
        `¿Borrar el sector "${s.nombre}" del local ${s.local}?\n` +
          'También se revoca su QR y se pierde el vínculo desde nuevas opiniones.',
      )
    )
      return
    const { error } = await supabase.from('sectores').delete().eq('id', s.id)
    if (error) {
      setError(error.message)
      return
    }
    setSectores((all) => all.filter((x) => x.id !== s.id))
    setTokens((all) => all.filter((t) => t.sector_id !== s.id))
    flash('Sector eliminado')
  }

  // ---------- QR ----------
  async function generarQr(local: string, sectorId: string, notificar = true) {
    if (!supabase) return
    setBusyId(sectorId)
    const { data, error } = await supabase.rpc('crear_qr_sector', {
      p_local: local,
      p_sector_id: sectorId,
    })
    setBusyId(null)
    if (error) {
      if (notificar) setError(error.message)
      return null
    }
    const token = data as string
    if (notificar) {
      // Refrescar tokens solo si es llamada individual
      const { data: qt } = await supabase.from('qr_tokens').select('*').eq('activo', true)
      setTokens((qt as QrToken[]) ?? [])
      flash(`QR generado (${slugToken(token)})`)
    }
    return token
  }

  async function regenerarQr(local: string, sector: Sector) {
    if (!supabase) return
    if (
      !window.confirm(
        `¿Regenerar el QR de "${sector.nombre}"?\n` +
          'El QR físico anterior dejará de funcionar cuando lo escaneen.',
      )
    )
      return
    setBusyId(sector.id)
    const { data, error } = await supabase.rpc('regenerar_qr_sector', {
      p_local: local,
      p_sector_id: sector.id,
    })
    setBusyId(null)
    if (error) {
      setError(error.message)
      return
    }
    const token = data as string
    const { data: qt } = await supabase.from('qr_tokens').select('*').eq('activo', true)
    setTokens((qt as QrToken[]) ?? [])
    flash(`QR regenerado (${slugToken(token)})`)
  }

  async function copiar(token: string) {
    try {
      await navigator.clipboard.writeText(urlPublico(token))
      setCopiado(token)
      setTimeout(() => setCopiado((c) => (c === token ? null : c)), 1800)
    } catch {
      /* ignore */
    }
  }

  function imprimir(local: string, sector: string, token: string) {
    const w = window.open('', '_blank', 'width=480,height=680')
    if (!w) return
    const nombre = `${nombreLocal.get(local) ?? local} · ${sector}`
    w.document.write(buildLabelHtml(qrCfg, nombre, urlPublico(token)))
    w.document.close()
  }

  function imprimirTodos(localCode: string) {
    const sects = sectoresPorLocal.get(localCode) ?? []
    const labels: { nombre: string; url: string }[] = []
    for (const s of sects) {
      if (!s.activo) continue
      const t = tokenActivoPorSector.get(s.id)
      if (!t) continue
      labels.push({ nombre: `${nombreLocal.get(localCode) ?? localCode} · ${s.nombre}`, url: urlPublico(t.token) })
    }
    if (labels.length === 0) {
      setError('No hay sectores con QR activos para imprimir.')
      return
    }
    const c = qrCfg
    const contentW = Math.max(10, c.ancho_mm - 4)
    const pageSize = c.alto_mm > 0 ? `${c.ancho_mm}mm ${c.alto_mm}mm` : `${c.ancho_mm}mm auto`
    const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
    const parts = labels.map((l) => {
      const inner: string[] = []
      if (c.logo) inner.push(`<img class="logo" src="${escHtml(c.logo)}" alt=""/>`)
      if (c.texto_encabezado) inner.push(`<div class="enc">${escHtml(c.texto_encabezado)}</div>`)
      if (c.mostrar_nombre) inner.push(`<div class="nombre">${escHtml(l.nombre)}</div>`)
      inner.push(`<img class="qr" src="${qrImgUrl(l.url)}" alt="QR"/>`)
      if (c.cta) inner.push(`<div class="cta">${escHtml(c.cta)}</div>`)
      if (c.mostrar_url) inner.push(`<div class="url">${escHtml(l.url)}</div>`)
      return `<div class="lbl">${inner.join('')}</div>`
    })
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>QRs · ${escHtml(localCode)}</title>
<style>
  @page { size: ${pageSize}; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .lbl {
    width: ${contentW}mm; margin: 0 auto; text-align: ${c.align};
    font-family: Arial, Helvetica, sans-serif; padding: 1mm 0;
    background: ${c.bg_color}; color: ${c.text_color};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    page-break-after: always;
  }
  .lbl:last-child { page-break-after: auto; }
  .logo { height: ${c.logo_alto_mm}mm; object-fit: contain; display: block; margin: 0 auto 1.5mm; }
  .enc { font-size: ${c.encabezado_pt}pt; margin-bottom: 1mm; }
  .nombre { font-size: ${c.nombre_pt}pt; font-weight: ${c.nombre_bold ? 700 : 400}; line-height: 1.15; margin-bottom: 1.5mm; }
  .qr { width: ${c.qr_mm}mm; height: ${c.qr_mm}mm; display: block; margin: 0 auto; image-rendering: pixelated; }
  .cta { font-size: ${c.cta_pt}pt; margin-top: 1.5mm; }
  .url { font-size: ${c.url_pt}pt; word-break: break-all; margin-top: 1mm; }
  @media screen { body { padding: 16px; background: #ddd; } .lbl { border: 1px dashed #999; margin-bottom: 12px; } }
</style></head>
<body>${parts.join('')}
<script>
  var imgs = document.querySelectorAll('img.qr');
  var pending = imgs.length;
  function go(){ if(--pending<=0){ setTimeout(function(){ window.focus(); window.print(); }, 300); } }
  imgs.forEach(function(img){ if(img.complete) go(); else { img.onload = go; img.onerror = go; } });
  if(imgs.length===0) go();
<\/script>
</body></html>`
    const w = window.open('', '_blank', 'width=480,height=680')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  function descargar(local: string, sector: string, token: string) {
    // Descarga el PNG del QR (servicio externo)
    const a = document.createElement('a')
    a.href = qrImgUrl(urlPublico(token), 900)
    a.download = `QR-${local}-${sector}.png`.replace(/\s+/g, '_')
    a.rel = 'noopener'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function toggleAbierto(codigo: string) {
    setAbiertos((s) => {
      const n = new Set(s)
      if (n.has(codigo)) n.delete(codigo)
      else n.add(codigo)
      return n
    })
  }

  if (cargando) {
    return (
      <Layout>
        <BackButton />
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando sectores…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />

      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Sectores / QR</h1>
          <p className="mt-1 text-sm text-sub">
            Un sector crea su QR en <b>todos los locales</b> de una. Cada combinación Local + Sector tiene un código único.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {msg && (
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400">
              {msg}
            </span>
          )}
          <select
            value={localFiltro}
            onChange={(e) => setLocalFiltro(e.target.value)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand-500"
          >
            <option value="">Todos los locales</option>
            {locales.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.codigo}
                {l.nombre ? ` · ${l.nombre}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={() => setNuevoSector({ nombre: '' })}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} aria-hidden /> Sector
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {locales.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
          Todavía no hay locales cargados. Agregalos desde <b>Configuraciones → Locales</b>.
        </p>
      )}

      <div className="space-y-3">
        {localesVisibles.map((l) => {
          const sects = sectoresPorLocal.get(l.codigo) ?? []
          const open = abiertos.has(l.codigo) || Boolean(localFiltro)
          return (
            <section key={l.codigo} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <button
                onClick={() => toggleAbierto(l.codigo)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left"
              >
                <Store size={18} className="shrink-0 text-sub" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold text-ink">
                    {l.codigo}
                    {l.nombre && <span className="ml-2 text-sm font-normal text-sub">· {l.nombre}</span>}
                  </div>
                  <p className="text-xs text-sub">
                    {sects.length} sector{sects.length === 1 ? '' : 'es'}
                  </p>
                </div>
                {sects.some((s) => s.activo && tokenActivoPorSector.has(s.id)) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      imprimirTodos(l.codigo)
                    }}
                    className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-sub hover:bg-line hover:text-ink"
                    title="Imprimir todos los QR de este local"
                  >
                    <Printer size={13} aria-hidden /> Imprimir
                  </button>
                )}
                {open ? (
                  <ChevronUp size={16} className="shrink-0 text-sub" aria-hidden />
                ) : (
                  <ChevronDown size={16} className="shrink-0 text-sub" aria-hidden />
                )}
              </button>

              {open && (
                <>
                  {sects.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-sub">
                      Este local todavía no tiene sectores. Agregá el primero (ej: <i>Probadores</i>, <i>Cajas</i>, <i>Salón</i>).
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-surface2 text-left text-sub">
                            <th className="px-3 py-2.5 font-medium">Sector</th>
                            <th className="px-3 py-2.5 font-medium">QR (token)</th>
                            <th className="px-3 py-2.5 font-medium">Estado</th>
                            <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sects.map((s) => {
                            const t = tokenActivoPorSector.get(s.id) ?? null
                            const busy = busyId === s.id
                            return (
                              <tr key={s.id} className="border-t border-line align-middle">
                                <td className="px-3 py-2.5 font-medium text-ink">
                                  <div className="flex items-center gap-2">
                                    <MapPin size={14} className="shrink-0 text-sub" aria-hidden />
                                    {s.nombre}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  {t ? (
                                    <code
                                      className="rounded-md border border-line bg-surface2 px-2 py-0.5 text-xs text-sub"
                                      title={t.token}
                                    >
                                      {slugToken(t.token)}
                                    </code>
                                  ) : (
                                    <span className="text-xs text-sub">Sin QR</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">
                                  {!s.activo ? (
                                    <span className="inline-block rounded-full border border-line2 bg-surface2 px-2 py-0.5 text-xs text-sub">
                                      inactivo
                                    </span>
                                  ) : t ? (
                                    <span className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                                      activo
                                    </span>
                                  ) : (
                                    <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                                      sin QR
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    {!t && s.activo && (
                                      <button
                                        onClick={() => generarQr(l.codigo, s.id)}
                                        disabled={busy}
                                        className="btn-press inline-flex items-center gap-1 rounded-lg border border-brand-600/40 bg-brand-600/15 px-2.5 py-1 text-xs font-medium text-brand-400 hover:bg-brand-600/25 disabled:opacity-50"
                                        title="Generar QR"
                                      >
                                        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <QrCode size={13} aria-hidden />}
                                        Generar QR
                                      </button>
                                    )}
                                    {t && (
                                      <>
                                        <button
                                          onClick={() =>
                                            setQrVer({ token: t.token, local: l.codigo, sector: s.nombre })
                                          }
                                          title="Ver QR"
                                          aria-label={`Ver QR de ${s.nombre}`}
                                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-ink hover:bg-line"
                                        >
                                          <QrCode size={14} aria-hidden />
                                        </button>
                                        <button
                                          onClick={() => copiar(t.token)}
                                          title="Copiar enlace"
                                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink"
                                        >
                                          {copiado === t.token ? (
                                            <Check size={14} className="text-emerald-400" aria-hidden />
                                          ) : (
                                            <Copy size={14} aria-hidden />
                                          )}
                                        </button>
                                        <button
                                          onClick={() => descargar(l.codigo, s.nombre, t.token)}
                                          title="Descargar PNG"
                                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink"
                                        >
                                          <Download size={14} aria-hidden />
                                        </button>
                                        <button
                                          onClick={() => imprimir(l.codigo, s.nombre, t.token)}
                                          title="Imprimir etiqueta"
                                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink"
                                        >
                                          <Printer size={14} aria-hidden />
                                        </button>
                                        {puedeRegenerar && (
                                          <button
                                            onClick={() => regenerarQr(l.codigo, s)}
                                            disabled={busy}
                                            title="Regenerar QR (invalida el anterior)"
                                            className="btn-press rounded-lg border border-amber-500/40 bg-amber-500/10 p-1.5 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                                          >
                                            {busy ? (
                                              <Loader2 size={14} className="animate-spin" aria-hidden />
                                            ) : (
                                              <RotateCw size={14} aria-hidden />
                                            )}
                                          </button>
                                        )}
                                      </>
                                    )}
                                    <button
                                      onClick={() => setEditSector(s)}
                                      title="Editar sector"
                                      className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink"
                                    >
                                      <Pencil size={13} aria-hidden />
                                    </button>
                                    <button
                                      onClick={() => borrarSector(s)}
                                      title="Borrar sector"
                                      className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20"
                                    >
                                      <Trash2 size={13} aria-hidden />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>

      {qrVer && (
        <VerQrModal
          token={qrVer.token}
          local={qrVer.local}
          sector={qrVer.sector}
          onClose={() => setQrVer(null)}
        />
      )}

      {nuevoSector && (
        <SectorFormModal
          titulo="Nuevo sector (todos los locales)"
          nombre={nuevoSector.nombre}
          activo
          onCancel={() => setNuevoSector(null)}
          onSave={(nombre) => crearSector(nombre)}
        />
      )}

      {editSector && (
        <SectorFormModal
          titulo={`Editar sector · ${editSector.local}`}
          nombre={editSector.nombre}
          activo={editSector.activo}
          onCancel={() => setEditSector(null)}
          onSave={(nombre, activo) => guardarSector(editSector, nombre, activo)}
          conActivo
        />
      )}
    </Layout>
  )
}

function VerQrModal({
  token,
  local,
  sector,
  onClose,
}: {
  token: string
  local: string
  sector: string
  onClose: () => void
}) {
  const url = urlPublico(token)
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">QR · {sector}</h2>
            <p className="truncate text-xs text-sub">{local}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 p-5">
          <img
            src={qrImgUrl(url, 500)}
            alt={`QR ${local} · ${sector}`}
            width={240}
            height={240}
            className="rounded-xl bg-white p-3"
          />
          <code className="max-w-full break-all text-xs text-sub">{url}</code>
          <p className="text-center text-xs text-sub">
            Este QR resuelve <b>siempre</b> a <b>{local}</b> · <b>{sector}</b>, aunque cambies los nombres.
          </p>
        </div>
      </div>
    </div>
  )
}

function SectorFormModal({
  titulo,
  nombre: nombreInicial,
  activo: activoInicial,
  onCancel,
  onSave,
  conActivo,
}: {
  titulo: string
  nombre: string
  activo: boolean
  onCancel: () => void
  onSave: (nombre: string, activo: boolean) => void | Promise<void>
  conActivo?: boolean
}) {
  const [nombre, setNombre] = useState(nombreInicial)
  const [activo, setActivo] = useState(activoInicial)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setBusy(true)
    await onSave(nombre.trim(), activo)
    setBusy(false)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onCancel}>
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-display font-semibold text-ink">{titulo}</h2>
          <button type="button" onClick={onCancel} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Nombre del sector</span>
            <input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Probadores, Cajas, Salón…"
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
              required
            />
          </label>
          {conActivo && (
            <label className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
              <span className="text-sm text-ink">Sector activo</span>
              <button
                type="button"
                onClick={() => setActivo((a) => !a)}
                className={`relative h-6 w-11 rounded-full transition ${activo ? 'bg-brand-600' : 'bg-line2'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${activo ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </label>
          )}
          <p className="text-xs text-sub">
            El QR queda vinculado al sector aunque cambies el nombre, así el QR impreso sigue funcionando.
          </p>
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button
            type="submit"
            disabled={busy || !nombre.trim()}
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            Guardar
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
