import {
  Briefcase,
  Wallet,
  Users,
  Boxes,
  Megaphone,
  ShoppingCart,
  Server,
  Store,
  Palette,
  Warehouse,
  Building2,
  PencilRuler,
  Bell,
  Truck,
  ClipboardList,
  Copy,
  type LucideIcon,
} from 'lucide-react'

/**
 * ===== ESTRUCTURA DEL HUB =====
 *
 * Nivel 1: AREAS de la empresa (lo que se ve en el menú principal).
 * Nivel 2: APPS dentro de cada área (herramientas/módulos).
 *
 * Para sumar un área -> agregar a AREAS.
 * Para sumar una app -> agregar a APPS con su areaId.
 *   - kind 'external': abre otra PWA/URL (ej. transporte, control locales).
 *   - kind 'internal': ruta dentro de este hub (se construye acá adentro).
 */

export interface AreaDef {
  id: string
  name: string
  icon: LucideIcon
  accent: string
}

export type AppKind = 'external' | 'internal'

export interface AppDef {
  id: string
  areaId: string
  title: string
  description: string
  icon: LucideIcon
  kind: AppKind
  /** external: URL destino · internal: ruta interna (ej. /repo-diaria) */
  target: string
  comingSoon?: boolean
}

export const AREAS: AreaDef[] = [
  { id: 'administracion', name: 'Administración', icon: Briefcase, accent: 'text-sky-400' },
  { id: 'tesoreria', name: 'Tesorería', icon: Wallet, accent: 'text-emerald-400' },
  { id: 'rrhh', name: 'RR. HH.', icon: Users, accent: 'text-violet-400' },
  { id: 'mayorista', name: 'Mayorista', icon: Boxes, accent: 'text-amber-400' },
  { id: 'marketing', name: 'Marketing', icon: Megaphone, accent: 'text-pink-400' },
  { id: 'compras', name: 'Compras', icon: ShoppingCart, accent: 'text-lime-400' },
  { id: 'sistemas', name: 'Sistemas', icon: Server, accent: 'text-cyan-400' },
  { id: 'locales', name: 'Locales', icon: Store, accent: 'text-green-400' },
  { id: 'diseno', name: 'Diseño', icon: Palette, accent: 'text-fuchsia-400' },
  { id: 'deposito', name: 'Depósito', icon: Warehouse, accent: 'text-orange-400' },
  { id: 'polo52', name: 'Polo 52', icon: Building2, accent: 'text-indigo-400' },
  { id: 'arquitectura', name: 'Arquitectura', icon: PencilRuler, accent: 'text-teal-400' },
  { id: 'recepcion', name: 'Recepción', icon: Bell, accent: 'text-rose-400' },
]

const URL_TRANSPORTE = import.meta.env.VITE_URL_TRANSPORTE?.trim() || ''
const URL_CONTROL_LOCALES = import.meta.env.VITE_URL_CONTROL_LOCALES?.trim() || ''

/**
 * Apps conocidas. La ubicación por área es una propuesta inicial:
 * mover un app a otra área = cambiar su `areaId`.
 */
export const APPS: AppDef[] = [
  {
    id: 'control-locales',
    areaId: 'locales',
    title: 'Control de Locales',
    description: 'Auditorías, inspectores, sectores y reportes.',
    icon: Store,
    kind: 'external',
    target: URL_CONTROL_LOCALES,
    comingSoon: !URL_CONTROL_LOCALES,
  },
  {
    id: 'transporte',
    areaId: 'deposito',
    title: 'Transporte',
    description: 'Bultos, sesiones, remitos y stock entre bases.',
    icon: Truck,
    kind: 'external',
    target: URL_TRANSPORTE,
    comingSoon: !URL_TRANSPORTE,
  },
  {
    id: 'repo-diaria',
    areaId: 'deposito',
    title: 'Repo Diaria',
    description: 'Reposición diaria. En construcción.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/repo-diaria',
    comingSoon: true,
  },
  {
    id: 'replicas',
    areaId: 'deposito',
    title: 'Réplicas',
    description: 'Gestión de réplicas. En construcción.',
    icon: Copy,
    kind: 'internal',
    target: '/replicas',
    comingSoon: true,
  },
]

export function appsDeArea(areaId: string): AppDef[] {
  return APPS.filter((a) => a.areaId === areaId)
}

export function getArea(areaId: string): AreaDef | undefined {
  return AREAS.find((a) => a.id === areaId)
}
