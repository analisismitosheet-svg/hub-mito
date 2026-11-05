# Órdenes de compras (`/compras/ordenes`)

Reemplaza la planilla «Alta Órdenes de Compras Mito» (Google Sheets). Alta: 05/11/2026.

- Pantalla `src/pages/OrdenesCompra.tsx` + `src/components/FormOrdenCompra.tsx` (alta/edición, sección Dragon) + `src/components/AutorizadoresOc.tsx` (admin). Lib `src/lib/ordenesCompra.ts`.
- App en `src/config/areas.ts` (`ordenes-compras`) visible en **Compras, Depósito, Diseño, Arquitectura y Administración**; permiso `ordenes_compra.view`.
- SQL `sql/ordenes_compra.sql`: `ordenes_compra` (cabecera + `pasos` jsonb `{valid|autor|env|acep|f_oc|f_rem|f_fac: {por, uid, at, via}}`), `ordenes_compra_eventos` (historial), `ordenes_compra_whatsapp` (envíos y respuestas), `ordenes_compra_config` (autorizadores = ids de `informes_contactos`, reparto, horas). Bucket privado `ordenes-compra` para el archivo.
- Importación: `scripts/importar-ordenes-compra.py` → `sql/ordenes_compra_import.sql` (1.512 OC, 11098–15549; `importada = true`, tildes «por planilla»). **No pide ninguna autorización.** Reimportar no pisa (on conflict do nothing). Numeración nueva: `max + 1` (desde 15550), la misma que usa Dragon.

## Permisos
| Permiso | Qué hace | Roles |
|---|---|---|
| `ordenes_compra.view` | ver la pantalla, cargar, ver las propias y las de su área | compras, deposito, arquitecto, administracion (Diseño: no hay rol, se da por persona) |
| `ordenes_compra.ver_todas` | ver todas | compras, administracion |
| `ordenes_compra.compras` | validar, enviada/aceptada, cancelar, editar, crear en Dragon | compras |
| `ordenes_compra.flexxus` | OC / remito / factura en Flexxus | administracion |
| `ordenes_compra.autorizar` | autorizar desde el hub | (por persona) |
Admin todo; borrar y Autorizadores solo admin. Área del usuario = sus permisos `area_*.view` (`private.oc_mis_areas`). Las importadas no tienen área: solo las ven quienes tienen `ver_todas`.

## Autorización por WhatsApp
- **Nunca sale sola**: botón «💬 Pedir autorización» (lista, detalle y «Guardar y pedir autorización»). Lo tocan Compras o quien cargó la OC. `POST /api/informe {ocPedir}` → RPC `oc_pedir_autorizacion` (con el JWT del usuario) → plantilla **`oc_para_autorizar`** (es_AR, Utility) con botones de respuesta rápida «Autorizado» / «No autorizado» (payload `OC|<id envío>|SI|NO`). Lib `src/lib/ordenesCompraWhatsapp.ts`.
- A quién: `private.oc_destinatarios` usa `oc_reparto()` = quién autorizó cada tipo en los últimos 90 días (en Gastos, por responsable; mínimo 3 OC) y lo cruza por primer nombre con los contactos tildados en Autorizadores (`informes_contactos`). Si nadie responde en `horas_espera`, `oc_ampliar_avisos()` (pg_cron `informes-diarios` cada 5 min → `?evento=diarios`) les manda a los demás.
- Respuesta: webhook `?evento=whatsapp` lee `messages[].button.payload` → `oc_responder_whatsapp` (valida que conteste el mismo número) → tilda `autor` (`via: whatsapp`) o cancela con `no_autorizada`; le contesta un texto de confirmación. **Requiere el webhook suscripto al campo `messages` en Meta.**
- Plantilla: Autorizadores → «Crear plantilla en WhatsApp» (`POST /api/informe {ocPlantilla:'crear'|'estado'}`, solo admin; WABA `WHATSAPP_WABA_ID` o 3764563940363184).

## Dragon (pedido de compra)
- Tilde «Esta OC va a Dragon» → base (hoy solo **INDOD**; NOMED en 100.85.74.68\ZOO2024 todavía no), proveedor (buscador sobre `recepcion_indo_proveedores`), motivo (obligatorio), condición de pago, lista (LISTA0) y artículos (buscador en vivo sobre `ZooLogic.ART` de la base elegida: `/api/sql/dragon-articulos?q=` → acción `dragon_articulos` del puente; colores y talles en vivo: `/api/sql/dragon-variantes` → acción `dragon_variantes`, COMB + COL). Monto bruto = total con IVA 21 %.
- **Importar txt**: una línea por SKU, `CANTIDAD+ARTICULO%COLORTALLE` (`24+zh000200%02xxl` = 24 u. de ZH000200, color 02, talle XXL; sin `N+` es 1). Valida contra la base (`dragon-articulos?codigos=`, de a 100), suma los repetidos y a lo que ya estaba cargado; lo que no existe no entra y se lista con el número de línea. Los precios quedan en 0.
- «Crear OC en Dragon» (Compras) → `oc_mandar_dragon` deja `dragon_estado = pendiente` → `puente-sql/scripts/sync-oc-dragon.js` (tarea «MITO - Pedidos franquicias», cada 1 min) → `dragon.js crearPedidoCompra` (`POST /Pedidodecompra/`, header `BaseDeDatos`, Letra X, PV 164, **mismo N°**) → `oc_resultado_dragon`. Si falla queda el error y se reintenta con el botón.
- Prueba hecha: X-0164-99001 en INDOD (EIRY, a anular a mano).

Mockup: `mockups/ordenes-compras.html` (con las OC reales; abrir con el server «mockups» de `.claude/launch.json`, es grande para el visor de archivos).
