# Otros módulos

- **RRHH**: `Empleados.tsx` (sub-menú por estado de legajo, columnas en `src/config/columnasEmpleados.ts`, import `src/lib/importarListado.ts`), `CargaNovedades`, `ResumenNovedades`, `MotivosNovedades`, `TiposNovedades`, `Cumpleanios.tsx` + `EditorCumple.tsx` (la plantilla trae nombres impresos: fondos generados + placa).
- **RMA**: `Rma.tsx`, `ProveedoresPacho.tsx`, `GuiaPacho.tsx`.
- **Contador de clientes IA**: `ContadorClientes.tsx`, `TasaConversion.tsx`, `IaCamaras.tsx`, `CalibrarCamara.tsx`. RLS por local, video solo por VPN. DVR excluidos: Polo 52, Producción, Fábrica (Mariano Max sí). Cámara sin imagen 30 s → se reconecta.
- **Opiniones/encuestas/QR**: `Opinar.tsx` (`/opinar/:local`, `/opinar/qr/:token`), `Opiniones.tsx`, `EncuestasAdmin.tsx`, `QrEtiquetaEditor.tsx`, `SectoresQr.tsx`, `QrLocales.tsx`.
- **Sistemas**: `DatosSql.tsx`, `SqlConexion.tsx`, `Replicas.tsx` (estado del Replicador SQL de `DESKTOP-OA4GU6I`, `api/replicas.ts`).
- **Varios**: `Manuales.tsx`, `Documentos.tsx`, `CarpetaArea.tsx` (`/archivos/:areaId`), `CuentaAmigos.tsx`, `BannerEditor.tsx`.
- Lectura de remitos con IA: sacada del hub (2026-10-07), queda dormida en mito-server.
