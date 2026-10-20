# Informes por WhatsApp

Pantalla **«Envío informes y reportes»** (área Sistemas, ruta `/informes`): informes que se mandan por WhatsApp a mano o todos los días. Alta: 09/10/2026.

- SQL `sql/informes.sql`: tablas `informes` (definición) e `informes_envios` (historial; solo lo escribe el servidor con service role).
- Permisos `sistemas.informes.view` / `.create` / `.edit` / `.delete`; app en `src/config/areas.ts`, ruta con `PermissionRoute` en `src/App.tsx`. Ver [[Permisos y usuarios]].
- Front: `src/pages/Informes.tsx` (lista + formulario: nombre, destinatarios, programación `manual` o `diario` hora+días, activo; Enviar ahora, Vista previa, historial). Tipos/helpers: `src/lib/informes.ts`.
- Fuente del cuerpo: `vista` (vista habilitada en Datos SQL, vía [[Puente SQL y syncs]]), `app` (Recepción INDO pendientes, Armados de pedidos, Pedidos de compra 7 días, Eficiencia mayorista, **Km recorridos del transporte** — `src/lib/informeKmTransporte.ts`, RPC `tracking_km` del día vs el último día con recorrido, ver [[Tracking de transporte]]) o `texto` libre con `{fecha}`, `{hora}`, `{dia}`.
- Formato (`config.formato`): `texto` o **`imagen`** PNG: `src/lib/informesImagen.ts` con **satori + sharp**; fuente Geist embebida en `src/lib/informeFuente.ts` (se regenera con `scripts/gen-font-base64.mjs`, TTF en `scripts/assets/`). Sube el PNG a `/media` de Meta y manda `type:"image"`.
- Motor (solo server): `src/lib/informesServidor.ts` → WhatsApp Cloud API (`graph.facebook.com`, versión por defecto **v23.0**).
- Endpoint único `api/informe.ts`: `POST` = envío manual / vista previa (JWT + `sistemas.informes.edit`); `GET` = manda los diarios vencidos (`CRON_SECRET` o JWT con permiso). «Ya se mandó hoy» con PATCH condicional (no duplica).
- Cron `vercel.json`: `0 11 * * *` (08:00 AR); en Hobby solo 1 por día. Por eso pg_cron `informes-diarios` (`sql/informes_diarios_cron.sql`) llama cada 5 min a `GET /api/informe?evento=diarios` (sin secreto, como `?evento=repo`: solo manda los diarios ya vencidos y una vez por día).
- Env en Vercel: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERSION` (opcional), `CRON_SECRET`. Sin credenciales queda registrado «WhatsApp no configurado».
- **Las RPC de la estadística tienen que dejar entrar al service role.** `estadistica_vtd` y `avance_vtd_rep` chequean admin o `mayorista.estadisticas.view`; el servidor entra con la service role key (sin usuario, `auth.uid()` NULL), así que el guard arranca con `auth.role() = 'service_role' OR …`. Si se reaplica una de esas funciones sin esa línea, el envío corta con **42501 «Sin permiso para ver la estadística»** (pasó el 20/10/2026 con `estadistica_vtd`; se arregla con `sql/estadistica_vtd_service_role.sql`).
- Mockup: `mockups/creador-informes.html`.
