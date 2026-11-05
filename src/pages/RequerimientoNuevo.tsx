import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ClipboardList, Loader2, Send, CalendarClock, CircleCheck, ThumbsUp, ThumbsDown, Wrench, ChevronRight, MapPin, Building2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import SelectorEmpleado from '@/components/SelectorEmpleado'
import AvisosCelular from '@/components/AvisosCelular'
import { FotosElegir, FotosVer } from '@/components/FotosRequerimiento'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { suscribirCambios } from '@/lib/realtime'
import { ZONAS, nombreZona } from '@/config/zonas'
import {
  useRubros, PRIORIDADES, ESTADOS, CAMPOS_REQ, prioridadDef, subirFotos, fechaCorta, fechaHora, quienesVan,
  type Persona, type Prioridad, type Requerimiento,
} from '@/lib/requerimientos'

/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos → Nuevo requerimiento.               */
/*  Lo carga el local (requerimientos.cargar): el local sale SIEMPRE   */
/*  de la cuenta. Quién lo solicita = nómina activa de RR. HH.         */
/*  Arriba, los arreglos que mantenimiento terminó y esperan la        */
/*  conformidad del local (Quedó listo / No quedó bien); abajo, los    */
/*  últimos del local con su estado.                                   */
/* ------------------------------------------------------------------ */

/** Cómo figura cada local en empleados.area_sector (la nómina de RR. HH.; `lugar` dice LOCALES). */
const SECTORES_DEL_LOCAL: Record<string, string[]> = {
  NVOCED: ['NVO CENTRO', 'NUEVO CENTRO'],
  LIBERD: ['HIPER', 'LIBERTAD'],
  ESPINOD: ['ESPINOSA', 'JOCKEY'],
  GPAZD: ['GRAL PAZ', 'GENERAL PAZ', 'GPAZ'],
  VCPD: ['VCP', 'CARLOS PAZ'],
  DINOD: ['DINO'],
  BUSTOD: ['BUSTOS'],
  MUNOZ: ['MUNOZ'],
  RIVERAD: ['RIVERA'],
  RUTA9D2: ['RUTA 9'],
  WALMARTD: ['WALMART'],
  '9DEJULIO': ['9 DE JULIO'],
  CFD: ['CF BUSTOS'],
  CFRA: ['CF RIVERA'],
  CFPO: ['CF OLMOS'],
  CFR9: ['CF RUTA 9'],
  CFR4: ['CF RIO IV', 'CF RIO 4'],
}
/** "NVO. CENTRO" = "Nvo Centro" = "NVOCENTRO" */
/** Terminados que se traen por vez (Ver más suma otra tanda) */
const TANDA = 50

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')

type Modo = 'zona' | 'local' | 'rubro' | 'nada'
const MODOS_ADMIN: [Modo, string][] = [['zona', 'Zona'], ['local', 'Local'], ['nada', 'Sin agrupar']]
const MODOS_LOCAL: [Modo, string][] = [['rubro', 'Rubro'], ['nada', 'Sin agrupar']]
const SIN_ZONA = 'SIN ZONA'
type EstadoLista = keyof typeof ESTADOS

/** Un desplegable: zona, rubro o local; las hojas tienen los pedidos (`hijos` vacío). */
interface Nodo { clave: string; tipo: 'zona' | 'rubro' | 'local'; nombre: string; zona: string; filas: Requerimiento[]; hijos: Nodo[] }

const pesoZona = (z: string) => { const i = (ZONAS as readonly string[]).indexOf(z); return i < 0 ? 99 : i }

function contarEstados(filas: Requerimiento[]): Partial<Record<EstadoLista, number>> {
  const c: Partial<Record<EstadoLista, number>> = {}
  for (const r of filas) c[r.estado] = (c[r.estado] ?? 0) + 1
  return c
}

/**
 * Agrupa por una clave. Zonas en su orden fijo (Centro, Norte, Sur, Este, Oeste, Interior),
 * locales en orden alfabético y rubros de mayor a menor cantidad.
 */
function agruparPor(filas: Requerimiento[], clave: (r: Requerimiento) => string, tipo: Nodo['tipo']): [string, Requerimiento[]][] {
  const m = new Map<string, Requerimiento[]>()
  for (const r of filas) { const k = clave(r); m.set(k, [...(m.get(k) ?? []), r]) }
  return [...m.entries()].sort((a, b) =>
    tipo === 'zona' ? pesoZona(a[0]) - pesoZona(b[0])
      : tipo === 'local' ? a[0].localeCompare(b[0], 'es', { sensitivity: 'base' })
        : b[1].length - a[1].length || a[0].localeCompare(b[0], 'es'))
}

/** Zona → Rubro → Local · Local (por zona) → Rubro · Rubro. */
function armarArbol(modo: Modo, filas: Requerimiento[], zonaDe: (r: Requerimiento) => string, localDe: (r: Requerimiento) => string): Nodo[] {
  const hoja = (pre: string, tipo: Nodo['tipo'], nombre: string, fs: Requerimiento[], hijos: Nodo[] = []): Nodo =>
    ({ clave: `${pre}${tipo}:${nombre}`, tipo, nombre, zona: fs[0] ? zonaDe(fs[0]) : SIN_ZONA, filas: fs, hijos })
  if (modo === 'zona') {
    return agruparPor(filas, zonaDe, 'zona').map(([z, fz]) => hoja('', 'zona', z, fz,
      agruparPor(fz, (r) => r.rubro, 'rubro').map(([ru, fr]) => hoja(`zona:${z}/`, 'rubro', ru, fr,
        agruparPor(fr, localDe, 'local').map(([lo, fl]) => hoja(`zona:${z}/rubro:${ru}/`, 'local', lo, fl))))))
  }
  if (modo === 'local') {
    return agruparPor(filas, localDe, 'local')
      .sort((a, b) => pesoZona(zonaDe(a[1][0])) - pesoZona(zonaDe(b[1][0])))
      .map(([lo, fl]) => hoja('', 'local', lo, fl,
        agruparPor(fl, (r) => r.rubro, 'rubro').map(([ru, fr]) => hoja(`local:${lo}/`, 'rubro', ru, fr))))
  }
  if (modo === 'rubro') return agruparPor(filas, (r) => r.rubro, 'rubro').map(([ru, fr]) => hoja('', 'rubro', ru, fr))
  return []
}

export default function RequerimientoNuevo() {
  const { rubros: RUBROS, rubroDef } = useRubros()
  const { perfil, isAdmin } = useAuth()
  const local = perfil?.local ?? ''
  // Local del pedido nuevo: el de la cuenta; el admin lo elige (requerimiento_crear lo acepta solo de él)
  const [localElegido, setLocalElegido] = useState('')
  const localForm = isAdmin ? (localElegido || local) : local
  // El admin ve los pedidos de todos los locales (filtro opcional); el resto, solo los de su local
  const [filtroLocal, setFiltroLocal] = useState('')
  const verLocal = isAdmin ? filtroLocal : local
  const veLista = isAdmin || Boolean(local)
  const [locales, setLocales] = useState<{ codigo: string; nombre: string; zona: string | null }[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [solicitante, setSolicitante] = useState<string | null>(null)
  const [rubro, setRubro] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('')
  const [descripcion, setDescripcion] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [yaResuelto, setYaResuelto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<number | null>(null)
  // Lista del local: abiertos (todos) o terminados (de a TANDA, con «Ver más»)
  const [vista, setVista] = useState<'abiertos' | 'terminados'>('abiertos')
  // Agrupado de la lista: el admin por Zona → Rubro → Local o por Local; el local, por Rubro
  const [modo, setModo] = useState<Modo>(isAdmin ? 'zona' : 'nada')
  const [abiertosG, setAbiertosG] = useState<Set<string>>(new Set())
  const caminoInicial = useRef('')
  const [abiertos, setAbiertos] = useState<Requerimiento[]>([])
  const [terminados, setTerminados] = useState<Requerimiento[]>([])
  const [totalTerminados, setTotalTerminados] = useState(0)
  const [tope, setTope] = useState(TANDA)
  const [paraConfirmar, setParaConfirmar] = useState<Requerimiento[]>([])
  const [devolviendo, setDevolviendo] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState<number | null>(null)
  // Botón Terminado de la lista: el local cierra algo que seguía abierto
  const [cerrando, setCerrando] = useState<number | null>(null)
  const [comentarioCierre, setComentarioCierre] = useState('')

  useEffect(() => {
    if (!supabase) return
    void supabase.from('locales').select('codigo,nombre,zona').eq('activo', true).then(({ data }) =>
      setLocales(((data as { codigo: string; nombre: string | null; zona: string | null }[] | null) ?? [])
        .map((l) => ({ codigo: l.codigo, nombre: l.nombre || l.codigo, zona: l.zona }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre))))
    void supabase.rpc('requerimientos_personas').then(({ data, error: e }) => {
      if (e) setError(e.message)
      else setPersonas((data as Persona[] | null) ?? [])
    })
  }, [])

  const nombreLocal = (c: string | null) => locales.find((l) => l.codigo === c)?.nombre ?? c ?? ''

  // Primero la gente de este local, después el resto de la nómina activa
  const opciones = useMemo(() => {
    const sectores = new Set((SECTORES_DEL_LOCAL[localForm] ?? [nombreLocal(localForm)]).map(norm))
    const delLocal = (p: Persona) => sectores.has(norm(p.sector ?? ''))
    return [...personas]
      .sort((a, b) => Number(delLocal(b)) - Number(delLocal(a)) || a.nombre.localeCompare(b.nombre))
      .map((p) => ({ id: p.legajo, nombre: p.nombre, legajo: p.legajo }))
  }, [personas, localForm, locales])

  const cargarUltimos = useCallback(async () => {
    if (!supabase || !veLista) { setAbiertos([]); setTerminados([]); setParaConfirmar([]); return }
    let qa = supabase.from('requerimientos').select(CAMPOS_REQ)
      .in('estado', ['pendiente', 'programado', 'en_curso', 'a_confirmar'])
    let qt = supabase.from('requerimientos').select(CAMPOS_REQ, { count: 'exact' })
      .in('estado', ['resuelto', 'no_corresponde'])
    // '' (admin sin filtro) = todos los locales
    if (verLocal) { qa = qa.eq('local', verLocal); qt = qt.eq('local', verLocal) }
    const [a, t] = await Promise.all([
      qa.order('created_at', { ascending: false }).limit(500),
      qt.order('resuelto_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(tope),
    ])
    const lista = (a.data as unknown as Requerimiento[] | null) ?? []
    setAbiertos(lista)
    setParaConfirmar(lista.filter((r) => r.estado === 'a_confirmar'))
    setTerminados((t.data as unknown as Requerimiento[] | null) ?? [])
    setTotalTerminados(t.count ?? 0)
  }, [veLista, verLocal, tope])
  useEffect(() => { void cargarUltimos() }, [cargarUltimos])
  useEffect(() => suscribirCambios(['requerimientos'], () => void cargarUltimos()), [cargarUltimos])

  const falta = !localForm ? (isAdmin ? 'Elegí el local' : 'Tu usuario no tiene un local asignado') : !solicitante ? 'Elegí quién lo solicita' : !rubro ? 'Elegí el rubro'
    : !prioridad ? 'Elegí la prioridad' : descripcion.trim().length < 3 ? 'Contá qué pasa' : null

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || falta) { setError(falta); return }
    setEnviando(true)
    setError(null)
    try {
      const rutas = await subirFotos(fotos, localForm)
      const { data, error: err } = await supabase.rpc('requerimiento_crear', {
        p_rubro: rubro, p_prioridad: prioridad, p_solicitante_legajo: solicitante,
        p_descripcion: descripcion.trim(), p_fotos: rutas, p_ya_resuelto: yaResuelto,
        p_local: isAdmin ? localForm : null,
      })
      if (err) throw new Error(err.message)
      setListo(data as number)
      setRubro(''); setPrioridad(''); setDescripcion(''); setFotos([]); setYaResuelto(false)
      void cargarUltimos()
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x))
    } finally {
      setEnviando(false)
    }
  }

  /** Quedó listo (a confirmar) o Terminado desde la lista (algo que seguía abierto) */
  async function confirmar(id: number, comentario?: string) {
    if (!supabase) return
    setOcupado(id)
    setError(null)
    const { error: err } = await supabase.rpc('requerimiento_confirmar', { p_id: id, p_comentario: comentario ?? null })
    setOcupado(null)
    if (err) { setError(err.message); return }
    setCerrando(null); setComentarioCierre('')
    void cargarUltimos()
  }

  async function noQuedo(id: number) {
    if (!supabase) return
    setOcupado(id)
    setError(null)
    const { error: err } = await supabase.rpc('requerimiento_no_quedo', { p_id: id, p_motivo: motivo })
    setOcupado(null)
    if (err) { setError(err.message); return }
    setDevolviendo(null); setMotivo('')
    void cargarUltimos()
  }

  // Una tarjeta de pedido: la usan la lista plana y las hojas de los grupos
  const tarjeta = (r: Requerimiento) => {
    const rd = rubroDef(r.rubro)
    return (
      <li key={r.id} className="rounded-2xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isAdmin && !verLocal && modo === 'nada' && <span className="font-semibold text-ink">{nombreLocal(r.local) || r.local_original || 'Sin local'}</span>}
          <span className="font-semibold text-sub">N° {r.id} · {fechaCorta(r.created_at)}</span>
          <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{r.rubro}</span>
          <span className={`rounded-full border px-2 py-0.5 ${prioridadDef(r.prioridad).clase}`}>{prioridadDef(r.prioridad).label}</span>
          <span className={`rounded-full border px-2 py-0.5 ${ESTADOS[r.estado].clase}`}>{ESTADOS[r.estado].label}</span>
        </div>
        <p className="mt-1 text-sm text-ink">{r.descripcion}</p>
        {r.solicitante_nombre && <p className="mt-0.5 text-xs text-sub">Lo pidió {r.solicitante_nombre}</p>}
        <FotosVer fotos={r.fotos} />
        {r.programado_para && (r.estado === 'programado' || r.estado === 'en_curso') && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-sky-500">
            <CalendarClock size={13} aria-hidden /> Va {quienesVan(r) || 'mantenimiento'} el {fechaHora(r.programado_para)}
          </p>
        )}
        {r.estado === 'pendiente' && r.rechazo_motivo && (
          <p className="mt-1 text-xs text-brand-400">Lo devolvieron: {r.rechazo_motivo}</p>
        )}
        {r.terminado_at && r.estado !== 'pendiente' && (
          <div className="mt-2 rounded-lg bg-surface2 p-2 text-xs text-sub">
            <p className="flex items-center gap-1.5">
              <Wrench size={12} aria-hidden /> Lo hizo {r.terminado_por ?? 'mantenimiento'} el {fechaHora(r.terminado_at)}
            </p>
            {r.terminado_comentario && <p className="mt-0.5 text-ink">{r.terminado_comentario}</p>}
            <FotosVer fotos={r.terminado_fotos} />
          </div>
        )}
        {r.estado === 'resuelto' && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-500">
            <CircleCheck size={13} aria-hidden />
            {r.origen === 'planilla'
              ? `Resuelto${r.resuelto_at ? ` el ${fechaCorta(r.resuelto_at)}` : ''} (planilla anterior)`
              : `Confirmado el ${r.resuelto_at ? fechaCorta(r.resuelto_at) : ''}${r.resuelto_por ? ` · ${r.resuelto_por}` : ''}${r.resuelto_comentario ? ` · ${r.resuelto_comentario}` : ''}`}
          </p>
        )}
        {r.estado === 'no_corresponde' && (
          <p className="mt-1 text-xs text-sub">
            No corresponde{r.resuelto_at ? ` (${fechaCorta(r.resuelto_at)})` : ''}{r.resuelto_comentario ? `: ${r.resuelto_comentario}` : ''}
          </p>
        )}
        {vista === 'abiertos' && (cerrando === r.id ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input autoFocus value={comentarioCierre} onChange={(e) => setComentarioCierre(e.target.value)}
              placeholder="¿Cómo se resolvió? (opcional)"
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink" />
            <button type="button" onClick={() => void confirmar(r.id, comentarioCierre)} disabled={ocupado === r.id}
              className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
              {ocupado === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <CircleCheck size={15} aria-hidden />} Confirmar
            </button>
            <button type="button" onClick={() => setCerrando(null)} className="btn-press h-10 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink">Cancelar</button>
          </div>
        ) : r.estado === 'a_confirmar' ? (
          devolviendo === r.id ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Qué quedó mal?"
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink" />
              <button type="button" onClick={() => void noQuedo(r.id)} disabled={ocupado === r.id}
                className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
                {ocupado === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ThumbsDown size={15} aria-hidden />} Devolver
              </button>
              <button type="button" onClick={() => setDevolviendo(null)} className="btn-press h-10 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink">Cancelar</button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void confirmar(r.id)} disabled={ocupado === r.id}
                className="btn-press inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-60">
                {ocupado === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ThumbsUp size={15} aria-hidden />} Quedó listo
              </button>
              <button type="button" onClick={() => { setDevolviendo(r.id); setMotivo('') }}
                className="btn-press inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-brand-600/40 bg-brand-600/10 text-sm font-semibold text-brand-400">
                <ThumbsDown size={15} aria-hidden /> No quedó bien
              </button>
            </div>
          )
        ) : (
          <div className="mt-3">
            <button type="button" onClick={() => { setCerrando(r.id); setComentarioCierre('') }}
              className="btn-press inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-500">
              <CircleCheck size={15} aria-hidden /> Terminado
            </button>
          </div>
        ))}
      </li>
    )
  }

  const zonaDeLocal = useMemo(() => new Map(locales.map((l) => [l.codigo, l.zona ?? SIN_ZONA])), [locales])
  const listaVista = vista === 'abiertos' ? abiertos : terminados
  const arbol = useMemo(
    () => armarArbol(modo, listaVista, (r) => zonaDeLocal.get(r.local ?? '') ?? SIN_ZONA, (r) => nombreLocal(r.local) || r.local_original || 'Sin local'),
    [modo, listaVista, zonaDeLocal, locales], // nombreLocal sale de `locales`
  )
  // Al cambiar de modo, pestaña o local, abre el primer camino para que se vea cómo baja
  useEffect(() => {
    const clave = `${modo}|${vista}|${verLocal}`
    if (!arbol.length || caminoInicial.current === clave) return
    caminoInicial.current = clave
    const primero = new Set<string>()
    let n: Nodo | undefined = arbol[0]
    while (n) { primero.add(n.clave); n = n.hijos[0] }
    setAbiertosG(primero)
  }, [arbol, modo, vista, verLocal])
  const alternar = (k: string) => setAbiertosG((a) => { const b = new Set(a); if (b.has(k)) b.delete(k); else b.add(k); return b })
  const todasLasClaves = () => { const t = new Set<string>(); const rec = (ns: Nodo[]) => ns.forEach((n) => { t.add(n.clave); rec(n.hijos) }); rec(arbol); return t }

  function iconoNodo(n: Nodo) {
    if (n.tipo === 'zona') return <MapPin size={16} className="text-teal-500" aria-hidden />
    if (n.tipo === 'local') return <Building2 size={16} className="text-sky-500" aria-hidden />
    const rd = rubroDef(n.nombre)
    return <rd.icon size={16} style={{ color: rd.color }} aria-hidden />
  }

  function pintarNodos(nodos: Nodo[], nivel: number): ReactNode {
    let zonaPrev = ''
    return nodos.map((n) => {
      // Por local: un separador cada vez que cambia la zona
      const sep = modo === 'local' && nivel === 0 && n.zona !== zonaPrev
        ? (zonaPrev = n.zona, (
          <p key={`sep-${n.zona}`} className="mb-1 mt-4 flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-teal-500">
            {n.zona === SIN_ZONA ? 'Sin zona' : `Zona ${nombreZona(n.zona).toLowerCase()}`}
            <span className="font-normal normal-case tracking-normal text-sub">{nodos.filter((x) => x.zona === n.zona).reduce((t, x) => t + x.filas.length, 0)} pedidos</span>
          </p>))
        : null
      const abierto = abiertosG.has(n.clave)
      return (
        <div key={n.clave}>
          {sep}
          <div className={`rounded-2xl border ${nivel === 0 ? 'bg-surface' : 'bg-surface2/40'} ${n.tipo === 'zona' ? 'border-teal-500/30' : 'border-line'}`}>
            <button type="button" onClick={() => alternar(n.clave)} aria-expanded={abierto}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
              {iconoNodo(n)}
              <span className={`min-w-0 flex-1 truncate font-semibold ${n.tipo === 'zona' ? 'text-xs uppercase tracking-wider text-teal-500' : nivel === 0 ? 'text-sm text-ink' : 'text-[13px] text-ink'}`}>
                {n.tipo === 'zona' ? (n.nombre === SIN_ZONA ? 'Sin zona' : `Zona ${nombreZona(n.nombre).toLowerCase()}`) : n.nombre}
              </span>
              <span className="hidden flex-wrap justify-end gap-1 sm:flex">
                {Object.entries(contarEstados(n.filas)).map(([e, c]) => (
                  <span key={e} className={`rounded-full border px-1.5 text-[10px] font-semibold ${ESTADOS[e as EstadoLista].clase}`}>{ESTADOS[e as EstadoLista].label} {c}</span>
                ))}
              </span>
              <span className="rounded-full bg-surface2 px-2 text-xs font-bold tabular-nums text-ink">{n.filas.length}</span>
              <ChevronRight size={15} className={`shrink-0 text-sub transition ${abierto ? 'rotate-90' : ''}`} aria-hidden />
            </button>
            {abierto && (
              <div className="space-y-2 px-2 pb-2">
                {n.hijos.length ? pintarNodos(n.hijos, nivel + 1) : <ul className="space-y-2">{n.filas.map(tarjeta)}</ul>}
              </div>
            )}
          </div>
        </div>
      )
    })
  }

  const caja = 'rounded-2xl border border-line bg-surface p-4'
  const titulo = 'mb-2 text-xs font-semibold uppercase tracking-wider text-sub/80'

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <ClipboardList size={22} className="text-teal-500" aria-hidden /> Nuevo requerimiento
        </h1>
        <p className="mt-1 text-sm text-sub">Contale a Arquitectura qué hay que arreglar en el local. Te avisamos el día y horario en que va mantenimiento.</p>
      </header>

      <AvisosCelular texto="Activá los avisos para que te llegue al celular qué día y a qué hora va mantenimiento." />

      {listo != null && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          <CircleCheck size={16} aria-hidden /> Requerimiento N° {listo} cargado. Lo ves abajo con su estado.
        </p>
      )}

      {paraConfirmar.length > 0 && (
        <section className="mb-5 rounded-2xl border border-lime-500/40 bg-lime-500/5 p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Wrench size={18} className="text-lime-500" aria-hidden /> Para confirmar ({paraConfirmar.length})
          </h2>
          <p className="mb-3 text-sm text-sub">Mantenimiento dice que ya lo arregló. Fijate y confirmá si quedó bien.</p>
          <ul className="space-y-2.5">
            {paraConfirmar.map((r) => {
              const rd = rubroDef(r.rubro)
              return (
                <li key={r.id} className="rounded-xl border border-line bg-surface p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    {isAdmin && <span className="font-semibold text-ink">{nombreLocal(r.local) || r.local_original || 'Sin local'}</span>}
                    <span className="font-semibold text-sub">N° {r.id} · {fechaCorta(r.created_at)}</span>
                    <span className="inline-flex items-center gap-1 text-ink"><rd.icon size={13} style={{ color: rd.color }} aria-hidden />{r.rubro}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink">{r.descripcion}</p>
                  <p className="mt-2 text-xs text-sub">
                    Lo terminó {r.terminado_por ?? 'mantenimiento'}{r.terminado_at ? ` el ${fechaHora(r.terminado_at)}` : ''}
                    {r.terminado_comentario ? <span className="text-ink"> · {r.terminado_comentario}</span> : null}
                  </p>
                  <FotosVer fotos={r.terminado_fotos} />
                  {devolviendo === r.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Qué quedó mal?"
                        className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink" />
                      <button type="button" onClick={() => void noQuedo(r.id)} disabled={ocupado === r.id}
                        className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
                        {ocupado === r.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ThumbsDown size={15} aria-hidden />} Devolver
                      </button>
                      <button type="button" onClick={() => setDevolviendo(null)} className="btn-press h-10 rounded-xl border border-line bg-surface2 px-3 text-sm text-ink">Cancelar</button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void confirmar(r.id)} disabled={ocupado === r.id}
                        className="btn-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-soft hover:bg-emerald-700 disabled:opacity-60">
                        {ocupado === r.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ThumbsUp size={16} aria-hidden />} Quedó listo
                      </button>
                      <button type="button" onClick={() => { setDevolviendo(r.id); setMotivo('') }}
                        className="btn-press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-brand-600/40 bg-brand-600/10 text-sm font-semibold text-brand-400">
                        <ThumbsDown size={16} aria-hidden /> No quedó bien
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <div className={`${caja} grid gap-3 sm:grid-cols-2`}>
          <div>
            <p className={titulo}>Local</p>
            {isAdmin ? (
              <select value={localForm} onChange={(e) => { setLocalElegido(e.target.value); setSolicitante(null) }} aria-label="Local"
                className="h-10 w-full rounded-xl border border-line bg-surface2 px-3 text-sm font-semibold text-ink">
                <option value="">Elegí el local…</option>
                {locales.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
              </select>
            ) : (
              <p className="flex h-10 items-center rounded-xl border border-line bg-surface2 px-3 text-sm font-semibold text-ink">
                {local ? nombreLocal(local) : 'Tu usuario no tiene local asignado'}
              </p>
            )}
          </div>
          <div>
            <p className={titulo}>¿Quién lo solicita?</p>
            <SelectorEmpleado empleados={opciones} valor={solicitante} onElegir={setSolicitante}
              placeholder="Buscá tu nombre o legajo…" className="h-10 w-full !max-w-none justify-between rounded-xl bg-surface2 px-3 !text-sm" />
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>Rubro</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {RUBROS.map((r) => {
              const activo = rubro === r.id
              return (
                <button key={r.id} type="button" onClick={() => setRubro(r.id)} aria-pressed={activo}
                  className={`btn-press flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${activo ? 'text-ink' : 'border-line bg-surface2 text-sub hover:text-ink'}`}
                  style={activo ? { borderColor: r.color, backgroundColor: `${r.color}22` } : undefined}>
                  <r.icon size={17} style={{ color: r.color }} aria-hidden /> {r.id}
                </button>
              )
            })}
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>Prioridad</p>
          <div className="flex gap-2">
            {PRIORIDADES.map((p) => (
              <button key={p.id} type="button" onClick={() => setPrioridad(p.id)} aria-pressed={prioridad === p.id}
                className={`btn-press h-10 flex-1 rounded-xl border text-sm font-semibold transition ${prioridad === p.id ? p.clase : 'border-line bg-surface2 text-sub hover:text-ink'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={caja}>
          <p className={titulo}>¿Qué pasa?</p>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4}
            placeholder="Ej.: se quemó un reflector de la vidriera, el de la izquierda."
            className="w-full rounded-xl border border-line bg-surface2 p-3 text-sm text-ink outline-none placeholder:text-sub/60 focus-visible:border-brand-500" />
          <p className={`${titulo} mt-3`}>Fotos de lo roto o del problema</p>
          <FotosElegir archivos={fotos} onCambio={setFotos} />
          <label className="mt-4 flex items-start gap-2 text-sm text-sub">
            <input type="checkbox" checked={yaResuelto} onChange={(e) => setYaResuelto(e.target.checked)} className="mt-0.5" />
            <span>Ya está resuelto, solo dejo constancia <span className="text-sub/70">(ej.: «hoy Marcos cambió una AR111»).</span></span>
          </label>
        </div>

        {error && <p role="alert" className="rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

        <button type="submit" disabled={enviando}
          className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-base font-semibold text-white shadow-soft hover:bg-teal-700 disabled:opacity-60">
          {enviando ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
          {enviando ? 'Enviando…' : yaResuelto ? 'Guardar constancia' : 'Enviar requerimiento'}
        </button>
      </form>

      {veLista && (
        <section className="mt-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              Requerimientos {verLocal ? `de ${nombreLocal(verLocal)}` : 'de todos los locales'}
            </h2>
            {isAdmin && (
              <select value={filtroLocal} onChange={(e) => { setFiltroLocal(e.target.value); setTope(TANDA) }} aria-label="Local"
                className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
                <option value="">Todos los locales</option>
                {locales.map((l) => <option key={l.codigo} value={l.codigo}>{l.nombre}</option>)}
              </select>
            )}
          </div>
          <div className="mb-3 flex gap-2">
            {([['abiertos', 'Abiertos', abiertos.length], ['terminados', 'Terminados', totalTerminados]] as const).map(([id, label, n]) => (
              <button key={id} type="button" onClick={() => setVista(id)} aria-pressed={vista === id}
                className={`btn-press inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${vista === id ? 'border-teal-500 bg-teal-500/15 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}>
                {label}<span className="rounded-full bg-surface2 px-1.5 text-xs tabular-nums">{n}</span>
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-sub">Agrupar por:</span>
            <div className="inline-flex rounded-xl border border-line bg-surface p-0.5">
              {(isAdmin ? MODOS_ADMIN : MODOS_LOCAL).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setModo(id)} aria-pressed={modo === id}
                  className={`rounded-lg px-3 py-1 text-sm font-semibold ${modo === id ? 'bg-teal-600 text-white' : 'text-sub hover:text-ink'}`}>{label}</button>
              ))}
            </div>
            {modo !== 'nada' && (
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => setAbiertosG(todasLasClaves())} className="px-1.5 text-xs font-semibold text-teal-500 hover:underline">Abrir todo</button>
                <button type="button" onClick={() => setAbiertosG(new Set())} className="px-1.5 text-xs font-semibold text-teal-500 hover:underline">Cerrar todo</button>
              </span>
            )}
          </div>
          {(vista === 'abiertos' ? abiertos : terminados).length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-4 text-sm text-sub">
              {vista === 'abiertos' ? 'No hay requerimientos abiertos.' : 'Todavía no hay requerimientos terminados.'}
            </p>
          ) : (
            modo === 'nada'
              ? <ul className="space-y-2">{listaVista.map(tarjeta)}</ul>
              : <div className="space-y-2">{pintarNodos(arbol, 0)}</div>
          )}
          {vista === 'terminados' && terminados.length < totalTerminados && (
            <button type="button" onClick={() => setTope((t) => t + TANDA)}
              className="btn-press mt-3 h-10 w-full rounded-xl border border-line bg-surface text-sm font-semibold text-sub hover:text-ink">
              Ver más ({totalTerminados - terminados.length} restantes)
            </button>
          )}
        </section>
      )}
    </Layout>
  )
}
