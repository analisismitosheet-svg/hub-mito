import {
  Boxes,
  ScanLine,
  Pause,
  Truck,
  Contact,
  FileText,
  ShoppingCart,
  PackageSearch,
  Map as MapIcon,
  TrendingUp,
  Building2,
  Cake,
  Warehouse,
  PackageCheck,
  ArrowRightLeft,
  ClipboardList,
  Percent,
  Target,
  CreditCard,
  BookOpen,
  FolderOpen,
  Star,
  Footprints,
  QrCode,
  Megaphone,
  Tag,
  Database,
  ScanEye,
  UserCog,
  ShieldCheck,
  Settings,
  Navigation,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/**
 * ===== CATÁLOGO DE PERMISOS (pantalla Roles y permisos) =====
 *
 * Solo los permisos que el hub revisa de verdad, agrupados por app como en el menú.
 * La tabla `permisos` tiene ~1.500 claves más (area.app.accion generadas en automático)
 * que ninguna pantalla mira: no se borran, simplemente no se muestran.
 *
 * Al sumar un permiso nuevo en el código, agregarlo acá para que aparezca en Roles.
 */

export type AccionPermiso = 'ver' | 'crear' | 'editar' | 'borrar'

export const ACCIONES_PERMISO: AccionPermiso[] = ['ver', 'crear', 'editar', 'borrar']
export const ACCION_PERMISO_LABEL: Record<AccionPermiso, string> = {
  ver: 'Ver',
  crear: 'Crear',
  editar: 'Editar',
  borrar: 'Borrar',
}

export interface GrupoPermisos {
  id: string
  /** área donde se lista (ids de AREAS, o 'configuracion') */
  areaId: string
  titulo: string
  descripcion: string
  icon: LucideIcon
  color: string
  /** acción → clave en la tabla permisos */
  acciones: Partial<Record<AccionPermiso, string>>
  /** etiqueta propia para una acción (ej. usuarios.edit = "Gestionar") */
  etiquetas?: Partial<Record<AccionPermiso, string>>
  /** permisos especiales de la app (no entran en "Ver y cargar", sí en "Todo") */
  especiales?: { clave: string; label: string }[]
}

/** Área extra solo para esta pantalla (usuarios, roles, configuraciones). */
export const AREA_CONFIGURACION = { id: 'configuracion', name: 'Configuración', color: '#64748b' }

export const GRUPOS_PERMISOS: GrupoPermisos[] = [
  // ===== Mayorista =====
  {
    id: 'mayorista-repos', areaId: 'mayorista', titulo: 'Repos Mayorista', descripcion: 'Pedidos de reposición del mayorista',
    icon: Boxes, color: '#d97706',
    acciones: { ver: 'mayorista.view' },
    especiales: [
      { clave: 'mayorista.import', label: 'Importar repos' },
      { clave: 'mayorista.mark', label: 'Marcar preparado / faltante' },
    ],
  },
  {
    id: 'mayorista-mi-repo', areaId: 'mayorista', titulo: 'Mi repo', descripcion: 'Escaneo y armado en el piso',
    icon: ScanLine, color: '#eab308', acciones: { ver: 'mayorista.repos_piso' },
  },
  {
    id: 'mayorista-pausas', areaId: 'mayorista', titulo: 'Pausas por autorizar', descripcion: 'Autorizar las pausas del piso',
    icon: Pause, color: '#f43f5e', acciones: { ver: 'mayorista.pausas.autorizar' },
  },
  {
    id: 'mayorista-pedidos-venta', areaId: 'mayorista', titulo: 'Pedidos de venta', descripcion: 'Pedidos de clientes mayoristas',
    icon: ShoppingCart, color: '#65a30d', acciones: { ver: 'pedidos_venta.view' },
  },
  {
    id: 'mayorista-clientes', areaId: 'mayorista', titulo: 'Clientes', descripcion: 'Clientes mayoristas',
    icon: Contact, color: '#3b82f6',
    acciones: { ver: 'mayorista.clientes.view', crear: 'mayorista.clientes.create', editar: 'mayorista.clientes.edit', borrar: 'mayorista.clientes.delete' },
  },
  {
    id: 'mayorista-facturacion', areaId: 'mayorista', titulo: 'Facturación Fábrica', descripcion: 'También aparece en Polo 52',
    icon: FileText, color: '#8b5cf6',
    acciones: { ver: 'mayorista.facturacion.view', crear: 'mayorista.facturacion.create', editar: 'mayorista.facturacion.edit', borrar: 'mayorista.facturacion.delete' },
  },
  {
    id: 'mayorista-guias', areaId: 'mayorista', titulo: 'Guías', descripcion: 'Guías de despacho',
    icon: Truck, color: '#06b6d4',
    acciones: { ver: 'mayorista.guias.view', crear: 'mayorista.guias.create', editar: 'mayorista.guias.edit', borrar: 'mayorista.guias.delete' },
  },
  {
    id: 'mayorista-notas-credito', areaId: 'mayorista', titulo: 'Notas de crédito', descripcion: 'Notas de crédito a clientes',
    icon: FileText, color: '#ec4899',
    acciones: { ver: 'mayorista.notas_credito.view', crear: 'mayorista.notas_credito.create', editar: 'mayorista.notas_credito.edit', borrar: 'mayorista.notas_credito.delete' },
  },
  {
    id: 'mayorista-transportes', areaId: 'mayorista', titulo: 'Transportes Mayorista', descripcion: 'Transportes de los envíos',
    icon: Truck, color: '#0891b2',
    acciones: { ver: 'mayorista.transportes.view', crear: 'mayorista.transportes.create', editar: 'mayorista.transportes.edit', borrar: 'mayorista.transportes.delete' },
  },
  {
    id: 'mayorista-articulos', areaId: 'mayorista', titulo: 'F12 Consulta artículos', descripcion: 'Stock y datos de artículos',
    icon: PackageSearch, color: '#d97706', acciones: { ver: 'mayorista.articulos.view' },
  },
  {
    id: 'mayorista-mapeo', areaId: 'mayorista', titulo: 'Mapeo depósito', descripcion: 'Ubicaciones de pasillos y niveles',
    icon: MapIcon, color: '#22c55e',
    acciones: { ver: 'mayorista.mapeo.view' },
    especiales: [
      { clave: 'mayorista.mapeo.escanear', label: 'Escanear' },
      { clave: 'mayorista.mapeo.gestionar', label: 'Crear/borrar pasillos y niveles' },
      { clave: 'mayorista.mapeo.borrar', label: 'Borrar del mapeo' },
    ],
  },
  {
    id: 'mayorista-estadisticas', areaId: 'mayorista', titulo: 'Eficiencia mayorista', descripcion: 'Estadísticas y rendimientos del piso',
    icon: TrendingUp, color: '#14b8a6', acciones: { ver: 'mayorista.estadisticas.view' },
  },
  {
    id: 'mayorista-franquicias', areaId: 'mayorista', titulo: 'Franquicias', descripcion: 'Reposición diaria, propuestas y materiales de las franquicias',
    icon: Building2, color: '#0891b2', acciones: { ver: 'mayorista.franquicias.view' },
  },

  // ===== Depósito =====
  {
    id: 'deposito', areaId: 'deposito', titulo: 'Repos Depósito, RMA y Recepción INDO', descripcion: 'Pantallas del depósito',
    icon: Warehouse, color: '#ea580c',
    acciones: { ver: 'deposito.view' },
    especiales: [
      { clave: 'deposito.import', label: 'Importar datos' },
      { clave: 'deposito.mark', label: 'Marcar ítems' },
    ],
  },
  {
    id: 'deposito-picking', areaId: 'deposito', titulo: 'Picking', descripcion: 'Ver, registrar y anular el ingreso de pedidos de compra',
    icon: PackageCheck, color: '#0d9488', acciones: { ver: 'picking.view' },
  },

  // ===== Compras =====
  {
    id: 'transferencias', areaId: 'compras', titulo: 'Reposiciones / Transferencias', descripcion: 'Transferencias entre locales y sus estadísticas',
    icon: ArrowRightLeft, color: '#d97706',
    acciones: { ver: 'transferencias.view', crear: 'transferencias.import' },
    etiquetas: { crear: 'Importar' },
    especiales: [{ clave: 'transferencias.ver_todo', label: 'Ver todos los locales' }],
  },
  {
    id: 'pedidos-compra', areaId: 'compras', titulo: 'Pedidos de compra', descripcion: 'Órdenes de compra, cancelaciones y estado',
    icon: ClipboardList, color: '#65a30d', acciones: { ver: 'pedidos_compra.view' },
  },
  {
    id: 'comparativa-precios', areaId: 'compras', titulo: 'Comparativa de precios', descripcion: 'Precios contra la competencia',
    icon: Percent, color: '#0891b2', acciones: { ver: 'compras_precios.view' },
  },

  // ===== RR. HH. =====
  {
    id: 'rrhh-novedades', areaId: 'rrhh', titulo: 'Novedades', descripcion: 'Carga, resumen y motivos de novedades',
    icon: Megaphone, color: '#7c3aed',
    acciones: { ver: 'rrhh.novedades.view', crear: 'rrhh.novedades.create', editar: 'rrhh.novedades.edit', borrar: 'rrhh.novedades.delete' },
  },
  {
    id: 'rrhh-empleados', areaId: 'rrhh', titulo: 'Empleados y cumpleaños', descripcion: 'Legajos de empleados',
    icon: Cake, color: '#ec4899',
    acciones: { ver: 'rrhh.empleados.view', crear: 'rrhh.empleados.create', editar: 'rrhh.empleados.edit', borrar: 'rrhh.empleados.delete' },
  },

  // ===== Tesorería =====
  {
    id: 'cuentas-amigos', areaId: 'tesoreria', titulo: 'Cuentas Amigos', descripcion: 'También aparece en Locales',
    icon: CreditCard, color: '#059669',
    acciones: { ver: 'cuentas_amigos.view', crear: 'cuentas_amigos.create', editar: 'cuentas_amigos.edit', borrar: 'cuentas_amigos.delete' },
  },

  // ===== Locales =====
  {
    id: 'manuales', areaId: 'locales', titulo: 'Manuales', descripcion: 'Manuales para los locales',
    icon: BookOpen, color: '#16a34a',
    acciones: { ver: 'manuales.view', crear: 'manuales.create', editar: 'manuales.edit', borrar: 'manuales.delete' },
    etiquetas: { crear: 'Subir' },
  },
  {
    id: 'documentos', areaId: 'locales', titulo: 'Archivos', descripcion: 'Fotos, PDF y documentos de cada área',
    icon: FolderOpen, color: '#0ea5e9',
    acciones: { ver: 'documentos.view', crear: 'documentos.create', editar: 'documentos.edit', borrar: 'documentos.delete' },
    etiquetas: { crear: 'Subir' },
  },
  {
    id: 'opiniones', areaId: 'locales', titulo: 'Opiniones', descripcion: 'Encuestas de los clientes',
    icon: Star, color: '#f59e0b', acciones: { ver: 'opiniones.view', borrar: 'opiniones.borrar' },
  },
  {
    id: 'contador', areaId: 'locales', titulo: 'Contador de clientes', descripcion: 'Entradas por cámara',
    icon: Footprints, color: '#a855f7',
    acciones: { ver: 'contador.view' },
    especiales: [
      { clave: 'contador.ver_todo', label: 'Ver todos los locales' },
      { clave: 'contador.gestionar', label: 'Gestionar cámaras' },
    ],
  },
  {
    id: 'conversion', areaId: 'locales', titulo: 'Tasa de conversión', descripcion: 'Ventas contra entradas',
    icon: Percent, color: '#db2777', acciones: { ver: 'conversion.view' },
  },
  {
    id: 'objetivos', areaId: 'locales', titulo: 'Objetivos', descripcion: 'Objetivo por local con el IPC del mes',
    icon: Target, color: '#84cc16', acciones: { ver: 'objetivos.view', editar: 'objetivos.edit' },
    etiquetas: { editar: 'Cargar IPC' },
  },
  {
    id: 'sectores', areaId: 'locales', titulo: 'Sectores y QR', descripcion: 'Sectores de los locales y sus QR',
    icon: QrCode, color: '#64748b',
    acciones: { ver: 'sectores.gestionar' },
    etiquetas: { ver: 'Gestionar' },
    especiales: [{ clave: 'qr.regenerar', label: 'Regenerar QR' }],
  },

  // ===== Marketing =====
  {
    id: 'encuestas', areaId: 'marketing', titulo: 'Encuestas', descripcion: 'Crear y editar encuestas',
    icon: ClipboardList, color: '#db2777', acciones: { ver: 'encuestas.gestionar' }, etiquetas: { ver: 'Gestionar' },
  },
  {
    id: 'etiqueta-qr', areaId: 'marketing', titulo: 'Etiqueta QR', descripcion: 'Editar la etiqueta QR de los locales',
    icon: Tag, color: '#f97316', acciones: { ver: 'banner.editar' }, etiquetas: { ver: 'Editar' },
  },

  // ===== Sistemas =====
  {
    id: 'datos-sql', areaId: 'sistemas', titulo: 'Datos SQL', descripcion: 'Consultas al SQL Server',
    icon: Database, color: '#0891b2',
    acciones: { ver: 'datos_sql.view' },
  },
  {
    id: 'ia-camaras', areaId: 'sistemas', titulo: 'IA Cámaras', descripcion: 'Cámaras del contador con IA',
    icon: ScanEye, color: '#6366f1', acciones: { ver: 'ia_camaras.view' },
  },
  {
    id: 'informes', areaId: 'sistemas', titulo: 'Envío informes y reportes', descripcion: 'Informes por WhatsApp',
    icon: FileText, color: '#22c55e',
    acciones: { ver: 'sistemas.informes.view', crear: 'sistemas.informes.create', editar: 'sistemas.informes.edit', borrar: 'sistemas.informes.delete' },
  },

  // ===== Administradores =====
  {
    id: 'tracking', areaId: 'administradores', titulo: 'Tracking de transporte', descripcion: 'Ubicación de los vehículos, cargas y entregas',
    icon: Navigation, color: '#2563eb', acciones: { ver: 'tracking.view', editar: 'tracking.gestionar' }, etiquetas: { editar: 'Vehículos y puntos de control' },
  },
  {
    id: 'stock-valorizado', areaId: 'administradores', titulo: 'Stock valorizado', descripcion: 'Unidades y plata a costo por sucursal',
    icon: Wallet, color: '#10b981', acciones: { ver: 'stock_valorizado.view' },
  },

  // ===== WEB =====
  {
    id: 'ventas-web', areaId: 'web', titulo: 'Ventas web', descripcion: 'Pedidos y facturación de la tienda Tiendanube',
    icon: ShoppingBag, color: '#a855f7', acciones: { ver: 'tiendanube.view' },
  },

  // ===== Configuración =====
  {
    id: 'usuarios', areaId: 'configuracion', titulo: 'Usuarios', descripcion: 'Alta, aprobación y datos de usuarios',
    icon: UserCog, color: '#0ea5e9', acciones: { ver: 'usuarios.view', editar: 'usuarios.edit' }, etiquetas: { editar: 'Gestionar' },
  },
  {
    id: 'roles-permisos', areaId: 'configuracion', titulo: 'Roles y permisos', descripcion: 'Esta pantalla',
    icon: ShieldCheck, color: '#ef4444', acciones: { ver: 'roles_permisos.view', editar: 'roles_permisos.edit' },
  },
  {
    id: 'configuraciones', areaId: 'configuracion', titulo: 'Configuraciones', descripcion: 'Ajustes generales del hub',
    icon: Settings, color: '#a855f7', acciones: { ver: 'configuraciones.view' },
  },
]

/** Clave del permiso "entrar al área" que pide el menú principal. */
export const claveArea = (areaId: string) => `area_${areaId}.view`

// ===== Niveles rápidos =====
// 0 Sin acceso · 1 Solo ver · 2 Ver y cargar · 3 Todo · 'medida' combinación propia
export type Nivel = 0 | 1 | 2 | 3 | 'medida'

export const NIVEL_LABEL: Record<Exclude<Nivel, 'medida'>, string> = {
  0: 'Sin acceso',
  1: 'Solo ver',
  2: 'Ver y cargar',
  3: 'Todo',
}

/** Todas las claves de un grupo (acciones + especiales). */
export function clavesDeGrupo(g: GrupoPermisos): string[] {
  return [...Object.values(g.acciones), ...(g.especiales ?? []).map((e) => e.clave)].filter(Boolean) as string[]
}

/** Claves que prende cada nivel. */
export function clavesDeNivel(g: GrupoPermisos, n: 0 | 1 | 2 | 3): string[] {
  if (n === 0) return []
  if (n === 3) return clavesDeGrupo(g)
  const out = [g.acciones.ver]
  if (n === 2) out.push(g.acciones.crear, g.acciones.editar)
  return out.filter(Boolean) as string[]
}

/** Niveles que tienen sentido para el grupo (no repetir botones que hacen lo mismo). */
export function nivelesDe(g: GrupoPermisos): (0 | 1 | 2 | 3)[] {
  const todas = clavesDeGrupo(g).length
  const out: (0 | 1 | 2 | 3)[] = [0, 1]
  const cargar = clavesDeNivel(g, 2).length
  if (cargar > 1 && cargar < todas) out.push(2)
  if (todas > 1) out.push(3)
  return out
}

/** Nivel actual del grupo según las claves prendidas. */
export function nivelActual(g: GrupoPermisos, tiene: (clave: string) => boolean): Nivel {
  const prendidas = new Set(clavesDeGrupo(g).filter(tiene))
  const igual = (claves: string[]) => claves.length === prendidas.size && claves.every((c) => prendidas.has(c))
  for (const n of nivelesDe(g)) if (igual(clavesDeNivel(g, n))) return n
  return 'medida'
}
