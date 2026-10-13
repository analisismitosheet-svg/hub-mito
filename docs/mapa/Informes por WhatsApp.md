# Informes por WhatsApp

Pantalla **«Envío informes y reportes»** (área Sistemas, ruta `/informes`): informes que se mandan por WhatsApp a mano o todos los días. Alta: 09/10/2026.

- SQL `sql/informes.sql`: tablas `informes` (definición) e `informes_envios` (historial; solo lo escribe el servidor con service role).
- Permisos `sistemas.informes.view` / `.create` / `.edit` / `.delete`; app en `src/config/areas.ts`, ruta con `PermissionRoute` en `src/App.tsx`. Ver [[Permisos y usuarios]].
- Front: `src/pages/Informes.tsx` (lista + formulario: nombre, destinatarios, programación `manual` o `diario` hora+días, activo; Enviar ahora, Vista previa, historial). Tipos/helpers: `src/lib/informes.ts`.
- Fuente del cuerpo: `vista` (vista habilitada en Datos SQL, vía [[Puente SQL y syncs]]), `app` (Recepción INDO pendientes, Armados de pedidos, Pedidos de compra 7 días) o `texto` libre con `{fecha}`, `{hora}`, `{dia}`.
- Formato (`config.formato`): `texto` o **`imagen`** PNG: `src/lib/informesImagen.ts` con **satori + sharp**; fuente Geist embebida en `src/lib/informeFuente.ts` (se regenera con `scripts/gen-font-base64.mjs`, TTF en `scripts/assets/`). Sube el PNG a `/media` de Meta y manda `type:"image"`.
- Motor (solo server): `src/lib/informesServidor.ts` → WhatsApp Cloud API (`graph.facebook.com`, versión por defecto **v23.0**).
- Endpoint único `api/informe.ts`: `POST` = envío manual / vista previa (JWT + `sistemas.informes.edit`); `GET` = manda los diarios vencidos (`CRON_SECRET` o JWT con permiso). «Ya se mandó hoy» con PATCH condicional (no duplica).
- Cron `vercel.json`: `0 11 * * *` (08:00 AR); en Hobby solo 1 por día, por eso también se procesan al abrir la pantalla.
- Env en Vercel: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERSION` (opcional), `CRON_SECRET`. Sin credenciales queda registrado «WhatsApp no configurado».
- Mockup: `mockups/creador-informes.html`.
