# Facturación, guías y notas de crédito (Mayorista)

- `FacturacionFabrica.tsx`: el alta es un **botón flotante movible** (`BotonFlotante`). Columna **transporte editable solo por admin**. Las de razón social **MITO SRL se borran solas cuando tienen fecha de envío** (`sql/facturacion_mito_srl_borrar.sql`).
- `Guias.tsx`, `NotasCredito.tsx`, `Clientes.tsx`, `Transportes.tsx`.
- Transporte y Control de Locales son **accesos directos del menú principal** (abajo, `enMenu` en `src/config/areas.ts`), para quienes ya tenían permiso.
