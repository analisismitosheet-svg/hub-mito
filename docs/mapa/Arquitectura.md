# Arquitectura

- **Frontend**: React 18 + Vite + Tailwind + TypeScript, PWA. Repo `D:\pwa mito`, rama `main`.
- **Deploy**: Vercel, auto-deploy al pushear a `main` → https://hub-mito.vercel.app. La PWA puede quedar con la versión vieja en caché: el usuario tiene que recargar (Ctrl+F5) o cerrar y abrir.
- **Base**: Supabase, proyecto `qwlugajzxrrwckrqlrjp`. RLS en todas las tablas; lo que escribe con lógica pasa por funciones `SECURITY DEFINER`. Ver [[Permisos y usuarios]].
- **Funciones de Vercel** (`api/`, **tope 12 en plan Hobby, hoy 10**; si se pasa, el deploy falla con `exceeded_serverless_functions_per_deployment` → antes de sumar una, fusionar): `api/sql/[ruta].ts` (un solo endpoint que rutea vista / `status` / `catalogo`; la lógica vive en `src/lib/sqlVista.ts`, `sqlStatus.ts`, `sqlCatalogo.ts`), `api/pedidos-sync.ts?tipo=compra|venta` (sync de pedidos de compra/venta), `api/replicas.ts`, `api/enviar-transferencia.ts` (mails por Microsoft Graph), `api/push.ts` (avisos push web-push, ver [[Armado de pedidos]]), `api/informe.ts` (informes por WhatsApp), `api/precios-sync.ts` ([[Comparativa de precios]]).
- **Puente SQL**: Node en la PC `DESKTOP-OA4GU6I`, publicado por Tailscale Funnel. Ver [[Puente SQL y syncs]].
- **Agentes IA**: servidor aparte `D:\PWA\mito-server` (Fastify + Ollama); `VITE_URL_AGENTES` en Vercel.

## Comandos
- Typecheck: `npx tsc -p tsconfig.json --noEmit` (alternativa: `node node_modules/typescript/bin/tsc --noEmit`).
- Build: `node node_modules/vite/bin/vite.js build`. Tests: `npm test`.
- SQL a Supabase desde script: `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/<archivo>.sql [--raw]`.
- SQL Server (solo lectura): `node scripts/sql.mjs "SELECT ..."` (`--alias` = servidor local `VISTAS_CONSOLIDADAS`).

## Desarrollo local
- El dev server no tiene `/api`. Para probar se puede agregar en `vite.config.ts` un proxy temporal `'/api': { target: 'https://hub-mito.vercel.app', changeOrigin: true }` y **sacarlo antes del commit**.

## Límites que muerden
- PostgREST corta en **1000 filas**: paginar con `.range()`, tandas de 200–500 en `.in()`, o que la RPC devuelva un array (`text[]`/`jsonb`) en vez de SETOF.
- RLS con funciones por fila = timeouts en tablas grandes (`transfer_items`). Solución usada: RPC `SECURITY DEFINER` que valida permisos una sola vez.
- El `statement_timeout` puesto en la función no ayuda a PostgREST.
- **Respuesta de una función de Vercel: máx. ~4,5 MB.** Si se pasa → 500 sin cuerpo ("Error 500 consultando <vista>"). Una vista para Datos SQL tiene que quedar bien por debajo (caso real: `equivalencias` 61 821 filas = 5,2 MB, se sacó de `config_app.sql_vistas`).
- **No usar catch-all `[...ruta].ts` en `/api`** (09/10/2026): el segmento no llega en `req.query` y `{...req}` no copia `req.headers` → `FUNCTION_INVOCATION_FAILED` en todo `/api/sql/*`. Se usa segmento simple `[ruta].ts` y se pasa el mismo `req` seteando `req.query.view`, nunca un spread.
- **Cron en Hobby: máximo 1 vez por día** (`*/10 * * * *` hace fallar el deploy).

## Seguridad (revisión 13/10/2026, `sql/seguridad_2026_10.sql`)
- **CSP en `vercel.json`** (`script-src 'self'`, sin inline ni eval). Un dominio externo nuevo que se cargue como script, iframe o fuente hay que sumarlo ahí; imágenes y `fetch` a `https:` ya están permitidos.
- **Ventanas de impresión sin `<script>` inline**: heredan la CSP. Imprimir o agregar controles desde la ventana principal con `src/lib/ventanaImpresion.ts` (`imprimirCuandoCarguen`, `controlesHojaPedido`).
- **Funciones `/api`**: no alcanza con un JWT válido (el registro es abierto y el usuario nuevo queda `pendiente`). Usar `autorizado(token, [permisos])` de `src/lib/apiAuth.ts` (RPC `api_autorizado`: aprobado + permiso). Ids que van en filtros de PostgREST con service role: validar con `esUuid` y `encodeURIComponent`.
- **Storage**: el bucket `dni` es privado; las fotos se muestran con `createSignedUrl`. No crear buckets públicos con datos personales.
- Valores de configuración que van a un `<style>` o HTML de impresión: sanear (ver `sanearQrConfig`).
- `xlsx` viene del CDN de SheetJS (0.20.3), no de npm.
