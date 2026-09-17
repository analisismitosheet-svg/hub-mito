import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { X, Type, Square, Circle, Minus, Smile, Trash2, Download, Palette } from 'lucide-react'

export interface CumpleFila {
  nombre: string
  dia: number
  mes: number
}

type ElemTipo = 'text' | 'rect' | 'circle' | 'line' | 'emoji'
interface Elem {
  id: string
  tipo: ElemTipo
  x: number
  y: number
  w: number
  h: number
  texto?: string
  color: string
  size: number
}

const W = 800
const H = 1100
const EMOJIS = ['🎂', '🎉', '🎁', '❤️', '⭐', '🎈', '🥳', '🌻']

let idCounter = 1

export default function EditorCumple({ titulo, filas, onClose }: { titulo: string; filas: CumpleFila[]; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [elems, setElems] = useState<Elem[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [color, setColor] = useState('#ec4899')
  const [size, setSize] = useState(36)
  const [emoji, setEmoji] = useState('🎂')
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null)

  const nuevoId = () => `el${idCounter++}`

  function render() {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    // Fondo
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#fdf2f8')
    g.addColorStop(1, '#fce7f3')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // Título
    ctx.textAlign = 'center'
    ctx.fillStyle = '#be185d'
    ctx.font = 'bold 56px sans-serif'
    ctx.fillText(titulo, W / 2, 110)

    // Sub título
    ctx.fillStyle = '#f472b6'
    ctx.font = '28px sans-serif'
    ctx.fillText('Lista de cumpleaños', W / 2, 165)

    // Línea divisoria
    ctx.strokeStyle = '#f9a8d4'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(80, 200)
    ctx.lineTo(W - 80, 200)
    ctx.stroke()

    // Listado
    const inicio = 240
    const paso = Math.max(38, Math.min(52, Math.floor((H - 260) / Math.max(1, filas.length))))
    ctx.textAlign = 'left'
    ctx.font = '30px sans-serif'
    filas.forEach((f, i) => {
      const y = inicio + i * paso
      const dd = String(f.dia).padStart(2, '0')
      const mm = String(f.mes).padStart(2, '0')
      ctx.fillStyle = '#9d174d'
      ctx.fillText(`• ${f.nombre}`, 120, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#be185d'
      ctx.font = 'bold 30px sans-serif'
      ctx.fillText(`${dd}/${mm}`, W - 120, y)
      ctx.textAlign = 'left'
      ctx.font = '30px sans-serif'
    })

    // Elementos extra
    for (const e of elems) {
      if (e.tipo === 'text' || e.tipo === 'emoji') {
        ctx.textAlign = 'left'
        ctx.font = `${e.size}px sans-serif`
        ctx.fillStyle = e.color
        ctx.fillText(e.texto ?? '', e.x, e.y + e.size)
      } else if (e.tipo === 'rect') {
        ctx.fillStyle = e.color
        ctx.fillRect(e.x, e.y, e.w, e.h)
      } else if (e.tipo === 'circle') {
        ctx.fillStyle = e.color
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.w / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (e.tipo === 'line') {
        ctx.strokeStyle = e.color
        ctx.lineWidth = e.size / 6
        ctx.beginPath()
        ctx.moveTo(e.x, e.y)
        ctx.lineTo(e.x + e.w, e.y + e.h)
        ctx.stroke()
      }
    }

    // Selección
    if (selId) {
      const e = elems.find((x) => x.id === selId)
      if (e) {
        ctx.strokeStyle = '#0ea5e9'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.strokeRect(e.x - 6, e.y - 6, (e.tipo === 'text' || e.tipo === 'emoji' ? e.size * 0.6 : e.w) + 12, (e.tipo === 'text' || e.tipo === 'emoji' ? e.size : e.h) + 12)
        ctx.setLineDash([])
      }
    }
  }

  useEffect(() => { render() })
  useEffect(() => {
    const onUp = () => dragRef.current = null
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  function posFromEvent(e: ReactMouseEvent): { x: number; y: number } {
    const cv = canvasRef.current!
    const rect = cv.getBoundingClientRect()
    const escala = W / rect.width
    return { x: (e.clientX - rect.left) * escala, y: (e.clientY - rect.top) * escala }
  }

  function onMouseDown(e: ReactMouseEvent) {
    const p = posFromEvent(e)
    // Buscar de arriba hacia abajo
    for (let i = elems.length - 1; i >= 0; i--) {
      const el = elems[i]
      const ancho = (el.tipo === 'text' || el.tipo === 'emoji') ? el.size * 0.6 : el.w
      const alto = (el.tipo === 'text' || el.tipo === 'emoji') ? el.size : el.h
      if (p.x >= el.x - 10 && p.x <= el.x + ancho + 10 && p.y >= el.y - 10 && p.y <= el.y + alto + 10) {
        setSelId(el.id)
        dragRef.current = { id: el.id, offX: p.x - el.x, offY: p.y - el.y }
        return
      }
    }
    setSelId(null)
  }

  function onMouseMove(e: ReactMouseEvent) {
    const d = dragRef.current
    if (!d) return
    const p = posFromEvent(e)
    setElems((prev) => prev.map((el) => el.id === d.id ? { ...el, x: p.x - d.offX, y: p.y - d.offY } : el))
  }

  function agregarTexto() {
    const texto = prompt('Texto:', 'Feliz cumpleaños!')
    if (texto == null) return
    setElems((p) => [...p, { id: nuevoId(), tipo: 'text', x: 100, y: 260, w: 200, h: 60, texto, color, size }])
  }
  function agregarRect() { setElems((p) => [...p, { id: nuevoId(), tipo: 'rect', x: 100, y: 280, w: 160, h: 90, color, size }]) }
  function agregarCircle() { setElems((p) => [...p, { id: nuevoId(), tipo: 'circle', x: 160, y: 330, w: 120, h: 120, color, size }]) }
  function agregarLine() { setElems((p) => [...p, { id: nuevoId(), tipo: 'line', x: 100, y: 340, w: 200, h: 0, color, size }]) }
  function agregarEmoji() { setElems((p) => [...p, { id: nuevoId(), tipo: 'emoji', x: 100, y: 280, w: 80, h: 80, texto: emoji, color, size: size + 30 }]) }

  function borrarSel() {
    if (!selId) return
    setElems((p) => p.filter((e) => e.id !== selId))
    setSelId(null)
  }

  function descargar() {
    const cv = canvasRef.current
    if (!cv) return
    render()
    const a = document.createElement('a')
    a.download = `cumpleanos_${titulo.replace(/\s+/g, '_')}.png`
    a.href = cv.toDataURL('image/png')
    a.click()
  }

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs font-medium text-ink transition hover:bg-line'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-[95vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Smile size={18} className="text-pink-500" aria-hidden /> Editor de imagen · Cumpleaños</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4 lg:flex-row" style={{ minHeight: 0 }}>
          {/* Canvas */}
          <div className="flex-1 overflow-auto rounded-2xl border border-line bg-surface2 p-3">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              className="mx-auto block w-full max-w-[420px] cursor-crosshair rounded-xl shadow-soft lg:max-w-[560px]"
              style={{ touchAction: 'none' }}
            />
          </div>
          {/* Herramientas */}
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-64">
            <div className="rounded-2xl border border-line bg-surface2 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Agregar</h3>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={agregarTexto} className={btn}><Type size={13} aria-hidden /> Texto</button>
                <button onClick={agregarEmoji} className={btn}><Smile size={13} aria-hidden /> Emoji</button>
                <button onClick={agregarRect} className={btn}><Square size={13} aria-hidden /> Rectángulo</button>
                <button onClick={agregarCircle} className={btn}><Circle size={13} aria-hidden /> Círculo</button>
                <button onClick={agregarLine} className={btn}><Minus size={13} aria-hidden /> Línea</button>
                <button onClick={borrarSel} className={btn + ' text-red-500'}><Trash2 size={13} aria-hidden /> Borrar</button>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface2 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sub/70"><Palette size={13} aria-hidden /> Color y tamaño</h3>
              <div className="flex items-center gap-2">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface2" title="Color" />
                <input type="range" min={14} max={90} value={size} onChange={(e) => setSize(Number(e.target.value))} className="flex-1" title="Tamaño" />
                <span className="text-xs text-sub">{size}px</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {EMOJIS.map((em) => (
                  <button key={em} onClick={() => setEmoji(em)} className={'rounded-lg px-1.5 py-0.5 text-lg transition ' + (emoji === em ? 'bg-pink-500/25' : 'hover:bg-line')} title={em}>{em}</button>
                ))}
              </div>
            </div>
            <button onClick={descargar} className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
              <Download size={15} aria-hidden /> Descargar PNG
            </button>
            <p className="text-[11px] leading-relaxed text-sub/70">
              {filas.length} cumpleañeros en el listado. Arrastrá los elementos sobre el lienzo; el listado se genera solo. Con el botón Descargar PNG obtenés la imagen para mandar por mail.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}