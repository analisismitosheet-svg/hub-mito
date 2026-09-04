import { useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, Printer, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/* ------------------------------------------------------------------ */
/*  Etiquetas de bultos (QR + impresión)                               */
/* ------------------------------------------------------------------ */

export interface EtiquetaRegistro {
  n_cliente: string | null
  razon_social: string | null
  n_remito: string | null
  bulto?: number | null
  transporte?: string | null
  observaciones?: string | null
}

export interface EtiquetaCliente {
  numeroCliente: string
  razonSocial: string
  direccion: string
  localidad: string
  provincia: string
  telefono: string
  transporte: string
  observaciones: string
}

export async function fetchClienteEtiqueta(nCl: string, fallback: { razon_social: string | null; transporte: string | null; observaciones: string | null }): Promise<EtiquetaCliente> {
  let data: Record<string, unknown> = {}
  if (supabase) {
    try {
      const { data: rows, error } = await supabase
        .from('clientes')
        .select('n_cliente,razon_social,telefono,transporte,direccion_entrega,direccion_barrio,localidad_provincia,obs_membretes,obs_facturacion,localidad')
        .eq('n_cliente', nCl)
        .limit(1)
      if (!error && rows && rows.length > 0) data = rows[0] as Record<string, unknown>
    } catch { /* si falla, uso fallback */ }
  }
  const provinciaLocalidad = String(data.localidad_provincia ?? '')
  const [local, provincia] = provinciaLocalidad.split(/[-–/]/).map((s) => s.trim())
  return {
    numeroCliente: nCl,
    razonSocial: String(data.razon_social ?? '') || (fallback.razon_social ?? ''),
    direccion: String(data.direccion_barrio ?? '') || String(data.direccion_entrega ?? '') || '',
    localidad: String(data.localidad ?? '') || local || '',
    provincia: provincia || '',
    telefono: String(data.telefono ?? ''),
    transporte: String(data.transporte ?? '') || (fallback.transporte ?? ''),
    observaciones: String(data.obs_membretes ?? '') || (fallback.observaciones ?? ''),
  }
}

export function EtiquetaBulto({ cliente, num, total, destino, origen, nRemito, ancho, alto, fontSize, qrSize }: {
  cliente: EtiquetaCliente
  num: number
  total: number
  destino: string
  origen: string
  nRemito: string
  ancho: number
  alto: number
  fontSize: number
  qrSize: number
}) {
  const remito = nRemito.replace(/-/g, '/')
  return (
    <div className="etiqueta-bulto" style={{ width: `${ancho}mm`, height: `${alto}mm`, fontSize: `${fontSize}px` }}>
      <div className="etq-top">
        <div className="etq-lado">
          <div className="etq-num">Nº {cliente.numeroCliente}</div>
          <div className="etq-origen"><span>ORIGEN:</span> {origen || '-'}</div>
        </div>
        <div className="etq-qr-col">
          <QRCodeSVG value={`${origen}-${remito}(${num}/${total})${destino ? `-${destino}` : ''}`} size={qrSize} level="M" />
          <div className="etq-qr-txt">{origen}-{remito}({num}/{total}){destino ? `-${destino}` : ''}</div>
        </div>
      </div>
      <div className="etq-razon">{cliente.razonSocial}</div>
      <div className="etq-line">TE: {cliente.telefono}</div>
      <div className="etq-dir"><b>DIR. ENTREGA:</b> {cliente.direccion}</div>
      <div className="etq-line">{cliente.localidad} - {cliente.provincia}</div>
      <div className="etq-line"><b>TEL CONTACTO:</b> {cliente.telefono}</div>
      <div className="etq-obs">OBS: {cliente.observaciones || '-'}</div>
      <div className="etq-transp">TRANSPORTE: {cliente.transporte || '-'} · BULTOS {num}/{total}</div>
    </div>
  )
}

const ETQ_PRE_KEY = 'etiqueta_bultos_predef'

interface PredefEtiqueta {
  ancho: number
  alto: number
  fontSize: number
  qrSize: number
  origen: string
  destino: string
}

const ETQ_PRE_DEFECTO: PredefEtiqueta = { ancho: 80, alto: 50, fontSize: 8, qrSize: 30, origen: 'MITO', destino: '' }

function leerPredef(): PredefEtiqueta {
  try {
    const raw = localStorage.getItem(ETQ_PRE_KEY)
    if (!raw) return ETQ_PRE_DEFECTO
    return { ...ETQ_PRE_DEFECTO, ...JSON.parse(raw) }
  } catch {
    return ETQ_PRE_DEFECTO
  }
}

export function EtiquetasModal({ registro, onClose }: { registro: EtiquetaRegistro; onClose: () => void }) {
  const totalDefault = useMemo(() => (registro?.bulto ?? 1), [registro])
  const [total, setTotal] = useState<number>(totalDefault)
  const [predef] = useState<PredefEtiqueta>(leerPredef)
  const [ancho, setAncho] = useState(predef.ancho)
  const [alto, setAlto] = useState(predef.alto)
  const [fontSize, setFontSize] = useState(predef.fontSize)
  const [qrSize, setQrSize] = useState(predef.qrSize)
  const [destino, setDestino] = useState(predef.destino)
  const [origen, setOrigen] = useState(predef.origen)
  const [generadas, setGeneradas] = useState(false)
  const [cliente, setCliente] = useState<EtiquetaCliente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  function guardarPredef() {
    localStorage.setItem(ETQ_PRE_KEY, JSON.stringify({ ancho, alto, fontSize, qrSize, origen, destino }))
    setGuardado(true)
  }

  useEffect(() => {
    const nCl = registro?.n_cliente ? String(registro.n_cliente) : ''
    if (!nCl) { setError('Este registro no tiene N° Cliente para buscar los datos de la etiqueta.'); return }
    let activo = true
    void fetchClienteEtiqueta(nCl, { razon_social: registro.razon_social, transporte: registro.transporte ?? null, observaciones: registro.observaciones ?? null }).then((c) => { if (activo) setCliente(c) }).catch(() => { if (activo) setError('No se pudieron cargar los datos del cliente.') })
    return () => { activo = false }
  }, [registro])

  const nums = useMemo(() => (generadas && total > 0 ? Array.from({ length: total }, (_, i) => i + 1) : []), [generadas, total])

  function generar() {
    if (total < 1) { setError('La cantidad de bultos debe ser al menos 1.'); return }
    setError(null)
    setGeneradas(true)
  }

  function imprimir() {
    const src = document.getElementById('etiquetas-print-area')
    if (!src || !src.innerHTML.trim()) return
    const root = document.createElement('div')
    root.id = 'etiquetas-print-root'
    root.innerHTML = src.innerHTML
    document.body.appendChild(root)
    const style = document.createElement('style')
    style.id = 'etiquetas-print-css'
    style.innerHTML = [
      `@page { size: ${ancho}mm ${alto}mm; margin: 0; }`,
      `@media print {`,
      `  body > *:not(#etiquetas-print-root) { display: none !important; }`,
      `  #etiquetas-print-root { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; }`,
      `  #etiquetas-print-root .etiqueta-bulto { page-break-after: always; break-after: page; }`,
      `}`,
    ].join('\n')
    document.head.appendChild(style)
    requestAnimationFrame(() => {
      window.print()
      root.remove()
      document.getElementById('etiquetas-print-css')?.remove()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !window.print && onClose()}>
      <div className="flex w-[94vw] max-w-4xl flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Printer size={18} className="text-amber-400" aria-hidden /> Etiquetas de bultos — {registro.razon_social || 'Sin razon social'}</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>

        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

        {/* Config */}
        <div className="border-b border-line px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Cant. bultos</span>
              <input type="number" min={1} value={total} onChange={(e) => setTotal(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Ancho (mm)</span>
              <input type="number" min={10} value={ancho} onChange={(e) => setAncho(Number(e.target.value) || 80)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Alto (mm)</span>
              <input type="number" min={10} value={alto} onChange={(e) => setAlto(Number(e.target.value) || 50)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Tamaño letra (px)</span>
              <input type="number" min={5} max={20} value={fontSize} onChange={(e) => setFontSize(Math.max(5, Math.min(20, Number(e.target.value) || 8)))} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Tamaño QR (px)</span>
              <input type="number" min={10} max={80} value={qrSize} onChange={(e) => setQrSize(Math.max(10, Math.min(80, Number(e.target.value) || 30)))} className={inputCls} />
            </label>
            <div className="flex flex-col items-end gap-1">
              <button onClick={generar} className="btn-press w-full rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Generar etiquetas</button>
              <button onClick={guardarPredef} className="btn-press inline-flex w-full items-center justify-center gap-1 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-line">
                <BookmarkPlus size={13} aria-hidden /> Guardar como predefinido
              </button>
              {guardado && <span className="text-[11px] font-medium text-emerald-500">✓ Predefinido guardado</span>}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Origen</span>
              <input value={origen} onChange={(e) => setOrigen(e.target.value)} placeholder="Ej: FABRICA" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sub">Destino</span>
              <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Local / Sucursal" className={inputCls} />
            </label>
          </div>
        </div>

        {/* Previsualización */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {!generadas || !cliente ? (
            <p className="py-10 text-center text-sm text-sub">Configura la cantidad y presiona "Generar etiquetas".</p>
          ) : (
            <div className="etq-preview flex flex-wrap gap-3">
              {nums.map((n) => (
                <EtiquetaBulto key={n} cliente={cliente} num={n} total={total} destino={destino} origen={origen} nRemito={registro?.n_remito || ''} ancho={ancho} alto={alto} fontSize={fontSize} qrSize={qrSize} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <p className="text-xs text-sub">Tamaño: {ancho} × {alto} mm · {nums.length || total} etiquetas</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
            <button onClick={imprimir} disabled={!generadas || nums.length === 0} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Printer size={15} aria-hidden /> Imprimir</button>
          </div>
        </div>

        {/* Área de impresión oculta en pantalla */}
        <div id="etiquetas-print-area" className="etiquetas-print-area">
          {nums.map((n) => (
            <EtiquetaBulto key={`p${n}`} cliente={cliente!} num={n} total={total} destino={destino} origen={origen} nRemito={registro?.n_remito || ''} ancho={ancho} alto={alto} fontSize={fontSize} qrSize={qrSize} />
          ))}
        </div>
      </div>
    </div>
  )
}