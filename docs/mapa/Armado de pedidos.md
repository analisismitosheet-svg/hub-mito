# Armado de pedidos

Mayorista pide armar un pedido de venta; el piso lo toma y lo arma en Mi repo.

- SQL `sql/mayorista_armados.sql`: tablas `mayorista_armados` (prioridad, estado, quién, faltantes; un solo armado activo por pedido) y `mayorista_armados_items` (`escaneadas` por línea). RLS select para `pedidos_venta.view` o `mayorista.repos_piso`.
- RPC: `pedir_armado`, `armado_aceptar` (gana el primero), `armado_escanear`, `armado_marcar_item` (tilde manual), `armado_deshacer`, `armado_finalizar`, `private.armado_cerrar_si_listo`.
- Front: `PedidosVenta.tsx` (botón Pedir armado, selección múltiple, prioridad urgente/normal/baja, pedido en verde EN CURSO/ARMADO), `MiRepo.tsx` + `src/components/ArmadoPedido.tsx` (cámara QR/Code39/Code128/EAN, ✓ manual por artículo), `src/lib/armados.ts` (tipos, `ordenArmados`).
- Aviso: `src/lib/alarma.ts` + `CampanaNotificaciones.tsx` miran cada 10 s y suenan/vibran. **Si nadie lo acepta, repica con backoff 1, 2, 4, 8 min y después cada 8** (`REPIQUES` / `esperaRepique`); si se libera vuelve a empezar. Con la app cerrada o bloqueado: ver Avisos push abajo.
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
- **Regla 08/10/2026**: si un pedido tiene un armado aceptado, gana el legajo que lo aceptó (en la lista, el detalle y los renglones), aunque la repo de ese local la tenga otro responsable.
- **Sin asignación automática (08/10/2026)**: se sacó el trigger `mayorista_armados_responsable` (`sql/armado_sin_asignar_y_quitar.sql`); el armado le llega a todo el piso y gana el primero que acepta. Las columnas `asignado_*` quedan pero ya no se llenan.
- **Sacar armado** (solo admin): botón en el detalle de Pedidos de venta → RPC `armado_quitar(p_id)` (borra el armado y sus ítems).
- **Ubicación en el armado**: `ArmadoPedido.tsx` muestra el chip de ubicación del Mapeo depósito y ordena "Faltan escanear" por ubicación, igual que el repo.
- **✓ manual de a 1 unidad** (`sql/armado_marcar_unidad.sql`): `armado_marcar_item` suma +1 (si piden 2 y hay 1, queda 1/2 y la otra va a faltante al Finalizar). En pantalla, si la cantidad es >1 el botón dice «+1». Se arregló el bug que trababa todos los ✓ después del primero (faltaba bajar `enViaje`).
- Al tildar o deshacer **no se vuelve a enfocar el casillero del escáner** (en el celular abría el teclado): se hace `blur`.
- Pausa del armado con motivo y cooldown: ver [[Repos Mayorista y Mi repo]] (`piso_pausas`).
- **Cronómetro del armado en la base + una tarea a la vez** (`sql/una_tarea_a_la_vez.sql`): columnas `crono_estado/crono_segundos/crono_desde` en `mayorista_armados`; `armado_iniciar` (= Reanudar), `armado_crono`. Sigue corriendo aunque se vuelva al menú. Al iniciar/reanudar un armado o una repo, `private.pausar_lo_demas` pausa lo que el legajo tenía en marcha con motivo `otra_tarea` ("Pasó al pedido N° …"). Esas pausas automáticas no cuentan para el cooldown de 15 min.
