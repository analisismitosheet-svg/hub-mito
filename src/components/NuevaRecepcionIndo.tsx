import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { pedidosCompraParaOc, type PedidoCompraOc } from '@/lib/ocPedidosCompra'
import SelectorOc from '@/components/SelectorOc'
import { supabase } from '@/lib/supabase'
import { claveRecepcion, normalizar, type RecepcionIndo } from '@/lib/recepcionIndo'
import type { Proveedor } from '@/lib/proveedoresIndo'

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
  // Órdenes de compra cargadas (una vez por sesión) para el selector de N° OC
  const [pedidosOc, setPedidosOc] = useState<PedidoCompraOc[]>([])
  useEffect(() => { void pedidosCompraParaOc().then(setPedidosOc) }, [])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }))
  const falta = (k: keyof Form) => OBLIGATORIOS.includes(k) && String(f[k]).trim() === ''
  const faltantes = OBLIGATORIOS.filter(falta)

  // Proveedor del catálogo (por nombre, sin puntos ni acentos): da el código
  const provCatalogo = useMemo(
    () => proveedores.find((p) => compacto(p.nombre) === compacto(f.proveedor)) ?? null,
    [proveedores, f.proveedor],
  )

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
          intento && falta(k) ? 'border-brand-500' : 'border-line'
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
              className={`h-10 w-full rounded-xl border bg-surface2 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${intento && falta('bultos') ? 'border-brand-500' : 'border-line'}`}
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

          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-sub">
              N° OC<span className="text-brand-400"> *</span> <span className="normal-case text-sub/60">(una o varias)</span>
            </span>
            <SelectorOc
              valor={f.nOc}
              onChange={(v) => set('nOc', v)}
              pedidos={pedidosOc}
              proveedorNombre={provCatalogo?.nombre ?? f.proveedor}
              proveedorCodigo={provCatalogo?.codigo ?? null}
              invalido={intento && falta('nOc')}
            />
          </div>
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
