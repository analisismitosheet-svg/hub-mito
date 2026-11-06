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

## Botón del formulario (un solo botón principal, 06/11/2026)
Antes había tres al pie («Guardar y crear OC en Dragon», «Guardar y pedir autorización», «Guardar OC»). Ahora `FormOrdenCompra.tsx` (`pie`) muestra **un botón principal según el estado** y «Solo guardar» como enlace chico:
| Estado de la OC | Botón principal |
|---|---|
| Nueva o sin pedir autorización | 💬 **Guardar y pedir autorización** (Compras o quien la cargó) |
| Autorización ya pedida | **Guardar OC** (el texto dice a quién se pidió) |
| Autorizada + tilde Dragon + Compras + no mandada | **Guardar y crear en Dragon** («reintentar» si quedó en error) |
| Autorizada sin Dragon, ya en Dragon o cancelada | **Guardar OC** |
- **Dragon espera la autorización**: al autorizarse (Telegram, link o tilde en el hub) el trigger `ordenes_compra_dragon_al_autorizar` (`sql/ordenes_compra_dragon_auto.sql`) la deja `pendiente` sola si tiene el tilde Dragon y los datos completos (`private.oc_falta_dragon`); `dragon_por` = «autorizó X». Si falta algo queda en `error` con «No se mandó sola al autorizarse: …» y Compras la completa y reintenta. `oc_mandar_dragon` rechaza las OC sin autorizar; en el detalle el botón «Crear OC en Dragon» solo aparece autorizada («Se crea sola cuando la autoricen»).

## Autorización por WhatsApp
- **Nunca sale sola**: botón «💬 Pedir autorización» (lista, detalle y «Guardar y pedir autorización»). Lo tocan Compras o quien cargó la OC. `POST /api/informe {ocPedir}` → RPC `oc_pedir_autorizacion` (con el JWT del usuario) → plantilla **`oc_autorizar_link`** (es_AR, Utility) con un botón al link `/oc/<token>`. Lib `src/lib/ordenesCompraWhatsapp.ts`.
- A quién (`private.oc_destinatarios`, `sql/ordenes_compra_reglas.sql`, 06/11/2026): Autorizadores → cuadro **«Quién autoriza cada categoría»** (solo admin). Filas: Producto, Servicios, Talleres, una por responsable de Gastos (las del historial + «＋ Agregar persona», de `oc_responsables_gastos()`) y «Gastos, el resto»; columnas = autorizadores tildados (uno o varios por fila; les llega a todos juntos y vale la primera respuesta). Se guarda en `ordenes_compra_config.reglas` (`{"tipo:Producto": [ids], "gastos:TOMAS ROCA": [ids], "tipo:Gastos": [ids]}`) con `oc_config_guardar(…, p_reglas)`. Orden: 1) elegidos para los Gastos de ese responsable, 2) historial de ese responsable, 3) elegidos para el tipo, 4) historial del tipo, 5) todos los tildados. El historial (pasos 2 y 4, apagable con el tilde de abajo del cuadro) es `oc_reparto()` = quién autorizó cada tipo en los últimos 90 días (en Gastos, por responsable; mínimo 3 OC), cruzado por primer nombre con los contactos tildados (`informes_contactos`); se ve en la columna «Historial» como sugerencia. Si nadie responde en `horas_espera`, `oc_ampliar_avisos()` (pg_cron `informes-diarios` cada 5 min → `?evento=diarios`) les manda a los demás.
- Respuesta: `/oc/:token` (`src/pages/AutorizarOc.tsx`, `sql/ordenes_compra_link.sql`), sin usuario del hub, como `/p/:token`, pero **con clave por autorizador**. Cada envío tiene su token (solo lo lee el servidor). Sin clave solo se ve el nombre del saludo (`oc_link_inicio`); `oc_link_abrir` y `oc_link_responder` la controlan en cada llamada. `oc_link_responder` tilda `autor` (`via: whatsapp`) o cancela con `no_autorizada` y motivo opcional; si otro ya respondió no cambia nada y muestra quién fue. **No necesita webhook.**
- Claves: tabla `ordenes_compra_claves` (por contacto, encriptada con bcrypt, sin acceso directo). Las carga el admin en Autorizadores (4 a 6 números). A los 5 intentos errados seguidos se bloquea; el admin toca «Desbloquear» y sigue valiendo la misma (cambiarla es otro botón). Sin clave cargada esa persona no puede abrir el link.
- Plantilla: Autorizadores → «Crear plantilla en WhatsApp» (`POST /api/informe {ocPlantilla:'crear'|'estado'}`, solo admin; WABA `WHATSAPP_WABA_ID` o 3764563940363184).

## Responsable por defecto
- En una OC nueva, «Responsable» arranca con el nombre (en mayúsculas) del usuario que la crea. Si la crea la cuenta del admin (se llama «admin», no es una persona) queda vacío para escribirlo (06/11/2026). Si el perfil carga después de abrir el formulario, se completa igual mientras siga vacío. Ojo: en Gastos el responsable decide a quién se le pide la autorización (`oc_reparto`).

## Datos del proveedor (autocompletar)
- En el alta, el buscador de **Razón social** trae las razones sociales de OC anteriores y además el maestro de Dragon (marcado «Dragon CÓDIGO»). Al elegir uno se completan CUIT, Contacto, Teléfono y Mail de ventas **solo si están vacíos** (lo cargado a mano no se pisa y todo sigue editable). Elegir el proveedor en la sección Dragon también completa lo vacío.
- Fuente: tabla `ordenes_compra_proveedores` (`sql/ordenes_compra_proveedores.sql`; select con `ordenes_compra.view`, escribe solo el RPC `ordenes_compra_proveedores_sync` con el PUENTE_TOKEN). La llena `puente-sql/scripts/sync-pedidos-compra.js` cada 1 hora desde `DRAGONFISH_VCPD.ZooLogic.PROV` del SQL Server de la PC del puente: `CLCUIT` (con guiones), `CLTLF`/`TLFM` → teléfono, `CLEMAIL` → mail, y el primer contacto de `ZooLogic.CONTPROVDET` (`CONNOM`, `CONTEL`, `CONMAIL`) para contacto y lo que falte. Solo esa parte: `node scripts/sync-pedidos-compra.js --solo-proveedores` (en `puente-sql`).
- Las OC importadas de la planilla no traen CUIT ni contacto, así que si el nombre elegido viene de una OC vieja se empareja con Dragon (`datosProveedorDragon` en `src/lib/ordenesCompra.ts`): primero por CUIT; si no, cada palabra del nombre (sin S.A./SRL) tiene que estar entera en el nombre de Dragon («NEW ARRECIFE S.A.» → RF «REEF - NEW ARRECIFE»). Si coincide con varios proveedores distintos no adivina. En la lista van primero los códigos de Dragon con datos (hay nombres repetidos vacíos, ej. 3 «HAVAIANAS»); si el elegido no tiene datos, también se busca por nombre. Reconoce 66 de los 251 proveedores de la planilla.
- Cobertura en Dragon (06/11/2026): 960 de 1.521 con CUIT, 317 con teléfono, 78 con mail, 13 con contacto. Lo que no está cargado en Dragon queda vacío (ej. NEW ARRECIFE solo tiene CUIT).

## Dragon (pedido de compra)
- Tilde «Esta OC va a Dragon» → base (hoy solo **INDOD**; NOMED en 100.85.74.68\ZOO2024 todavía no), proveedor (buscador sobre `recepcion_indo_proveedores`), motivo (obligatorio), condición de pago, lista (LISTA0) y artículos (buscador en vivo sobre `ZooLogic.ART` de la base elegida: `/api/sql/dragon-articulos?q=` → acción `dragon_articulos` del puente; colores y talles en vivo: `/api/sql/dragon-variantes` → acción `dragon_variantes`, COMB + COL). Monto bruto = total con IVA 21 %.
- **Importar txt**: una línea por SKU, `CANTIDAD+ARTICULO%COLORTALLE` (`24+zh000200%02xxl` = 24 u. de ZH000200, color 02, talle XXL; sin `N+` es 1). Valida contra la base (`dragon-articulos?codigos=`, de a 100), suma los repetidos y a lo que ya estaba cargado; lo que no existe no entra y se lista con el número de línea. Los precios quedan en 0.
- Sola al autorizarse (ver «Botón del formulario») o «Crear OC en Dragon» (Compras, con la OC autorizada) → `oc_mandar_dragon` deja `dragon_estado = pendiente` → `puente-sql/scripts/sync-oc-dragon.js` (tarea «MITO - Pedidos franquicias», cada 1 min) → `dragon.js crearPedidoCompra` (`POST /Pedidodecompra/`, header `BaseDeDatos`, Letra X, PV 164, **mismo N°**) → `oc_resultado_dragon`. Si falla queda el error y se reintenta con el botón.
- Prueba hecha: X-0164-99001 en INDOD (EIRY, a anular a mano).

Mockup: `mockups/ordenes-compras.html` (con las OC reales; abrir con el server «mockups» de `.claude/launch.json`, es grande para el visor de archivos).
