# Franquicias

Área Mayorista + configuración en Sistemas. Permiso `mayorista.franquicias.view` (rol `mayorista`, ver [[Permisos y usuarios]]). Tres pantallas (`src/components/FranquiciasTabs.tsx`) y la configuración separada; lógica común en `src/lib/franquicias.ts` y `src/hooks/useReposicionFranquicia.ts`.

## Reposición diaria automática (desde 27/10/2026, la única en el menú)

- `/mayorista/franquicias`, `FranquiciasReposicionAuto.tsx`. Las pantallas de abajo quedaron fuera del menú (siguen por link; la vieja diaria pasó a `/mayorista/franquicias/diaria`).
- **Paso 1**: cliente ↔ base, sucursal de stock (es de la base), **varios WhatsApps**, automático activo, días (1 = lunes … 7 = domingo) y hora. RPC `franquicias_guardar_auto`. Columnas nuevas en `franquicias_clientes`: `telefonos[]`, `auto_activo`, `auto_dias[]`, `auto_hora`, `auto_ultimo_hasta`, `auto_pedido_at`, `auto_error`.
- **Paso 2**: por cliente, una reposición por fecha de venta (propuestas `tipo = 'reposicion'`), con la tabla de lo vendido, lo que va en el link (editable con − / + mientras nadie la aceptó), el estado de cada WhatsApp y quién aceptó. «Armar ahora» (`franquicias_pedir_armado`) hace que el puente la arme en el próximo minuto.
- **Armado**: `puente-sql/scripts/reposicion-franquicias-auto.js`, corre en la tarea "MITO - Pedidos franquicias" (cada 1 min, después de la carga en Dragon). Pide `franquicias_auto_pendientes` (activo + hoy es su día + pasó la hora + la venta de ayer no se armó, o «Armar ahora»), lee el SQL local con sqlcmd (venta neta de `venta_franquicias`, stock cliente, `vw_STOCK_SKU_MITO`, precio de `vw_ARTICULOS_MITO`) y guarda con `franquicias_auto_crear`. Rango: desde el día siguiente al último armado (máx. 7 días) hasta ayer. Sin nada para reponer no crea propuesta. Prueba sin guardar: `--probar BASE "SUCURSAL" desde hasta`.
- **Envío**: una fila por número en `franquicias_propuesta_envios`, cada una con **su token**. `/api/informe?evento=franquicias` (pg_cron `franquicias-whatsapp` cada 5 min, y el puente apenas arma) manda la plantilla `reposicion_franquicia` (es_AR, 6 variables: cliente, N°, venta del, artículos, unidades, link) — `src/lib/franquiciasWhatsapp.ts`. Reintenta 12 veces (~1 h). Desde la pantalla: «Enviar por WhatsApp los que faltan» (POST `/api/informe {franquicias: id}`) o «WhatsApp a mano» (wa.me con el link de ese número).
- **Bloqueo**: `/p/:token` acepta el token de la propuesta o el de un envío. El primero que confirma guarda `confirmada_por` (su número); a los demás el link les muestra «🔒 Este pedido ya fue aceptado por +…» con lo que se pidió. SQL: `sql/franquicias_reposicion_auto.sql`, `sql/franquicias_whatsapp_cron.sql`.

## Pantallas anteriores (fuera del menú)

- **Reposición diaria** — `/mayorista/franquicias/diaria`, `MayoristaFranquicias.tsx`.
  - Se elige el **cliente** (solo los que tienen base asignada; por defecto `01140`). La base, la sucursal de stock y el teléfono salen de *Sistemas → Franquicias*.
  - Ventas de `VISTAS_CONSOLIDADAS.dbo.venta_franquicias` filtradas por `BASE_DATOS` = base del cliente; stock del cliente de `vw_STOCK_SUCURSALES_REAL` por `BD_ORIGEN` = sucursal de la base; stock MITO de `vw_STOCK_SKU_MITO`. Detalle de fuentes en [[Puente SQL y syncs]].
  - Sugerido = máx(0, mín(vendido − stock cliente, stock MITO)). La columna **Estado** (Urgente/Normal) va al lado del artículo.
  - Permite exportar a Excel, compartir la lista por WhatsApp (usa el teléfono configurado si existe) y saltar a **Propuesta de reposición** con el mismo cliente y rango de fechas.
- **Propuesta de reposición** — `/mayorista/franquicias/propuestas`, `MayoristaFranquiciasPropuestas.tsx`.
  - Usa el mismo motor de datos que la reposición diaria (ventas, stock cliente, stock MITO, precios).
  - Muestra un resumen de artículos/unidades/importe y una vista previa de lo que se va a proponer.
  - Renderiza `FranquiciaPropuestas`: arma la propuesta, la guarda y abre WhatsApp con el link. El envío sigue siendo manual por `wa.me`; no hay cron de propuestas ni envío automático.
  - Historial por franquicia: propuesto vs. lo que pidió el cliente, estado y alta en Dragon.
- **Reposición de materiales** — `/mayorista/franquicias/materiales`, `MayoristaFranquiciasMateriales.tsx` (reemplaza al pedido de venta de calzado; `/mayorista/franquicias/calzado` redirige acá).
  - Reposición por **curva de talles**: un modelo por artículo + color con el stock de cada talle (`vw_STOCK_SKU_MITO`), precio de `vw_ARTICULOS_MITO`. Solo materiales que `DWH.dbo.vw_DIM_MATERIAL` llama CALZADO (en `articulos`: `1` y `CALZADO`).
  - Pestañas talle simple (40) / doble (38/39, chanclas y slippers). Filtros por grupo, **temporada** (`articulos.id_temporada`: 0 sin temporada, 1 verano, 2 continuo, 3 invierno, 4 atemporal) y texto.
  - Mismo circuito que la propuesta: se manda el link y el cliente confirma. La propuesta queda con `tipo = 'materiales'` (las viejas con `calzado` se siguen mostrando igual).

## Configuración en Sistemas

- **Clientes, bases y teléfonos** — `/sistemas/franquicias`, `SistemasFranquicias.tsx`. Antes era una solapa de Franquicias; `/mayorista/franquicias/clientes` redirige acá.
- Cada cliente activo de `clientes` apunta a una base de Dragon y tiene un teléfono de WhatsApp. Tablas `franquicias_bases` (base, sucursal = `BD_ORIGEN`, nombre, activa) y `franquicias_clientes` (cliente_id → base + teléfono). RPC `franquicias_bases_mapa()` (devuelve `bases`, `clientes` y `telefonos`), `franquicias_guardar_asignacion(p_cliente, p_base, p_telefono)` (base vacía = sacar la asignación completa) y `franquicias_asignar_telefono(p_cliente, p_telefono)` (solo teléfono, para no pisar la base en un blur). SQL: `sql/franquicias_clientes_bases.sql`, `sql/franquicias_telefono_cliente.sql`, `sql/franquicias_asignar_base_permiso.sql`.
- El teléfono se normaliza para WhatsApp (`normalizarTelefono`, internacional sin `+`). Se usa como contacto principal de la propuesta; los contactos extra siguen en `franquicias_contactos`.
- Las RPCs validan con `private.tengo_permiso()`; `sql/franquicias_telefono_cliente.sql` incluye `grant usage on schema private to authenticated` para que el rol autenticado pueda invocarlas.
- Código de cliente: en `clientes` va sin ceros (`1140`), Dragon y la asignación lo usan con 5 dígitos (`01140`, `claveCliente`). Clave de franquicia = base sin `DRAGONFISH_` (`CFU`).

## Propuestas y link público

- Tablas `franquicias_propuestas` (estado `borrador` → `enviada` → `confirmada` → `en_dragon`, o `anulada`; vence a los 7 días), `franquicias_propuesta_items`, `franquicias_contactos`. SQL: `sql/franquicias_propuestas.sql`.
- Multi-cliente (`sql/franquicias_multicliente.sql`, 21/10/2026): la propuesta guarda `cliente_id`, `cliente_nombre` (destino del pedido en Dragon) y `tipo` (`reposicion` / `materiales`; también se acepta `calzado` por compatibilidad).
- Link sin usuario `/p/:token` (`PropuestaFranquicia.tsx`): RPC `propuesta_franquicia_publica` y `confirmar_propuesta_franquicia`.

## Alta en Dragon

- `puente-sql/scripts/sync-franquicias-dragon.js` (tarea "MITO - Pedidos franquicias", cada 1 min): toma las confirmadas con `franquicias_tomar_para_dragon` y crea el pedido de venta en `DRAGONFISH_MITO` por la API REST (solo altas).
- Cliente = el `cliente_id` de la propuesta (si es vieja y no lo trae, el fijo de la franquicia). Lista siempre `LISTA2`. Observación: "cliente (nombre) - Propuesta|Reposición de materiales N - comentario". Hasta 5 reintentos.
