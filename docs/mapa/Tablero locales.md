# Tablero locales

Área **Administración** → `/administracion/tablero-locales` (`TableroLocales.tsx`, permiso `tablero_locales.view` de `sql/tablero_locales_permiso.sql`, aplicado; sin rol asignado: entra el admin). Solo lectura. Maqueta aprobada: `mockups/tablero-locales.html`.

Son las hojas **Caja** y **Errores de caja** del Tablero del local (`TableroLocal.exe`, fuente en `D:\pbi a html\pwa-locales`, `src/consultas/venta.js`), para uno o varios locales a la vez.

Flujo: `src/lib/tableroLocales.ts` → `POST /api/sql/tablero-locales` (`src/lib/tableroLocalesApi.ts`, colgado de `api/sql/[ruta].ts`; suma los objetivos con la RPC `objetivos_locales_dia` usando la service role) → Puente `{ accion: 'tablero_locales', hoja }` (`puente-sql/tablero-locales.js`) → la base `DRAGONFISH_*` de cada local, por el servidor donde está al día (misma lista que la consulta de precios: `STOCK_PUBLICO_LOCALES` de `server.js`). Cache 60 s; si un local falla, el resto responde y se avisa.

- Hojas del puente: `caja` (venta por día, valores, vendedores, comprobantes de caja `COMCAJ`, arqueos `ARQCAJA`/`ARQTOTDET`, cierre = concepto `CCC`), `billetes` (`ARQEFECTDET` de un arqueo), `errores` (cobros `VAL` por comprobante), `articulos` (renglones de un comprobante). Hasta 62 días.
- Criterios del tablero: venta sin anulados, sin remitos ni vendedores 999/992, notas de crédito restan.
- Errores de caja: `JJRECIB` sumado por comprobante coincide siempre con `FTOTAL` (es lo imputado, no lo entregado) y `JJTOTFAC` repite el primer importe cuando hay dos medios de pago: **no sirven para marcar diferencias automáticas** (se probó el 27/11/2026). La hoja queda como la del tablero: para revisar a ojo.
- Todas las tablas se ordenan tocando el encabezado (asc → desc → original).
- Dev: copia del puente (launch «puente-copia», :3199) + `node scripts/mock-tablero-locales.mjs` (:4182, launch «mock-tablero-locales»); vite proxyea `/api/sql/tablero-locales`.
- Cambios en `tablero-locales.js` o `server.js` → reiniciar el puente.
