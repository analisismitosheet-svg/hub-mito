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
  Contact,
  BookOpen,
  Wrench,
  CreditCard,
  Eye,
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
  /** color propio del área (hex) para tintar ícono y barra de acento */
  color: string
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
  /** color propio de la app (hex) para tintar ícono y barra de acento */
  color: string
  /** permiso requerido para ver/entrar (ej. 'cuentas_amigos.view'); si falta, la app es pública dentro del área */
  permiso?: string
  /** áreas adicionales donde también aparece la app (además de areaId) */
  areaIds?: string[]
}

// accent: color de nivel 600 para contraste AA sobre superficies claras (Soft UI)
// color: hex propio del área para tintar ícono/barra (identidad visual por área)
export const AREAS: AreaDef[] = [
  { id: 'administracion', name: 'Administración', icon: Briefcase, accent: 'text-sky-600', color: '#0284c7' },
  { id: 'tesoreria', name: 'Tesorería', icon: Wallet, accent: 'text-emerald-600', color: '#059669' },
  { id: 'rrhh', name: 'RR. HH.', icon: Users, accent: 'text-violet-600', color: '#7c3aed' },
  { id: 'mayorista', name: 'Mayorista', icon: Boxes, accent: 'text-amber-600', color: '#d97706' },
  { id: 'marketing', name: 'Marketing', icon: Megaphone, accent: 'text-pink-600', color: '#db2777' },
  { id: 'compras', name: 'Compras', icon: ShoppingCart, accent: 'text-lime-600', color: '#65a30d' },
  { id: 'sistemas', name: 'Sistemas', icon: Server, accent: 'text-cyan-600', color: '#0891b2' },
  { id: 'locales', name: 'Locales', icon: Store, accent: 'text-green-600', color: '#16a34a' },
  { id: 'diseno', name: 'Diseño', icon: Palette, accent: 'text-fuchsia-600', color: '#c026d3' },
  { id: 'deposito', name: 'Depósito', icon: Warehouse, accent: 'text-orange-600', color: '#ea580c' },
  { id: 'polo52', name: 'Polo 52', icon: Building2, accent: 'text-indigo-600', color: '#4f46e5' },
  { id: 'arquitectura', name: 'Arquitectura', icon: PencilRuler, accent: 'text-teal-600', color: '#0d9488' },
  { id: 'recepcion', name: 'Recepción', icon: Bell, accent: 'text-rose-600', color: '#e11d48' },
  { id: 'mantenimiento', name: 'Mantenimiento', icon: Wrench, accent: 'text-slate-400', color: '#64748b' },
]

const URL_TRANSPORTE =
  import.meta.env.VITE_URL_TRANSPORTE?.trim() || 'https://project-r4hl5.vercel.app'
const URL_CONTROL_LOCALES =
  import.meta.env.VITE_URL_CONTROL_LOCALES?.trim() || 'https://control-locales-pwa.vercel.app'

/**
 * Apps conocidas. La ubicación por área es una propuesta inicial:
 * mover un app a otra área = cambiar su `areaId`.
 */
export const APPS: AppDef[] = [
  {
    id: 'cuenta-amigos',
    areaId: 'tesoreria',
    areaIds: ['tesoreria', 'locales'],
    title: 'Cuentas Amigos',
    description: 'Clientes habilitados para retirar mercadería.',
    icon: Contact,
    kind: 'internal',
    target: '/cuenta-amigos',
    color: '#0d9488',
    permiso: 'cuentas_amigos.view',
  },
  {
    id: 'manuales',
    areaId: 'locales',
    title: 'Manuales',
    description: 'Instructivos y documentos: Excel, Word, PDF y más.',
    icon: BookOpen,
    kind: 'internal',
    target: '/manuales',
    color: '#16a34a',
    permiso: 'manuales.view',
  },
  {
    id: 'errores-tarjetas',
    areaId: 'locales',
    title: 'Errores tarjetas',
    description: 'Formulario para reportar errores de tarjetas.',
    icon: CreditCard,
    kind: 'external',
    target: 'https://docs.google.com/forms/d/e/1FAIpQLSdD1eOXY9DVK0TZLqSrCnX6n4M8QUpgBbFUfwGSpe3brj-kDg/viewform',
    color: '#f97316',
  },
  {
    id: 'carga-requerimientos',
    areaId: 'locales',
    title: 'Carga requerimientos',
    description: 'Formulario para cargar requerimientos.',
    icon: ClipboardList,
    kind: 'external',
    target: 'https://docs.google.com/forms/d/e/1FAIpQLSfYBY4jL-YkZuAkMAvmqzDlhQWwP1DbdVhcV66jdbBi3jenpQ/viewform',
    color: '#3b82f6',
  },
  {
    id: 'control-vidrieras',
    areaId: 'locales',
    title: 'Control vidrieras',
    description: 'Formulario de control de vidrieras.',
    icon: Eye,
    kind: 'external',
    target: 'https://docs.google.com/forms/d/e/1FAIpQLScDiCgnqRrmdx705tjFVUfdYXw4EdFETAfuAAEZiBGDiNmgAA/viewform',
    color: '#a855f7',
  },
  {
    id: 'control-locales',
    areaId: 'locales',
    title: 'Control de Locales',
    description: 'Auditorías, inspectores, sectores y reportes.',
    icon: Store,
    kind: 'external',
    target: URL_CONTROL_LOCALES,
    comingSoon: !URL_CONTROL_LOCALES,
    color: '#16a34a',
  },
  {
    id: 'transporte',
    areaId: 'locales',
    title: 'Transporte',
    description: 'Bultos, sesiones, remitos y stock entre bases.',
    icon: Truck,
    kind: 'external',
    target: URL_TRANSPORTE,
    comingSoon: !URL_TRANSPORTE,
    color: '#0891b2',
  },
  {
    id: 'repo-diaria',
    areaId: 'compras',
    title: 'Repo Diaria',
    description: 'Reposición diaria. En construcción.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/repo-diaria',
    comingSoon: true,
    color: '#d97706',
  },
  {
    id: 'replicas',
    areaId: 'sistemas',
    title: 'Réplicas',
    description: 'Gestión de réplicas. En construcción.',
    icon: Copy,
    kind: 'internal',
    target: '/replicas',
    comingSoon: true,
    color: '#7c3aed',
  },
]

export function appsDeArea(areaId: string): AppDef[] {
  return APPS.filter((a) => a.areaId === areaId || a.areaIds?.includes(areaId))
}

export function getArea(areaId: string): AreaDef | undefined {
  return AREAS.find((a) => a.id === areaId)
}
