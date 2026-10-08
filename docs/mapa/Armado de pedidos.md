# Armado de pedidos

Mayorista pide armar un pedido de venta; el piso lo toma y lo arma en Mi repo.

- SQL `sql/mayorista_armados.sql`: tablas `mayorista_armados` (prioridad, estado, quién, faltantes; un solo armado activo por pedido) y `mayorista_armados_items` (`escaneadas` por línea). RLS select para `pedidos_venta.view` o `mayorista.repos_piso`.
- RPC: `pedir_armado`, `armado_aceptar` (gana el primero), `armado_escanear`, `armado_marcar_item` (tilde manual), `armado_deshacer`, `armado_finalizar`, `private.armado_cerrar_si_listo`.
- Front: `PedidosVenta.tsx` (botón Pedir armado, selección múltiple, prioridad urgente/normal/baja, pedido en verde EN CURSO/ARMADO), `MiRepo.tsx` + `src/components/ArmadoPedido.tsx` (cámara QR/Code39/Code128/EAN, ✓ manual por artículo), `src/lib/armados.ts` (tipos, `ordenArmados`).
- Aviso: `src/lib/alarma.ts` + `CampanaNotificaciones.tsx` miran cada 10 s y suenan/vibran. Con la app cerrada o bloqueado: ver Avisos push abajo.
- Tests: `scripts/test-armados.sql`, `scripts/test-armados-rls.sql`. Mockups `mockups/pedir-armado.html`, `mockups/mi-repo.html`.

Ver [[Repos Mayorista y Mi repo]], [[Pedidos compra, venta y cancelaciones]].

## Avisos push (suena con el celular bloqueado)
- `sql/push_suscripciones.sql`: tabla `push_suscripciones` (un celular por fila), RPC `push_suscribir` / `push_desuscribir` (legajos `@empleados.hub-mito.app` o `mayorista.repos_piso`), columna `mayorista_armados.push_at`.
- `api/push-armado.ts` (Vercel, `web-push`): GET da la clave pública; POST (lo llama PedidosVenta después de `pedir_armado`, `avisarArmados()`) manda el aviso de los armados no avisados y borra suscripciones vencidas. Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- `public/push-sw.js` (importado por el SW de la PWA vía `workbox.importScripts`): muestra la notificación con vibración y abre Mi repo al tocarla.
- `src/lib/push.ts` + `src/components/AvisosCelular.tsx`: cartel «Activar avisos» en Mi repo (cada celular lo toca una vez). iPhone: solo con la app instalada en la pantalla de inicio.
- `alarma.ts` `prepararAudio()`: destraba el audio en el primer toque (sin eso el pitido dentro de la app no sonaba).

## Responsable del local (sincronizado con Repos Mayorista)
- `sql/armado_responsable.sql`: trigger al crear el armado → si el **cliente** del pedido es un local (mismo código que en la repo, o sinónimo de `locales_sinonimos`) con responsable en `mayorista_responsables` (la repo más reciente), queda en `asignado_legajo/nombre/local`. `private.responsable_de_local()` usa `public.empleados` (no `empleados_basico`, que filtra por usuario).
- Asignado ⇒ solo le aparece/suena a ese legajo (Mi repo `paraLegajo()`, campana y push) y solo él lo acepta (`armado_aceptar`; mayorista/admin también). Sin asignar ⇒ como antes, el primero que acepta.
