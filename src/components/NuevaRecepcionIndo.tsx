import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { claveRecepcion, normalizar, type RecepcionIndo } from '@/lib/recepcionIndo'
import type { Proveedor } from '@/lib/proveedoresIndo'
import { leerFotoRemito, type DatosRemito } from '@/lib/agentesApi'

/* ------------------------------------------------------------------ */
/*  Recepción INDO · "Nuevo registro": alta a mano de una recepción     */
/*  con todas las columnas del Excel. Se guarda por el mismo camino que */
/*  la importación (recepcion_indo_importar) y con la misma clave       */
/*  natural, así una reimportación del Excel la reconoce y no la        */
/*  duplica.                                                            */
/* ------------------------------------------------------------------ */

type Campo = keyof Omit<RecepcionIndo, 'clave' | 'mes' | 'fechaControlada' | 'ocCargadaDragon' | 'bultos' | 'iva'>

interface Form {
  nGuia: string
  transporte: string
  bultos: string
  deposito: string
  proveedor: string
  nRemito: string
  fechaRemito: string
  nOc: string
  ocCargadaDragon: boolean
  nFactura: string
  fechaFactura: string
  facturaLink: string
  fechaIngreso: string
  estado: string
  iva: string
  detalle: string
}

const hoy = () => new Date().toLocaleDateString('sv-SE')
const compacto = (v: string) => normalizar(v).replace(/[^A-Z0-9]/g, '')

/** Achica la foto (máx. 1600 px) y la pasa a JPEG en base64: viaja rápido y la IA la lee igual. */
async function fotoABase64(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo)
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No se pudo abrir la imagen.'))
      i.src = url
    })
    const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * escala)
    c.height = Math.round(img.naturalHeight * escala)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Mejor coincidencia de un texto leído contra una lista (todas las palabras, sin puntos ni acentos). */
function elegirDeLista(leido: string | null, lista: string[]): string | null {
  if (!leido) return null
  const l = compacto(leido)
  // Primero: algún valor de la lista que aparezca entero en lo leído ("INDOD" dentro de "INDONESIA DEPOSITO (INDOD)")
  const contenido = lista.filter((x) => compacto(x).length >= 3 && l.includes(compacto(x))).sort((a, b) => b.length - a.length)[0]
  if (contenido) return contenido
  const palabras = normalizar(leido).split(/[^A-Z0-9]+/).filter((w) => w.length > 2)
  return lista.find((x) => palabras.length > 0 && palabras.every((w) => compacto(x).includes(w))) ?? null
}

// Opcionales: el link de la factura y el detalle. Todo lo demás es obligatorio.
const OBLIGATORIOS: (keyof Form)[] = [
  'nGuia', 'transporte', 'bultos', 'deposito', 'proveedor', 'nRemito', 'fechaRemito', 'nOc',
  'nFactura', 'fechaFactura', 'fechaIngreso', 'estado', 'iva',
]

export default function NuevaRecepcionIndo({
  depositos, transportes, estados, proveedores, onCerrar, onGuardado,
}: {
  depositos: string[]
  transportes: string[]
  estados: string[]
  proveedores: Proveedor[]
  onCerrar: () => void
  onGuardado: (texto: string) => void
}) {
  const [f, setF] = useState<Form>({
    nGuia: '', transporte: '', bultos: '', deposito: depositos.length === 1 ? depositos[0] : '', proveedor: '',
    nRemito: '', fechaRemito: '', nOc: '', ocCargadaDragon: false, nFactura: '', fechaFactura: '',
    facturaLink: '', fechaIngreso: hoy(), estado: '', iva: '', detalle: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(false)
  // Foto del remito: la lee la IA local (Ollama en mito-server) y completa los campos
  const fotoRef = useRef<HTMLInputElement>(null)
  const [leyendo, setLeyendo] = useState<number | null>(null) // segundos que lleva
  const [leidos, setLeidos] = useState<Set<keyof Form>>(new Set())
  const [textoFoto, setTextoFoto] = useState<string | null>(null)
  useEffect(() => {
    if (leyendo === null) return
    const id = setInterval(() => setLeyendo((s) => (s === null ? s : s + 1)), 1000)
    return () => clearInterval(id)
  }, [leyendo === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const falta = (k: keyof Form) => OBLIGATORIOS.includes(k) && String(f[k]).trim() === ''
  const faltantes = OBLIGATORIOS.filter(falta)

  // Proveedor del catálogo (por nombre, sin puntos ni acentos): da el código
  const provCatalogo = useMemo(
    () => proveedores.find((p) => compacto(p.nombre) === compacto(f.proveedor)) ?? null,
    [proveedores, f.proveedor],
  )

  /** Pasa lo que leyó la IA a los campos (sin pisar lo que ya se escribió a mano). */
  function completarDesdeFoto(d: DatosRemito) {
    const nuevos: Partial<Form> = {}
    const proveedor = d.remitente
      ? proveedores.find((p) => compacto(p.nombre) === compacto(d.remitente!.split(/\s[—-]\s|,/)[0]))?.nombre
        ?? elegirDeLista(d.remitente.split(/\s[—-]\s|,/)[0], proveedores.map((p) => p.nombre))
        ?? d.remitente.split(/\s[—-]\s|,/)[0].trim()
      : null
    const valores: Partial<Form> = {
      nGuia: d.nGuia ?? undefined,
      transporte: (elegirDeLista(d.transporte, transportes) ?? d.transporte) ?? undefined,
      bultos: d.bultos != null ? String(d.bultos) : undefined,
      deposito: elegirDeLista(d.destino, depositos) ?? undefined,
      proveedor: proveedor ?? undefined,
      nRemito: d.nRemito ?? undefined,
      fechaRemito: d.fechaRemito ?? undefined,
      nFactura: d.nFactura ?? undefined,
    }
    for (const [k, v] of Object.entries(valores) as [keyof Form, string | undefined][]) {
      if (v && String(f[k]).trim() === '') (nuevos as Record<string, string>)[k] = v
    }
    setF((prev) => ({ ...prev, ...nuevos }))
    setLeidos(new Set(Object.keys(nuevos) as (keyof Form)[]))
    setTextoFoto(d.textoLeido)
  }

  async function leerFoto(archivo: File) {
    setError(null)
    setLeyendo(0)
    try {
      const base64 = await fotoABase64(archivo)
      const r = await leerFotoRemito(base64)
      completarDesdeFoto(r.datos)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setError(
        /fetch|network|Failed|timeout|aborted/i.test(m)
          ? 'No se pudo conectar con la IA (mito-server en la PC de la oficina). ¿Está prendida? Mientras tanto completá a mano.'
          : m,
      )
    } finally {
      setLeyendo(null)
      if (fotoRef.current) fotoRef.current.value = ''
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setIntento(true)
    setError(null)
    if (faltantes.length || !supabase) return
    const bultos = Number(f.bultos)
    const iva = Number(f.iva.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(bultos) || bultos < 0) return setError('Bultos tiene que ser un número.')
    if (!Number.isFinite(iva)) return setError('IVA tiene que ser un número (ej. 125000,50).')

    const base: Omit<RecepcionIndo, 'clave'> = {
      nGuia: f.nGuia.trim(),
      transporte: f.transporte.trim(),
      bultos,
      deposito: f.deposito.trim(),
      proveedor: provCatalogo?.nombre ?? f.proveedor.trim(),
      nRemito: f.nRemito.trim(),
      fechaRemito: f.fechaRemito || null,
      mes: f.fechaRemito ? Number(f.fechaRemito.slice(5, 7)) : null,
      nOc: f.nOc.split(/[/;,\s]+/).map((s) => s.trim()).filter(Boolean).join('/'),
      ocCargadaDragon: f.ocCargadaDragon,
      nFactura: f.nFactura.trim(),
      fechaFactura: f.fechaFactura || null,
      facturaLink: f.facturaLink.trim() || null,
      fechaIngreso: f.fechaIngreso || null,
      fechaControlada: null,
      estado: f.estado.trim(),
      iva,
      detalle: f.detalle.trim(),
    }
    const clave = claveRecepcion(base)
    setGuardando(true)
    // Misma clave natural que la importación: si ya existe, no se pisa
    const { data: existe, error: e1 } = await supabase.from('recepcion_indo').select('clave').eq('clave', clave).maybeSingle()
    if (e1) { setGuardando(false); return setError(e1.message) }
    if (existe) { setGuardando(false); return setError('Ya hay una recepción con la misma guía, depósito, proveedor, remito, fechas y factura.') }
    const { error: e2 } = await supabase.rpc('recepcion_indo_importar', {
      p_filas: [{ ...base, clave, proveedorCodigo: provCatalogo?.codigo?.trim() ?? null }],
    })
    setGuardando(false)
    if (e2) return setError(e2.message)
    onGuardado(`Registro nuevo: guía ${base.nGuia} de ${base.proveedor}.`)
  }

  const input = (k: Campo, etiqueta: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, ancho = '') => (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">
        {etiqueta}{OBLIGATORIOS.includes(k) ? <span className="text-brand-400"> *</span> : <span className="normal-case text-sub/60"> (opcional)</span>}
      </span>
      <input
        value={String(f[k] ?? '')}
        onChange={(e) => set(k, e.target.value as never)}
        className={`h-10 w-full rounded-xl border bg-surface2 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
          intento && falta(k) ? 'border-brand-500' : leidos.has(k) ? 'border-violet-500/70 bg-violet-500/10' : 'border-line'
        }`}
        {...props}
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Nuevo registro">
      <form onSubmit={(e) => void guardar(e)} className="my-6 w-full max-w-3xl rounded-2xl border border-line bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">Nuevo registro de recepción</h2>
          <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-sub hover:bg-surface2 hover:text-ink" aria-label="Cerrar">
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Foto del remito de transporte: la IA local completa lo que puede leer */}
        <div className="mb-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
          <input
            ref={fotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const a = e.target.files?.[0]; if (a) void leerFoto(a) }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fotoRef.current?.click()}
              disabled={leyendo !== null}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {leyendo !== null ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Camera size={15} aria-hidden />}
              {leyendo !== null ? `Leyendo la foto… ${leyendo} s` : 'Foto del remito'}
            </button>
            <p className="min-w-0 flex-1 text-xs text-sub">
              {leyendo !== null
                ? 'La IA de la oficina está leyendo el remito: tarda entre 30 segundos y 2 minutos.'
                : leidos.size
                  ? <span className="inline-flex items-center gap-1 text-violet-400"><Sparkles size={12} aria-hidden /> Completé {leidos.size} campos (en violeta): revisalos antes de guardar.</span>
                  : 'Sacá o subí una foto del remito de transporte y completo guía, transporte, bultos, fecha, proveedor y depósito.'}
            </p>
          </div>
          {textoFoto && (
            <details className="mt-2 text-[11px] text-sub">
              <summary className="cursor-pointer">Texto que leyó la IA</summary>
              <p className="mt-1 whitespace-pre-wrap break-words">{textoFoto}</p>
            </details>
          )}
        </div>

        <datalist id="nri-depositos">{depositos.map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="nri-transportes">{transportes.map((t) => <option key={t} value={t} />)}</datalist>
        <datalist id="nri-estados">{estados.map((s) => <option key={s} value={s} />)}</datalist>
        <datalist id="nri-proveedores">{proveedores.map((p) => <option key={p.codigo || p.nombre} value={p.nombre} />)}</datalist>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {input('nGuia', 'N° guía', { placeholder: '88-5408', autoFocus: true })}
          {input('transporte', 'Transporte', { list: 'nri-transportes' })}
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">Bultos<span className="text-brand-400"> *</span></span>
            <input
              type="number" min={0} inputMode="numeric" value={f.bultos} onChange={(e) => set('bultos', e.target.value)}
              className={`h-10 w-full rounded-xl border bg-surface2 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${intento && falta('bultos') ? 'border-brand-500' : leidos.has('bultos') ? 'border-violet-500/70 bg-violet-500/10' : 'border-line'}`}
            />
          </label>

          {input('deposito', 'Depósito', { list: 'nri-depositos' })}
          <div className="sm:col-span-2">
            {input('proveedor', 'Proveedor', { list: 'nri-proveedores', placeholder: 'Escribí y elegí del catálogo' })}
            <p className={`mt-0.5 text-[11px] ${provCatalogo ? 'text-emerald-500' : 'text-sub/70'}`}>
              {f.proveedor.trim() ? (provCatalogo ? `Del catálogo: ${provCatalogo.nombre} (${provCatalogo.codigo.trim()})` : 'No está en el catálogo: se guarda tal cual.') : ''}
            </p>
          </div>

          {input('nRemito', 'N° remito')}
          {input('fechaRemito', 'Fecha remito', { type: 'date' })}
          {input('fechaIngreso', 'Fecha ingreso', { type: 'date' })}

          <div className="sm:col-span-2">{input('nOc', 'N° OC', { placeholder: 'Una o varias: 15183/15347' })}</div>
          <label className="flex h-10 cursor-pointer items-center gap-2 self-end text-sm text-sub">
            <input type="checkbox" checked={f.ocCargadaDragon} onChange={(e) => set('ocCargadaDragon', e.target.checked)} className="h-4 w-4 accent-brand-500" />
            OC cargada en Dragonfish
          </label>

          {input('nFactura', 'N° factura')}
          {input('fechaFactura', 'Fecha factura', { type: 'date' })}
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">IVA ($)<span className="text-brand-400"> *</span></span>
            <input
              inputMode="decimal" value={f.iva} onChange={(e) => set('iva', e.target.value)} placeholder="125000,50"
              className={`h-10 w-full rounded-xl border bg-surface2 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${intento && falta('iva') ? 'border-brand-500' : 'border-line'}`}
            />
          </label>

          <div className="sm:col-span-2">{input('facturaLink', 'Link de la factura (Drive)', { type: 'url', placeholder: 'https://drive.google.com/…' })}</div>
          {input('estado', 'Estado', { list: 'nri-estados' })}

          <div className="sm:col-span-3">{input('detalle', 'Detalle')}</div>
        </div>

        {intento && faltantes.length > 0 && (
          <p className="mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2.5 text-sm text-brand-400">
            Completá los campos marcados en rojo ({faltantes.length}).
          </p>
        )}
        {error && <p role="alert" className="mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2.5 text-sm text-brand-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="rounded-xl px-4 py-2 text-sm text-sub hover:text-ink">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />} Guardar registro
          </button>
        </div>
      </form>
    </div>
  )
}
