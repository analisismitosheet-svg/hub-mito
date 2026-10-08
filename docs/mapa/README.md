# Mapa del Hub MITO

Notas cortas para ubicar rápido **dónde está cada cosa** sin recorrer el código.
Se abren como bóveda de Obsidian (abrir la carpeta `docs/mapa`) o en cualquier visor de Markdown.
El detalle largo y la historia de cada módulo siguen en `CONTEXTO.md` (raíz del repo).

> Se actualiza solo de lunes a viernes a las 17:30 con los commits del día (tarea programada `actualizar-mapa-hub`).

## Índice
- [[Arquitectura]]: stack, deploy, Supabase, puente SQL, comandos
- [[Permisos y usuarios]]: roles, permisos, helpers `private.*`
- [[Puente SQL y syncs]]: los dos SQL Server, túnel, tareas programadas
- [[Artículos y F12]]: maestro de artículos, descripción adicional, F12, stock
- [[Picking]]: pickings por registro, cancelaciones, Excel
- [[Recepción INDO]]
- [[Pedidos compra, venta y cancelaciones]]
- [[Armado de pedidos]]: Mayorista pide, el piso arma en Mi repo
- [[Repos Mayorista y Mi repo]]
- [[Mapeo depósito]]
- [[Transferencias]]: reposiciones y estadísticas
- [[Facturación, guías y notas de crédito]]
- [[Otros módulos]]: RRHH, RMA, contador de clientes, encuestas, QR, réplicas
- [[UI y estilo]]
- [[Reglas y decisiones]]: lo que no hay que romper

## Rutas → pantalla
| Ruta | Pantalla (`src/pages`) | Nota |
|---|---|---|
| `/deposito/picking?oc=&prov=` | Picking.tsx | [[Picking]] |
| `/deposito/recepcion-indo` | RecepcionIndo.tsx | [[Recepción INDO]] |
| `/deposito/rma` (+proveedores, guia) | Rma.tsx, ProveedoresPacho.tsx, GuiaPacho.tsx | [[Otros módulos]] |
| `/compras/pedidos` | PedidosHub.tsx | [[Pedidos compra, venta y cancelaciones]] |
| `/compras/pedidos-compra?numero=` | PedidosCompra.tsx | idem |
| `/compras/cancelaciones` | Cancelaciones.tsx | idem |
| `/compras/estado-pedidos` | EstadoPedidos.tsx | idem |
| `/mayorista/pedidos-venta` | PedidosVenta.tsx | idem + [[Armado de pedidos]] |
| `/transferencias`, `/transferencias/estadisticas` | Transferencias.tsx, EstadisticasTransferencias.tsx | [[Transferencias]] |
| `/mayorista` , `/mayorista/mi-repo`, `/mayorista/estadisticas` | Mayorista.tsx, MiRepo.tsx, EstadisticasRendimiento.tsx | [[Repos Mayorista y Mi repo]] |
| `/mayorista/mapeo` (+escanear, orden, ubicaciones) | MapeoEscanear/Orden/Ubicaciones.tsx | [[Mapeo depósito]] |
| `/mayorista/consulta-articulos` | ConsultaArticulos.tsx | [[Artículos y F12]] |
| `/mayorista/facturacion-fabrica`, `/guias`, `/notas-credito`, `/clientes`, `/transportes` | FacturacionFabrica, Guias, NotasCredito, Clientes, Transportes | [[Facturación, guías y notas de crédito]] |
| `/rrhh/*` | Empleados, CargaNovedades, ResumenNovedades, MotivosNovedades, Cumpleanios | [[Otros módulos]] |
| `/contador-clientes`, `/tasa-conversion`, `/ia-camaras` | ContadorClientes, TasaConversion, IaCamaras, CalibrarCamara | [[Otros módulos]] |
| `/datos-sql`, `/configuraciones/sql`, `/replicas` | DatosSql, SqlConexion, Replicas | [[Puente SQL y syncs]] |
| `/usuarios`, `/roles`, `/locales`, `/configuraciones` | Usuarios, Roles, Locales, Configuraciones | [[Permisos y usuarios]] |

Rutas: `src/App.tsx`. Menú por áreas y apps: `src/config/areas.ts` (agregar una app = un `AppDef` ahí).
