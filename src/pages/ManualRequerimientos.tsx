import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BookOpen, ChevronLeft, ChevronRight, ChevronDown, FolderOpen, Inbox, CalendarClock, ListChecks, Wrench,
  CircleCheck, ThumbsUp, Tags, Pencil, ArrowRight, ExternalLink, type LucideIcon,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'

/* ------------------------------------------------------------------ */
/*  Arquitectura → Manual de uso (Requerimientos).                     */
/*  Paso a paso con capturas reales (public/manual/requerimientos,     */
/*  WebP: no entran en el precache del service worker). El paso va en  */
/*  ?paso=N para poder pasar el link de un paso puntual.               */
/* ------------------------------------------------------------------ */

interface Paso {
  titulo: string
  icon: LucideIcon
  color: string
  img: string
  alt: string
  texto: string
  puntos: string[]
  link?: { a: string; label: string }
}

const IMG = '/manual/requerimientos'

const PASOS: Paso[] = [
  {
    titulo: 'Dónde está',
    icon: FolderOpen, color: '#14b8a6',
    img: `${IMG}/01-carpeta.webp`, alt: 'Carpeta Requerimientos con sus tarjetas',
    texto: 'En el hub entrá a Arquitectura → Requerimientos.',
    puntos: [
      'Bandeja de requerimientos: todo lo que cargan los locales.',
      'Mis tareas: lo que ve mantenimiento.',
      'Nuevo requerimiento: el formulario de los locales.',
      'Rubros: la lista de rubros del formulario.',
    ],
    link: { a: '/arquitectura/requerimientos', label: 'Abrir Requerimientos' },
  },
  {
    titulo: 'La bandeja',
    icon: Inbox, color: '#0284c7',
    img: `${IMG}/02-bandeja.webp`, alt: 'Bandeja de requerimientos, pestaña Sin programar',
    texto: 'Los pedidos nuevos caen en «Sin programar». Cada pestaña es un estado y el número es cuántos hay.',
    puntos: [
      'Cada tarjeta: local, rubro, prioridad, qué pasa, quién lo pidió y fotos.',
      'Los días abiertos se ponen en rojo cuando pasan de 7.',
      'Filtrá por local, rubro o prioridad, o buscá por N°, texto o persona.',
      '«Fecha: más viejos primero» muestra lo más atrasado arriba.',
    ],
    link: { a: '/arquitectura/requerimientos/bandeja', label: 'Abrir la bandeja' },
  },
  {
    titulo: 'Programar',
    icon: CalendarClock, color: '#0d9488',
    img: `${IMG}/03-programar.webp`, alt: 'Panel para programar: día, horario, quién va y nota',
    texto: 'Tocá «Programar» en el pedido y completá:',
    puntos: [
      'Día y horario.',
      '¿Quién va? Marcá una o más personas de mantenimiento.',
      'Una nota si hace falta (ej.: «llevar tira LED»).',
      'Tocá «Confirmar».',
    ],
  },
  {
    titulo: 'Programados',
    icon: ListChecks, color: '#6366f1',
    img: `${IMG}/04-programados.webp`, alt: 'Pestaña Programados con el día, la hora y quién va',
    texto: 'El pedido pasa a «Programados» con el día, la hora y quién va.',
    puntos: [
      'Al local le llega un aviso al celular con la tarea, el día y la hora.',
      'A mantenimiento le aparece en «Mis tareas».',
      '«Reprogramar» cambia la fecha o la gente (el local recibe el aviso nuevo).',
    ],
  },
  {
    titulo: 'Lo que ve mantenimiento',
    icon: Wrench, color: '#64748b',
    img: `${IMG}/08-mis-tareas.webp`, alt: 'Mis tareas de mantenimiento, agrupadas por día',
    texto: 'En «Mis tareas» mantenimiento ve lo programado por día y hora, con tu nota.',
    puntos: [
      '«Empezar» lo pasa a «En curso».',
      '«Terminar» pide un comentario y una foto del arreglo.',
      'Al terminar, el pedido queda «A confirmar» por el local.',
    ],
  },
  {
    titulo: 'A confirmar',
    icon: CircleCheck, color: '#65a30d',
    img: `${IMG}/05-a-confirmar.webp`, alt: 'Pestaña A confirmar con lo que hizo mantenimiento',
    texto: 'Acá esperan los pedidos que ya se hicieron, hasta que el local dé el OK.',
    puntos: [
      'Ves quién lo terminó, cuándo y qué hizo.',
      'Vos también podés tocar «Terminado» en un pedido abierto (aunque no lo hayas programado): pasa a «A confirmar».',
      '«No corresponde» cierra el pedido con un motivo (repetido, no es de Arquitectura…).',
      '«Reabrir», en «Cerrados», lo vuelve a «Sin programar».',
    ],
  },
  {
    titulo: 'El local confirma',
    icon: ThumbsUp, color: '#16a34a',
    img: `${IMG}/09-local-confirma.webp`, alt: 'Recuadro Para confirmar del local con Quedó listo y No quedó bien',
    texto: 'El local ve el arreglo en «Para confirmar» (y en la campana):',
    puntos: [
      '«Quedó listo»: se cierra como resuelto, a nombre del local.',
      '«No quedó bien»: vuelve a tu bandeja en «Sin programar», con el motivo en rojo. Hay que programarlo de nuevo.',
      'El local también puede cerrar un pedido abierto con «Terminado» si lo resolvió por su cuenta.',
    ],
  },
  {
    titulo: 'Rubros',
    icon: Tags, color: '#c026d3',
    img: `${IMG}/06-rubros.webp`, alt: 'Lista de rubros con Editar y Borrar',
    texto: 'La lista de rubros que eligen los locales en el formulario.',
    puntos: [
      '«Nuevo rubro»: nombre, ícono y color.',
      '«Borrar»: si nunca se usó, se borra; si ya tiene pedidos queda «Oculto» (sale del formulario, el historial lo guarda).',
      '«Reactivar» vuelve a mostrar un rubro oculto.',
    ],
    link: { a: '/arquitectura/requerimientos/rubros', label: 'Abrir Rubros' },
  },
  {
    titulo: 'Editar un rubro',
    icon: Pencil, color: '#ea580c',
    img: `${IMG}/07-rubro-editar.webp`, alt: 'Edición de un rubro: nombre, color e ícono',
    texto: 'Tocá «Editar», cambiá lo que necesites y «Guardar».',
    puntos: [
      'Si cambiás el nombre, los pedidos viejos pasan al nombre nuevo.',
      'El color y el ícono se ven en la bandeja, en Mis tareas y en el formulario.',
    ],
  },
]

/** Recorrido de un pedido: cada estado lleva al paso que lo explica. */
const ESTADOS: { label: string; paso: number; clase: string }[] = [
  { label: 'Sin programar', paso: 1, clase: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  { label: 'Programado', paso: 3, clase: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  { label: 'En curso', paso: 4, clase: 'border-violet-500/40 bg-violet-500/10 text-violet-500' },
  { label: 'A confirmar', paso: 5, clase: 'border-lime-500/40 bg-lime-500/10 text-lime-500' },
  { label: 'Resuelto', paso: 6, clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
]

const PREGUNTAS: { p: string; r: string }[] = [
  { p: '¿Puedo dar por resuelto un pedido yo?', r: 'No: «Terminado» lo deja «A confirmar» y el OK final lo da el local que lo pidió. Si el pedido no va, usá «No corresponde».' },
  { p: '¿Qué pasa si el local dice que no quedó bien?', r: 'Vuelve a «Sin programar» con el motivo del local en rojo. Programalo de nuevo (día, horario y quién va).' },
  { p: '¿Cómo veo lo más atrasado?', r: 'En la bandeja tocá el botón de fecha hasta que diga «más viejos primero». Los días abiertos en rojo pasan de 7.' },
  { p: '¿Puedo mandar a dos personas?', r: 'Sí: al programar marcá todas las que van. A cada una le aparece en «Mis tareas».' },
  { p: '¿Se pierde algo si borro un rubro?', r: 'No. Si el rubro tiene pedidos, queda oculto en vez de borrarse, y lo podés reactivar.' },
  { p: '¿Hay que recargar la bandeja?', r: 'No: se actualiza sola cuando un local carga o confirma algo.' },
]

export default function ManualRequerimientos() {
  const [params, setParams] = useSearchParams()
  const n = Math.min(Math.max(Number(params.get('paso')) || 1, 1), PASOS.length)
  const i = n - 1
  const paso = PASOS[i]
  const ir = (k: number) => setParams({ paso: String(Math.min(Math.max(k, 1), PASOS.length)) }, { replace: true })

  // Flechas del teclado para avanzar y volver
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') ir(n + 1)
      if (e.key === 'ArrowLeft') ir(n - 1)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const btn = 'btn-press inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-40'

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <BookOpen size={22} className="text-amber-500" aria-hidden /> Manual de uso · Requerimientos
        </h1>
        <p className="mt-1 text-sm text-sub">Los locales cargan los arreglos, Arquitectura los programa, mantenimiento los hace y el local da el OK.</p>
      </header>

      {/* Recorrido de un pedido */}
      <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sub/80">El recorrido de un pedido (tocá un estado)</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {ESTADOS.map((e, k) => (
            <span key={e.label} className="flex items-center gap-1.5">
              <button type="button" onClick={() => ir(e.paso + 1)}
                className={`btn-press rounded-full border px-3 py-1 text-sm font-semibold ${e.clase} ${n === e.paso + 1 ? 'ring-2 ring-offset-0 ring-white/30' : ''}`}>
                {e.label}
              </button>
              {k < ESTADOS.length - 1 && <ArrowRight size={14} className="text-sub/60" aria-hidden />}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-sub">Si el local dice «No quedó bien», vuelve a «Sin programar». «No corresponde» lo cierra desde cualquier estado abierto.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        {/* Índice de pasos */}
        <nav aria-label="Pasos del manual" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {PASOS.map((p, k) => (
            <button key={p.titulo} type="button" onClick={() => ir(k + 1)} aria-current={k === i ? 'step' : undefined}
              className={`btn-press flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${k === i ? 'border-amber-500/60 bg-amber-500/10 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: p.color }}>{k + 1}</span>
              {p.titulo}
            </button>
          ))}
        </nav>

        {/* Paso actual */}
        <article className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <p className="text-xs font-semibold text-sub">Paso {n} de {PASOS.length}</p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <paso.icon size={20} style={{ color: paso.color }} aria-hidden /> {paso.titulo}
          </h2>
          <p className="mt-2 text-sm text-ink">{paso.texto}</p>
          <ul className="mt-2 space-y-1.5">
            {paso.puntos.map((t) => (
              <li key={t} className="flex gap-2 text-sm text-sub">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: paso.color }} aria-hidden />
                {t}
              </li>
            ))}
          </ul>
          <a href={paso.img} target="_blank" rel="noreferrer" title="Ver la imagen en grande"
            className="mt-4 block overflow-hidden rounded-xl border border-line">
            <img src={paso.img} alt={paso.alt} width={800} height={552} className="h-auto w-full" />
          </a>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => ir(n - 1)} disabled={n === 1} className={`${btn} border border-line bg-surface2 text-ink`}>
              <ChevronLeft size={16} aria-hidden /> Anterior
            </button>
            {paso.link && (
              <Link to={paso.link.a} className={`${btn} border border-teal-500/40 bg-teal-500/10 text-teal-500`}>
                {paso.link.label} <ExternalLink size={14} aria-hidden />
              </Link>
            )}
            <button type="button" onClick={() => ir(n + 1)} disabled={n === PASOS.length} className={`${btn} bg-amber-600 text-white hover:bg-amber-700`}>
              Siguiente <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        </article>
      </div>

      {/* Preguntas rápidas */}
      <section className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold text-ink">Preguntas rápidas</h2>
        <div className="space-y-2">
          {PREGUNTAS.map((q) => (
            <details key={q.p} className="group rounded-xl border border-line bg-surface p-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink">
                {q.p}
                <ChevronDown size={16} className="shrink-0 text-sub transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-2 text-sm text-sub">{q.r}</p>
            </details>
          ))}
        </div>
      </section>
    </Layout>
  )
}
