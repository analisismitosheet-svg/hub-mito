# Permisos y usuarios

- Pantallas: `Usuarios.tsx`, `Roles.tsx`, `Locales.tsx`. Hook: `useAuth()` → `{ isAdmin, can('permiso'), perfil }`; `usePermisosArea('<area>')`.
- Rutas protegidas con `PermissionRoute` (en `src/App.tsx`); apps del menú filtradas por el permiso del `AppDef` (`src/config/areas.ts`).
- Permisos: por rol + overrides individuales por usuario (efecto `grant`/`revoke`).
- **Roles.tsx** (desde 14/10/2026): pestañas *Por rol* / *Por persona* / *Ubicación de menús*. Cada app con niveles rápidos (Sin acceso · Solo ver · Ver y cargar · Todo) + Detalle; por persona muestra origen (por rol / + extra / − quitado), "Copiar permisos de…" y "Quitar extras". Se guarda todo junto con la barra de abajo.
- **Catálogo**: `src/config/permisosCatalogo.ts` lista solo los permisos que el código usa, agrupados por app. **Al crear un permiso nuevo, sumarlo ahí** o no aparece en Roles. La tabla `permisos` tiene ~1.500 claves generadas (`area.app.read/approve/...`) que nadie mira: se ocultan, no se borran. Ojo: `permisos` tiene más de 1.000 filas, la consulta sin filtro corta en 1.000.

## Helpers SQL (`private.*`)
| Función | Qué hace |
|---|---|
| `private.tengo_permiso('x')` | el usuario actual tiene el permiso (rol o individual) |
| `private.es_admin()` | es admin |
| `private.mi_local()` | local del usuario (usuarios de local) |
| `private.mis_origenes()` | orígenes/locales que ve el usuario (con sinónimos) |

## Permisos usados (los principales)
- `picking.view` → [[Picking]] (ver, registrar y anular).
- `deposito.view` (+ `deposito.import`, `deposito.mark`) → [[Recepción INDO]], depósito.
- `pedidos_compra.view`, `pedidos_venta.view` → [[Pedidos compra, venta y cancelaciones]].
- `mayorista.repos_piso` → piso / Mi repo ([[Repos Mayorista y Mi repo]], [[Armado de pedidos]]).
- `mayorista.franquicias.view` → Franquicias: reposición sugerida, propuestas por link y alta en Dragon. Dado al rol `mayorista` (21/10/2026); antes compartía `mayorista.repos_piso`, con lo que el rol `empleado` también la veía.
- `mayorista.articulos.view` → [[Artículos y F12]].
- `mayorista.mapeo.view` / `.escanear` / `.borrar` → [[Mapeo depósito]]. **`.borrar` solo admin + puesto3indo@gmail.com (individual)**; se sacó del rol `mayorista`.
- `mayorista.pausas.autorizar` → autorizar pausas del piso (`/mayorista/pausas`), dado a puesto3 ([[Repos Mayorista y Mi repo]]).
- `mayorista.faltantes.ver` → aviso de faltantes de stock al cerrar un armado, dado a puesto3; admin siempre ([[Armado de pedidos]]).
- `sistemas.informes.view` / `.create` / `.edit` / `.delete` → [[Informes por WhatsApp]].
- `transferencias.view` → [[Transferencias]].
- `contador.view` → contador de clientes ([[Otros módulos]]).
- `tracking.view` / `tracking.gestionar` → [[Tracking de transporte]] (área Administradores, `area_administradores.view`).
- `tiendanube.view` → [[Ventas web (Tiendanube)]] (sin rol: admin + a mano).
- `compras_precios.view` → [[Comparativa de precios]] (asignado a administrador y compras).

## Pruebas de RLS
Patrón: `begin; select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); set local role authenticated; ...; rollback;`
