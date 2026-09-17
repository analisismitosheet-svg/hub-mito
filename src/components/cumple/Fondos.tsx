// Fondos dibujados en canvas (sin depender de una imagen externa).
import { Fragment } from 'react'
import { Group, Rect, Ellipse, Line, Circle, Text } from 'react-konva'
import type { TipoFondo } from './tipos'

/** Random determinista: el mismo lienzo se dibuja siempre igual. */
function rnd(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const PASTEL = ['#f9a8d4', '#fcd34d', '#a7f3d0', '#bfdbfe', '#fdba74', '#ddd6fe']

function Globo({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  const sw = Math.max(1, r * 0.07)
  return (
    <Group listening={false}>
      <Line
        points={[x, y + r * 1.45, x + r * 0.4, y + r * 2.6, x - r * 0.25, y + r * 3.7, x + r * 0.15, y + r * 4.8]}
        stroke="#c7cad0"
        strokeWidth={sw}
        tension={0.5}
      />
      <Ellipse x={x} y={y} radiusX={r} radiusY={r * 1.22} fill={color} />
      <Line points={[x - r * 0.18, y + r * 1.16, x + r * 0.18, y + r * 1.16, x, y + r * 1.5]} closed fill={color} />
      <Ellipse x={x - r * 0.34} y={y - r * 0.42} radiusX={r * 0.16} radiusY={r * 0.3} fill="rgba(255,255,255,0.5)" rotation={-18} />
    </Group>
  )
}

function Guirnalda({
  x1, y1, x2, y2, caida, tam, seed,
}: { x1: number; y1: number; x2: number; y2: number; caida: number; tam: number; seed: number }) {
  const cx = (x1 + x2) / 2
  const cy = (y1 + y2) / 2 + caida
  const N = 9
  const pts: number[] = []
  const nodos: { x: number; y: number }[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const u = 1 - t
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2
    pts.push(x, y)
    nodos.push({ x, y })
  }
  const r = rnd(seed)
  return (
    <Group listening={false}>
      <Line points={pts} stroke="#d4d7dd" strokeWidth={Math.max(1, tam * 0.08)} />
      {nodos.slice(0, -1).map((n, i) => {
        const sig = nodos[i + 1]
        const mx = (n.x + sig.x) / 2
        const my = (n.y + sig.y) / 2
        const color = PASTEL[Math.floor(r() * PASTEL.length)]
        return (
          <Line
            key={`b-${i}`}
            points={[mx - tam * 0.45, my, mx + tam * 0.45, my, mx, my + tam * 1.25]}
            closed
            fill={color}
          />
        )
      })}
    </Group>
  )
}

function Marca({ w, h }: { w: number; h: number }) {
  const s = Math.min(w, h)
  const fs = s * 0.026
  const padX = fs * 0.7
  const padY = fs * 0.45
  const anchoA = fs * 9.2
  const anchoB = fs * 10.4
  return (
    <Group listening={false}>
      <Group x={w * 0.33} y={h * 0.03}>
        <Rect width={anchoA} height={fs + padY * 2} fill="#e11d2e" />
        <Text
          text="COMUNICÁNDONOS"
          x={padX}
          y={padY}
          fontFamily="Anton"
          fontSize={fs}
          fill="#ffffff"
          letterSpacing={fs * 0.06}
        />
        <Rect x={anchoA * 0.28} y={fs + padY * 2 + fs * 0.35} width={anchoB} height={fs + padY * 2} fill="#111111" />
        <Text
          text="RECURSOS HUMANOS"
          x={anchoA * 0.28 + padX}
          y={fs + padY * 3 + fs * 0.35}
          fontFamily="Anton"
          fontSize={fs}
          fill="#ffffff"
          letterSpacing={fs * 0.06}
        />
      </Group>
      <Text text="📣" x={w * 0.25} y={h * 0.035} fontSize={s * 0.07} />
    </Group>
  )
}

export default function Fondo({
  tipo, w, h, marca,
}: { tipo: TipoFondo; w: number; h: number; marca: boolean }) {
  const s = Math.min(w, h)

  if (tipo === 'globos') {
    const r = rnd(7)
    const rad = s * 0.042
    const izq = [0.075, 0.075, 0.1, 0.06]
    const der = [0.925, 0.925, 0.9, 0.94]
    const ys = [0.3, 0.48, 0.66, 0.83]
    return (
      <Group listening={false}>
        <Rect width={w} height={h} fill="#ffffff" />
        <Guirnalda x1={w * 0.02} y1={h * 0.06} x2={w * 0.23} y2={h * 0.025} caida={h * 0.055} tam={s * 0.033} seed={11} />
        <Guirnalda x1={w * 0.77} y1={h * 0.025} x2={w * 0.98} y2={h * 0.06} caida={h * 0.055} tam={s * 0.033} seed={23} />
        {ys.map((y, i) => (
          <Fragment key={`g-${i}`}>
            <Globo x={w * izq[i]} y={h * y} r={rad * (0.85 + r() * 0.35)} color={PASTEL[Math.floor(r() * PASTEL.length)]} />
            <Globo x={w * der[i]} y={h * (y + 0.04)} r={rad * (0.85 + r() * 0.35)} color={PASTEL[Math.floor(r() * PASTEL.length)]} />
          </Fragment>
        ))}
        {marca && <Marca w={w} h={h} />}
      </Group>
    )
  }

  if (tipo === 'confeti') {
    const r = rnd(42)
    const piezas = Array.from({ length: 90 }, () => ({
      x: r() * w,
      y: r() * h,
      a: r() * 360,
      c: PASTEL[Math.floor(r() * PASTEL.length)],
      l: s * (0.008 + r() * 0.012),
    }))
    return (
      <Group listening={false}>
        <Rect
          width={w}
          height={h}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: w, y: h }}
          fillLinearGradientColorStops={[0, '#fde4f2', 0.55, '#ede9fe', 1, '#dbeafe']}
        />
        {piezas.map((p, i) => (
          <Rect key={`c-${i}`} x={p.x} y={p.y} width={p.l * 2.4} height={p.l} fill={p.c} rotation={p.a} opacity={0.85} cornerRadius={p.l * 0.4} />
        ))}
        <Rect
          x={w * 0.055}
          y={h * 0.055}
          width={w * 0.89}
          height={h * 0.89}
          fill="#ffffff"
          opacity={0.94}
          cornerRadius={s * 0.035}
          shadowColor="#5b21b6"
          shadowOpacity={0.18}
          shadowBlur={s * 0.05}
          shadowOffsetY={s * 0.012}
        />
        {marca && <Marca w={w} h={h} />}
      </Group>
    )
  }

  if (tipo === 'oscuro') {
    const r = rnd(99)
    return (
      <Group listening={false}>
        <Rect width={w} height={h} fill="#0b0b0d" />
        <Circle
          x={w * 0.15}
          y={h * 0.12}
          radius={s * 0.55}
          fillRadialGradientStartPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndRadius={s * 0.55}
          fillRadialGradientColorStops={[0, 'rgba(225,29,46,0.4)', 1, 'rgba(225,29,46,0)']}
        />
        <Circle
          x={w * 0.88}
          y={h * 0.92}
          radius={s * 0.5}
          fillRadialGradientStartPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndRadius={s * 0.5}
          fillRadialGradientColorStops={[0, 'rgba(249,115,22,0.28)', 1, 'rgba(249,115,22,0)']}
        />
        {Array.from({ length: 40 }, (_, i) => (
          <Circle key={`s-${i}`} x={r() * w} y={r() * h} radius={s * (0.0015 + r() * 0.003)} fill="#ffffff" opacity={0.25 + r() * 0.5} />
        ))}
        <Rect x={s * 0.03} y={s * 0.03} width={w - s * 0.06} height={h - s * 0.06} stroke="rgba(225,29,46,0.55)" strokeWidth={Math.max(1, s * 0.004)} cornerRadius={s * 0.02} />
      </Group>
    )
  }

  // blanco
  return (
    <Group listening={false}>
      <Rect width={w} height={h} fill="#ffffff" />
      <Rect width={w} height={h * 0.022} fill="#e11d2e" />
      <Rect y={h - h * 0.022} width={w} height={h * 0.022} fill="#111111" />
      {marca && <Marca w={w} h={h} />}
    </Group>
  )
}
