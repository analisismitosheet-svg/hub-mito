import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, RefreshCw, Save, Undo2, Trash2, ArrowLeftRight, CheckCircle2, AlertTriangle, Crosshair } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

/**
 * Editor de calibración de una cámara del contador (IA Cámaras → Calibrar).
 * Se dibuja sobre una foto LIMPIA que da la PC del local por la VPN
 * (contador-camaras/vista.py, /foto?limpia=1). Al guardar va a
 * contador_config; la PC la recibe con su próximo envío y la aplica sin reiniciar.
 * Coordenadas normalizadas 0..1 (las mismas que usa contador.py / calibrar.py).
 */

type Punto = [number, number]
type Capa = 'zona_exterior' | 'zona_interior' | 'zona_a' | 'zona_b' | 'linea'
type Herramienta = Capa | 'credencial'

interface Empleados { activo: boolean; hsv_min: number[]; hsv_max: number[]; frac_min?: number }
interface Calibracion {
  modo: 'zonas' | 'linea' | null
  zona_exterior: Punto[] | null
  zona_interior: Punto[] | null
  zona_a: Punto[] | null
  zona_b: Punto[] | null
  linea: Punto[] | null
  invertir: boolean
  punto: 'pie' | 'centro'
  empleados: Empleados | null
}
interface CamEstado { nombre: string; ok: boolean; error: string | null; foto_url?: string | null; calibracion?: Partial<Calibracion>; config_version?: string | null }

const CAPAS: { id: Capa; label: string; color: string; ayuda: string }[] = [
  { id: 'zona_exterior', label: 'Afuera (roja)', color: '#ef4444', ayuda: 'Pasillo / vereda justo antes de la puerta.' },
  { id: 'zona_interior', label: 'Adentro (azul)', color: '#3b82f6', ayuda: 'Piso del local pasando la puerta. Dejá una franja libre entre las dos zonas (la puerta).' },
  { id: 'zona_a', label: 'Transeúntes A', color: '#f59e0b', ayuda: 'Vereda/pasillo, de un lado de la puerta.' },
  { id: 'zona_b', label: 'Transeúntes B', color: '#22d3ee', ayuda: 'Vereda/pasillo, del otro lado de la puerta.' },
  { id: 'linea', label: 'Línea', color: '#facc15', ayuda: 'Dos clics sobre el piso, de un marco de la puerta al otro. La flecha verde apunta hacia ADENTRO.' },
]
const VACIA: Calibracion = {
  modo: 'zonas', zona_exterior: null, zona_interior: null, zona_a: null, zona_b: null, linea: null,
  invertir: false, punto: 'pie', empleados: null,
}

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/** RGB -> HSV con la misma escala que OpenCV (H 0-179, S y V 0-255). */
function hsvOpenCv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return [Math.round(h / 2), max ? Math.round((255 * d) / max) : 0, max]
}

const percentil = (v: number[], p: number) => {
  const o = [...v].sort((a, b) => a - b)
  return o[Math.min(o.length - 1, Math.max(0, Math.round((p / 100) * (o.length - 1))))]
}

export default function CalibrarCamara() {
  const [params] = useSearchParams()
  const dispId = params.get('disp') ?? ''
  const camNombre = params.get('cam') ?? ''

  const [local, setLocal] = useState('')
  const [cam, setCam] = useState<CamEstado | null>(null)
  const [cal, setCal] = useState<Calibracion>(VACIA)
  const [historial, setHistorial] = useState<Calibracion[]>([])
  const [herr, setHerr] = useState<Herramienta>('zona_exterior')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [foto, setFoto] = useState<{ n: number; estado: 'cargando' | 'ok' | 'error' }>({ n: 0, estado: 'cargando' })
  const [tam, setTam] = useState<{ w: number; h: number }>({ w: 1280, h: 720 })
  const [guardado, setGuardado] = useState<{ version: string; aplicado: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const arrastre = useRef<{ capa: Capa; i: number } | null>(null)
  const rect = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [rectVis, setRectVis] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const leerDispositivo = useCallback(async () => {
    const { data, error: err } = await sb().from('contador_dispositivos').select('local,estado').eq('id', dispId).maybeSingle()
    if (err || !data) throw new Error(err?.message ?? 'No se encontró la PC contadora.')
    const c = ((data.estado as { camaras?: CamEstado[] } | null)?.camaras ?? []).find((x) => x.nombre === camNombre) ?? null
    return { local: data.local as string, cam: c }
  }, [dispId, camNombre])

  useEffect(() => {
    void (async () => {
      try {
        const [{ local: l, cam: c }, guardada] = await Promise.all([
          leerDispositivo(),
          sb().from('contador_config').select('config').eq('dispositivo_id', dispId).eq('camara', camNombre).maybeSingle(),
        ])
        setLocal(l)
        setCam(c)
        const base = (guardada.data?.config as Partial<Calibracion> | undefined) ?? c?.calibracion ?? {}
        setCal({ ...VACIA, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) } as Calibracion)
        if (!c) setError('Esta cámara todavía no informó al hub. Revisá que el contador esté corriendo en la PC del local.')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setCargando(false)
      }
    })()
  }, [leerDispositivo, dispId, camNombre])

  // Después de guardar: esperar a que la PC informe que aplicó esta versión
  useEffect(() => {
    if (!guardado || guardado.aplicado) return
    const t = setInterval(async () => {
      try {
        const { cam: c } = await leerDispositivo()
        if (c?.config_version && new Date(c.config_version).getTime() === new Date(guardado.version).getTime()) {
          setGuardado({ ...guardado, aplicado: true })
        }
      } catch { /* reintenta */ }
    }, 5000)
    return () => clearInterval(t)
  }, [guardado, leerDispositivo])

  const cambiar = (nueva: Calibracion) => {
    setHistorial((h) => [...h.slice(-40), cal])
    setCal(nueva)
    setGuardado(null)
  }
  const deshacer = () => setHistorial((h) => {
    if (!h.length) return h
    setCal(h[h.length - 1])
    return h.slice(0, -1)
  })

  const coords = (e: { clientX: number; clientY: number }): Punto => {
    const r = svg.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]
  }

  const alPresionar = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = coords(e)
    if (herr === 'credencial') {
      rect.current = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }
      setRectVis(rect.current)
      svg.current?.setPointerCapture(e.pointerId)
      return
    }
    const actual = cal[herr] ?? []
    const nuevos = herr === 'linea' && actual.length >= 2 ? [p] : [...actual, p]
    cambiar({ ...cal, [herr]: nuevos, modo: herr === 'linea' ? 'linea' : herr === 'zona_exterior' || herr === 'zona_interior' ? 'zonas' : cal.modo })
  }
  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = coords(e)
    if (arrastre.current) {
      const { capa, i } = arrastre.current
      setCal((c) => ({ ...c, [capa]: (c[capa] ?? []).map((q, k) => (k === i ? p : q)) }))
    } else if (rect.current) {
      rect.current = { ...rect.current, x1: p[0], y1: p[1] }
      setRectVis(rect.current)
    }
  }
  const alSoltar = () => {
    if (arrastre.current) {
      arrastre.current = null
      setGuardado(null)
    }
    if (rect.current) {
      medirCredencial(rect.current)
      rect.current = null
      setRectVis(null)
    }
  }

  const medirCredencial = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const el = img.current
    if (!el || !el.naturalWidth) return
    const x = Math.round(Math.min(r.x0, r.x1) * el.naturalWidth), y = Math.round(Math.min(r.y0, r.y1) * el.naturalHeight)
    const w = Math.round(Math.abs(r.x1 - r.x0) * el.naturalWidth), h = Math.round(Math.abs(r.y1 - r.y0) * el.naturalHeight)
    if (w < 3 || h < 3) return
    try {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d')!
      ctx.drawImage(el, x, y, w, h, 0, 0, w, h)
      const px = ctx.getImageData(0, 0, w, h).data
      const H: number[] = [], S: number[] = [], V: number[] = []
      for (let i = 0; i < px.length; i += 4) {
        const [hh, ss, vv] = hsvOpenCv(px[i], px[i + 1], px[i + 2])
        H.push(hh); S.push(ss); V.push(vv)
      }
      const lim = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)))
      cambiar({
        ...cal,
        empleados: {
          activo: true,
          hsv_min: [lim(percentil(H, 5) - 8, 179), lim(percentil(S, 5) - 40, 255), lim(percentil(V, 5) - 40, 255)],
          hsv_max: [lim(percentil(H, 95) + 8, 179), lim(percentil(S, 95) + 40, 255), lim(percentil(V, 95) + 40, 255)],
          frac_min: cal.empleados?.frac_min ?? 0.04,
        },
      })
    } catch {
      setError('No se pudo leer el color de la foto (la PC tiene que tener el contador actualizado).')
    }
  }

  const problemas = useMemo(() => {
    const p: string[] = []
    if (cal.modo === 'linea' && (cal.linea?.length ?? 0) !== 2) p.push('La línea necesita exactamente 2 puntos.')
    if (cal.modo !== 'linea') {
      if ((cal.zona_exterior?.length ?? 0) < 3) p.push('La zona de afuera (roja) necesita 3 puntos o más.')
      if ((cal.zona_interior?.length ?? 0) < 3) p.push('La zona de adentro (azul) necesita 3 puntos o más.')
    }
    const a = cal.zona_a?.length ?? 0, b = cal.zona_b?.length ?? 0
    if ((a > 0 && a < 3) || (b > 0 && b < 3)) p.push('Las zonas de transeúntes necesitan 3 puntos o más (o borralas).')
    if ((a >= 3) !== (b >= 3)) p.push('Para contar transeúntes hacen falta las dos zonas, A y B.')
    return p
  }, [cal])

  const guardar = async () => {
    if (problemas.length) return
    setGuardando(true)
    setError(null)
    const limpio = (v: Punto[] | null) => (v && v.length ? v : null)
    const config: Calibracion = {
      ...cal, modo: cal.modo ?? 'zonas',
      zona_exterior: limpio(cal.zona_exterior), zona_interior: limpio(cal.zona_interior),
      zona_a: limpio(cal.zona_a), zona_b: limpio(cal.zona_b), linea: limpio(cal.linea),
    }
    const { data, error: err } = await sb().from('contador_config')
      .upsert({ dispositivo_id: dispId, camara: camNombre, config, actualizado: new Date().toISOString() }, { onConflict: 'dispositivo_id,camara' })
      .select('actualizado').single()
    setGuardando(false)
    if (err) return setError(err.message)
    setGuardado({ version: data.actualizado as string, aplicado: false })
  }

  const W = tam.w, H = tam.h
  const flecha = useMemo(() => {
    if (cal.linea?.length !== 2) return null
    const [[ax, ay], [bx, by]] = cal.linea
    const dx = (bx - ax) * W, dy = (by - ay) * H
    const largo = Math.hypot(dx, dy) || 1
    let nx = -dy / largo, ny = dx / largo
    if (cal.invertir) { nx = -nx; ny = -ny }
    const mx = ((ax + bx) / 2) * W, my = ((ay + by) / 2) * H, k = Math.min(W, H) * 0.08
    return { x1: mx - nx * k * 0.6, y1: my - ny * k * 0.6, x2: mx + nx * k, y2: my + ny * k }
  }, [cal.linea, cal.invertir, W, H])

  const fotoUrl = cam?.foto_url ? `${cam.foto_url}&r=${foto.n}` : null
  const btn = 'btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50'
  const capasVisibles = CAPAS.filter((c) => (cal.modo === 'linea' ? c.id !== 'zona_exterior' && c.id !== 'zona_interior' : c.id !== 'linea'))

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Crosshair size={22} className="text-cyan-500" aria-hidden /> Calibrar cámara
        </h1>
        <span className="text-sm text-sub">{local} · {camNombre}</span>
        <Link to="/ia-camaras?tab=pcs" className="ml-auto text-xs text-brand-400 hover:underline">Volver a PCs y cámaras</Link>
      </header>

      {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
          {/* Foto + dibujo */}
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {(['zonas', 'linea'] as const).map((m) => (
                <button key={m} onClick={() => { cambiar({ ...cal, modo: m }); setHerr(m === 'linea' ? 'linea' : 'zona_exterior') }}
                  className={'h-8 rounded-lg px-3 text-xs font-medium ' + (cal.modo === m ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub')}>
                  {m === 'zonas' ? 'Contar por zonas' : 'Contar por línea'}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-line" />
              <button onClick={deshacer} disabled={!historial.length} className={btn}><Undo2 size={13} aria-hidden /> Deshacer</button>
              {herr !== 'credencial' && (
                <button onClick={() => cambiar({ ...cal, [herr]: null })} className={btn}><Trash2 size={13} aria-hidden /> Borrar {CAPAS.find((c) => c.id === herr)?.label}</button>
              )}
              {cal.modo === 'linea' && (
                <button onClick={() => cambiar({ ...cal, invertir: !cal.invertir })} className={btn}><ArrowLeftRight size={13} aria-hidden /> Invertir flecha</button>
              )}
              <button onClick={() => setFoto({ n: foto.n + 1, estado: 'cargando' })} className={btn + ' ml-auto'}><RefreshCw size={13} aria-hidden /> Otra foto</button>
            </div>

            {!fotoUrl ? (
              <div className="flex aspect-video items-center justify-center rounded-xl bg-black/40 p-4 text-center text-sm text-sub">
                {!cam ? 'La cámara no informó al hub todavía.' : 'Esta PC no publica la foto (actualizá el contador y corré publicar_vista.bat).'}
              </div>
            ) : (
              <div className="relative select-none overflow-hidden rounded-xl bg-black">
                <img ref={img} src={fotoUrl} crossOrigin="anonymous" alt="Foto de la cámara para calibrar" className="block w-full"
                  onLoad={(e) => { setTam({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setFoto((f) => ({ ...f, estado: 'ok' })) }}
                  onError={() => setFoto((f) => ({ ...f, estado: 'error' }))} />
                {foto.estado !== 'ok' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center text-sm text-white/80">
                    {foto.estado === 'cargando' ? <><Loader2 size={22} className="animate-spin" aria-hidden /> Pidiendo una foto a la cámara…</> : (
                      <>
                        <AlertTriangle size={22} aria-hidden />
                        {cam && !cam.ok ? `La cámara no responde: ${cam.error ?? 'sin imagen'}.` : 'No se pudo traer la foto. Este equipo tiene que estar conectado a la VPN (Tailscale).'}
                        <button onClick={() => setFoto({ n: foto.n + 1, estado: 'cargando' })} className="rounded-lg border border-white/30 px-2 py-1 text-xs">Reintentar</button>
                      </>
                    )}
                  </div>
                )}
                {foto.estado === 'ok' && (
                  <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={'absolute inset-0 h-full w-full ' + (herr === 'credencial' ? 'cursor-crosshair' : 'cursor-copy')}
                    onPointerDown={alPresionar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerLeave={alSoltar}
                    onContextMenu={(e) => e.preventDefault()}>
                    {CAPAS.map((c) => {
                      const pts = cal[c.id] ?? []
                      if (!pts.length || (cal.modo === 'linea' && (c.id === 'zona_exterior' || c.id === 'zona_interior')) || (cal.modo !== 'linea' && c.id === 'linea')) return null
                      const pix = pts.map(([x, y]) => `${x * W},${y * H}`).join(' ')
                      const activa = herr === c.id
                      return (
                        <g key={c.id}>
                          {c.id === 'linea' || pts.length < 3
                            ? <polyline points={pix} fill="none" stroke={c.color} strokeWidth={activa ? 4 : 2.5} vectorEffect="non-scaling-stroke" />
                            : <polygon points={pix} fill={c.color} fillOpacity={activa ? 0.22 : 0.12} stroke={c.color} strokeWidth={activa ? 3 : 2} vectorEffect="non-scaling-stroke" />}
                          {pts.map(([x, y], i) => (
                            <circle key={i} cx={x * W} cy={y * H} r={Math.max(W, H) * 0.007} fill={c.color} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke"
                              className={activa ? 'cursor-move' : ''}
                              onPointerDown={(e) => {
                                if (!activa) return
                                e.stopPropagation()
                                if (e.button === 2) { cambiar({ ...cal, [c.id]: pts.filter((_, k) => k !== i) }); return }
                                setHistorial((h) => [...h.slice(-40), cal])
                                arrastre.current = { capa: c.id, i }
                                svg.current?.setPointerCapture(e.pointerId)
                              }} />
                          ))}
                        </g>
                      )
                    })}
                    {cal.modo === 'linea' && flecha && (
                      <line x1={flecha.x1} y1={flecha.y1} x2={flecha.x2} y2={flecha.y2} stroke="#22c55e" strokeWidth={5} markerEnd="url(#punta)" vectorEffect="non-scaling-stroke" />
                    )}
                    <defs>
                      <marker id="punta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
                      </marker>
                    </defs>
                    {rectVis && (
                      <rect x={Math.min(rectVis.x0, rectVis.x1) * W} y={Math.min(rectVis.y0, rectVis.y1) * H}
                        width={Math.abs(rectVis.x1 - rectVis.x0) * W} height={Math.abs(rectVis.y1 - rectVis.y0) * H}
                        fill="none" stroke="#d946ef" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                    )}
                  </svg>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] text-sub/70">
              Clic: agregar punto · arrastrar un punto: moverlo · clic derecho sobre un punto: borrarlo. Las zonas se dibujan en el PISO (se cuenta por los pies).
            </p>
          </div>

          {/* Panel */}
          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/70">Qué dibujar</div>
              <div className="flex flex-col gap-1.5">
                {capasVisibles.map((c) => (
                  <button key={c.id} onClick={() => setHerr(c.id)}
                    className={'flex items-start gap-2 rounded-xl border p-2 text-left text-xs ' + (herr === c.id ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface2/60')}>
                    <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />
                    <span>
                      <span className="font-semibold text-ink">{c.label}</span> <span className="text-sub">({cal[c.id]?.length ?? 0} puntos)</span>
                      <span className="block text-sub/80">{c.ayuda}</span>
                    </span>
                  </button>
                ))}
                <button onClick={() => setHerr('credencial')}
                  className={'flex items-start gap-2 rounded-xl border p-2 text-left text-xs ' + (herr === 'credencial' ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface2/60')}>
                  <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm bg-fuchsia-500" />
                  <span>
                    <span className="font-semibold text-ink">Credencial del personal</span>
                    <span className="block text-sub/80">Arrastrá un recuadro SOLO sobre la credencial/cordón de un empleado. El personal no suma entradas.</span>
                  </span>
                </button>
                {cal.empleados?.activo && (
                  <div className="flex items-center gap-2 rounded-xl border border-line p-2 text-[11px] text-sub">
                    HSV {cal.empleados.hsv_min.join(',')} → {cal.empleados.hsv_max.join(',')}
                    <button onClick={() => cambiar({ ...cal, empleados: null })} className="ml-auto text-brand-400 hover:underline">Quitar</button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-3 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span className="text-sub">Contar por</span>
                <select value={cal.punto} onChange={(e) => cambiar({ ...cal, punto: e.target.value as Calibracion['punto'] })}
                  className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
                  <option value="pie">los pies (cámara en diagonal)</option>
                  <option value="centro">el centro del cuerpo (cámara desde arriba)</option>
                </select>
              </label>
            </div>

            {problemas.length > 0 && (
              <ul className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                {problemas.map((p) => <li key={p}>• {p}</li>)}
              </ul>
            )}

            <button onClick={() => void guardar()} disabled={guardando || problemas.length > 0 || !cam}
              className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white disabled:opacity-50">
              {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />} Guardar y aplicar
            </button>
            {guardado && (
              <p className={'flex items-center gap-2 rounded-xl border p-3 text-xs ' + (guardado.aplicado ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-line bg-surface2 text-sub')}>
                {guardado.aplicado
                  ? <><CheckCircle2 size={15} aria-hidden /> La PC del local ya está contando con esta calibración.</>
                  : <><Loader2 size={15} className="animate-spin" aria-hidden /> Guardado. Esperando que la PC del local lo aplique (menos de 1 minuto)…</>}
              </p>
            )}
            {guardado?.aplicado && (
              <Link to={`/tasa-conversion?local=${encodeURIComponent(local)}`} className="text-center text-xs text-brand-400 hover:underline">
                Ver el conteo en vivo con las zonas nuevas
              </Link>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
