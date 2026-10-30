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
  Factory,
  CreditCard,
  Eye,
  ArrowRightLeft,
  Star,
  Database,
  FileText,
  TrendingUp,
  FolderOpen,
  RotateCcw,
  Cake,
  ScanLine,
  PackageCheck,
  Footprints,
  ScanEye,
  Percent,
  Target,
  Map as MapIcon,
  ListOrdered,
  PackageSearch,
  Package,
  QrCode,
  Pause,
  Tag,
  FilePlus,
  CircleDollarSign,
  Clock,
  CircleCheck,
  CircleX,
  Home,
  ShieldCheck,
  Navigation,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

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
  /** grupo/encabezado opcional dentro del área (ej. 'Novedades') para agrupar apps visualmente */
  grupo?: string
  /** solo la ven las cuentas de legajo (empleados de piso) y los administradores */
  soloLegajo?: boolean
  /**
   * Acceso directo en el MENÚ PRINCIPAL (no se lista dentro de las áreas).
   * Sus áreas (areaId/areaIds o las tildadas en Roles → Ubicación de menús)
   * ya no dicen dónde aparece sino QUIÉN lo ve: el que pueda ver alguna.
   */
  enMenu?: boolean
  /** oculta la tarjeta para todos (incluso admin); la ruta sigue andando */
  oculto?: boolean
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
  { id: 'produccion', name: 'Producción', icon: Factory, accent: 'text-yellow-600', color: '#ca8a04' },
  { id: 'administradores', name: 'Administradores', icon: ShieldCheck, accent: 'text-red-600', color: '#dc2626' },
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
    areaIds: ['locales', 'deposito', 'rrhh'],
    title: 'Control de Locales',
    description: 'Auditorías, inspectores, sectores y reportes.',
    icon: Store,
    kind: 'external',
    target: URL_CONTROL_LOCALES,
    comingSoon: !URL_CONTROL_LOCALES,
    color: '#16a34a',
    enMenu: true,
  },
  {
    id: 'transporte',
    areaId: 'locales',
    areaIds: ['locales', 'deposito', 'polo52', 'mayorista'],
    title: 'Transporte',
    description: 'Bultos, sesiones, remitos y stock entre bases.',
    icon: Truck,
    kind: 'external',
    target: URL_TRANSPORTE,
    comingSoon: !URL_TRANSPORTE,
    color: '#0891b2',
    enMenu: true,
  },
  {
    id: 'tracking-transporte',
    areaId: 'administradores',
    title: 'Tracking de transporte',
    description: 'Dónde está cada vehículo, qué lleva, qué entregó y por qué puntos de control pasó.',
    icon: Navigation,
    kind: 'internal',
    target: '/administradores/tracking',
    color: '#2563eb',
    permiso: 'tracking.view',
  },
  {
    id: 'stock-valorizado',
    areaId: 'administradores',
    title: 'Stock valorizado',
    description: 'Cuántas unidades hay y cuánta plata es, a costo, sucursal por sucursal.',
    icon: Wallet,
    kind: 'internal',
    target: '/administradores/stock-valorizado',
    color: '#10b981',
    permiso: 'stock_valorizado.view',
  },
  {
    id: 'ventas-web',
    areaId: 'administradores',
    title: 'Ventas web',
    description: 'Pedidos y facturación de la tienda Tiendanube, día por día.',
    icon: ShoppingBag,
    kind: 'internal',
    target: '/administradores/ventas-web',
    color: '#a855f7',
    permiso: 'tiendanube.view',
  },
  {
    id: 'mayorista-repo',
    areaId: 'mayorista',
    title: 'Repos Mayorista',
    description: 'Preparar repos por local: marcar hecho o faltante.',
    icon: Store,
    kind: 'internal',
    target: '/mayorista',
    color: '#d97706',
    permiso: 'mayorista.view',
    oculto: true,
  },
  {
    id: 'mayorista-mi-repo',
    areaId: 'mayorista',
    title: 'Mi repo',
    description: 'Escaneo en piso: tus locales asignados, artículo por artículo.',
    icon: ScanLine,
    kind: 'internal',
    target: '/mayorista/mi-repo',
    color: '#d97706',
    permiso: 'mayorista.repos_piso',
    soloLegajo: true,
  },
  {
    id: 'mayorista-pausas',
    areaId: 'mayorista',
    title: 'Pausas por autorizar',
    description: 'Pedidos de pausa del piso: autorizar quién puede parar y por qué.',
    icon: Pause,
    kind: 'internal',
    target: '/mayorista/pausas',
    color: '#f59e0b',
    permiso: 'mayorista.pausas.autorizar',
  },
  {
    id: 'mayorista-transportes',
    areaId: 'mayorista',
    title: 'Transportes Mayorista',
    description: 'ABM de transportes: crear, editar, activar/desactivar.',
    icon: Truck,
    kind: 'internal',
    target: '/mayorista/transportes',
    color: '#0891b2',
    permiso: 'mayorista.transportes.view',
  },
  {
    id: 'mayorista-clientes',
    areaId: 'mayorista',
    title: 'Clientes',
    description: 'ABM de clientes mayoristas, direcciones y condiciones de pago.',
    icon: Users,
    kind: 'internal',
    target: '/mayorista/clientes',
    color: '#d97706',
    permiso: 'mayorista.clientes.view',
  },
  {
    id: 'mayorista-facturacion',
    areaId: 'mayorista',
    title: 'Facturacion Fabrica',
    description: 'Gestion de facturacion, remitos y despachos desde fabrica.',
    icon: FileText,
    kind: 'internal',
    target: '/mayorista/facturacion-fabrica',
    color: '#d97706',
    permiso: 'mayorista.facturacion.view',
  },
  {
    id: 'mayorista-guias',
    areaId: 'mayorista',
    title: 'Guias',
    description: 'Gestion de guias de despacho y pedidos.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/mayorista/guias',
    color: '#0891b2',
    permiso: 'mayorista.guias.view',
  },
  {
    id: 'mayorista-notas-credito',
    areaId: 'mayorista',
    title: 'Notas de Credito',
    description: 'Notas de credito generadas desde guias.',
    icon: FileText,
    kind: 'internal',
    target: '/mayorista/notas-credito',
    color: '#f59e0b',
    permiso: 'mayorista.notas_credito.view',
  },
  {
    id: 'mayorista-pedidos-venta',
    areaId: 'mayorista',
    title: 'Pedidos de venta',
    description: 'Pedidos de clientes mayoristas de Dragonfish: artículos, cantidades y totales.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/mayorista/pedidos-venta',
    color: '#65a30d',
    permiso: 'pedidos_venta.view',
  },
  {
    id: 'mayorista-consulta-articulos',
    areaId: 'mayorista',
    title: 'F12 Consulta artículos',
    description: 'Datos de MITO por artículo + color + talle: stock, ubicación y precio.',
    icon: PackageSearch,
    kind: 'internal',
    target: '/mayorista/consulta-articulos',
    color: '#d97706',
    permiso: 'mayorista.articulos.view',
  },
  {
    id: 'mayorista-mapeo',
    areaId: 'mayorista',
    title: 'Mapeo depósito',
    description: 'Escaneo por ubicación, orden mapeado y lista de pasillos / niveles.',
    icon: MapIcon,
    kind: 'internal',
    target: '/mayorista/mapeo',
    color: '#d97706',
    permiso: 'mayorista.mapeo.view',
  },
  {
    id: 'mapeo-escanear',
    areaId: 'mayorista-mapeo',
    title: 'Escanear',
    description: 'QR de la ubicación y después los artículos que están ahí.',
    icon: ScanLine,
    kind: 'internal',
    target: '/mayorista/mapeo/escanear',
    color: '#d97706',
    permiso: 'mayorista.mapeo.escanear',
  },
  {
    id: 'mapeo-orden',
    areaId: 'mayorista-mapeo',
    title: 'Orden mapeado',
    description: 'El recorrido del depósito agrupado por ubicación. Exporta a Excel.',
    icon: ListOrdered,
    kind: 'internal',
    target: '/mayorista/mapeo/orden',
    color: '#0891b2',
    permiso: 'mayorista.mapeo.view',
  },
  {
    id: 'mapeo-ubicaciones',
    areaId: 'mayorista-mapeo',
    title: 'Lista pasillos / niveles',
    description: 'Crear pasillos y niveles e imprimir sus QR en membrete.',
    icon: QrCode,
    kind: 'internal',
    target: '/mayorista/mapeo/ubicaciones',
    color: '#7c3aed',
    permiso: 'mayorista.mapeo.view',
  },
  {
    id: 'mayorista-franquicias',
    areaId: 'mayorista',
    title: 'Franquicias',
    description: 'Reposición diaria automática: cada cliente con su base y sus WhatsApps, días y hora de salida, y las ventas por cliente y fecha.',
    icon: Building2,
    kind: 'internal',
    target: '/mayorista/franquicias',
    color: '#d97706',
    permiso: 'mayorista.franquicias.view',
  },
  {
    id: 'mayorista-estadisticas',
    areaId: 'mayorista',
    areaIds: ['rrhh'],
    title: 'Eficiencia mayorista',
    description: 'Repos VTD por día, semana y local, y tiempo real en piso.',
    icon: TrendingUp,
    kind: 'internal',
    target: '/mayorista/estadisticas',
    color: '#0d9488',
    permiso: 'mayorista.estadisticas.view',
  },
  {
    id: 'rrhh-novedades',
    areaId: 'rrhh',
    title: 'Novedades',
    description: 'Carga y resumen de novedades de empleados.',
    icon: FolderOpen,
    kind: 'internal',
    target: '/rrhh/novedades',
    color: '#7c3aed',
    permiso: 'rrhh.novedades.view',
  },
  {
    id: 'rrhh-novedades-carga',
    areaId: 'rrhh-novedades',
    title: 'Carga Novedades',
    description: 'Cargar o editar novedades de empleados.',
    icon: Megaphone,
    kind: 'internal',
    target: '/rrhh/novedades/carga',
    color: '#7c3aed',
    permiso: 'rrhh.novedades.create',
  },
  {
    id: 'rrhh-novedades-resumen',
    areaId: 'rrhh-novedades',
    title: 'Resumen Novedades',
    description: 'Resumen y filtros de novedades de empleados.',
    icon: Megaphone,
    kind: 'internal',
    target: '/rrhh/novedades/resumen',
    color: '#7c3aed',
    permiso: 'rrhh.novedades.view',
  },
  {
    id: 'rrhh-novedades-motivos',
    areaId: 'rrhh-novedades',
    title: 'Motivos',
    description: 'Crear, editar o borrar motivos de novedades y elegir su color.',
    icon: Palette,
    kind: 'internal',
    target: '/rrhh/novedades/motivos',
    color: '#7c3aed',
    permiso: 'rrhh.novedades.view',
  },
  {
    id: 'rrhh-empleados',
    areaId: 'rrhh',
    title: 'Empleados',
    description: 'Nómina activa, planes activos y bajas.',
    icon: Users,
    kind: 'internal',
    target: '/rrhh/empleados',
    color: '#7c3aed',
    permiso: 'rrhh.empleados.view',
  },
  {
    id: 'rrhh-cumpleanos',
    areaId: 'rrhh',
    title: 'Cumpleaños',
    description: 'Calendario mensual de cumpleaños de empleados.',
    icon: Cake,
    kind: 'internal',
    target: '/rrhh/cumpleanios',
    color: '#ec4899',
    permiso: 'rrhh.empleados.view',
  },
  {
    id: 'polo52-facturacion',
    areaId: 'polo52',
    title: 'Facturacion Fabrica',
    description: 'Despachos POLO52 desde fabrica (solo marcados).',
    icon: FileText,
    kind: 'internal',
    target: '/mayorista/facturacion-fabrica?polo52=1',
    color: '#4f46e5',
    permiso: 'mayorista.facturacion.view',
  },
  {
    id: 'deposito-repo',
    areaId: 'deposito',
    title: 'Repos Depósito',
    description: 'Preparar repos por local: marcar hecho o faltante.',
    icon: Store,
    kind: 'internal',
    target: '/deposito',
    color: '#ea580c',
    permiso: 'deposito.view',
  },
  {
    id: 'deposito-rma',
    areaId: 'deposito',
    title: 'RMA',
    description: 'Gestión de RMA (devoluciones).',
    icon: RotateCcw,
    kind: 'internal',
    target: '/deposito/rma',
    color: '#ea580c',
    permiso: 'deposito.view',
  },
  {
    id: 'deposito-picking',
    areaId: 'deposito',
    title: 'Picking',
    description: 'Ingreso físico de pedidos de compra: por proveedor y N° de pedido, marcá lo que llegó.',
    icon: PackageCheck,
    kind: 'internal',
    target: '/deposito/picking',
    color: '#0d9488',
    permiso: 'picking.view',
  },
  {
    id: 'deposito-recepcion-indo',
    areaId: 'deposito',
    title: 'Recepción INDO',
    description: 'Recepción de mercadería: subí el Excel y marcá qué ya se controló.',
    icon: Package,
    kind: 'internal',
    target: '/deposito/recepcion-indo',
    color: '#ea580c',
    permiso: 'deposito.view',
  },
  {
    id: 'transferencias',
    areaId: 'compras',
    areaIds: ['compras', 'locales'],
    title: 'Reposiciones / Transferencias',
    description: 'Subí el Excel; cada local marca lo que ya envió.',
    icon: ArrowRightLeft,
    kind: 'internal',
    target: '/transferencias',
    color: '#d97706',
    permiso: 'transferencias.view',
  },
  {
    id: 'pedidos-compra',
    areaId: 'compras',
    areaIds: ['compras', 'deposito'],
    title: 'Pedidos',
    description: 'Pedidos de compra, cancelaciones y estado del ingreso.',
    icon: ClipboardList,
    kind: 'internal',
    target: '/compras/pedidos',
    color: '#65a30d',
    permiso: 'pedidos_compra.view',
  },
  {
    id: 'comparativa-precios',
    areaId: 'compras',
    title: 'Comparativa de precios',
    description: 'Tus precios contra la web de la marca: dónde estás arriba, abajo o igual.',
    icon: Tag,
    kind: 'internal',
    target: '/compras/comparativa-precios',
    color: '#0891b2',
    permiso: 'compras_precios.view',
  },
  {
    id: 'transferencias-estadisticas',
    areaId: 'compras',
    title: 'Estadísticas Transferencias',
    description: 'Dashboard de reposiciones/transferencias por local.',
    icon: TrendingUp,
    kind: 'internal',
    target: '/transferencias/estadisticas',
    color: '#65a30d',
    permiso: 'transferencias.view',
  },
  {
    id: 'opiniones',
    areaId: 'locales',
    title: 'Opiniones',
    description: 'Resultados de encuestas por local. Enlace y QR público.',
    icon: Star,
    kind: 'internal',
    target: '/opiniones',
    color: '#f59e0b',
    permiso: 'opiniones.view',
  },
  {
    id: 'contador-clientes',
    areaId: 'locales',
    title: 'Contador de clientes',
    description: 'Entradas y salidas por local desde las cámaras. Conversión con ventas.',
    icon: Footprints,
    kind: 'internal',
    target: '/contador-clientes',
    color: '#16a34a',
    permiso: 'contador.view',
  },
  {
    id: 'tasa-conversion',
    areaId: 'locales',
    title: 'Tasa de conversión',
    description: 'Video en vivo de la puerta con el conteo y conversión entradas vs tickets por local.',
    icon: Percent,
    kind: 'internal',
    target: '/tasa-conversion',
    color: '#db2777',
    permiso: 'conversion.view',
  },
  {
    id: 'objetivos-locales',
    areaId: 'locales',
    title: 'Objetivos',
    description: 'Objetivo de venta por local y por día: la venta 2025 del mismo día de la semana actualizada por el IPC del mes.',
    icon: Target,
    kind: 'internal',
    target: '/objetivos-locales',
    color: '#84cc16',
    permiso: 'objetivos.view',
  },
  {
    id: 'datos-sql',
    areaId: 'sistemas',
    title: 'Datos SQL',
    description: 'Consulta en vivo de vistas del SQL Server de la empresa.',
    icon: Database,
    kind: 'internal',
    target: '/datos-sql',
    color: '#0891b2',
    permiso: 'datos_sql.view',
  },
  {
    id: 'ia-camaras',
    areaId: 'sistemas',
    title: 'IA Cámaras',
    description: 'Vista previa de los conteos de hoy por local y estado de las PCs contadoras.',
    icon: ScanEye,
    kind: 'internal',
    target: '/ia-camaras',
    color: '#0891b2',
    permiso: 'ia_camaras.view',
  },
  {
    id: 'replicas',
    areaId: 'sistemas',
    title: 'Réplicas',
    description: 'Última actualización de cada réplica que copia el Replicador SQL.',
    icon: Copy,
    kind: 'internal',
    target: '/replicas',
    color: '#7c3aed',
  },
  {
    id: 'sistemas-franquicias',
    areaId: 'sistemas',
    title: 'Franquicias: clientes, bases y teléfonos',
    description: 'Asociá cada cliente con su base Dragon, la sucursal de stock y el teléfono de WhatsApp.',
    icon: Building2,
    kind: 'internal',
    target: '/sistemas/franquicias',
    color: '#0891b2',
    permiso: 'mayorista.franquicias.view',
  },
  {
    id: 'informes',
    areaId: 'sistemas',
    title: 'Envío informes y reportes',
    description: 'Creá informes y recibilos por WhatsApp, a mano o todos los días.',
    icon: FileText,
    kind: 'internal',
    target: '/informes',
    color: '#0891b2',
    permiso: 'sistemas.informes.view',
  },
  // ===== Arquitectura: carpeta Gestión de Obras (pantallas todavía sin construir) =====
  {
    id: 'arquitectura-obras',
    areaId: 'arquitectura',
    title: 'Gestión de Obras',
    description: 'Presupuestos, pedidos de pago, obras y reportes.',
    icon: FolderOpen,
    kind: 'internal',
    target: '/arquitectura/gestion-obras',
    color: '#0d9488',
  },
  {
    id: 'obras-cargar-presupuesto',
    areaId: 'arquitectura-obras',
    title: 'Cargar presupuesto',
    description: 'Subí el presupuesto de una obra para que lo revisen.',
    icon: FilePlus,
    kind: 'internal',
    target: '/arquitectura/presupuestos/nuevo',
    color: '#0d9488',
  },
  {
    id: 'obras-solicitar-pago',
    areaId: 'arquitectura-obras',
    title: 'Solicitar pago',
    description: 'Pedí un pago a proveedores o contratistas de una obra.',
    icon: CircleDollarSign,
    kind: 'internal',
    target: '/arquitectura/pagos/nuevo',
    color: '#059669',
  },
  {
    id: 'obras-solicitudes-pendientes',
    areaId: 'arquitectura-obras',
    title: 'Solicitudes pendientes',
    description: 'Presupuestos y pagos que esperan aprobación.',
    icon: Clock,
    kind: 'internal',
    target: '/arquitectura/solicitudes/pendientes',
    color: '#d97706',
  },
  {
    id: 'obras-solicitudes-aprobadas',
    areaId: 'arquitectura-obras',
    title: 'Solicitudes aprobadas',
    description: 'Lo que ya se aprobó, con fecha y quién lo aprobó.',
    icon: CircleCheck,
    kind: 'internal',
    target: '/arquitectura/solicitudes/aprobadas',
    color: '#65a30d',
  },
  {
    id: 'obras-solicitudes-rechazadas',
    areaId: 'arquitectura-obras',
    title: 'Solicitudes rechazadas',
    description: 'Lo rechazado y el motivo, para corregir y volver a enviar.',
    icon: CircleX,
    kind: 'internal',
    target: '/arquitectura/solicitudes/rechazadas',
    color: '#e11d48',
  },
  {
    id: 'obras',
    areaId: 'arquitectura-obras',
    title: 'Obras',
    description: 'Listado de obras con su estado, presupuesto y gastos.',
    icon: Home,
    kind: 'internal',
    target: '/arquitectura/obras',
    color: '#4f46e5',
  },
  {
    id: 'obras-reportes',
    areaId: 'arquitectura-obras',
    title: 'Reportes',
    description: 'Gastos por obra y presupuestado contra pagado.',
    icon: TrendingUp,
    kind: 'internal',
    target: '/arquitectura/reportes',
    color: '#0891b2',
  },
]

export function appsDeArea(areaId: string): AppDef[] {
  return APPS.filter((a) => !a.enMenu && !a.oculto && (a.areaId === areaId || a.areaIds?.includes(areaId)))
}

/** Accesos directos del menú principal (Transporte, Control de Locales…). */
export const ACCESOS_MENU: AppDef[] = APPS.filter((a) => a.enMenu)

/** Áreas de una app: las tildadas en Roles (override) o, si no hay, las del código. */
export function areasDeApp(app: AppDef, mapa: Record<string, string[]>): string[] {
  return mapa[app.id] ?? [app.areaId, ...(app.areaIds ?? [])]
}

export function getArea(areaId: string): AreaDef | undefined {
  return AREAS.find((a) => a.id === areaId)
}

/* ------------------------------------------------------------------ */
/*  Overrides de ubicación por área (tabla app_areas)                  */
/*  Permite tildar en qué áreas aparece cada app desde el panel Roles. */
/* ------------------------------------------------------------------ */

let overridesCache: Record<string, string[]> | null = null
let loadPromise: Promise<void> | null = null

/** Devuelve, para cada app, las áreas donde debe aparecer (override). */
export function overridesAreas(): Record<string, string[]> {
  return overridesCache ?? {}
}

/** Invalida el cache de overrides (se llama tras editar la ubicación desde Roles). */
export function invalidarOverridesAreas(): void {
  overridesCache = null
  loadPromise = null
}

/**
 * Carga la config de app_areas una sola vez. Idempotente.
 * Devuelve un mapa app_id -> area_ids.
 */
export async function cargarOverridesAreas(): Promise<Record<string, string[]>> {
  if (overridesCache) return overridesCache
  if (!loadPromise) {
    loadPromise = (async () => {
      const map: Record<string, string[]> = {}
      try {
        if (!supabase) return
        const { data } = await supabase.from('app_areas').select('app_id,area_id')
        for (const r of (data as { app_id: string; area_id: string }[] | null) ?? []) {
          const arr = map[r.app_id] ?? []
          arr.push(r.area_id)
          map[r.app_id] = arr
        }
      } catch { /* si falla, se mantiene la config estática */ }
      overridesCache = map
    })()
  }
  await loadPromise
  return overridesCache ?? {}
}

/** Aplica los overrides a la lista de apps de un área. */
export function appsDeAreaConOverrides(areaId: string, mapa: Record<string, string[]>): AppDef[] {
  const base = appsDeArea(areaId)
  const out = base.filter((a) => {
    const areas = mapa[a.id]
    if (!areas) return true // sin override: conserva el estático
    return areas.includes(areaId)
  })
  // Apps que no estaban en el estático pero se marcaron en esta área
  const idsBase = new Set(base.map((a) => a.id))
  for (const app of APPS) {
    if (idsBase.has(app.id) || app.enMenu || app.oculto) continue
    if ((mapa[app.id] ?? []).includes(areaId)) out.push(app)
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Acciones por app+área (tabla app_area_acciones)                    */
/*  Permite definir por área qué acciones se pueden hacer en cada app: */
/*  ver, crear, editar, edicion_unica, borrar.                         */
/* ------------------------------------------------------------------ */

export type AccionArea = 'ver' | 'crear' | 'editar' | 'edicion_unica' | 'borrar'
export const ACCIONES_AREA: AccionArea[] = ['ver', 'crear', 'editar', 'edicion_unica', 'borrar']
export const ACCIONES_AREA_LABEL: Record<AccionArea, string> = {
  ver: 'Ver',
  crear: 'Crear',
  editar: 'Editar',
  edicion_unica: 'Edición única',
  borrar: 'Borrar',
}

let accionesCache: Record<string, string[]> | null = null // clave: `${appId}|${areaId}`
let accionesLoadPromise: Promise<void> | null = null

/** Devuelve, para cada (app, área), la lista de acciones permitidas. */
export function accionesArea(): Record<string, string[]> {
  return accionesCache ?? {}
}

/** Invalida el cache de acciones (tras editar desde Roles). */
export function invalidarAccionesArea(): void {
  accionesCache = null
  accionesLoadPromise = null
}

/**
 * Carga app_area_acciones una sola vez. Idempotente.
 * Clave del mapa: `${appId}|${areaId}` → acciones[].
 */
export async function cargarAccionesArea(): Promise<Record<string, string[]>> {
  if (accionesCache) return accionesCache
  if (!accionesLoadPromise) {
    accionesLoadPromise = (async () => {
      const map: Record<string, string[]> = {}
      try {
        if (!supabase) return
        const { data } = await supabase.from('app_area_acciones').select('app_id,area_id,accion')
        for (const r of (data as { app_id: string; area_id: string; accion: string }[] | null) ?? []) {
          const k = `${r.app_id}|${r.area_id}`
          const arr = map[k] ?? []
          arr.push(r.accion)
          map[k] = arr
        }
      } catch { /* si falla, se mantiene el comportamiento por rol */ }
      accionesCache = map
    })()
  }
  await accionesLoadPromise
  return accionesCache ?? {}
}

/** Acciones permitidas para una (app, área) o undefined si no hay config. */
export function accionesDe(appId: string, areaId: string | undefined): string[] | undefined {
  if (!areaId) return undefined
  return accionesCache?.[`${appId}|${areaId}`]
}

const SUFIJO_ACCION = new Set(['view', 'create', 'edit', 'delete', 'import', 'mark', 'ver_todo', 'regenerar', 'borrar'])

/** Base de un permiso: quita el sufijo de acción (ej. 'cuentas_amigos.view' → 'cuentas_amigos'). */
export function moduloDePermiso(permiso: string | undefined): string {
  if (!permiso) return ''
  const i = permiso.lastIndexOf('.')
  if (i === -1) return permiso
  const suf = permiso.slice(i + 1)
  return SUFIJO_ACCION.has(suf) ? permiso.slice(0, i) : permiso
}
