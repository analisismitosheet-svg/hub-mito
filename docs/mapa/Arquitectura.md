# Arquitectura

- **Frontend**: React 18 + Vite + Tailwind + TypeScript, PWA. Repo `D:\pwa mito`, rama `main`.
- **Deploy**: Vercel, auto-deploy al pushear a `main` → https://hub-mito.vercel.app. La PWA puede quedar con la versión vieja en caché: el usuario tiene que recargar (Ctrl+F5) o cerrar y abrir.
- **Base**: Supabase, proyecto `qwlugajzxrrwckrqlrjp`. RLS en todas las tablas; lo que escribe con lógica pasa por funciones `SECURITY DEFINER`. Ver [[Permisos y usuarios]].
- **Funciones de Vercel** (`api/`): `api/sql/[view].ts` (lee vistas del SQL Server vía puente), `api/sql/status`, `api/replicas.ts`, `api/enviar-transferencia.ts` (mails por Microsoft Graph), `api/push-armado.ts` (avisos push web-push, ver [[Armado de pedidos]]).
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
