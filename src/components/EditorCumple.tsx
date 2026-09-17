import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group } from 'react-konva'
import { X, Download, FileSpreadsheet, LinkIcon, Check } from 'lucide-react'

export interface CumpleFila { nombre: string; dia: number; mes: number }

const W = 800
const H = 1100
const STORAGE_KEY = 'plantilla_cumple_url'
const DEFAULT_URL = import.meta.env.VITE_URL_PLANTILLA_CUMPLE?.trim() || '/plantilla-cumpleanos.jpeg'

const ddmm = (dia: number, mes: number) => `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`

function estimarLineas(texto: string, width: number, size: number): number {
  if (!texto) return 1
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 1
  ctx.font = `${size}px Poppins, sans-serif`
  let lineas = 1
  let actual = ''
  for (const p of texto.split(/\s+/)) {
    const prueba = actual ? `${actual} ${p}` : p
    if (ctx.measureText(prueba).width > width) { lineas++; actual = p } else actual = prueba
  }
  return lineas
}

export default function EditorCumple({ titulo, filas: filasIniciales, onClose }: { titulo: string; filas: CumpleFila[]; onClose: () => void }) {
  const stageRef = useRef<any>(null)
  const [filas] = useState<CumpleFila[]>(filasIniciales)
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL } catch { return DEFAULT_URL }
  })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [cargando, setCargando] = useState(false)
  const [msg, setMsg] = useState('')
  const scale = Math.min(1, 460 / W)

  // Cargar plantilla por URL
  function cargarPlantilla(u: string) {
    const uu = u.trim()
    if (!uu) { setImg(null); return }
    setCargando(true); setMsg('')
    const im = new window.Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => { setImg(im); setCargando(false); setMsg('Plantilla cargada.') }
    im.onerror = () => { setImg(null); setCargando(false); setMsg('No se pudo cargar la imagen. Verificá la URL.') }
    im.src = uu
  }

  useEffect(() => { cargarPlantilla(url) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function aplicarUrl() {
    try { localStorage.setItem(STORAGE_KEY, url.trim()) } catch { /* noop */ }
    cargarPlantilla(url)
    setTimeout(() => setMsg(''), 3000)
  }

  // El listado se dibuja desde la franja central (ajustable)
  const layoutFilas = useMemo(() => {
    const top = 260
    const area = H - top - 120
    const sizeAuto = Math.max(18, Math.min(34, Math.floor(area / Math.max(1, filas.length))))
    let acum = top
    return filas.map((f) => {
      const lineas = estimarLineas(f.nombre, 520, sizeAuto)
      const alto = lineas * sizeAuto * 1.35 + 14
      const y = acum
      acum += alto
      return { ...f, y, size: sizeAuto }
    })
  }, [filas])

  function exportarPng() {
    stageRef.current?.toDataURL({ pixelRatio: 2, mimeType: 'image/png' }, (d: string) => {
      const a = document.createElement('a'); a.download = `cumpleanos_${titulo.replace(/\s+/g, '_')}.png`; a.href = d; a.click()
    })
  }
  function exportarPdf() {
    stageRef.current?.toDataURL({ pixelRatio: 2, mimeType: 'image/png' }, (d: string) => {
      const doc = new jsPDF({ unit: 'px', format: [W, H], orientation: 'portrait' })
      doc.addImage(d, 'PNG', 0, 0, W, H)
      doc.save(`cumpleanos_${titulo.replace(/\s+/g, '_')}.pdf`)
    })
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-[95vw] max-w-[1300px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '94vh' }}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-ink">🎂 Cumpleaños · {titulo} <span className="text-sm font-normal text-sub">({filas.length})</span></h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4 lg:flex-row" style={{ minHeight: 0 }}>
          {/* Lienzo */}
          <div className="flex min-w-0 flex-1 items-start justify-center overflow-auto rounded-2xl border border-line bg-[#eceef1] p-4">
            <div className="rounded-xl bg-white shadow-[0_10px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/5" style={{ width: 460 }}>
              <Stage ref={stageRef} width={W} height={H} scaleX={scale} scaleY={scale}>
                <Layer>
                  {img ? (
                    <KonvaImage image={img} x={0} y={0} width={W} height={H} listening={false} />
                  ) : (
                    <>
                      <Rect x={0} y={0} width={W} height={H} fill="#fff7fa" listening={false} />
                      <Rect x={0} y={0} width={W} height={180} fill="#f9a8d4" listening={false} />
                      <Text text={titulo} x={W / 2} y={52} align="center" fontFamily="Poppins" fontStyle="bold" fontSize={48} fill="#ffffff" listening={false} />
                      <Text text="Lista de cumpleaños" x={W / 2} y={112} align="center" fontFamily="Poppins" fontSize={24} fill="#fdf2f8" listening={false} />
                    </>
                  )}
                  {layoutFilas.map((f, i) => (
                    <Group key={`f-${i}`} listening={false}>
                      <Text text={`• ${f.nombre}`} x={70} y={f.y} width={540} fontFamily="Poppins" fontSize={f.size} fill={img ? '#2b2b2b' : '#9d174d'} wrap="word" />
                      <Text text={ddmm(f.dia, f.mes)} x={640} y={f.y} width={100} align="right" fontFamily="Poppins" fontStyle="bold" fontSize={f.size} fill={img ? '#2b2b2b' : '#be185d'} />
                    </Group>
                  ))}
                </Layer>
              </Stage>
            </div>
          </div>

          {/* Panel */}
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
            <div className="rounded-2xl border border-line bg-surface2 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sub/70"><LinkIcon size={13} aria-hidden /> Plantilla</h3>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Pegá la URL de la imagen de la plantilla" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs" />
              <button onClick={aplicarUrl} className={'mt-2 ' + btn + ' w-full justify-center bg-violet-600 text-white hover:bg-violet-700'} disabled={cargando}>
                {cargando ? 'Cargando...' : <><Check size={14} aria-hidden /> Usar plantilla</>}
              </button>
              {msg && <p className="mt-1 text-[11px] text-emerald-500">{msg}</p>}
              <p className="mt-2 text-[11px] leading-relaxed text-sub/70">
                La imagen se guarda en este dispositivo. Si no ponés plantilla, se usa el diseño simple con la lista sobre fondo rosa.
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface2 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Listado</h3>
              <p className="text-[11px] leading-relaxed text-sub/70">
                {filas.length} cumpleañeros. Nombres largos bajan de línea y la fecha queda siempre a la derecha, sin superponerse.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={exportarPng} className={btn + ' justify-center bg-emerald-600 text-white hover:bg-emerald-700'}><Download size={15} aria-hidden /> PNG</button>
              <button onClick={exportarPdf} className={btn + ' justify-center bg-rose-600 text-white hover:bg-rose-700'}><FileSpreadsheet size={15} aria-hidden /> PDF</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}