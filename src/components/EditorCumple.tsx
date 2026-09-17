import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import { Stage, Layer, Group, Rect, Text, Line, Image as KonvaImage, Transformer } from 'react-konva'
import {
  X, Download, FileText, Image as ImageIcon, Upload, Link as LinkIcon, Trash2, Plus,
  AlignLeft, AlignCenter, AlignRight, Bold, Italic, Eye, EyeOff, RotateCcw,
  ZoomIn, ZoomOut, Maximize2, Type, LayoutGrid, Users, Crosshair, Copy, Check,
  AlertTriangle, ArrowUpNarrowWide,
} from 'lucide-react'
import Fondo from './cumple/Fondos'
import { Grupo, Fila, Deslizador, Segmento, Interruptor, SelectorColor, SelectorFuente } from './cumple/Controles'
import {
  autoSize, cfgPorDefecto, construirItems, cortar, fuenteCss, layoutLista, FORMATOS, FAMILIAS_GOOGLE,
} from './cumple/tipos'
import type {
  AlignH, AlignV, CumpleCfg, CumpleFila, Elemento, Formato, FormatoFecha, ListaCfg, ModoLista,
  TextoCfg, TipoFondo, Vineta,
} from './cumple/tipos'

export type { CumpleFila } from './cumple/tipos'

const CFG_KEY = 'cumple_editor_v3'
const IMG_KEY = 'cumple_plantilla_v3'
const URL_PLANTILLA = import.meta.env.VITE_URL_PLANTILLA_CUMPLE?.trim() || '/plantilla-cumpleanos.jpeg'
const MAX_GUARDADO = 3_000_000

interface FilaEd extends CumpleFila { id: string; on: boolean }

const FONDOS: { id: TipoFondo; nombre: string; muestra: string }[] = [
  { id: 'globos', nombre: 'Globos', muestra: 'linear-gradient(135deg,#ffffff 0%,#ffffff 60%,#f9a8d4 100%)' },
  { id: 'confeti', nombre: 'Confeti', muestra: 'linear-gradient(135deg,#fde4f2,#ede9fe,#dbeafe)' },
  { id: 'oscuro', nombre: 'Oscuro', muestra: 'radial-gradient(circle at 30% 20%,rgba(225,29,46,.55),#0b0b0d 70%)' },
  { id: 'blanco', nombre: 'Simple', muestra: 'linear-gradient(#e11d2e 0 8%,#ffffff 8% 92%,#111111 92% 100%)' },
  { id: 'imagen', nombre: 'Imagen', muestra: 'repeating-conic-gradient(#3f3f46 0% 25%,#27272a 0% 50%) 50%/12px 12px' },
]

export default function EditorCumple({
  titulo, filas, onClose,
}: { titulo: string; filas: CumpleFila[]; onClose: () => void }) {
  // ── Estado ────────────────────────────────────────────────────────────────
  const [cfg, setCfg] = useState<CumpleCfg>(() => {
    const base = cfgPorDefecto(titulo)
    try {
      const raw = localStorage.getItem(CFG_KEY)
      if (!raw) return base
      const g = JSON.parse(raw) as Partial<CumpleCfg>
      return {
        ...base,
        ...g,
        encabezado: { ...base.encabezado, ...(g.encabezado ?? {}) },
        titulo: { ...base.titulo, ...(g.titulo ?? {}), texto: titulo },
        pie: { ...base.pie, ...(g.pie ?? {}) },
        lista: { ...base.lista, ...(g.lista ?? {}) },
      }
    } catch { return base }
  })
  const [filasEd, setFilasEd] = useState<FilaEd[]>(() =>
    filas.map((f, i) => ({ ...f, id: `f${i}`, on: true })),
  )
  const [imgSrc, setImgSrc] = useState<string>(() => {
    try { return localStorage.getItem(IMG_KEY) || URL_PLANTILLA } catch { return URL_PLANTILLA }
  })
  const [urlCampo, setUrlCampo] = useState('')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [sel, setSel] = useState<Elemento | null>('lista')
  const [tab, setTab] = useState<'diseno' | 'estilo' | 'datos'>('diseno')
  const [zoomManual, setZoomManual] = useState<number | null>(null)
  const [guias, setGuias] = useState(false)
  const [aviso, setAviso] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [revFuentes, setRevFuentes] = useState(0)
  const [caja, setCaja] = useState({ w: 900, h: 620 })

  const stageRef = useRef<any>(null)
  const uiRef = useRef<any>(null)
  const trRef = useRef<any>(null)
  const nodos = useRef<Record<string, any>>({})
  const contRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // ── Fuentes de Google (Konva necesita que estén listas antes de medir) ────
  useEffect(() => {
    let vivo = true
    import('webfontloader')
      .then(({ default: WebFont }) => {
        WebFont.load({
          google: { families: FAMILIAS_GOOGLE },
          fontactive: () => { if (vivo) setRevFuentes((n) => n + 1) },
          active: () => { if (vivo) setRevFuentes((n) => n + 1) },
        })
      })
      .catch(() => { /* sin fuentes extra: se usan las del sistema */ })
    return () => { vivo = false }
  }, [])

  // ── Plantilla de imagen ───────────────────────────────────────────────────
  useEffect(() => {
    if (!imgSrc) { setImg(null); return }
    let vivo = true
    const im = new window.Image()
    if (!imgSrc.startsWith('data:')) im.crossOrigin = 'anonymous'
    im.onload = () => { if (vivo) setImg(im) }
    im.onerror = () => {
      if (!vivo) return
      setImg(null)
      setAviso('No se pudo cargar la imagen de plantilla.')
    }
    im.src = imgSrc
    return () => { vivo = false }
  }, [imgSrc])

  useEffect(() => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch { /* sin espacio */ } }, [cfg])

  // ── Medidas del lienzo ────────────────────────────────────────────────────
  const { W, H } = useMemo(() => {
    if (cfg.fondo === 'imagen' && img?.naturalWidth) {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      return { W: Math.round(img.naturalWidth * k), H: Math.round(img.naturalHeight * k) }
    }
    const f = FORMATOS[cfg.formato]
    return { W: f.w, H: f.h }
  }, [cfg.fondo, cfg.formato, img])

  useEffect(() => {
    const el = contRef.current
    if (!el) return
    const medir = () => setCaja({ w: el.clientWidth, h: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const escalaFit = Math.max(0.05, Math.min((caja.w - 32) / W, (caja.h - 32) / H))
  const escala = zoomManual ?? escalaFit

  // ── Datos y layout del listado ───────────────────────────────────────────
  const activas = useMemo(
    () => filasEd.filter((f) => f.on && f.nombre.trim()).map((f) => ({ nombre: f.nombre.trim(), dia: f.dia, mes: f.mes })),
    [filasEd],
  )
  const items = useMemo(
    () => construirItems(activas, cfg.lista.agrupar, cfg.lista.formato),
    [activas, cfg.lista.agrupar, cfg.lista.formato],
  )

  const L = cfg.lista
  const cajaLista = { x: L.x * W, y: L.y * H, w: Math.max(40, L.w * W), h: Math.max(30, L.h * H) }
  // Clave con todo lo que afecta la medición (excluye x/y para no recalcular al arrastrar)
  const claveEstilo = [
    L.fuente, L.bold, L.mayus, L.modo, L.columnas, L.interlineado, L.espacio, L.vineta,
    L.formato, L.align, L.auto, L.sizeRel, Math.round(cajaLista.w), Math.round(cajaLista.h), H, revFuentes,
  ].join('|')

  const lay = useMemo(() => {
    const size = L.auto
      ? autoSize(items, L, cajaLista.w, cajaLista.h)
      : Math.max(8, Math.round(L.sizeRel * H))
    return layoutLista(items, L, cajaLista.w, cajaLista.h, size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, claveEstilo])

  const offsetY = L.alignV === 'center' ? Math.max(0, (cajaLista.h - lay.alto) / 2) : 0

  // ── Helpers de configuración ─────────────────────────────────────────────
  const setTexto = useCallback((el: 'encabezado' | 'titulo' | 'pie', parche: Partial<TextoCfg>) => {
    setCfg((c) => ({ ...c, [el]: { ...c[el], ...parche } }))
  }, [])
  const setLista = useCallback((parche: Partial<ListaCfg>) => {
    setCfg((c) => ({ ...c, lista: { ...c.lista, ...parche } }))
  }, [])

  const textoDe = (el: Elemento): TextoCfg | null => (el === 'lista' ? null : cfg[el])

  // ── Arrastrar / redimensionar ────────────────────────────────────────────
  const registrar = (el: Elemento) => (n: any) => { nodos.current[el] = n }

  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const n = sel ? nodos.current[sel] : null
    tr.nodes(n && (sel === 'lista' || textoDe(sel as Elemento)?.visible) ? [n] : [])
    tr.getLayer()?.batchDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, W, H, cfg, lay])

  const limite = (anchoPx: number, altoPx: number) => (pos: { x: number; y: number }) => {
    const centro = ((W - anchoPx) / 2) * escala
    let x = Math.abs(pos.x - centro) < 12 ? centro : pos.x
    x = Math.min(Math.max(x, -anchoPx * escala * 0.85), (W - anchoPx * 0.15) * escala)
    const y = Math.min(Math.max(pos.y, -altoPx * escala * 0.85), (H - altoPx * 0.15) * escala)
    return { x, y }
  }

  function finArrastre(el: Elemento, e: any) {
    const n = e.target
    const x = n.x() / W
    const y = n.y() / H
    if (el === 'lista') setLista({ x, y })
    else setTexto(el, { x, y })
  }

  function finTransformar(el: Elemento, e: any) {
    const n = e.target
    const sx = n.scaleX()
    const sy = n.scaleY()
    n.scaleX(1)
    n.scaleY(1)
    if (el === 'lista') {
      setLista({
        x: n.x() / W,
        y: n.y() / H,
        w: Math.max(0.12, Math.min(1, L.w * sx)),
        h: Math.max(0.06, Math.min(1, L.h * sy)),
      })
    } else {
      const t = cfg[el]
      setTexto(el, { x: n.x() / W, y: n.y() / H, w: Math.max(0.08, Math.min(1, t.w * sx)) })
    }
  }

  const centrar = (el: Elemento) => {
    if (el === 'lista') setLista({ x: (1 - L.w) / 2 })
    else setTexto(el, { x: (1 - cfg[el].w) / 2 })
  }

  // Teclado: mover el elemento elegido y cerrar con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && /input|textarea|select/i.test(t.tagName)) return
      if (e.key === 'Escape') { onClose(); return }
      if (!sel) return
      const paso = e.shiftKey ? 0.02 : 0.004
      const dx = e.key === 'ArrowLeft' ? -paso : e.key === 'ArrowRight' ? paso : 0
      const dy = e.key === 'ArrowUp' ? -paso : e.key === 'ArrowDown' ? paso : 0
      if (!dx && !dy) return
      e.preventDefault()
      if (sel === 'lista') setLista({ x: L.x + dx, y: L.y + dy })
      else setTexto(sel, { x: cfg[sel].x + dx, y: cfg[sel].y + dy })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, cfg, onClose])

  // ── Plantilla: archivo, URL ──────────────────────────────────────────────
  function usarArchivo(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setAviso('El archivo tiene que ser una imagen.'); return }
    const fr = new FileReader()
    fr.onload = () => {
      const d = String(fr.result)
      setImgSrc(d)
      setCfg((c) => ({ ...c, fondo: 'imagen' }))
      setAviso(d.length > MAX_GUARDADO ? 'Imagen cargada (muy grande para guardarla en este dispositivo).' : '')
      try {
        if (d.length <= MAX_GUARDADO) localStorage.setItem(IMG_KEY, d)
        else localStorage.removeItem(IMG_KEY)
      } catch { /* sin espacio */ }
    }
    fr.readAsDataURL(file)
  }

  function usarUrl() {
    const u = urlCampo.trim()
    if (!u) return
    setImgSrc(u)
    setCfg((c) => ({ ...c, fondo: 'imagen' }))
    setAviso('')
    try { localStorage.setItem(IMG_KEY, u) } catch { /* noop */ }
  }

  function quitarPlantilla() {
    setImgSrc('')
    setImg(null)
    setCfg((c) => ({ ...c, fondo: 'globos' }))
    try { localStorage.removeItem(IMG_KEY) } catch { /* noop */ }
  }

  // ── Exportar ─────────────────────────────────────────────────────────────
  function generar(mime: string, calidad = 0.94): string | null {
    const stage = stageRef.current
    if (!stage) return null
    uiRef.current?.visible(false)
    // Con plantilla propia no conviene ampliar mucho más que su resolución real
    const objetivo = cfg.fondo === 'imagen' && img?.naturalWidth
      ? Math.min(2400, Math.max(W, Math.round(img.naturalWidth * 1.6)))
      : Math.min(2400, Math.max(1600, Math.round(W * 1.4)))
    const pixelRatio = objetivo / (W * escala)
    try {
      return stage.toDataURL({ mimeType: mime, quality: calidad, pixelRatio })
    } catch {
      setAviso('No se pudo exportar: la plantilla viene de otro dominio y bloquea la descarga. Subila como archivo.')
      return null
    } finally {
      uiRef.current?.visible(true)
      uiRef.current?.getLayer()?.batchDraw()
    }
  }

  const nombreArchivo = `cumpleanos_${titulo.replace(/\s+/g, '_').toLowerCase()}`

  function bajar(data: string, ext: string) {
    const a = document.createElement('a')
    a.download = `${nombreArchivo}.${ext}`
    a.href = data
    a.click()
  }

  function exportarPng() { const d = generar('image/png'); if (d) bajar(d, 'png') }
  function exportarJpg() { const d = generar('image/jpeg'); if (d) bajar(d, 'jpg') }
  function exportarPdf() {
    const d = generar('image/png')
    if (!d) return
    const doc = new jsPDF({ unit: 'px', format: [W, H], orientation: W > H ? 'landscape' : 'portrait' })
    doc.addImage(d, 'PNG', 0, 0, W, H)
    doc.save(`${nombreArchivo}.pdf`)
  }
  async function copiar() {
    const d = generar('image/png')
    if (!d) return
    try {
      const blob = await (await fetch(d)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setAviso('Este navegador no deja copiar imágenes; usá Descargar PNG.')
    }
  }

  function elegirFondo(f: TipoFondo) {
    setCfg((c) => {
      const aOscuro = f === 'oscuro'
      if (aOscuro === (c.fondo === 'oscuro')) return { ...c, fondo: f }
      return {
        ...c,
        fondo: f,
        encabezado: { ...c.encabezado, color: aOscuro ? '#f59e0b' : '#e11d2e' },
        titulo: { ...c.titulo, color: aOscuro ? '#ffffff' : '#111111' },
        pie: { ...c.pie, color: aOscuro ? '#a1a1aa' : '#6b7280' },
        lista: {
          ...c.lista,
          color: aOscuro ? '#f4f4f5' : '#1a1a1a',
          colorFecha: aOscuro ? '#fb923c' : '#e11d2e',
          placaColor: aOscuro ? '#111111' : '#ffffff',
        },
      }
    })
  }

  function restaurarDiseno() {
    const base = cfgPorDefecto(titulo)
    setCfg({ ...base, fondo: cfg.fondo, formato: cfg.formato })
  }

  // ── Render del lienzo ────────────────────────────────────────────────────
  function dibujarTexto(el: 'encabezado' | 'titulo' | 'pie') {
    const t = cfg[el]
    if (!t.visible) return null
    const size = Math.max(6, t.sizeRel * H)
    const txt = t.mayus ? t.texto.toLocaleUpperCase('es') : t.texto
    const w = Math.max(20, t.w * W)
    const lineas = cortar(txt, w, fuenteCss(t.fuente, size, t.bold, t.italic)).length
    const alto = Math.max(size * 1.25, lineas * size * t.interlineado)
    const estilo = [t.bold ? 'bold' : '', t.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal'
    return (
      <Group
        key={el}
        ref={registrar(el)}
        x={t.x * W}
        y={t.y * H}
        draggable
        dragBoundFunc={limite(w, alto)}
        onMouseDown={() => setSel(el)}
        onTouchStart={() => setSel(el)}
        onDragEnd={(e) => finArrastre(el, e)}
        onTransformEnd={(e) => finTransformar(el, e)}
      >
        <Rect width={w} height={alto} fill="rgba(0,0,0,0.001)" />
        <Text
          text={txt}
          width={w}
          align={t.align}
          fontFamily={t.fuente}
          fontSize={size}
          fontStyle={estilo}
          lineHeight={t.interlineado}
          fill={t.color}
          wrap="word"
          listening={false}
          shadowColor={t.sombra ? 'rgba(0,0,0,0.45)' : undefined}
          shadowBlur={t.sombra ? size * 0.22 : 0}
          shadowOffsetY={t.sombra ? size * 0.07 : 0}
          shadowOpacity={t.sombra ? 1 : 0}
        />
      </Group>
    )
  }

  const bordeSel = (el: Elemento) => {
    if (sel !== el) return null
    const r = el === 'lista'
      ? cajaLista
      : (() => {
        const t = cfg[el]
        const size = Math.max(6, t.sizeRel * H)
        const w = Math.max(20, t.w * W)
        const n = cortar(t.mayus ? t.texto.toLocaleUpperCase('es') : t.texto, w, fuenteCss(t.fuente, size, t.bold, t.italic)).length
        return { x: t.x * W, y: t.y * H, w, h: Math.max(size * 1.25, n * size * t.interlineado) }
      })()
    return (
      <Rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        stroke="#e11d2e"
        strokeWidth={2 / escala}
        dash={[8 / escala, 6 / escala]}
        listening={false}
      />
    )
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const tSel = sel && sel !== 'lista' ? cfg[sel] : null
  const chips: { el: Elemento; label: string }[] = [
    { el: 'encabezado', label: 'Encabezado' },
    { el: 'titulo', label: 'Título' },
    { el: 'lista', label: 'Listado' },
    { el: 'pie', label: 'Pie' },
  ]
  const btn = 'btn-press inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40'
  const btnIcono = 'btn-press rounded-lg border border-line p-1.5 text-sub transition hover:bg-surface2 hover:text-ink'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex h-[96vh] w-[98vw] max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Barra superior */}
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="mr-auto flex min-w-0 items-center gap-2 truncate font-display text-base font-semibold text-ink">
            🎂 Cumpleaños · {titulo}
            <span className="text-xs font-normal text-sub">{items.length} línea{items.length === 1 ? '' : 's'} · {activas.length} personas</span>
          </h2>

          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface2 p-0.5">
            <button className={btnIcono + ' border-0'} title="Alejar" onClick={() => setZoomManual(Math.max(0.05, escala - 0.1))}><ZoomOut size={15} aria-hidden /></button>
            <button className="min-w-[52px] rounded-lg px-1 text-xs font-medium text-sub hover:text-ink" title="Ajustar a la ventana" onClick={() => setZoomManual(null)}>
              {Math.round(escala * 100)}%
            </button>
            <button className={btnIcono + ' border-0'} title="Acercar" onClick={() => setZoomManual(Math.min(3, escala + 0.1))}><ZoomIn size={15} aria-hidden /></button>
            <button className={btnIcono + ' border-0'} title="Ajustar" onClick={() => setZoomManual(null)}><Maximize2 size={15} aria-hidden /></button>
          </div>

          <button onClick={() => setGuias((g) => !g)} className={btnIcono + (guias ? ' bg-surface2 text-ink' : '')} title="Guías de centro"><Crosshair size={15} aria-hidden /></button>
          <button onClick={copiar} className={btn + ' border border-line text-sub hover:text-ink'} title="Copiar imagen al portapapeles">
            {copiado ? <><Check size={15} aria-hidden /> Copiado</> : <><Copy size={15} aria-hidden /> Copiar</>}
          </button>
          <button onClick={exportarPng} className={btn + ' bg-emerald-600 text-white hover:bg-emerald-700'}><Download size={15} aria-hidden /> PNG</button>
          <button onClick={exportarJpg} className={btn + ' border border-line text-sub hover:text-ink'} title="Descargar JPG"><ImageIcon size={15} aria-hidden /> JPG</button>
          <button onClick={exportarPdf} className={btn + ' bg-brand-600 text-white hover:bg-brand-700'}><FileText size={15} aria-hidden /> PDF</button>
          <button onClick={onClose} className={btnIcono} aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Lienzo */}
          <div className="flex min-h-0 min-w-0 basis-[56%] flex-col lg:basis-auto lg:flex-1">
            <div
              ref={contRef}
              className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#111214] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:18px_18px] p-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); usarArchivo(e.dataTransfer.files?.[0]) }}
            >
              <div className="shadow-[0_18px_60px_rgba(0,0,0,0.6)]" style={{ width: W * escala, height: H * escala }}>
                <Stage
                  ref={stageRef}
                  width={W * escala}
                  height={H * escala}
                  scaleX={escala}
                  scaleY={escala}
                  onMouseDown={(e: any) => { if (e.target === e.target.getStage()) setSel(null) }}
                >
                  <Layer>
                    {cfg.fondo === 'imagen' && img
                      ? <KonvaImage image={img} width={W} height={H} listening={false} />
                      : <Fondo tipo={cfg.fondo === 'imagen' ? 'blanco' : cfg.fondo} w={W} h={H} marca={cfg.marca} />}

                    {dibujarTexto('encabezado')}
                    {dibujarTexto('titulo')}

                    <Group
                      ref={registrar('lista')}
                      x={cajaLista.x}
                      y={cajaLista.y}
                      draggable
                      dragBoundFunc={limite(cajaLista.w, cajaLista.h)}
                      onMouseDown={() => setSel('lista')}
                      onTouchStart={() => setSel('lista')}
                      onDragEnd={(e) => finArrastre('lista', e)}
                      onTransformEnd={(e) => finTransformar('lista', e)}
                    >
                      {L.placa && (
                        <Rect
                          x={-L.placaPad * W}
                          y={-L.placaPad * W}
                          width={cajaLista.w + L.placaPad * W * 2}
                          height={cajaLista.h + L.placaPad * W * 2}
                          fill={L.placaColor}
                          opacity={L.placaOpacidad}
                          cornerRadius={L.placaRadio * W}
                          listening={false}
                        />
                      )}
                      <Rect width={cajaLista.w} height={cajaLista.h} fill="rgba(0,0,0,0.001)" />
                      {lay.textos.map((t) => (
                        <Text
                          key={t.key}
                          text={t.texto}
                          x={t.x}
                          y={t.y + offsetY}
                          width={t.w}
                          align={t.align}
                          fontFamily={L.fuente}
                          fontSize={lay.size}
                          fontStyle={L.bold ? 'bold' : 'normal'}
                          fill={t.tipo === 'fecha' ? L.colorFecha : L.color}
                          listening={false}
                          shadowColor={L.sombra ? 'rgba(0,0,0,0.4)' : undefined}
                          shadowBlur={L.sombra ? lay.size * 0.2 : 0}
                          shadowOffsetY={L.sombra ? lay.size * 0.06 : 0}
                          shadowOpacity={L.sombra ? 1 : 0}
                        />
                      ))}
                    </Group>

                    {dibujarTexto('pie')}

                    {/* Capa de edición: se oculta al exportar */}
                    <Group ref={uiRef}>
                      {guias && (
                        <>
                          <Line points={[W / 2, 0, W / 2, H]} stroke="#e11d2e" strokeWidth={1 / escala} dash={[10 / escala, 8 / escala]} opacity={0.6} listening={false} />
                          <Line points={[0, H / 2, W, H / 2]} stroke="#e11d2e" strokeWidth={1 / escala} dash={[10 / escala, 8 / escala]} opacity={0.6} listening={false} />
                        </>
                      )}
                      {bordeSel('encabezado')}
                      {bordeSel('titulo')}
                      {bordeSel('lista')}
                      {bordeSel('pie')}
                      <Transformer
                        ref={trRef}
                        rotateEnabled={false}
                        keepRatio={false}
                        anchorSize={9}
                        anchorStroke="#e11d2e"
                        anchorFill="#ffffff"
                        borderStroke="#e11d2e"
                        borderDash={[6, 4]}
                        enabledAnchors={sel === 'lista'
                          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
                          : ['middle-left', 'middle-right']}
                        boundBoxFunc={(_o: any, n: any) => ({ ...n, width: Math.max(30, n.width), height: Math.max(20, n.height) })}
                      />
                    </Group>
                  </Layer>
                </Stage>
              </div>
            </div>

            {/* Selección rápida de elementos */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line bg-surface px-3 py-2">
              {chips.map(({ el, label }) => {
                const t = textoDe(el)
                const activo = sel === el
                return (
                  <div key={el} className={'flex items-center overflow-hidden rounded-lg border ' + (activo ? 'border-brand-600 bg-brand-600/15' : 'border-line bg-surface2')}>
                    <button
                      onClick={() => { setSel(el); setTab('estilo') }}
                      className={'px-2.5 py-1.5 text-[11px] font-medium transition ' + (activo ? 'text-ink' : 'text-sub hover:text-ink')}
                    >
                      {label}
                    </button>
                    {t && (
                      <button
                        onClick={() => setTexto(el as 'encabezado' | 'titulo' | 'pie', { visible: !t.visible })}
                        title={t.visible ? 'Ocultar' : 'Mostrar'}
                        className="border-l border-line px-1.5 py-1.5 text-sub transition hover:text-ink"
                      >
                        {t.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                      </button>
                    )}
                  </div>
                )
              })}
              {!lay.cabe && (
                <span className="ml-auto flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] text-amber-400">
                  <AlertTriangle size={12} aria-hidden /> El listado no entra en su caja
                </span>
              )}
            </div>
          </div>

          {/* Panel */}
          <aside className="flex min-h-0 w-full shrink-0 basis-[44%] flex-col border-t border-line lg:basis-auto lg:w-[340px] lg:border-l lg:border-t-0">
            <div className="flex shrink-0 border-b border-line">
              {([
                { id: 'diseno', label: 'Diseño', icono: <LayoutGrid size={13} aria-hidden /> },
                { id: 'estilo', label: 'Estilo', icono: <Type size={13} aria-hidden /> },
                { id: 'datos', label: 'Datos', icono: <Users size={13} aria-hidden /> },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={
                    'flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition ' +
                    (tab === t.id ? 'border-b-2 border-brand-600 text-ink' : 'text-sub hover:text-ink')
                  }
                >
                  {t.icono} {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
              {aviso && (
                <p className="flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-400">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {aviso}
                </p>
              )}

              {tab === 'diseno' && (
                <>
                  <Grupo titulo="Fondo">
                    <div className="grid grid-cols-5 gap-1.5">
                      {FONDOS.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => elegirFondo(f.id)}
                          title={f.nombre}
                          className={
                            'overflow-hidden rounded-lg border transition ' +
                            (cfg.fondo === f.id ? 'border-brand-600 ring-2 ring-brand-600/40' : 'border-line hover:border-line2')
                          }
                        >
                          <span className="block h-9 w-full" style={{ background: f.muestra }} />
                          <span className="block px-0.5 py-0.5 text-[9px] text-sub">{f.nombre}</span>
                        </button>
                      ))}
                    </div>
                    <Interruptor label="Etiquetas RRHH" valor={cfg.marca} onChange={(v) => setCfg((c) => ({ ...c, marca: v }))} />
                  </Grupo>

                  <Grupo titulo="Tamaño del lienzo">
                    {cfg.fondo === 'imagen' && img ? (
                      <p className="text-[11px] leading-relaxed text-sub/70">
                        Toma la proporción de la plantilla: {W} × {H} px.
                      </p>
                    ) : (
                      <select
                        value={cfg.formato}
                        onChange={(e) => setCfg((c) => ({ ...c, formato: e.target.value as Formato }))}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink"
                      >
                        {Object.entries(FORMATOS).map(([k, v]) => (
                          <option key={k} value={k}>{v.nombre} · {v.w}×{v.h}</option>
                        ))}
                      </select>
                    )}
                  </Grupo>

                  <Grupo titulo="Plantilla propia" icono={<LinkIcon size={12} aria-hidden />}>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => usarArchivo(e.target.files?.[0])} />
                    <button onClick={() => fileRef.current?.click()} className={btn + ' w-full border border-line text-sub hover:text-ink'}>
                      <Upload size={14} aria-hidden /> Subir imagen
                    </button>
                    <div className="flex gap-1.5">
                      <input
                        value={urlCampo}
                        onChange={(e) => setUrlCampo(e.target.value)}
                        placeholder="o pegá una URL"
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink"
                      />
                      <button onClick={usarUrl} className={btn + ' bg-surface2 text-sub hover:text-ink'}>Usar</button>
                    </div>
                    {img && (
                      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-1.5">
                        <img src={imgSrc} alt="" className="h-10 w-14 rounded object-cover" />
                        <span className="min-w-0 flex-1 truncate text-[10px] text-sub">{img.naturalWidth}×{img.naturalHeight}</span>
                        <button onClick={quitarPlantilla} className={btnIcono} title="Quitar plantilla"><Trash2 size={13} aria-hidden /></button>
                      </div>
                    )}
                    <p className="text-[11px] leading-relaxed text-sub/70">
                      Ideal: una plantilla <strong>sin nombres</strong> (solo el marco decorado). Los textos los pone el editor y podés arrastrarlos donde quieras.
                    </p>
                  </Grupo>

                  <button onClick={restaurarDiseno} className={btn + ' w-full border border-line text-sub hover:text-ink'}>
                    <RotateCcw size={14} aria-hidden /> Restaurar diseño
                  </button>
                </>
              )}

              {tab === 'estilo' && !sel && (
                <p className="rounded-xl border border-line bg-surface2/60 p-3 text-[11px] leading-relaxed text-sub">
                  Elegí un elemento en el lienzo (o en la barra de abajo) para editarlo. Arrastralo para moverlo y usá los tiradores para cambiar el ancho.
                </p>
              )}

              {tab === 'estilo' && sel === 'lista' && (
                <>
                  <Grupo titulo="Listado">
                    <Segmento<ModoLista>
                      valor={L.modo}
                      onChange={(v) => setLista({ modo: v })}
                      opciones={[
                        { v: 'unido', label: 'Nombre + fecha' },
                        { v: 'split', label: 'Fecha a la derecha' },
                      ]}
                    />
                    <Fila label="Fecha">
                      <select
                        value={L.formato}
                        onChange={(e) => setLista({ formato: e.target.value as FormatoFecha })}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-ink"
                      >
                        <option value="dd/mm">08/09</option>
                        <option value="d/m">8/9</option>
                        <option value="dia">08</option>
                        <option value="texto">8 de septiembre</option>
                        <option value="ninguno">Sin fecha</option>
                      </select>
                    </Fila>
                    <Interruptor label="Juntar los del mismo día" valor={L.agrupar} onChange={(v) => setLista({ agrupar: v })} />
                    <Fila label="Columnas">
                      <Segmento<number> valor={L.columnas} onChange={(v) => setLista({ columnas: v as 1 | 2 })} opciones={[{ v: 1, label: '1' }, { v: 2, label: '2' }]} />
                    </Fila>
                    <Fila label="Viñeta">
                      <select
                        value={L.vineta}
                        onChange={(e) => setLista({ vineta: e.target.value as Vineta })}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-ink"
                      >
                        <option value="ninguna">Sin viñeta</option>
                        <option value="punto">• Punto</option>
                        <option value="torta">🎂 Torta</option>
                        <option value="globo">🎈 Globo</option>
                        <option value="estrella">★ Estrella</option>
                      </select>
                    </Fila>
                  </Grupo>

                  <Grupo titulo="Tipografía">
                    <SelectorFuente valor={L.fuente} onChange={(v) => setLista({ fuente: v })} />
                    <Interruptor label={`Tamaño automático${L.auto ? ` (${lay.size}px)` : ''}`} valor={L.auto} onChange={(v) => setLista({ auto: v, sizeRel: v ? L.sizeRel : lay.size / H })} />
                    {!L.auto && (
                      <Deslizador label="Tamaño" valor={Math.round(L.sizeRel * 1000)} min={8} max={140} onChange={(v) => setLista({ sizeRel: v / 1000 })} />
                    )}
                    <Deslizador label="Interlineado" valor={L.interlineado} min={0.9} max={2.2} paso={0.05} onChange={(v) => setLista({ interlineado: v })} mostrar={(v) => v.toFixed(2)} />
                    <Deslizador label="Espacio entre personas" valor={L.espacio} min={0} max={1.5} paso={0.02} onChange={(v) => setLista({ espacio: v })} mostrar={(v) => v.toFixed(2)} />
                    <div className="flex gap-1.5">
                      <Segmento<AlignH>
                        valor={L.align}
                        onChange={(v) => setLista({ align: v })}
                        opciones={[
                          { v: 'left', icono: <AlignLeft size={13} aria-hidden />, title: 'Izquierda' },
                          { v: 'center', icono: <AlignCenter size={13} aria-hidden />, title: 'Centrado' },
                          { v: 'right', icono: <AlignRight size={13} aria-hidden />, title: 'Derecha' },
                        ]}
                      />
                      <Segmento<AlignV>
                        valor={L.alignV}
                        onChange={(v) => setLista({ alignV: v })}
                        opciones={[
                          { v: 'top', icono: <ArrowUpNarrowWide size={13} aria-hidden />, title: 'Arriba' },
                          { v: 'center', icono: <AlignCenter size={13} className="rotate-90" aria-hidden />, title: 'Centrado vertical' },
                        ]}
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <Segmento<number> valor={L.bold ? 1 : 0} onChange={(v) => setLista({ bold: !!v })} opciones={[{ v: 0, label: 'Normal' }, { v: 1, icono: <Bold size={13} aria-hidden />, title: 'Negrita' }]} />
                      <Segmento<number> valor={L.mayus ? 1 : 0} onChange={(v) => setLista({ mayus: !!v })} opciones={[{ v: 0, label: 'Aa' }, { v: 1, label: 'AA' }]} />
                    </div>
                    <Interruptor label="Sombra" valor={L.sombra} onChange={(v) => setLista({ sombra: v })} />
                  </Grupo>

                  <Grupo titulo="Colores">
                    <Fila label="Nombres"><span /></Fila>
                    <SelectorColor valor={L.color} onChange={(v) => setLista({ color: v })} />
                    <Fila label="Fechas"><span /></Fila>
                    <SelectorColor valor={L.colorFecha} onChange={(v) => setLista({ colorFecha: v })} />
                  </Grupo>

                  <Grupo titulo="Caja">
                    <Deslizador label="Ancho" valor={Math.round(L.w * 100)} min={15} max={100} onChange={(v) => setLista({ w: v / 100 })} mostrar={(v) => `${v}%`} />
                    <Deslizador label="Alto" valor={Math.round(L.h * 100)} min={8} max={100} onChange={(v) => setLista({ h: v / 100 })} mostrar={(v) => `${v}%`} />
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => centrar('lista')} className={btn + ' border border-line text-sub hover:text-ink'}>Centrar</button>
                      <button onClick={() => setLista({ x: 0.08, w: 0.84, y: 0.3, h: 0.6 })} className={btn + ' border border-line text-sub hover:text-ink'}>Espacio libre</button>
                    </div>
                  </Grupo>

                  <Grupo titulo="Placa de fondo">
                    <Interruptor label="Tapar lo que hay detrás" valor={L.placa} onChange={(v) => setLista({ placa: v })} />
                    {L.placa && (
                      <>
                        <SelectorColor valor={L.placaColor} onChange={(v) => setLista({ placaColor: v })} />
                        <Deslizador label="Opacidad" valor={Math.round(L.placaOpacidad * 100)} min={10} max={100} onChange={(v) => setLista({ placaOpacidad: v / 100 })} mostrar={(v) => `${v}%`} />
                        <Deslizador label="Margen" valor={Math.round(L.placaPad * 1000)} min={0} max={100} onChange={(v) => setLista({ placaPad: v / 1000 })} mostrar={(v) => `${(v / 10).toFixed(1)}%`} />
                        <Deslizador label="Esquinas" valor={Math.round(L.placaRadio * 1000)} min={0} max={80} onChange={(v) => setLista({ placaRadio: v / 1000 })} mostrar={(v) => `${(v / 10).toFixed(1)}%`} />
                      </>
                    )}
                    <button
                      onClick={() => setLista({ placa: true, x: 0.05, y: 0.1, w: 0.9, h: 0.8 })}
                      className={btn + ' w-full border border-line text-sub hover:text-ink'}
                    >
                      Cubrir todo el centro
                    </button>
                    <p className="text-[11px] leading-relaxed text-sub/70">
                      Útil cuando la plantilla ya trae nombres impresos: la placa los cubre y el listado nuevo se dibuja encima.
                    </p>
                  </Grupo>
                </>
              )}

              {tab === 'estilo' && tSel && sel && sel !== 'lista' && (
                <>
                  <Grupo titulo={sel === 'encabezado' ? 'Encabezado' : sel === 'titulo' ? 'Título' : 'Pie'}>
                    <textarea
                      value={tSel.texto}
                      onChange={(e) => setTexto(sel, { texto: e.target.value })}
                      rows={2}
                      className="w-full resize-y rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink"
                      placeholder="Escribí el texto"
                    />
                    <Interruptor label="Visible" valor={tSel.visible} onChange={(v) => setTexto(sel, { visible: v })} />
                  </Grupo>

                  <Grupo titulo="Tipografía">
                    <SelectorFuente valor={tSel.fuente} onChange={(v) => setTexto(sel, { fuente: v })} />
                    <Deslizador label="Tamaño" valor={Math.round(tSel.sizeRel * 1000)} min={10} max={200} onChange={(v) => setTexto(sel, { sizeRel: v / 1000 })} />
                    <Deslizador label="Interlineado" valor={tSel.interlineado} min={0.9} max={2} paso={0.05} onChange={(v) => setTexto(sel, { interlineado: v })} mostrar={(v) => v.toFixed(2)} />
                    <div className="flex gap-1.5">
                      <Segmento<AlignH>
                        valor={tSel.align}
                        onChange={(v) => setTexto(sel, { align: v })}
                        opciones={[
                          { v: 'left', icono: <AlignLeft size={13} aria-hidden />, title: 'Izquierda' },
                          { v: 'center', icono: <AlignCenter size={13} aria-hidden />, title: 'Centrado' },
                          { v: 'right', icono: <AlignRight size={13} aria-hidden />, title: 'Derecha' },
                        ]}
                      />
                      <Segmento<number> valor={tSel.mayus ? 1 : 0} onChange={(v) => setTexto(sel, { mayus: !!v })} opciones={[{ v: 0, label: 'Aa' }, { v: 1, label: 'AA' }]} />
                    </div>
                    <div className="flex gap-1.5">
                      <Segmento<number> valor={tSel.bold ? 1 : 0} onChange={(v) => setTexto(sel, { bold: !!v })} opciones={[{ v: 0, label: 'Normal' }, { v: 1, icono: <Bold size={13} aria-hidden />, title: 'Negrita' }]} />
                      <Segmento<number> valor={tSel.italic ? 1 : 0} onChange={(v) => setTexto(sel, { italic: !!v })} opciones={[{ v: 0, label: '—' }, { v: 1, icono: <Italic size={13} aria-hidden />, title: 'Cursiva' }]} />
                    </div>
                    <Interruptor label="Sombra" valor={tSel.sombra} onChange={(v) => setTexto(sel, { sombra: v })} />
                  </Grupo>

                  <Grupo titulo="Color">
                    <SelectorColor valor={tSel.color} onChange={(v) => setTexto(sel, { color: v })} />
                  </Grupo>

                  <Grupo titulo="Posición">
                    <Deslizador label="Ancho" valor={Math.round(tSel.w * 100)} min={10} max={100} onChange={(v) => setTexto(sel, { w: v / 100 })} mostrar={(v) => `${v}%`} />
                    <Deslizador label="Arriba" valor={Math.round(tSel.y * 1000)} min={-50} max={1000} onChange={(v) => setTexto(sel, { y: v / 1000 })} mostrar={(v) => `${(v / 10).toFixed(1)}%`} />
                    <button onClick={() => centrar(sel)} className={btn + ' w-full border border-line text-sub hover:text-ink'}>Centrar horizontal</button>
                  </Grupo>
                </>
              )}

              {tab === 'datos' && (
                <>
                  <Grupo titulo={`Cumpleañeros (${activas.length})`}>
                    <div className="space-y-1.5">
                      {filasEd.map((f) => (
                        <div key={f.id} className="flex items-center gap-1">
                          <button
                            onClick={() => setFilasEd((fs) => fs.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)))}
                            title={f.on ? 'Quitar del listado' : 'Incluir en el listado'}
                            className={'shrink-0 rounded-md border p-1 transition ' + (f.on ? 'border-emerald-600/40 bg-emerald-600/15 text-emerald-400' : 'border-line text-sub')}
                          >
                            {f.on ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
                          </button>
                          <input
                            value={f.nombre}
                            onChange={(e) => setFilasEd((fs) => fs.map((x) => (x.id === f.id ? { ...x, nombre: e.target.value } : x)))}
                            className={'min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-ink ' + (f.on ? '' : 'opacity-50')}
                          />
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={f.dia}
                            onChange={(e) => setFilasEd((fs) => fs.map((x) => (x.id === f.id ? { ...x, dia: Math.max(1, Math.min(31, Number(e.target.value) || 1)) } : x)))}
                            className="w-12 shrink-0 rounded-md border border-line bg-surface px-1 py-1 text-center text-[11px] text-ink"
                          />
                          <button
                            onClick={() => setFilasEd((fs) => fs.filter((x) => x.id !== f.id))}
                            className="shrink-0 rounded-md border border-line p-1 text-sub transition hover:border-brand-600/50 hover:text-brand-400"
                            title="Borrar"
                          >
                            <Trash2 size={12} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setFilasEd((fs) => [...fs, { id: `n${Date.now()}`, nombre: '', dia: 1, mes: filas[0]?.mes ?? 1, on: true }])}
                        className={btn + ' border border-line text-sub hover:text-ink'}
                      >
                        <Plus size={14} aria-hidden /> Agregar
                      </button>
                      <button
                        onClick={() => setFilasEd(filas.map((f, i) => ({ ...f, id: `f${i}`, on: true })))}
                        className={btn + ' border border-line text-sub hover:text-ink'}
                      >
                        <RotateCcw size={14} aria-hidden /> Restaurar
                      </button>
                    </div>
                  </Grupo>

                  <Grupo titulo="Vista previa del texto">
                    <ol className="max-h-56 space-y-0.5 overflow-y-auto text-[11px] leading-relaxed text-sub">
                      {items.map((it, i) => (
                        <li key={i} className="truncate">
                          {L.mayus ? it.nombre.toLocaleUpperCase('es') : it.nombre} <span className="text-brand-400">{it.fecha}</span>
                        </li>
                      ))}
                    </ol>
                  </Grupo>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
