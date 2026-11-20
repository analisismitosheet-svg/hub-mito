import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CORTO, suma, type Fila } from '@/lib/reparto'

/**
 * Grilla del Reparto manual: edición tipo Excel (tipear el número, flechas / Enter / Tab,
 * Shift+flechas = rango, arrastrar con el mouse, Ctrl+C / Ctrl+V con columnas de Excel, Supr,
 * Ctrl+Z / Ctrl+Y), scroll virtual (solo dibuja las filas que se ven) y sin scroll horizontal:
 * la tabla ocupa el ancho y los locales se reparten parejo.
 *
 * Marcas: relleno rojo = vendió en el período · 🚚N = le llegan N en tránsito (en 0: no es hueco) ·
 * violeta + «+1»/«−2» = celda cambiada (recibe / dona) · amarillo/rosa en la línea del mouse =
 * a la Master / Mercedes todavía le falta pasar por ese local hoy · semáforo de días sin venta.
 */

export interface Cambio { fila: Fila; i: number; antes: number; despues: number }
export interface MarcaRuta { vehiculo: string; clase: 'm1' | 'm2'; hora: string | null }
export interface Semaforo { on: boolean; verde: number; amarillo: number; colores: { v: boolean; a: boolean; r: boolean } }

const ALTO = 26
const NCOLS_FIJAS = 4

export default function GrillaReparto({
  filas,
  locales,
  resumen,
  version,
  onCambios,
  onDeshacer,
  onRehacer,
  faltaPasar,
  semaforo,
  artSel,
  onElegirArt,
  onGrafico,
  completa,
}: {
  filas: Fila[]
  locales: string[]
  resumen: { posturas: number[]; ideal: number[]; dif: number[] }
  version: number
  onCambios: (c: Cambio[]) => void
  onDeshacer: () => void
  onRehacer: () => void
  faltaPasar: Record<string, MarcaRuta[]> | null
  semaforo: Semaforo
  artSel: { art: string; col: string } | null
  onElegirArt: (art: string, col: string) => void
  onGrafico: (art: string, col: string) => void
  completa: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [alto, setAlto] = useState(600)
  const [activa, setActiva] = useState<{ r: number; s: number } | null>(null)
  const [ancla, setAncla] = useState<{ r: number; s: number } | null>(null)
  const [sel, setSel] = useState<{ r1: number; r2: number; c1: number; c2: number } | null>(null)
  const [buffer, setBufferEstado] = useState('')
  // El número que se está tipeando también en una ref: si las teclas llegan seguidas (tipeo rápido)
  // Enter tiene que ver lo último, no lo del render anterior.
  const bufRef = useRef('')
  const activaRef = useRef<{ r: number; s: number } | null>(null)
  const setBuffer = (v: string | ((b: string) => string)) => {
    bufRef.current = typeof v === 'function' ? v(bufRef.current) : v
    setBufferEstado(bufRef.current)
  }
  const [hover, setHover] = useState(false)
  const arrastrando = useRef(false)
  const nL = locales.length

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const medir = () => setAlto(el.clientHeight || 600)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [completa])

  // Al cambiar las filas visibles (filtro/orden) se vuelve arriba
  useEffect(() => {
    if (wrap.current) wrap.current.scrollTop = 0
    setScroll(0)
  }, [filas])

  const desde = Math.max(0, Math.floor(scroll / ALTO) - 12)
  const hasta = Math.min(filas.length, Math.ceil((scroll + alto) / ALTO) + 12)

  const enSel = (r: number, s: number) => !!sel && r >= sel.r1 && r <= sel.r2 && s >= sel.c1 && s <= sel.c2
  const norm = (a: { r: number; s: number }, b: { r: number; s: number }) => ({
    r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.s, b.s), c2: Math.max(a.s, b.s),
  })

  const enfocar = useCallback(
    (r: number, s: number, extender = false) => {
      if (r < 0 || r >= filas.length || s < 0 || s >= nL) return
      activaRef.current = { r, s }
      setActiva({ r, s })
      if (extender && ancla) setSel(norm(ancla, { r, s }))
      else {
        setAncla({ r, s })
        setSel({ r1: r, r2: r, c1: s, c2: s })
      }
      // que la celda quede a la vista
      const el = wrap.current
      if (el) {
        const thead = el.querySelector('thead') as HTMLElement | null
        const th = thead?.offsetHeight ?? 110
        const top = r * ALTO
        if (el.scrollTop > top) el.scrollTop = top
        else if (el.scrollTop < th + (r + 1) * ALTO - el.clientHeight) el.scrollTop = th + (r + 1) * ALTO - el.clientHeight
      }
      requestAnimationFrame(() => {
        const td = el?.querySelector(`td[data-r="${r}"][data-s="${s}"]`) as HTMLElement | null
        td?.focus({ preventScroll: true })
      })
    },
    [filas.length, nL, ancla],
  )

  const fijar = (r: number, s: number, valor: number, acc: Cambio[]) => {
    const f = filas[r]
    if (!f) return
    const n = Math.max(0, Math.round(Number(valor) || 0))
    if (n === f.cur[s]) return
    acc.push({ fila: f, i: s, antes: f.cur[s], despues: n })
  }
  const confirmarBuffer = () => {
    const a = activaRef.current
    if (!a || bufRef.current === '') return
    const acc: Cambio[] = []
    fijar(a.r, a.s, Number(bufRef.current), acc)
    setBuffer('')
    if (acc.length) onCambios(acc)
  }

  function teclado(e: React.KeyboardEvent) {
    const act = activaRef.current
    if (!act) return
    const { r, s } = act
    const k = e.key
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(k)) {
      e.preventDefault()
      confirmarBuffer()
      if (k.toLowerCase() === 'y' || e.shiftKey) onRehacer()
      else onDeshacer()
      return
    }
    if (e.ctrlKey || e.metaKey) return // copiar / pegar van por los eventos nativos
    if (/^[0-9]$/.test(k)) {
      e.preventDefault()
      setAncla({ r, s })
      setSel({ r1: r, r2: r, c1: s, c2: s })
      setBuffer((b) => (b + k).slice(0, 4))
      return
    }
    if (k === 'Backspace') {
      e.preventDefault()
      setBuffer((b) => b.slice(0, -1))
      return
    }
    if (k === 'Escape') {
      setBuffer('')
      return
    }
    if (k === 'Delete') {
      e.preventDefault()
      if (!sel) return
      const acc: Cambio[] = []
      for (let a = sel.r1; a <= sel.r2; a++) for (let b = sel.c1; b <= sel.c2; b++) fijar(a, b, 0, acc)
      if (acc.length) onCambios(acc)
      return
    }
    const mov: Record<string, [number, number]> = {
      ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], Tab: [0, e.shiftKey ? -1 : 1],
    }
    if (mov[k]) {
      e.preventDefault()
      confirmarBuffer()
      enfocar(r + mov[k][0], s + mov[k][1], e.shiftKey && k.startsWith('Arrow'))
    }
  }

  // Copiar / pegar como Excel (texto con \t y \n)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const copiar = (e: ClipboardEvent) => {
      if (!sel || !el.contains(document.activeElement)) return
      const lineas: string[] = []
      for (let a = sel.r1; a <= sel.r2; a++) {
        const cols: number[] = []
        for (let b = sel.c1; b <= sel.c2; b++) cols.push(filas[a]?.cur[b] ?? 0)
        lineas.push(cols.join('\t'))
      }
      e.clipboardData?.setData('text/plain', lineas.join('\n'))
      e.preventDefault()
    }
    const pegar = (e: ClipboardEvent) => {
      if (!activa || !el.contains(document.activeElement)) return
      const texto = e.clipboardData?.getData('text') ?? ''
      const grid = texto.replace(/\r/g, '').split('\n').filter((l) => l !== '').map((l) => l.split('\t'))
      if (!grid.length) return
      e.preventDefault()
      const gw = Math.max(...grid.map((x) => x.length))
      const multi = !!sel && (sel.r2 > sel.r1 || sel.c2 > sel.c1)
      const R1 = multi ? sel!.r1 : activa.r, C1 = multi ? sel!.c1 : activa.s
      const R2 = multi ? sel!.r2 : R1 + grid.length - 1, C2 = multi ? sel!.c2 : C1 + gw - 1
      const acc: Cambio[] = []
      for (let a = R1; a <= R2 && a < filas.length; a++)
        for (let b = C1; b <= C2 && b < nL; b++) {
          const v = grid[(a - R1) % grid.length][(b - C1) % gw]
          if (v === undefined || v.trim() === '') continue
          fijar(a, b, Number(v), acc)
        }
      if (acc.length) onCambios(acc)
    }
    document.addEventListener('copy', copiar)
    document.addEventListener('paste', pegar)
    return () => {
      document.removeEventListener('copy', copiar)
      document.removeEventListener('paste', pegar)
    }
  })

  useEffect(() => {
    const fin = () => (arrastrando.current = false)
    document.addEventListener('mouseup', fin)
    return () => document.removeEventListener('mouseup', fin)
  }, [])

  const semClase = (f: Fila, s: number) => {
    if (!semaforo.on || !(f.cur[s] || f.base[s])) return ''
    const d = f.ult[s]
    const k = d == null || d > semaforo.amarillo ? 'r' : d > semaforo.verde ? 'a' : 'v'
    return semaforo.colores[k] ? ` rp-s-${k}` : ''
  }
  const rutaClase = (s: number) => (faltaPasar?.[locales[s]] ?? []).map((m) => ` rp-${m.clase}`).join('')
  const rutaTip = (s: number) => (faltaPasar?.[locales[s]] ?? []).map((m) => `${m.vehiculo} le falta pasar${m.hora ? ` (límite ${m.hora})` : ''}`)

  // Fondo alternado por artículo + color (como una tabla de Excel con bandas): cambia cada vez
  // que termina un artículo-color y empieza otro. Se calcula sobre todas las filas para que no
  // salte al hacer scroll (la grilla solo dibuja las visibles).
  const banda = useMemo(() => {
    const b = new Uint8Array(filas.length)
    let g = 0
    for (let i = 1; i < filas.length; i++) {
      if (filas[i].articulo !== filas[i - 1].articulo || filas[i].color !== filas[i - 1].color) g ^= 1
      b[i] = g
    }
    return b
  }, [filas])

  const filasHtml = useMemo(() => {
    const out: JSX.Element[] = []
    for (let ri = desde; ri < hasta; ri++) {
      const f = filas[ri]
      const prev = filas[ri - 1]
      const nuevoGrupo = ri > 0 && prev && `${prev.articulo}|${prev.color}` !== `${f.articulo}|${f.color}`
      const elegido = artSel && f.articulo === artSel.art && f.color === artSel.col
      const rem = suma(f.base) - suma(f.cur)
      out.push(
        <tr key={`${f.articulo}|${f.color}|${f.talle}`} className={(nuevoGrupo ? 'rp-ng' : '') + (banda[ri] ? ' rp-alt' : '') + (elegido ? ' rp-sel-art' : '')}>
          <td className="rp-c0" title={`Tocá para elegir ${f.articulo} color ${f.color} y pedir una sugerencia`} onClick={() => onElegirArt(f.articulo, f.color)}>
            {f.articulo}
          </td>
          <td className="rp-c1" title={f.desc}>{f.desc}</td>
          <td className="rp-c2" title={`Doble clic: stock y venta por local de ${f.articulo} color ${f.color}`} onDoubleClick={() => onGrafico(f.articulo, f.color)}>
            {f.color}
          </td>
          <td className="rp-c3">{f.talle}</td>
          {locales.map((loc, si) => {
            const v = f.cur[si]
            const editando = buffer !== '' && activa?.r === ri && activa?.s === si
            const movida = v !== f.base[si]
            let c = 'rp-cell' + rutaClase(si) + semClase(f, si)
            if (f.vend[si] > 0) c += ' rp-sold'
            if (f.trans[si]) c += v ? ' rp-tr rp-tr-con' : ' rp-tr'
            if (movida) c += ' rp-moved'
            if (enSel(ri, si)) c += ' rp-insel'
            const tip = [
              f.vend[si] > 0 ? `Vendió ${f.vend[si]}` : '',
              f.trans[si] ? `En tránsito: ${f.trans[si]}${v ? '' : ' (no es hueco, ya le llega)'}` : '',
              semaforo.on && (v || f.base[si]) ? (f.ult[si] == null ? 'Sin venta en 180 días' : f.ult[si] === 0 ? 'Vendió hoy' : `Última venta hace ${f.ult[si]} días`) : '',
              ...rutaTip(si),
              movida ? `Antes: ${f.base[si]}` : '',
            ].filter(Boolean)
            return (
              <td
                key={loc}
                className={c}
                tabIndex={0}
                data-r={ri}
                data-s={si}
                title={tip.join(' · ') || undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  confirmarBuffer()
                  if (e.shiftKey) enfocar(ri, si, true)
                  else {
                    arrastrando.current = true
                    enfocar(ri, si)
                  }
                }}
                onMouseEnter={() => {
                  if (!arrastrando.current || !ancla) return
                  activaRef.current = { r: ri, s: si }
                  setActiva({ r: ri, s: si })
                  setSel(norm(ancla, { r: ri, s: si }))
                }}
              >
                {editando ? buffer : v || ''}
                {movida && !editando && (
                  <span className={'rp-delta ' + (v > f.base[si] ? 'mas' : 'menos')}>
                    {v > f.base[si] ? '+' : '−'}
                    {Math.abs(v - f.base[si])}
                  </span>
                )}
                {f.trans[si] ? <span className={'rp-trmk' + (v ? ' esq' : '')}>🚚{f.trans[si]}</span> : null}
              </td>
            )
          })}
          <td className={'rp-rem' + (rem > 0 ? ' on' : rem < 0 ? ' neg' : '')} title={rem ? `Rem.: ${rem > 0 ? 'quedan ' + rem + ' sin repartir' : 'te pasaste por ' + -rem}` : undefined}>
            {rem || ''}
          </td>
        </tr>,
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, banda, locales, desde, hasta, sel, activa, buffer, version, faltaPasar, semaforo, artSel])

  const filaResumen = (titulo: string, vals: number[], conColor = false) => (
    <tr className="rp-sum">
      <th className="rp-lbl" colSpan={NCOLS_FIJAS}>{titulo}</th>
      {vals.map((v, i) => (
        <th key={locales[i]} className={conColor ? (v > 0 ? 'rp-pos' : v < 0 ? 'rp-neg' : '') : ''}>{v || ''}</th>
      ))}
      <th />
    </tr>
  )

  return (
    <div
      ref={wrap}
      className={'rp-wrap' + (hover ? ' rp-hov' : '') + (completa ? ' rp-full' : '') + (semaforo.on ? ' rp-sv' : '')}
      onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}
      onMouseOver={() => !hover && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={teclado}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) confirmarBuffer()
      }}
    >
      <style>{CSS}</style>
      <table className="rp-tabla">
        <colgroup>
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '2.8%' }} />
          <col style={{ width: '3%' }} />
          {locales.map((l) => <col key={l} />)}
          <col style={{ width: '3%' }} />
        </colgroup>
        <thead>
          {filaResumen('Posturas', resumen.posturas)}
          {filaResumen('Dif. ideal', resumen.dif, true)}
          {filaResumen('Stock ideal', resumen.ideal)}
          <tr className="rp-head">
            <th className="rp-c0">Artículo</th>
            <th className="rp-c1">Descripción</th>
            <th className="rp-c2">Col.</th>
            <th className="rp-c3">Talle</th>
            {locales.map((l, i) => (
              <th key={l} className={rutaClase(i).replace(/rp-m/g, 'rp-hm')} title={[l, ...rutaTip(i)].join(' · ')}>
                {CORTO[l] ?? l}
              </th>
            ))}
            <th title="Stock que quedó sin repartir (rojo = te pasaste)">Rem.</th>
          </tr>
        </thead>
        <tbody>
          {desde > 0 && <tr className="rp-spacer"><td colSpan={NCOLS_FIJAS + nL + 1} style={{ height: desde * ALTO }} /></tr>}
          {filasHtml}
          {hasta < filas.length && <tr className="rp-spacer"><td colSpan={NCOLS_FIJAS + nL + 1} style={{ height: (filas.length - hasta) * ALTO }} /></tr>}
        </tbody>
      </table>
    </div>
  )
}

const CSS = `
.rp-wrap{overflow-y:auto;overflow-x:hidden;max-height:62vh;border:1px solid var(--line);border-radius:14px;background:rgba(0,0,0,.18);outline:none}
.rp-wrap.rp-full{max-height:none;flex:1;min-height:0}
.rp-tabla{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:clamp(10.5px,.82vw,12.5px);font-variant-numeric:tabular-nums}
.rp-tabla th,.rp-tabla td{height:26px;padding:0 3px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-tabla thead th{position:sticky;background:var(--surface-solid);z-index:2;font-weight:600;color:var(--sub);font-size:11.5px;text-align:center}
.rp-tabla thead tr:nth-child(1) th{top:0}.rp-tabla thead tr:nth-child(2) th{top:27px}.rp-tabla thead tr:nth-child(3) th{top:54px}
.rp-tabla thead tr:nth-child(4) th{top:81px;color:var(--ink);font-size:clamp(9px,.68vw,11px);letter-spacing:-.02em;padding:0 1px}
.rp-sum th{font-weight:700}.rp-sum th.rp-lbl{text-align:right;font-weight:600}
.rp-pos{color:#a3e635!important}.rp-neg{color:#f87171!important}
.rp-tabla td.rp-c0{cursor:pointer;color:var(--ink)}.rp-tabla td.rp-c0:hover{color:#fdba74;text-decoration:underline}
.rp-tabla td.rp-c1{color:var(--sub)}
.rp-tabla td.rp-c2{text-align:center;cursor:zoom-in;text-decoration:underline dotted rgba(148,163,184,.6);text-underline-offset:3px}
.rp-tabla td.rp-c3{text-align:center;border-right:1px solid var(--line2)}
.rp-tabla th.rp-c0,.rp-tabla th.rp-c1{text-align:left}
.rp-tabla tr.rp-ng td{border-top:2px solid rgba(148,163,184,.7)}
tr.rp-alt>td{background:rgba(148,163,184,.24)}
.light .rp-wrap{background:#fff}
.light tr.rp-alt>td{background:rgba(100,116,139,.17)}
.light .rp-tabla tr.rp-ng td{border-top-color:rgba(71,85,105,.6)}
.rp-tabla tr.rp-sel-art td.rp-c0,.rp-tabla tr.rp-sel-art td.rp-c1,.rp-tabla tr.rp-sel-art td.rp-c2,.rp-tabla tr.rp-sel-art td.rp-c3{background:rgba(249,115,22,.16);color:#fed7aa}
.rp-tabla tr.rp-sel-art td.rp-c0{box-shadow:inset 3px 0 0 #f97316;font-weight:700}
.rp-cell{position:relative;text-align:center;cursor:cell;outline:none;color:var(--ink)}
.rp-cell:focus{box-shadow:inset 0 0 0 2px #f97316}
.rp-cell.rp-sold{background:rgba(248,113,113,.18)}
/* tránsito: el camión lleva la cantidad; con stock el número queda normal y se corre para dejarle lugar */
.rp-cell.rp-tr-con{padding-right:24px}
.rp-cell.rp-moved{background:rgba(167,139,250,.22);font-weight:700}
.rp-cell.rp-insel{box-shadow:inset 0 0 0 1px rgba(249,115,22,.6);background:rgba(249,115,22,.12)}
.rp-delta{position:absolute;top:0;left:1px;font-size:8.5px;line-height:1;font-weight:800;pointer-events:none}
.rp-delta.mas{color:#86efac}.rp-delta.menos{color:#fca5a5}
.rp-trmk{font-size:.95em;font-weight:800;color:#38bdf8;pointer-events:none;white-space:nowrap}
.rp-trmk.esq{position:absolute;top:1px;right:1px;font-size:9.5px;line-height:1;background:rgba(14,165,233,.2);border-radius:4px;padding:1px 2px}
.rp-rem{text-align:center;font-weight:700}.rp-rem.on{color:#fbbf24}.rp-rem.neg{color:#fff;background:rgba(248,113,113,.55)}
.rp-wrap.rp-sv .rp-cell.rp-sold{background:none}
.rp-wrap.rp-sv .rp-cell.rp-moved{outline:2px dashed rgba(167,139,250,.9);outline-offset:-3px}
.rp-cell.rp-s-v{background:rgba(22,163,74,.32)!important}.rp-cell.rp-s-a{background:rgba(245,158,11,.32)!important}.rp-cell.rp-s-r{background:rgba(220,38,38,.38)!important}
.rp-tabla tbody tr:hover td.rp-m1{box-shadow:inset 0 0 0 2px #eab308;background-color:rgba(234,179,8,.2)}
.rp-tabla tbody tr:hover td.rp-m2{box-shadow:inset 0 0 0 2px #ec4899;background-color:rgba(236,72,153,.2)}
.rp-tabla tbody tr:hover td.rp-m1.rp-m2{box-shadow:inset 0 0 0 2px #eab308,inset 0 0 0 4px #ec4899}
.rp-tabla tbody tr:hover td:not(.rp-cell){background:rgba(255,255,255,.04)}
.rp-hov .rp-tabla thead th.rp-hm1{background:#ca8a04;color:#fff}
.rp-hov .rp-tabla thead th.rp-hm2{background:#db2777;color:#fff}
.rp-hov .rp-tabla thead th.rp-hm1.rp-hm2{background:linear-gradient(135deg,#ca8a04 50%,#db2777 50%)}
`
