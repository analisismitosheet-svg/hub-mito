import { useId, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { DIMENSIONES_VENTA, PARAMS_DEFAULT, type ParamsCascada, type ReglaLista, type ReglaNumero } from '@/lib/repoDiaria'

/**
 * Compras > Repo diaria > Cascada > Parámetros.
 * Cada regla de puente-sql/cascada.js se puede prender / apagar y cambiar de valores
 * (agregar o sacar locales, materiales, proveedores…). Cada cambio recalcula la cascada
 * (lo hace la pantalla, sobre la misma foto). «Guardar» los deja como predeterminados:
 * con esos abre la pantalla y corre la cascada automática.
 */

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clon = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T

type ClaveLista = 'excluir_temporadas' | 'excluir_grupos' | 'excluir_articulos' | 'excluir_proveedores' | 'excluir_lineas' | 'materiales'
type ClaveNumero = 'receptor_max' | 'tope_sku' | 'min_envio'

function Interruptor({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 flex-none rounded-full transition ${on ? 'bg-emerald-500' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/** Etiquetas con ×, más un campo para agregar (Enter o salir del campo). */
function Etiquetas({ valores, onChange, sugerencias, mayus = true, placeholder = '+ agregar' }: {
  valores: string[]
  onChange: (v: string[]) => void
  sugerencias?: string[]
  mayus?: boolean
  placeholder?: string
}) {
  const [nuevo, setNuevo] = useState('')
  const id = useId()
  function agregar() {
    let v = nuevo.trim()
    if (!v) return
    if (mayus) v = v.toUpperCase()
    if (!valores.includes(v)) onChange([...valores, v])
    setNuevo('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {valores.map((v) => (
        <span key={v} className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface2 py-0.5 pl-2 pr-0.5 text-[11px] text-ink">
          {v}
          <button type="button" onClick={() => onChange(valores.filter((x) => x !== v))} className="rounded p-0.5 text-sub hover:text-red-400" aria-label={`Sacar ${v}`}>
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={nuevo}
        onChange={(e) => setNuevo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            agregar()
          }
        }}
        onBlur={agregar}
        list={sugerencias?.length ? id : undefined}
        placeholder={placeholder}
        className="h-6 w-24 rounded-md border border-line bg-surface px-1.5 text-[11px] text-ink placeholder:text-sub/60"
      />
      {!!sugerencias?.length && (
        <datalist id={id}>
          {sugerencias.filter((s) => !valores.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  )
}

/** Reglas que no están siempre: se suman con «+ Agregar parámetro» y se sacan con la papelera. */
type ClaveOpcional = 'prioridad_venta' | 'excluir_proveedores' | 'excluir_lineas'
const OPCIONALES: { clave: ClaveOpcional; titulo: string; ayuda: string }[] = [
  {
    clave: 'prioridad_venta',
    titulo: 'Prioridad por venta',
    ayuda: 'Compara cuánto vende cada local por proveedor, material, grupo, línea, categoría, marca… y ordena por eso quién recibe y quién dona.',
  },
  { clave: 'excluir_proveedores', titulo: 'Sin proveedores', ayuda: 'Sacar de la cascada los artículos de ciertos proveedores.' },
  { clave: 'excluir_lineas', titulo: 'Sin líneas', ayuda: 'Sacar de la cascada ciertas líneas (ej. W27-M).' },
]

function Regla({ titulo, ayuda, activo, onActivo, onQuitar, cambio, children }: {
  titulo: string
  ayuda?: string
  activo?: boolean
  onActivo?: (v: boolean) => void
  /** regla opcional: en vez del interruptor, un botón para sacarla */
  onQuitar?: () => void
  cambio: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`border-b border-line px-3 py-2.5 last:border-0 ${cambio ? 'bg-amber-500/[0.07]' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          {titulo}
          {cambio && <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-500">cambiado</span>}
          {ayuda && <span className="block text-[11px] font-normal text-sub">{ayuda}</span>}
        </p>
        {onQuitar ? (
          <button type="button" onClick={onQuitar} className="rounded p-1 text-sub hover:text-red-400" aria-label={`Sacar ${titulo}`} title="Sacar este parámetro">
            <Trash2 size={13} aria-hidden />
          </button>
        ) : (
          onActivo && <Interruptor on={!!activo} onChange={onActivo} label={titulo} />
        )}
      </div>
      {children && <div className={`mt-1.5 ${activo === false ? 'pointer-events-none opacity-40' : ''}`}>{children}</div>}
    </div>
  )
}

export default function ParametrosCascada({ params, guardados, onChange, onGuardar, guardando, calculando, sugerencias }: {
  params: ParamsCascada
  /** los guardados como predeterminados (para marcar si hay cambios sin guardar) */
  guardados: ParamsCascada
  onChange: (p: ParamsCascada) => void
  onGuardar: () => void
  guardando: boolean
  calculando: boolean
  sugerencias: { locales: string[]; proveedores: string[]; materiales: string[] }
}) {
  const P = params
  const D = PARAMS_DEFAULT
  const [menu, setMenu] = useState(false)
  const set = (f: (p: ParamsCascada) => void) => {
    const n = clon(P)
    f(n)
    onChange(n)
  }
  const cambios = (Object.keys(D) as (keyof ParamsCascada)[]).filter((k) => !igual(P[k], D[k])).length
  const sinGuardar = !igual(P, guardados)
  const inputNum = 'h-6 w-14 rounded-md border border-line bg-surface px-1.5 text-right text-xs tabular-nums text-ink'

  const numero = (k: ClaveNumero, titulo: string, ayuda: string, prefijo: string, min = 1) => (
    <Regla titulo={titulo} ayuda={ayuda} activo={P[k].activo} onActivo={(v) => set((p) => { p[k].activo = v })} cambio={!igual(P[k], D[k])}>
      <span className="text-xs text-sub">
        {prefijo}{' '}
        <input
          type="number"
          min={min}
          value={(P[k] as ReglaNumero).valor}
          onChange={(e) => set((p) => { p[k].valor = Math.max(min, Math.floor(Number(e.target.value) || min)) })}
          className={inputNum}
        />{' '}
        u.
      </span>
    </Regla>
  )
  const listaRegla = (k: ClaveLista, titulo: string, ayuda: string, sug?: string[], mayus = true) => (
    <Regla titulo={titulo} ayuda={ayuda} activo={P[k].activo} onActivo={(v) => set((p) => { p[k].activo = v })} cambio={!igual(P[k], D[k])}>
      <Etiquetas valores={(P[k] as ReglaLista).lista} sugerencias={sug} mayus={mayus} onChange={(v) => set((p) => { p[k].lista = v })} />
    </Regla>
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <p className="text-sm font-semibold text-ink">
          Parámetros
          <span className="ml-2 text-[11px] font-normal text-sub">
            {cambios ? `${cambios} distinto${cambios > 1 ? 's' : ''} de los de siempre` : 'los de siempre'}
          </span>
        </p>
        {calculando && <Loader2 size={14} className="animate-spin text-sub" aria-label="Recalculando" />}
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        <Regla titulo="Locales y prioridad" ayuda="Los que participan. El orden desempata donantes y ordena la salida." cambio={!igual(P.prioridad, D.prioridad)}>
          <div className="space-y-0.5">
            {P.prioridad.map((b, i) => (
              <div key={b} className="flex items-center gap-1.5 rounded-md border border-line/70 bg-surface2/60 px-1.5 py-0.5 text-xs">
                <span className="w-4 text-right tabular-nums text-sub">{i + 1}</span>
                <span className="flex-1 text-ink">{b}</span>
                {P.no_donan.includes(b) && <span className="rounded bg-red-500/10 px-1 text-[10px] text-red-400">no dona</span>}
                {P.no_reciben.includes(b) && <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-500">no recibe</span>}
                {P.pase_extra.activo && P.pase_extra.locales.includes(b) && <span className="rounded bg-violet-500/10 px-1 text-[10px] text-violet-400">pase extra</span>}
                <button type="button" disabled={i === 0} onClick={() => set((p) => { [p.prioridad[i - 1], p.prioridad[i]] = [p.prioridad[i], p.prioridad[i - 1]] })} className="p-0.5 text-sub hover:text-sky-500 disabled:opacity-30" aria-label={`Subir ${b}`}>
                  <ArrowUp size={12} aria-hidden />
                </button>
                <button type="button" disabled={i === P.prioridad.length - 1} onClick={() => set((p) => { [p.prioridad[i + 1], p.prioridad[i]] = [p.prioridad[i], p.prioridad[i + 1]] })} className="p-0.5 text-sub hover:text-sky-500 disabled:opacity-30" aria-label={`Bajar ${b}`}>
                  <ArrowDown size={12} aria-hidden />
                </button>
                <button type="button" disabled={P.prioridad.length <= 2} onClick={() => set((p) => { p.prioridad.splice(i, 1) })} className="p-0.5 text-sub hover:text-red-400 disabled:opacity-30" aria-label={`Sacar ${b}`}>
                  <X size={12} aria-hidden />
                </button>
              </div>
            ))}
            <Etiquetas valores={[]} placeholder="+ local" sugerencias={sugerencias.locales.filter((l) => !P.prioridad.includes(l))} onChange={(v) => set((p) => { p.prioridad.push(...v) })} />
          </div>
        </Regla>
        <Regla
          titulo="Donante principal"
          ayuda="Dona antes que los locales y trabaja como MITO: cubre lo que falta con todo su stock, por prioridad de local, sin quedarse con nada ni topes. Lo que no alcanza lo donan los locales."
          activo={P.donante_principal.activo}
          onActivo={(v) => set((p) => { p.donante_principal.activo = v })}
          cambio={!igual(P.donante_principal, D.donante_principal)}
        >
          <Etiquetas valores={P.donante_principal.bases} sugerencias={['INDOD', 'POLO52', 'FABRICA']} onChange={(v) => set((p) => { p.donante_principal.bases = v })} />
        </Regla>
        <Regla
          titulo="Cerrados por día"
          ayuda="Los días que no abren no donan: lo que se les iba a pedir lo dona otro local que sí abre."
          activo={P.cerrados_dia.activo}
          onActivo={(v) => set((p) => { p.cerrados_dia.activo = v })}
          cambio={!igual(P.cerrados_dia, D.cerrados_dia)}
        >
          <div className="space-y-1">
            {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((nombre, i) => (
              <div key={nombre} className="flex items-start gap-2">
                <span className="w-16 flex-none pt-1 text-[11px] text-sub">{nombre}</span>
                <div className="min-w-0 flex-1">
                  <Etiquetas
                    valores={P.cerrados_dia.dias[i + 1] ?? []}
                    sugerencias={P.prioridad}
                    onChange={(v) => set((p) => { if (v.length) p.cerrados_dia.dias[i + 1] = v; else delete p.cerrados_dia.dias[i + 1] })}
                  />
                </div>
              </div>
            ))}
          </div>
        </Regla>
        <Regla titulo="No donan" ayuda="Reciben pero nunca mandan." cambio={!igual(P.no_donan, D.no_donan)}>
          <Etiquetas valores={P.no_donan} sugerencias={P.prioridad} onChange={(v) => set((p) => { p.no_donan = v })} />
        </Regla>
        <Regla titulo="No reciben" ayuda="Donan pero no se les manda nada." cambio={!igual(P.no_reciben, D.no_reciben)}>
          <Etiquetas valores={P.no_reciben} sugerencias={P.prioridad} onChange={(v) => set((p) => { p.no_reciben = v })} />
        </Regla>
        <Regla titulo="Descontar lo que manda MITO" ayuda="Faltante = venta − repo MITO. Apagado: toda la venta." activo={P.restar_mito} onActivo={(v) => set((p) => { p.restar_mito = v })} cambio={P.restar_mito !== D.restar_mito} />
        <Regla titulo="Respetar tránsito" ayuda="No recibe un SKU que ya le está llegando." activo={P.respetar_transito} onActivo={(v) => set((p) => { p.respetar_transito = v })} cambio={P.respetar_transito !== D.respetar_transito} />
        {numero('receptor_max', 'No recibe si ya tiene', 'Unidades del SKU en el local que recibe.', '≥')}
        <Regla titulo="El donante se queda con" ayuda="Lo mínimo que deja en el local que dona." cambio={P.donante_queda !== D.donante_queda}>
          <span className="text-xs text-sub">
            <input type="number" min={0} value={P.donante_queda} onChange={(e) => set((p) => { p.donante_queda = Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={inputNum} /> u.
          </span>
        </Regla>
        {numero('tope_sku', 'Tope por donante y SKU', 'Lo máximo que dona un local de un mismo SKU.', 'hasta')}
        {numero('min_envio', 'Mínimo por envío', 'Cada par donante → receptor suma al menos…', 'mínimo')}
        <Regla titulo="Restricción de proveedor" ayuda="Estos receptores solo reciben estos proveedores." activo={P.restriccion.activo} onActivo={(v) => set((p) => { p.restriccion.activo = v })} cambio={!igual(P.restriccion, D.restriccion)}>
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-sub">Receptores</p>
          <Etiquetas valores={P.restriccion.receptores} sugerencias={P.prioridad} onChange={(v) => set((p) => { p.restriccion.receptores = v })} />
          <p className="mb-0.5 mt-1.5 text-[10px] uppercase tracking-wide text-sub">Proveedores</p>
          <Etiquetas valores={P.restriccion.proveedores} sugerencias={sugerencias.proveedores} onChange={(v) => set((p) => { p.restriccion.proveedores = v })} />
        </Regla>
        <Regla titulo="Pase extra" ayuda="Si no recibieron nada, aceptan donantes con 1 sola unidad." activo={P.pase_extra.activo} onActivo={(v) => set((p) => { p.pase_extra.activo = v })} cambio={!igual(P.pase_extra, D.pase_extra)}>
          <Etiquetas valores={P.pase_extra.locales} sugerencias={P.prioridad} onChange={(v) => set((p) => { p.pase_extra.locales = v })} />
        </Regla>
        {listaRegla('materiales', 'Solo estos materiales', 'Apagado: todos.', sugerencias.materiales)}
        {listaRegla('excluir_temporadas', 'Sin temporadas', 'Verano / Continuo / Invierno.', ['Verano', 'Continuo', 'Invierno'], false)}
        {listaRegla('excluir_grupos', 'Sin grupos', 'Los que empiezan con…')}
        {listaRegla('excluir_articulos', 'Sin artículos', 'Códigos de artículo.')}
        <Regla titulo="Orden de los receptores" ayuda="Quién se sirve primero." cambio={P.orden_receptores !== D.orden_receptores}>
          <select value={P.orden_receptores} onChange={(e) => set((p) => { p.orden_receptores = e.target.value as ParamsCascada['orden_receptores'] })} className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink">
            <option value="alfabetico">Alfabético (como el script)</option>
            <option value="prioridad">Por prioridad</option>
          </select>
        </Regla>
        <Regla titulo="Orden de los donantes" ayuda="A quién se le pide primero." cambio={P.orden_donantes !== D.orden_donantes}>
          <select value={P.orden_donantes} onChange={(e) => set((p) => { p.orden_donantes = e.target.value as ParamsCascada['orden_donantes'] })} className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink">
            <option value="stock">Más stock del artículo (como el script)</option>
            <option value="prioridad">Por prioridad</option>
          </select>
        </Regla>

        {/* ---- Parámetros agregados (opcionales) ---- */}
        {P.prioridad_venta.activo && (
          <Regla
            titulo="Prioridad por venta"
            ayuda="Recibe primero el local que más vende lo mismo que el artículo (según lo que elijas comparar); dona primero el que menos lo vende. La prioridad fija queda de desempate."
            onQuitar={() => set((p) => { p.prioridad_venta = clon(D.prioridad_venta) })}
            cambio
          >
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs text-sub">
              <span className="self-start pt-1">Comparar por</span>
              <div>
                <div className="flex flex-wrap gap-1">
                  {DIMENSIONES_VENTA.map((d) => {
                    const on = P.prioridad_venta.por.includes(d.clave)
                    return (
                      <button
                        key={d.clave}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          set((p) => {
                            const l = p.prioridad_venta.por
                            // Siempre queda al menos uno; el orden es el de la lista
                            const n = on ? l.filter((x) => x !== d.clave) : [...l, d.clave]
                            if (n.length) p.prioridad_venta.por = DIMENSIONES_VENTA.map((x) => x.clave).filter((x) => n.includes(x))
                          })
                        }
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] transition ${on ? 'border-violet-500 bg-violet-500/15 font-semibold text-violet-400' : 'border-line bg-surface2 text-sub hover:text-ink'}`}
                      >
                        {d.nombre}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1 text-[10px] text-sub">
                  Se compara la venta de: {P.prioridad_venta.por.map((c) => DIMENSIONES_VENTA.find((d) => d.clave === c)?.nombre).join(' + ')} (todos juntos)
                </p>
              </div>
              <span>Venta de los</span>
              <span>
                últimos{' '}
                <input type="number" min={1} max={12} value={P.prioridad_venta.dias} onChange={(e) => set((p) => { p.prioridad_venta.dias = Math.min(12, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} className={inputNum} />{' '}
                días con venta
              </span>
              <span>Ordena</span>
              <select value={P.prioridad_venta.aplica} onChange={(e) => set((p) => { p.prioridad_venta.aplica = e.target.value as ParamsCascada['prioridad_venta']['aplica'] })} className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink">
                <option value="receptores">A quién se le manda primero</option>
                <option value="donantes">A quién se le pide primero</option>
                <option value="ambos">Las dos cosas</option>
              </select>
            </div>
          </Regla>
        )}
        {(P.excluir_proveedores.activo || P.excluir_proveedores.lista.length > 0) && (
          <Regla titulo="Sin proveedores" ayuda="Códigos de proveedor que no entran." onQuitar={() => set((p) => { p.excluir_proveedores = clon(D.excluir_proveedores) })} cambio>
            <Etiquetas valores={P.excluir_proveedores.lista} sugerencias={sugerencias.proveedores} onChange={(v) => set((p) => { p.excluir_proveedores.lista = v })} />
          </Regla>
        )}
        {(P.excluir_lineas.activo || P.excluir_lineas.lista.length > 0) && (
          <Regla titulo="Sin líneas" ayuda="Líneas que no entran (ej. W27-M)." onQuitar={() => set((p) => { p.excluir_lineas = clon(D.excluir_lineas) })} cambio>
            <Etiquetas valores={P.excluir_lineas.lista} onChange={(v) => set((p) => { p.excluir_lineas.lista = v })} />
          </Regla>
        )}

        {/* ---- + Agregar parámetro ---- */}
        <div className="px-3 py-2.5">
          {(() => {
            const libres = OPCIONALES.filter((o) => !P[o.clave].activo)
            if (!libres.length) return <p className="text-[11px] text-sub">Ya están todos los parámetros agregados.</p>
            return menu ? (
              <div className="space-y-1">
                {libres.map((o) => (
                  <button
                    key={o.clave}
                    type="button"
                    onClick={() => {
                      set((p) => { p[o.clave].activo = true })
                      setMenu(false)
                    }}
                    className="block w-full rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-left hover:border-sky-500/50"
                  >
                    <span className="block text-xs font-semibold text-ink">{o.titulo}</span>
                    <span className="block text-[11px] text-sub">{o.ayuda}</span>
                  </button>
                ))}
                <button type="button" onClick={() => setMenu(false)} className="text-[11px] text-sub hover:text-ink">Cancelar</button>
              </div>
            ) : (
              <button type="button" onClick={() => setMenu(true)} className="btn-press inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-sky-500/50 text-xs font-semibold text-sky-500 hover:bg-sky-500/10">
                <Plus size={14} aria-hidden /> Agregar parámetro
              </button>
            )
          })()}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line p-3">
        <button type="button" onClick={() => onChange(clon(D))} disabled={cambios === 0} className="btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line disabled:opacity-50">
          <RotateCcw size={13} aria-hidden /> Los de siempre
        </button>
        {sinGuardar && (
          <button type="button" onClick={() => onChange(clon(guardados))} className="btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">
            Deshacer
          </button>
        )}
        <button type="button" onClick={onGuardar} disabled={!sinGuardar || guardando} className="btn-press ml-auto inline-flex h-8 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
          {guardando ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />} Guardar como predeterminados
        </button>
      </div>
    </div>
  )
}
