import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WebFont from 'webfontloader'
import { jsPDF } from 'jspdf'
import { Stage, Layer, Rect, Text, Circle, Line as KonvaLine, Image as KonvaImage, Transformer, Group } from 'react-konva'
import { X, Type, Square, Circle as CircleIcon, Minus, Smile, Trash2, Download, Undo2, Redo2, Lock, Unlock, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'

export interface CumpleFila { nombre: string; dia: number; mes: number }

type ElemTipo = 'text' | 'rect' | 'circle' | 'line' | 'emoji' | 'image'
interface Obj {
  id: string; tipo: ElemTipo; x: number; y: number; w: number; h: number
  texto?: string; color: string; size: number; fuente: string
  align: 'left' | 'center' | 'right'; lineHeight: number; sombra: boolean
  rot: number; bloqueado: boolean; src?: string
}

const W = 800
const H = 1100
const EMOJIS = ['🎂', '🎉', '🎁', '❤️', '⭐', '🎈', '🥳', '🌻']
const FUENTES = ['Poppins', 'Montserrat', 'Pacifico', 'Lobster', 'Roboto', 'Oswald', 'Dancing Script', 'Playfair Display']
let idCounter = 1
const nuevoId = () => `el${idCounter++}`

function estimarLineas(texto: string, width: number, font: string, size: number): number {
  if (!texto) return 1
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return 1
  ctx.font = `${size}px ${font}, sans-serif`
  let lineas = 1
  let actual = ''
  for (const p of texto.split(/\s+/)) {
    const prueba = actual ? `${actual} ${p}` : p
    if (ctx.measureText(prueba).width > width) { lineas++; actual = p } else actual = prueba
  }
  return lineas
}

const ddmm = (dia: number, mes: number) => `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`

export default function EditorCumple({ titulo, filas: filasIniciales, onClose }: { titulo: string; filas: CumpleFila[]; onClose: () => void }) {
  const stageRef = useRef<any>(null)
  const shapeRefs = useRef<Record<string, any>>({})
  const [filas, setFilas] = useState<CumpleFila[]>(filasIniciales)
  const [csv, setCsv] = useState('')
  const [objs, setObjs] = useState<Obj[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [color, setColor] = useState('#7c3aed')
  const [size, setSize] = useState(40)
  const [fuente] = useState('Poppins')
  const [lineHeight] = useState(1.15)
  const [sombra] = useState(false)
  const [emoji, setEmoji] = useState('🎂')
  const [fondo, setFondo] = useState('#ffffff')
  const [fondoImg, setFondoImg] = useState<string | null>(null)
  const [pestaña, setPestaña] = useState<'plantillas' | 'texto' | 'elementos' | 'fondos' | 'datos'>('plantillas')
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({})
  const [hist, setHist] = useState<Obj[][]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [aviso, setAviso] = useState('')
  const excelRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const fondoRef = useRef<HTMLInputElement>(null)

  useEffect(() => { WebFont.load({ google: { families: FUENTES }, timeout: 5000 }) }, [])

  const pushHist = useCallback((next: Obj[]) => { setHist((h) => [...h.slice(0, histIdx + 1), next]); setHistIdx((i) => i + 1) }, [histIdx])
  const mutar = useCallback((fn: (p: Obj[]) => Obj[]) => { setObjs((prev) => { const next = fn(prev); pushHist(next); return next }) }, [pushHist])

  function deshacer() { if (histIdx > 0) { setHistIdx((i) => i - 1); setObjs(hist[histIdx - 1]); setSelId(null) } }
  function rehacer() { if (histIdx < hist.length - 1) { setHistIdx((i) => i + 1); setObjs(hist[histIdx + 1]); setSelId(null) } }

  const sel = objs.find((o) => o.id === selId) ?? null

  function parsearCSV(texto: string): CumpleFila[] {
    const out: CumpleFila[] = []
    for (const linea of texto.split(/\r?\n/)) {
      const trozos = linea.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
      if (trozos.length < 2) continue
      const m = trozos[1].match(/(\d{1,2})[/\-.](\d{1,2})(?:[/\-.]\d{2,4})?/)
      if (!m) continue
      const dia = Number(m[1]); const mes = Number(m[2])
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) out.push({ nombre: trozos[0], dia, mes })
    }
    return out.sort((a, b) => a.mes - b.mes || a.dia - b.dia)
  }
  function aplicarDatos(nuevas: CumpleFila[]) {
    if (nuevas.length === 0) { setAviso('No se reconocieron filas con formato "nombre, dd/mm".'); setTimeout(() => setAviso(''), 3500); return }
    setFilas(nuevas); setAviso(`Lista actualizada: ${nuevas.length} cumplea\u00f1eros.`); setTimeout(() => setAviso(''), 3500)
  }
  function actualizarDesdeCSV() { aplicarDatos(parsearCSV(csv)) }
  async function subirExcel(file: File) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const out: CumpleFila[] = []
    for (const r of rows) {
      const v = Object.values(r).map((x) => String(x).trim())
      if (v.length < 2) continue
      const m = v[1].match(/(\d{1,2})[/\-.](\d{1,2})(?:[/\-.]\d{2,4})?/)
      if (!m) continue
      const dia = Number(m[1]); const mes = Number(m[2])
      if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) out.push({ nombre: v[0], dia, mes })
    }
    aplicarDatos(out.sort((a, b) => a.mes - b.mes || a.dia - b.dia))
  }

  function agregarTexto() {
    const texto = prompt('Texto:', 'Feliz cumplea\u00f1os!')
    if (texto == null) return
    mutar((p) => [...p, { id: nuevoId(), tipo: 'text', x: 120, y: 280, w: 400, h: 60, texto, color, size, fuente, align: 'center', lineHeight, sombra, rot: 0, bloqueado: false }])
    setPestaña('texto'); setSelId(null)
  }
  function agregarEmoji() { mutar((p) => [...p, { id: nuevoId(), tipo: 'emoji', x: 140, y: 300, w: 90, h: 90, texto: emoji, color, size: size + 30, fuente: 'sans-serif', align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: false }]); setSelId(null) }
  function agregarRect() { mutar((p) => [...p, { id: nuevoId(), tipo: 'rect', x: 140, y: 320, w: 160, h: 90, color, size, fuente, align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: false }]); setSelId(null) }
  function agregarCircle() { mutar((p) => [...p, { id: nuevoId(), tipo: 'circle', x: 200, y: 360, w: 120, h: 120, color, size, fuente, align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: false }]); setSelId(null) }
  function agregarLine() { mutar((p) => [...p, { id: nuevoId(), tipo: 'line', x: 140, y: 380, w: 220, h: 0, color, size: 6, fuente, align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: false }]); setSelId(null) }

  function borrarSel() { if (selId) { mutar((p) => p.filter((o) => o.id !== selId)); setSelId(null) } }
  function toggleBloqueo() { if (selId) mutar((p) => p.map((o) => o.id === selId ? { ...o, bloqueado: !o.bloqueado } : o)) }

  function cargarImagen(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => {
        setImgs((m) => ({ ...m, [src]: img }))
        const esc = img.width > 220 ? 220 / img.width : 1
        mutar((p) => [...p, { id: nuevoId(), tipo: 'image', x: 160, y: 320, w: Math.round(img.width * esc), h: Math.round(img.height * esc), color, size, fuente, align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: false, src }])
        setSelId(null)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }
  function subirFondo(file: File) {
    const reader = new FileReader()
    reader.onload = () => { setFondoImg(String(reader.result)); setFondo('#ffffff') }
    reader.readAsDataURL(file)
  }

  function aplicarPlantilla() {
    const t: Obj[] = [
      { id: nuevoId(), tipo: 'text', x: 60, y: 55, w: 680, h: 70, texto: 'Comunicándonos', color: '#7c3aed', size: 46, fuente: 'Pacifico', align: 'center', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
      { id: nuevoId(), tipo: 'text', x: 60, y: 118, w: 680, h: 40, texto: 'Recursos Humanos', color: '#a78bfa', size: 26, fuente: 'Poppins', align: 'center', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
      { id: nuevoId(), tipo: 'emoji', x: 60, y: 60, w: 90, h: 90, texto: '🎈', color: '#7c3aed', size: 80, fuente: 'sans-serif', align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
      { id: nuevoId(), tipo: 'emoji', x: 650, y: 60, w: 90, h: 90, texto: '🎈', color: '#7c3aed', size: 80, fuente: 'sans-serif', align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
      { id: nuevoId(), tipo: 'rect', x: 60, y: 1030, w: 680, h: 4, color: '#c4b5fd', size: 4, fuente: 'sans-serif', align: 'left', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
      { id: nuevoId(), tipo: 'text', x: 60, y: 1045, w: 680, h: 30, texto: `${titulo} · Comunicándonos`, color: '#8b5cf6', size: 20, fuente: 'Poppins', align: 'center', lineHeight: 1, sombra: false, rot: 0, bloqueado: true },
    ]
    mutar((p) => [...p, ...t]); setSelId(null)
  }
  const trRef = useRef<any>(null)
  const layoutFilas = useMemo(() => {
    const sizeAuto = Math.max(18, Math.min(32, Math.floor(700 / Math.max(1, filas.length))))
    let acum = 215
    return filas.map((f) => {
      const lineas = estimarLineas(f.nombre, 520, 'Poppins', sizeAuto)
      const alto = lineas * sizeAuto * 1.3 + 10
      const y = acum
      acum += alto
      return { ...f, y, sizeAuto }
    })
  }, [filas])
  const scale = Math.min(1, 460 / W)

  useEffect(() => {
    const tr = trRef.current
    const node = selId ? shapeRefs.current[selId] : null
    if (tr) { tr.nodes(node ? [node] : []); tr.getLayer()?.batchDraw() }
  }, [selId, objs])

  function onDragEnd(o: Obj) {
    const node = shapeRefs.current[o.id]
    if (!node) return
    mutar((p) => p.map((x) => x.id === o.id ? { ...x, x: node.x(), y: node.y() } : x))
  }
  function onTransformEnd(o: Obj) {
    const node = shapeRefs.current[o.id]
    if (!node) return
    mutar((p) => p.map((x) => x.id === o.id ? { ...x, w: Math.max(10, o.w * node.scaleX()), h: Math.max(10, o.h * node.scaleY()), rot: node.rotation() } : x))
    node.scaleX(1); node.scaleY(1)
  }
  const clickSel = (o: Obj) => { if (!o.bloqueado) setSelId(o.id === selId ? null : o.id) }
  const dragProps = (o: Obj) => ({
    draggable: !o.bloqueado,
    onClick: () => clickSel(o), onTap: () => clickSel(o),
    onDragEnd: () => onDragEnd(o),
    onTransformEnd: () => onTransformEnd(o),
  })
  const fontProp = (o: Obj) => ({ fontFamily: o.fuente, fontSize: o.size, fill: o.color, align: o.align, lineHeight: o.lineHeight })

  function renderObj(o: Obj) {
    const ref = (n: any) => (shapeRefs.current[o.id] = n)
    const common = {
      key: o.id, ref, x: o.x, y: o.y, rotation: o.rot, opacity: 1,
      stroke: selId === o.id ? '#0ea5e9' : undefined, strokeWidth: selId === o.id ? 2 : 0,
      ...dragProps(o),
    }
    if (o.tipo === 'text') return <Text {...common} {...fontProp(o)} text={o.texto ?? ''} width={o.w} shadowEnabled={o.sombra} shadowColor="#000000" shadowBlur={8} shadowOpacity={0.3} offsetX={o.w / 2} offsetY={o.size / 2} />
    if (o.tipo === 'emoji') return <Text {...common} text={o.texto ?? '🎂'} fontSize={o.size} width={o.w} align="center" offsetX={o.w / 2} offsetY={o.size / 2} />
    if (o.tipo === 'rect') return <Rect {...common} width={o.w} height={o.h} fill={o.color} cornerRadius={8} offsetX={o.w / 2} offsetY={o.h / 2} />
    if (o.tipo === 'circle') return <Circle {...common} radius={o.w / 2} fill={o.color} offsetX={0} offsetY={0} />
    if (o.tipo === 'line') return <KonvaLine {...common} points={[-o.w / 2, 0, o.w / 2, 0]} stroke={o.color} strokeWidth={o.size} lineCap="round" />
    if (o.tipo === 'image' && o.src && imgs[o.src]) return <KonvaImage {...common} image={imgs[o.src]} width={o.w} height={o.h} offsetX={o.w / 2} offsetY={o.h / 2} />
    return null
  }

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

  const btn = 'inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs font-medium text-ink transition hover:bg-line'
  const pestañaBtn = (id: string, label: string) => (
    <button onClick={() => setPestaña(id as never)} className={'rounded-lg px-2.5 py-1.5 text-xs font-medium transition ' + (pestaña === id ? 'bg-violet-600 text-white' : 'text-sub hover:bg-line hover:text-ink')}>{label}</button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-[95vw] max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '94vh' }}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-ink"><Smile size={18} className="text-violet-500" aria-hidden /> Editor · Cumpleaños {titulo}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={deshacer} disabled={histIdx <= 0} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line disabled:opacity-40" title="Deshacer"><Undo2 size={14} aria-hidden /></button>
            <button onClick={rehacer} disabled={histIdx >= hist.length - 1} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line disabled:opacity-40" title="Rehacer"><Redo2 size={14} aria-hidden /></button>
            <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
          </div>
        </div>
        {aviso && <p className="mx-5 mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">{aviso}</p>}

        <div className="flex flex-1 flex-col gap-3 p-4 lg:flex-row" style={{ minHeight: 0 }}>
          {/* Lienzo */}
          <div className="flex min-w-0 flex-1 items-start justify-center overflow-auto rounded-2xl border border-line bg-[#eceef1] p-4">
            <div className="rounded-xl bg-white shadow-[0_10px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/5" style={{ width: 460 }}>
              <Stage ref={stageRef} width={W} height={H} scaleX={scale} scaleY={scale}>
                <Layer>
                  <Rect x={0} y={0} width={W} height={H} fill={fondo} listening={false} />
                  {fondoImg && imgs[fondoImg] && <KonvaImage image={imgs[fondoImg]} x={0} y={0} width={W} height={H} listening={false} />}
                  {/* Título y encabezado del listado */}
                  <Text text={titulo} x={W / 2} y={165} width={0} offsetX={0} align="center" fontFamily="Poppins" fontStyle="bold" fontSize={46} fill="#be185d" listening={false} />
                  <Text text="Lista de cumplea\u00f1os" x={W / 2} y={215} align="center" fontFamily="Poppins" fontSize={22} fill="#f472b6" listening={false} />
                  {layoutFilas.map((f) => (
                    <Group key={`f${f.nombre}-${f.dia}-${f.mes}`} listening={false}>
                      <Text text={`\u2022 ${f.nombre}`} x={90} y={f.y} width={520} fontFamily="Poppins" fontSize={f.sizeAuto} fill="#9d174d" wrap="word" />
                      <Text text={ddmm(f.dia, f.mes)} x={640} y={f.y} width={100} align="right" fontFamily="Poppins" fontStyle="bold" fontSize={f.sizeAuto} fill="#be185d" />
                    </Group>
                  ))}
                  {objs.map(renderObj)}
                  {selId && !sel?.bloqueado && <Transformer ref={trRef} rotateEnabled flipEnabled={false} anchorSize={8} anchorCornerRadius={4} />}
                </Layer>
              </Stage>
            </div>
          </div>

          {/* Paneles */}
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80" style={{ minHeight: 0 }}>
            <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface2 p-1">
              {pestañaBtn('plantillas', 'Plantillas')}
              {pestañaBtn('texto', 'Texto')}
              {pestañaBtn('elementos', 'Elementos')}
              {pestañaBtn('fondos', 'Fondos')}
              {pestañaBtn('datos', 'Datos')}
            </div>

            {pestaña === 'plantillas' && (
              <div className="rounded-2xl border border-line bg-surface2 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Plantilla clásica</h3>
                <button onClick={aplicarPlantilla} className={btn + ' w-full justify-center bg-violet-600 text-white hover:bg-violet-700'}>Aplicar plantilla</button>
                <p className="mt-2 text-[11px] text-sub/70">Agrega logos de texto "Comunicándonos" y "Recursos Humanos" (bloqueados, no se mueven). Para usar tus logos, subilos como imagen y ubicalos.</p>
              </div>
            )}

            {pestaña === 'texto' && (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-line bg-surface2 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Agregar texto</h3>
                  <button onClick={agregarTexto} className={btn + ' w-full justify-center'}><Type size={13} aria-hidden /> Nuevo texto</button>
                </div>
                {sel && (sel.tipo === 'text' || sel.tipo === 'emoji') && (
                  <div className="rounded-2xl border border-line bg-surface2 p-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Propiedades del texto</h3>
                    <label className="mb-2 block"><span className="mb-0.5 block text-[11px] text-sub">Tipografía</span>
                      <select value={sel.fuente} onChange={(e) => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, fuente: e.target.value } : o))} className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                        {FUENTES.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="flex-1"><span className="mb-0.5 block text-[11px] text-sub">Tamaño</span><input type="number" value={sel.size} min={10} max={200} onChange={(e) => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, size: Number(e.target.value) } : o))} className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs" /></label>
                      <label className="flex-1"><span className="mb-0.5 block text-[11px] text-sub">Color</span><input type="color" value={sel.color} onChange={(e) => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, color: e.target.value } : o))} className="h-7 w-full rounded-lg border border-line bg-surface" /></label>
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[11px] text-sub">Alinear</span>
                      {(['left', 'center', 'right'] as const).map((a) => (
                        <button key={a} onClick={() => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, align: a } : o))} className={'rounded px-2 py-0.5 text-xs ' + (sel.align === a ? 'bg-violet-600 text-white' : 'bg-line text-sub')}>{a[0].toUpperCase()}</button>
                      ))}
                    </div>
                    <div className="mb-2"><span className="mb-0.5 block text-[11px] text-sub">Interlineado: {sel.lineHeight.toFixed(2)}</span><input type="range" min={0.8} max={2} step={0.05} value={sel.lineHeight} onChange={(e) => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, lineHeight: Number(e.target.value) } : o))} className="w-full" /></div>
                    <label className="flex items-center gap-2 text-xs text-sub"><input type="checkbox" checked={sel.sombra} onChange={(e) => mutar((p) => p.map((o) => o.id === sel.id ? { ...o, sombra: e.target.checked } : o))} className="h-3.5 w-3.5" /> Sombra</label>
                  </div>
                )}
              </div>
            )}

            {pestaña === 'elementos' && (
              <div className="rounded-2xl border border-line bg-surface2 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Elementos</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={agregarEmoji} className={btn}><Smile size={13} aria-hidden /> Emoji</button>
                  <button onClick={agregarRect} className={btn}><Square size={13} aria-hidden /> Rectángulo</button>
                  <button onClick={agregarCircle} className={btn}><CircleIcon size={13} aria-hidden /> Círculo</button>
                  <button onClick={agregarLine} className={btn}><Minus size={13} aria-hidden /> Línea</button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {EMOJIS.map((em) => <button key={em} onClick={() => setEmoji(em)} className={'rounded-lg px-1.5 py-0.5 text-lg ' + (emoji === em ? 'bg-violet-600/25' : 'hover:bg-line')}>{em}</button>)}
                </div>
                <label className="mb-2 mt-2 block"><span className="mb-0.5 block text-[11px] text-sub">Color</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-full rounded-lg border border-line bg-surface" /></label>
                <div className="flex items-center gap-2"><span className="text-[11px] text-sub">Tamaño</span><input type="range" min={14} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} className="flex-1" /><span className="text-xs text-sub">{size}px</span></div>
                <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) cargarImagen(f); e.target.value = '' }} />
                <button onClick={() => imgRef.current?.click()} className={btn + ' mt-2 w-full justify-center'}><Upload size={13} aria-hidden /> Subir imagen</button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={borrarSel} disabled={!selId} className={btn + ' justify-center text-red-500 disabled:opacity-40'}><Trash2 size={13} aria-hidden /> Borrar</button>
                  <button onClick={toggleBloqueo} disabled={!selId} className={btn + ' justify-center disabled:opacity-40'}>{sel?.bloqueado ? <><Unlock size={13} aria-hidden /> Desbloquear</> : <><Lock size={13} aria-hidden /> Bloquear</>}</button>
                </div>
              </div>
            )}

            {pestaña === 'fondos' && (
              <div className="rounded-2xl border border-line bg-surface2 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Fondo</h3>
                <div className="flex flex-wrap gap-2">
                  {['#ffffff', '#fdf2f8', '#f3f4ff', '#eff6ff', '#fefce8', '#ecfeff'].map((c) => (
                    <button key={c} onClick={() => { setFondo(c); setFondoImg(null) }} className={'h-8 w-8 rounded-lg border ' + (fondo === c && !fondoImg ? 'ring-2 ring-violet-500' : 'border-line')} style={{ backgroundColor: c }} />
                  ))}
                </div>
                <input ref={fondoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFondo(f); e.target.value = '' }} />
                <button onClick={() => fondoRef.current?.click()} className={btn + ' mt-2 w-full justify-center'}><Upload size={13} aria-hidden /> Subir imagen de fondo</button>
              </div>
            )}

            {pestaña === 'datos' && (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-line bg-surface2 p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Datos de la lista</h3>
                  <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Peg\u00e1 ac\u00e1 el listado: nombre, dd/mm\nEj:\nLEYRIA EXEQUIEL, 01/09\nGUZMAN IGNACIO, 02/09'} rows={6} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs" />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={actualizarDesdeCSV} className={btn + ' justify-center'}><RefreshCw size={13} aria-hidden /> Actualizar</button>
                    <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirExcel(f); e.target.value = '' }} />
                    <button onClick={() => excelRef.current?.click()} className={btn + ' justify-center'}><FileSpreadsheet size={13} aria-hidden /> Excel</button>
                  </div>
                  <p className="mt-2 text-[11px] text-sub/70">Se ordena cronológicamente por fecha. La lista se regenera automáticamente.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={exportarPng} className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"><Download size={15} aria-hidden /> PNG</button>
              <button onClick={exportarPdf} className="btn-press inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"><FileSpreadsheet size={15} aria-hidden /> PDF</button>
            </div>
            <p className="text-[11px] leading-relaxed text-sub/70">
              {filas.length} cumpleañeros en el listado. Seleccioná un elemento para moverlo, redimensionarlo o bloquearlo. Deshacer/Rehacer disponibles arriba.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}