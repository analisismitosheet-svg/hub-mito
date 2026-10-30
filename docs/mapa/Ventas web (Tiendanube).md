# Ventas web (Tiendanube)

Área **WEB** (`area_web.view`) → `/web/ventas` (`VentasWeb.tsx`, permiso `tiendanube.view`). Hasta el 30/10/2026 estaba en Administradores; `/administradores/ventas-web` redirige.
Pedidos de la tienda Tiendanube **Indonesiashop** (`indonesiashop.com.ar`, tienda `1245791`): facturado, pedidos, ticket promedio, unidades, por día, más vendidos, medio de pago, envío/retiro, provincia y la lista de pedidos con sus productos.

## De dónde salen los datos
- **API de Tiendanube** con la app privada **«acceso hub mito»** (creada el 30/10/2026, solo lectura). El token y la tienda van en `puente-sql/.env` (`TN_HUB_TOKEN`, `TN_STORE_ID`; opcional `TN_USER_AGENT`, default `Hub MITO`). **Nunca en el código ni en el chat.**
- **Sync**: `puente-sql/scripts/sync-tiendanube.js` (+ `.ps1`), tarea **«MITO - Sync Tiendanube» cada 20 min** en la PC central (`instalar-tarea.ps1`). Trae los pedidos **modificados** desde la última corrida (`updated_at_min`, con 15 min de margen); la marca queda en `puente-sql/data/sync-tiendanube.json` y el log en `data/sync-tiendanube.log`. Sin marca, trae los últimos 3 días.
- **Carga completa**: `node scripts/sync-tiendanube.js --desde=2025-01-01` (va mes por mes por `created_at`). Se corrió el 30/10/2026 desde el 01/01/2025; lo anterior no está en el hub.
- Respeta el límite de la API (balde de 40, 2 por segundo): frena si quedan menos de 5 y reintenta los 429.
- Sube en lotes de 200 por la RPC `tn_pedidos_sync_lote` (PUENTE_TOKEN, como los otros syncs) y cierra con `tn_sync_fin`. Nunca borra pedidos: un cancelado queda con `estado = 'cancelled'`.

## Tablas (`sql/tiendanube.sql`)
- `tn_pedidos`: una fila por pedido (id de Tiendanube). Estados, montos (`subtotal`, `descuento`, `envio`, `total`), `medio_pago` (gateway), `metodo_pago`, `cuotas`, `envio_tipo`/`envio_opcion`, `canal` (storefront), `utm_source`, `cupon`, `cliente`, `provincia`, `ciudad`, `unidades`.
- `tn_pedidos_items`: renglones (`sku`, `nombre` sin variante, `variante` "COLOR / TALLE", `cantidad`, `precio`).
- `tn_sync`: hora de la última corrida (la muestra la pantalla).
- **Datos personales**: no se guardan mail, teléfono, DNI ni dirección; solo el nombre de contacto y provincia/ciudad de entrega (de la sucursal si es retiro).
- RLS: solo lectura con `tiendanube.view`. Lo trae el **rol `web`** (`sql/area_web.sql`, junto con `area_web.view`): registrar a alguien con rol Web alcanza para que vea el área y las ventas. Admin siempre.

## Pantalla
- Rango: Hoy / 7 días / Este mes / Mes anterior o fechas a mano (máx. 400 días). Días en hora de Córdoba.
- Resumen con la RPC `tn_ventas_resumen(desde, hasta)` (SECURITY DEFINER, valida el permiso una vez y agrupa en la base). **«Vendido» = `estado_pago = 'paid'` y no cancelado**; pendientes = `pending`/`authorized`.
- Lista: los últimos 1000 pedidos del rango; tocar uno despliega sus productos.
- **No sondea**: carga al abrir, al cambiar el rango o con «Recargar» (lee Supabase; los datos nuevos llegan con la tarea de 20 min).

## Otras cosas de Tiendanube (fuera del hub)
- `D:\tiendanube\api tienda nube`: app **SizeOrder AP** (ordena los talles de las variantes; Vercel `sizeorder-ap`, permisos de productos). Es otra app, con otro token.
- `D:\tiendanube\HANDOFF.md`: landing «Active» y tema de la tienda (FTP / CLI).

Relacionado: [[Puente SQL y syncs]] · [[Permisos y usuarios]] · [[Stock valorizado]]
