# Control físico de mercadería (Depósito Indo, 27/11/2026)

Segundo paso después del [[Picking]]: el depósito cuenta lo que dice el picking de cada factura de [[Recepción INDO]]. Maqueta: `mockups/control-mercaderia-indo.html`.

## Flujo
1. Compras registra el picking contra la factura y la factura pasa a «LISTO PARA CONTROLAR» (ya existía).
2. **Recién ahí se habilita** el control: sin picking, Recepción INDO muestra «🔒 Falta el picking» y la factura ni aparece en el celular. Si se anula el picking, los renglones desaparecen.
3. `/deposito/control-fisico` (`ControlFisico.tsx`, celular): lo hace **cualquiera con rol `deposito`** (o legajo de Depósito Indo) y el admin (`veMiRepoDeposito`). Más adelante: asignado por legajo. Cada renglón: «Está todo» o contar distinto (falta → motivo obligatorio).
4. Renglones **color 00 / talle U** (en Dragon Indo esos artículos están dados de alta solo como 00 / UNICO, ~40 % de los renglones) se **desglosan siempre** en una grilla color × talle (`components/control/GrillaDesglose.tsx`). **El mismo artículo de la misma OC va en una sola tarjeta** (`clavesGrupo`): color 00 con talles (3.5, 4.5, 6…) → la grilla trae ESOS talles como columnas («de 11») y se agregan los colores; color con talle U → las filas son esos colores y se agregan los talles; 00 / U → solo. Cada celda se guarda en su renglón del picking (`DesglosePorLinea`), con un motivo para los que quedan cortos.
5. Colores y talles **solo de los maestros de Dragon Indo**, en vivo: vistas `vw_COLORES_INDOD` (788) y `vw_TALLES_INDOD` (310) en `VISTAS_CONSOLIDADAS` (`sql/vw_COLORES_TALLES_INDOD.sql`), leídas por `/api/sql`. Lo que no está en Dragon no se puede cargar (Compras lo da de alta). Curvas rápidas S–4XL, XS–XXL, 36–46, 1–16, 3.5–8 y **Rango de talles** «del … al …» (`talleRango`): letras (S al 4XL, con la forma que tenga Dragon: XXL, 3XL) o números (35 al 44, 3 al 12); si es numérico **pregunta si agrega los medios** (3.5, 4.5…). Los que no existen en Dragon no se agregan y se avisan.
6. El desglose **no reemplaza** el renglón del picking: queda en `control_fisico_lineas.desglose` y se ve desplegando el renglón (Picking y Controles físicos).
7. «Terminar control físico» (todo contado): marca **«Controlada» siempre** en Recepción INDO (fecha + quién por el trigger `recepcion_indo_firma`); si hubo faltantes/sobrantes queda la etiqueta **«con diferencias»**. Push «📦 Control físico terminado» + campana al rol deposito, legajos de Indo y admins.

## Pantallas
- `/deposito/controles-fisicos` (`ControlesFisicos.tsx`): diseño de Pedidos de venta (lista + detalle). Filtros período y estado (Con diferencias / OK / En curso / Pendientes). Detalle con **P. compra**, importe contado, $ dif., faltante a precio compra, Excel con el desglose. `?abrir=<factura_clave>` (lo usan push y campana; al abrirlo se marca visto). Admin: «Reabrir».
- [[Picking]]: columnas **P. compra** (unitario sin IVA de la línea de la OC, RPC `picking_precios`), **Importe** (recibido × precio) y **Control físico** de la factura elegida (desglose desplegable).
- [[Recepción INDO]]: debajo de la fecha de Control, chip del control físico (pendiente / % en curso / OK / con diferencias) o «🔒 Falta el picking».

## Base (`sql/control_fisico.sql`)
- `control_fisico` (una por `factura_clave` = proveedor|factura compactos, igual que `picking_entregas`), `control_fisico_lineas` (pedido + artículo + color + talle, contado, motivo, desglose jsonb), `control_fisico_vistos`. Sin acceso directo: todo por RPC.
- `private.cf_lineas(factura)`: picking vivo + precio de la OC + lo contado. `private.cf_requiere_desglose`: color '', 0, 00 o talle '', U, UNICO.
- RPC: `control_fisico_lista`, `_detalle`, `_guardar` (con desglose ignora `p_contado`; los dos NULL = sacar lo contado), `_terminar`, `_reabrir` (admin), `_estados(claves)` (Recepción INDO), `_avisos` / `_visto` (campana), `_reclamar_push` (service role, `api/push.ts?tipo=control_fisico`), `picking_precios`.
- Ver: `cf_ve()` = cuenta + `picking.view` + `deposito.view`. Contar: `cf_cuenta()` = admin o `private.recibe_avisos_indo`.
- En local (`vite` sin `/api`) la grilla avisa que Dragon no devolvió la lista: se prueba en Vercel.
