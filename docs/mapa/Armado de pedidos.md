# Armado de pedidos

Mayorista pide armar un pedido de venta; el piso lo toma y lo arma en Mi repo.

- SQL `sql/mayorista_armados.sql`: tablas `mayorista_armados` (prioridad, estado, quién, faltantes; un solo armado activo por pedido) y `mayorista_armados_items` (`escaneadas` por línea). RLS select para `pedidos_venta.view` o `mayorista.repos_piso`.
- RPC: `pedir_armado`, `armado_aceptar` (gana el primero), `armado_escanear`, `armado_marcar_item` (tilde manual), `armado_deshacer`, `armado_finalizar`, `private.armado_cerrar_si_listo`.
- Front: `PedidosVenta.tsx` (botón Pedir armado, selección múltiple, prioridad urgente/normal/baja, pedido en verde EN CURSO/ARMADO), `MiRepo.tsx` + `src/components/ArmadoPedido.tsx` (cámara QR/Code39/Code128/EAN, ✓ manual por artículo), `src/lib/armados.ts` (tipos, `ordenArmados`).
- Aviso: `src/lib/alarma.ts` + `CampanaNotificaciones.tsx` miran cada 10 s y suenan/vibran. Pendiente: Web Push con la app cerrada.
- Tests: `scripts/test-armados.sql`, `scripts/test-armados-rls.sql`. Mockups `mockups/pedir-armado.html`, `mockups/mi-repo.html`.

Ver [[Repos Mayorista y Mi repo]], [[Pedidos compra, venta y cancelaciones]].
