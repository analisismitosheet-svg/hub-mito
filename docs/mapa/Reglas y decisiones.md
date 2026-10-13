# Reglas y decisiones

- **SQL Server: solo lectura, siempre.** "Borrar del hub" = ocultar en el hub.
- Responder siempre en español rioplatense.
- Al terminar: typecheck, commit y push a `main` incluyendo todo lo pendiente (es todo el mismo proyecto), sin preguntar.
- Sacar el proxy `/api` temporal de `vite.config.ts` antes de commitear.
- No renombrar la PC de Tailscale (`DESKTOP-OA4GU6I`).
- Nada de borrados automáticos basados en el stock del SQL ([[Mapeo depósito]]).
- La descripción de artículos es `ARTICULO_ADICIONAL` ([[Artículos y F12]]).
- Picking: cada picking se registra aparte, no se edita el total ([[Picking]]).
- RPC grandes: SECURITY DEFINER + permisos una vez; arrays en vez de SETOF si pasan de 1000 filas ([[Arquitectura]]).
- Íconos sin colores repetidos ([[UI y estilo]]).
- Vercel Hobby: **máx. 12 funciones** (hoy 9) y cron **1 vez por día**; nada de catch-all `[...x].ts` en `/api` ni `{...req}` ([[Arquitectura]]).
- Vistas para Datos SQL: respuesta < 4,5 MB ([[Arquitectura]]).
- Pausas del piso: las autoriza el puesto, no arrancan solas ([[Repos Mayorista y Mi repo]]). Faltantes al finalizar: la línea se cierra sola y el aviso sale solo ([[Armado de pedidos]]).
- Un pedido completo (todo en verde) no se vuelve a pedir a armar salvo el admin ([[Pedidos compra, venta y cancelaciones]]).
