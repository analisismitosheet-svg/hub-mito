# Transferencias (reposiciones)

- `Transferencias.tsx` (`/transferencias`): lotes `transfer_lotes` + `transfer_items`; mails a locales con `api/enviar-transferencia.ts` (Microsoft Graph), botón Reenviar. Filtro por período (`src/lib/periodoSemanas`), mismo esquema rápido que [[Repos Mayorista y Mi repo]].
- `EstadisticasTransferencias.tsx`: una sola RPC `estadisticas_transferencias` (`sql/estadisticas_transferencias_definer.sql`, SECURITY DEFINER, permisos resueltos una vez con `private.mis_origenes()`). Filtro tipo: **diaria** (nombre del lote contiene "diaria", incluye "venta diaria") / **otras**.
- **Sinónimos de locales** (`sql/locales_sinonimos.sql`): General Paz = GRALPAZ/GPAZD…, Walmart = WALMARTD…; se unifican con `coalesce(so.grupo, i.origen)`.
- `listar_transfer_items` (`sql/listar_transfer_items_mis_origenes.sql`) fuerza `private.mis_origenes()` para usuarios de local. La pantalla espera perfil + sinónimos y descarta respuestas viejas (`cargaActual`).
- Por qué DEFINER: las policies de `transfer_items` llaman funciones por fila → timeout. Ver [[Arquitectura]].
- Permiso `transferencias.view`.
- **Importador del Excel** (`procesar()` en `Transferencias.tsx`): una hoja por local origen (el nombre de la hoja es el origen; se saltean venta/resumen/general), fila de encabezado con `ARTICULO`, columnas de locales destino desde **la última columna de datos del artículo** (ARTICULO/DESC/MATERIAL/COLOR/TALLE/TIPO) hasta `TOTAL`; `NO_LOCAL` descarta STOCK/VENTA/PRIORIDAD/etc. Antes de grabar muestra origenes y destinos detectados para confirmar.
  - Hay dos plantillas: la **diaria** (6 columnas de artículo, con MATERIAL y TIPO) y la de **cyber/MAT/ZAPAS** (solo ARTICULO, DESC, COLOR, TALLE, orden fijo de locales que arranca con VCPD, WALMARTD, CFRA…). Hasta el 02/11/2026 el importador asumía 6 columnas si no había TIPO y **se comía las 2 primeras columnas de locales** de la segunda plantilla: ningún lote no-diario desde agosto tiene destino VCPD ni WALMARTD (ej. «261030 - cyber ultima!!!»).
  - Origen WALMART (nombre de hoja) y WALMARTD son el mismo local por los sinónimos; no hace falta renombrar hojas.
