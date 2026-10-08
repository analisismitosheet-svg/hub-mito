# Permisos y usuarios

- Pantallas: `Usuarios.tsx`, `Roles.tsx`, `Locales.tsx`. Hook: `useAuth()` → `{ isAdmin, can('permiso'), perfil }`; `usePermisosArea('<area>')`.
- Rutas protegidas con `PermissionRoute` (en `src/App.tsx`); apps del menú filtradas por el permiso del `AppDef` (`src/config/areas.ts`).
- Permisos: por rol + overrides individuales por usuario (efecto `grant`/`revoke`).

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
- `mayorista.articulos.view` → [[Artículos y F12]].
- `mayorista.mapeo.view` / `.escanear` / `.borrar` → [[Mapeo depósito]]. **`.borrar` solo admin + puesto3indo@gmail.com (individual)**; se sacó del rol `mayorista`.
- `transferencias.view` → [[Transferencias]].
- `contador.view` → contador de clientes ([[Otros módulos]]).

## Pruebas de RLS
Patrón: `begin; select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); set local role authenticated; ...; rollback;`
