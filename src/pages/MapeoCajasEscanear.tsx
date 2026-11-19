import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Loader2, Check, AlertTriangle, Camera, CameraOff, Package, MoveDown, QrCode, Plus, RotateCcw, PackageCheck,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ScannerCamara from '@/components/ScannerCamara'
import { supabase } from '@/lib/supabase'
import {
  PREFIJO_CAJA, cargarCajasLlenas, cargarListaCajas, leerNumeroCaja, marcarCajaLlena,
  type AccionRepetidoCaja, type FilaEscaneoCaja,
} from '@/lib/mapeoCajas'

/**
 * Mapeo de cajas · Escanear
 * Paso 1: QR de la caja (o tipear su número). Paso 2: artículos de esa caja.
 * Escanear otro QR de caja (o tocar «Cambiar caja») cambia dónde van los siguientes.
 */
export default function MapeoCajasEscanear() {
  const [caja, setCaja] = useState<number | null>(null)
  const [camara, setCamara] = useState(false)
  const [enViaje, setEnViaje] = useState(0)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  // Artículo que ya estaba en otra caja: se pregunta si moverlo o agregarlo
  const [repetido, setRepetido] = useState<{ bruto: string; caja: number; fila: FilaEscaneoCaja } | null>(null)
  const [resolviendo, setResolviendo] = useState<AccionRepetidoCaja | null>(null)
  // Mover con el artículo en varias cajas: de cuáles sacarlo (null = no se está eligiendo)
  const [sacarDe, setSacarDe] = useState<Set<number> | null>(null)
  useEffect(() => {
    setSacarDe(null)
  }, [repetido])
  // Artículos escaneados en la caja actual (desde que se eligió)
  const [enEsta, setEnEsta] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const enfocar = useCallback(() => {
    // El escáner inalámbrico escribe como teclado: el foco tiene que volver siempre.
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    enfocar()
  }, [enfocar, caja])

  const cajaRef = useRef(caja)

  // Cajas creadas: si hay lista, solo se aceptan esos números
  const validasRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    let vivo = true
    cargarListaCajas()
      .then((l) => { if (vivo) validasRef.current = new Set(l) })
      .catch(() => { /* sin lista: se acepta cualquier número */ })
    return () => { vivo = false }
  }, [])

  // Cajas marcadas como llenas: la actual muestra el tilde
  const [llenas, setLlenas] = useState<Set<number>>(new Set())
  const llenasRef = useRef(llenas)
  llenasRef.current = llenas
  const [marcando, setMarcando] = useState(false)
  useEffect(() => {
    let vivo = true
    cargarCajasLlenas()
      .then((s) => { if (vivo) setLlenas(s) })
      .catch(() => { /* sin tabla todavía: nadie llena */ })
    return () => { vivo = false }
  }, [])

  async function alternarLlena() {
    if (caja == null) return
    const nueva = !llenas.has(caja)
    setMarcando(true)
    try {
      await marcarCajaLlena(caja, nueva)
      setLlenas((prev) => {
        const s = new Set(prev)
        if (nueva) s.add(caja)
        else s.delete(caja)
        return s
      })
      setMensaje({ ok: true, texto: nueva ? `Caja ${caja} marcada como llena.` : `Caja ${caja}: tiene lugar otra vez.` })
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo marcar la caja.' })
    } finally {
      setMarcando(false)
      enfocar()
    }
  }

  const fijarCaja = useCallback((n: number | null, bruto: string) => {
    if (n == null) {
      setMensaje({ ok: false, texto: `«${bruto}» no es un número de caja.` })
      return
    }
    if (validasRef.current.size > 0 && !validasRef.current.has(n)) {
      setMensaje({ ok: false, texto: `La caja ${n} no está en la lista de cajas.` })
      return
    }
    cajaRef.current = n
    setCaja(n)
    setEnEsta(0)
    setRepetido(null)
    setMensaje(
      llenasRef.current.has(n)
        ? { ok: false, texto: `La caja ${n} está marcada como llena. Si le entra más, sacale el tilde.` }
        : { ok: true, texto: `Caja ${n}: ahora escaneá los artículos.` },
    )
  }, [])

  // Viene de «¿Dónde guardo?» con ?caja=N: arranca con esa caja elegida
  const [params] = useSearchParams()
  const cajaInicial = params.get('caja')
  useEffect(() => {
    if (cajaInicial) fijarCaja(leerNumeroCaja(cajaInicial), cajaInicial)
  }, [cajaInicial, fijarCaja])

  function cambiarCaja() {
    cajaRef.current = null
    setCaja(null)
    setEnEsta(0)
    setRepetido(null)
    setMensaje(null)
    enfocar()
  }

  const escanearArticulo = useCallback(async (codigo: string, accion?: AccionRepetidoCaja, cajaFija?: number, sacarDeCajas?: number[]) => {
    // Al resolver un repetido se usa la caja del momento en que se escaneó
    const c = cajaFija ?? cajaRef.current
    if (!codigo || c == null || !supabase) return
    setEnViaje((n) => n + 1)
    try {
      // El servidor traduce el código con las equivalencias de Dragonfish
      const { data, error } = await supabase.rpc('mapeo_cajas_escanear', {
        p_codigo: codigo,
        p_caja: c,
        p_accion: accion ?? null,
        // Mover: solo de estas cajas (sin lista = de todas las otras)
        p_sacar_de: sacarDeCajas ?? null,
      })
      if (error) throw new Error(error.message)
      const f = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaEscaneoCaja | null
      if (!f) throw new Error('Sin respuesta del servidor.')
      if (f.estado === 'ya_mapeado') {
        setRepetido({ bruto: codigo, caja: c, fila: f })
        setMensaje(null)
      } else if (f.estado === 'ya_aca') {
        setRepetido(null)
        setMensaje({ ok: false, texto: `${f.codigo} ya está en la caja ${c}` })
      } else {
        setRepetido(null)
        if (c === cajaRef.current) setEnEsta((n) => n + 1)
        const verbo = f.estado === 'movido' ? 'Movido' : f.estado === 'agregado' ? 'Agregado' : 'Mapeado'
        setMensaje({ ok: true, texto: `${verbo}: ${f.codigo}` })
      }
    } catch (e) {
      setRepetido(null)
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : 'No se pudo guardar el escaneo.' })
    } finally {
      setEnViaje((n) => n - 1)
    }
  }, [])

  /** Cada lectura (lector, teclado o cámara): ¿caja o artículo?
   *  Sin caja elegida, lo que entra es el número de caja. Con caja, solo un QR
   *  o algo con prefijo CAJA: la cambia (los códigos de barra también son números). */
  const procesar = useCallback(
    (texto: string, formato?: string) => {
      const bruto = texto.trim()
      if (!bruto) return
      const esCaja = cajaRef.current == null || formato === 'QR_CODE' || PREFIJO_CAJA.test(bruto)
      if (esCaja) fijarCaja(leerNumeroCaja(bruto), bruto)
      else void escanearArticulo(bruto)
    },
    [fijarCaja, escanearArticulo],
  )

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = inputRef.current
    if (!input) return
    const v = input.value
    input.value = ''
    procesar(v)
    enfocar()
  }

  async function resolverRepetido(accion: AccionRepetidoCaja, sacarDeCajas?: number[]) {
    if (!repetido) return
    setResolviendo(accion)
    await escanearArticulo(repetido.bruto, accion, repetido.caja, sacarDeCajas)
    setResolviendo(null)
    enfocar()
  }

  // Cajas donde ya está el artículo repetido
  const otrasCajas = repetido?.fila.otras ?? []

  /** Mover: si está en una sola caja, directo; si está en varias, se elige de cuáles sacarlo */
  function tocarMover() {
    if (otrasCajas.length > 1) setSacarDe(new Set(otrasCajas))
    else void resolverRepetido('mover')
  }

  function alternarSacar(n: number) {
    setSacarDe((prev) => {
      const s = new Set(prev ?? [])
      if (s.has(n)) s.delete(n)
      else s.add(n)
      return s
    })
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Escanear cajas</h1>
        <p className="text-sm text-sub">Escaneá el QR de la caja (o tipeá su número) y después los artículos que tiene adentro.</p>
      </header>

      <div className="space-y-3 pb-4">
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-soft">
          {/* Paso actual */}
          {caja != null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2.5">
                <Package size={22} aria-hidden className="shrink-0 text-orange-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-sub">Caja</p>
                  <p className="truncate font-display text-2xl font-bold leading-tight tabular-nums text-ink">
                    {caja}
                    {llenas.has(caja) && (
                      <span className="ml-2 rounded-full bg-brand-600/15 px-2 py-0.5 align-middle text-xs font-bold text-brand-400">LLENA</span>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-xl font-bold leading-tight tabular-nums text-orange-500">{enEsta}</p>
                  <p className="text-[11px] text-sub">artículos</p>
                </div>
              </div>
              {/* Tilde de caja llena: después «¿Dónde guardo?» no la ofrece */}
              <label
                className={`flex min-h-[2.75rem] cursor-pointer select-none items-center gap-2.5 rounded-xl border px-3 text-sm font-semibold transition ${
                  llenas.has(caja) ? 'border-brand-600/50 bg-brand-600/10 text-brand-400' : 'border-line bg-surface2 text-ink hover:bg-line'
                }`}
              >
                {marcando ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                ) : (
                  <input
                    type="checkbox"
                    checked={llenas.has(caja)}
                    onChange={() => void alternarLlena()}
                    className="h-5 w-5 accent-red-600"
                  />
                )}
                <PackageCheck size={16} aria-hidden />
                Caja llena
                <span className="ml-auto text-xs font-normal text-sub">
                  {llenas.has(caja) ? 'No se ofrece para guardar' : 'Tildala cuando no entre más'}
                </span>
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface2 px-3 py-4">
              <QrCode size={26} aria-hidden className="shrink-0 text-orange-500" />
              <div>
                <p className="font-display font-semibold text-ink">Escaneá el QR de la caja o tipeá su número</p>
                <p className="text-xs text-sub">Después se habilitan los códigos de barra de los artículos.</p>
              </div>
            </div>
          )}

          {/* Entrada: escáner inalámbrico (escribe + Enter), teclado o cámara */}
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              name="codigo"
              type="text"
              inputMode={caja == null ? 'numeric' : 'text'}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder={caja != null ? 'Escaneá el artículo…' : 'N° de caja o QR…'}
              aria-label={caja != null ? 'Código de barra del artículo' : 'Número o QR de la caja'}
              onBlur={() => { if (!camara) enfocar() }}
              className="h-12 w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 text-base text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            />
            <button
              type="button"
              onClick={() => setCamara((c) => !c)}
              className="btn-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2 text-ink transition hover:bg-line"
              title={camara ? 'Cerrar cámara' : 'Abrir cámara'}
              aria-label={camara ? 'Cerrar cámara' : 'Abrir cámara'}
            >
              {camara ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
            </button>
          </form>

          {(mensaje || enViaje > 0) && (
            <div aria-live="polite" className="space-y-1.5">
              {mensaje && (
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                    mensaje.ok
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-brand-600/40 bg-brand-600/10 text-brand-400'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {mensaje.ok ? <Check size={16} className="shrink-0" aria-hidden /> : <AlertTriangle size={16} className="shrink-0" aria-hidden />}
                    <span className="truncate">{mensaje.texto}</span>
                  </span>
                </div>
              )}
              {enViaje > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-sub">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  Guardando {enViaje === 1 ? '1 escaneo' : `${enViaje} escaneos`}…
                </p>
              )}
            </div>
          )}

          {/* Artículo que ya está en otra caja: mover o agregar */}
          {repetido && (
            <div role="alert" className="space-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-amber-500" />
                <div className="min-w-0 text-sm">
                  <span className="text-[15px] font-semibold text-ink">{repetido.fila.codigo}</span>
                  <p className="mt-1 text-sub">
                    Ya está en {otrasCajas.length === 1 ? 'la caja' : 'las cajas'}{' '}
                    <span className="font-semibold text-ink">{otrasCajas.join(', ')}</span>.
                    ¿Qué hacés en la <span className="font-semibold text-ink">caja {repetido.caja}</span>?
                  </p>
                </div>
              </div>
              {sacarDe ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-sub">¿De qué cajas lo sacás?</p>
                  <div className="flex flex-wrap gap-2">
                    {otrasCajas.map((n) => (
                      <label
                        key={n}
                        className={`inline-flex min-h-[2.5rem] cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold tabular-nums transition ${
                          sacarDe.has(n) ? 'border-amber-500/60 bg-amber-500/15 text-amber-500' : 'border-line bg-surface text-sub'
                        }`}
                      >
                        <input type="checkbox" checked={sacarDe.has(n)} onChange={() => alternarSacar(n)} className="h-4 w-4 accent-amber-600" />
                        Caja {n}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setSacarDe(null); enfocar() }}
                      disabled={!!resolviendo}
                      className="btn-press inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface text-sm font-semibold text-ink transition hover:bg-surface2 disabled:opacity-60"
                    >
                      Volver
                    </button>
                    <button
                      onClick={() => void resolverRepetido('mover', [...sacarDe])}
                      disabled={!!resolviendo || sacarDe.size === 0}
                      className="btn-press inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-amber-600 text-sm font-semibold text-white shadow-soft transition hover:bg-amber-700 disabled:opacity-50"
                      title="Lo saca de las tildadas y lo deja en esta"
                    >
                      {resolviendo === 'mover' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MoveDown size={16} aria-hidden />}
                      Mover ({sacarDe.size})
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={tocarMover}
                    disabled={!!resolviendo}
                    className="btn-press inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-surface text-sm font-semibold text-amber-500 transition hover:bg-amber-500/15 disabled:opacity-60"
                    title={otrasCajas.length > 1 ? 'Elegí de qué cajas sacarlo' : 'Lo saca de la otra caja y lo deja solo en esta'}
                  >
                    {resolviendo === 'mover' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MoveDown size={16} aria-hidden />}
                    Mover
                  </button>
                  <button
                    onClick={() => void resolverRepetido('agregar')}
                    disabled={!!resolviendo}
                    className="btn-press inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60"
                    title="Queda en las dos cajas"
                  >
                    {resolviendo === 'agregar' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
                    Agregar
                  </button>
                </div>
              )}
            </div>
          )}

          {caja != null && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-sub">Para pasar a otra caja, escaneá su QR o tocá «Cambiar caja».</p>
              <button
                onClick={cambiarCaja}
                className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 text-sm font-medium text-ink transition hover:bg-line"
              >
                <RotateCcw size={15} aria-hidden /> Cambiar caja
              </button>
            </div>
          )}
        </div>

        {camara && (
          <ScannerCamara
            conQr
            onLectura={(t, formato) => procesar(t, formato)}
            onCerrar={() => {
              setCamara(false)
              enfocar()
            }}
          />
        )}
      </div>
    </Layout>
  )
}
