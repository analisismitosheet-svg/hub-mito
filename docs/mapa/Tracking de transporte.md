# Tracking de transporte

Área **Administradores** (`area_administradores.view`) → app **Tracking de transporte** (`/administradores/tracking`, `TrackingTransporte.tsx`). Permisos: `tracking.view` (ver) y `tracking.gestionar` (vehículos, locales obligatorios, ubicar locales). SQL: `sql/tracking_transporte.sql`.

## De dónde sale cada dato
- **GPS**: app **Traccar Client** en el celular del chofer (corre en segundo plano aunque se cierre todo). Manda cada ~30 s a `https://hub-mito.vercel.app/api/tracking` (formato OsmAnd por query o JSON de Traccar 9). Autoriza el **identificador del dispositivo** (`tracking_vehiculos.dispositivo`, largo y al azar, lo genera el hub). Se guarda en `tracking_ubicaciones` (solo escribe la API con service role).
- **Cargas / entregas**: `api/tracking.ts?vista=hub` lee en vivo `bultos_historial` de la base de **Transporte** (con `TRANSPORTE_SERVICE_ROLE_KEY`): carga = bulto escaneado por un usuario `TRANSPORTISTA`; entrega = registro `RECIBIDO` de ese bulto. No se copia nada al hub.
- **Puntos de control = los locales**: cada base de Transporte se ubica una vez con su **dirección** (buscador de OpenStreetMap/Nominatim desde el navegador; muchas veces da el medio de la calle, por eso después centra el mapa para ajustar con un toque) o tocando el mapa, con su radio (`tracking_bases`). A cada vehículo (chofer) se le tildan los locales por donde tiene que pasar sí o sí, con días de la semana y hora límite opcionales (`tracking_recorridos`). RPC `tracking_controles_dia(fecha)` = primera vez que el GPS entró en el radio. Sin pasar y vencida la hora (o día pasado) → rojo.

## Bloqueo en la app Transporte
`D:\PWA\transporte-pwa\src\components\GuardiaUbicacion.tsx` envuelve `/lista/:sesionCodigo`. Para rol `TRANSPORTISTA` pregunta a `api/tracking?vista=chofer` (JWT de Transporte, CORS para su dominio) cada 60 s: si su vehículo no mandó ubicación en **10 min**, no deja escanear (tapa la pantalla y frena la pistola sin perder lo escaneado). Chofer sin vehículo vinculado o sin conexión con el hub → no bloquea.

## Estados en la lista
En ruta (≥5 km/h, ubicación < 5 min) · Detenido · Sin señal (> 15 min) · Sin GPS (chofer sin vehículo).

## Desarrollo
`npx tsx scripts/dev-tracking.mts` sirve la API en :4174 (vite hace proxy de `/api/tracking`); la ingesta local falla porque no hay service role del hub en `.env`.
