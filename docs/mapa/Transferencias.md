# Transferencias (reposiciones)

- `Transferencias.tsx` (`/transferencias`): lotes `transfer_lotes` + `transfer_items`; mails a locales con `api/enviar-transferencia.ts` (Microsoft Graph), botón Reenviar. Filtro por período (`src/lib/periodoSemanas`), mismo esquema rápido que [[Repos Mayorista y Mi repo]].
- `EstadisticasTransferencias.tsx`: una sola RPC `estadisticas_transferencias` (`sql/estadisticas_transferencias_definer.sql`, SECURITY DEFINER, permisos resueltos una vez con `private.mis_origenes()`). Filtro tipo: **diaria** (nombre del lote contiene "diaria", incluye "venta diaria") / **otras**.
- **Sinónimos de locales** (`sql/locales_sinonimos.sql`): General Paz = GRALPAZ/GPAZD…, Walmart = WALMARTD…; se unifican con `coalesce(so.grupo, i.origen)`.
- `listar_transfer_items` (`sql/listar_transfer_items_mis_origenes.sql`) fuerza `private.mis_origenes()` para usuarios de local. La pantalla espera perfil + sinónimos y descarta respuestas viejas (`cargaActual`).
- Por qué DEFINER: las policies de `transfer_items` llaman funciones por fila → timeout. Ver [[Arquitectura]].
- Permiso `transferencias.view`.
