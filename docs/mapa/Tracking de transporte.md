# Tracking de transporte

Área **Administradores** (`area_administradores.view`) → app **Tracking de transporte** (`/administradores/tracking`, `TrackingTransporte.tsx`). Permisos: `tracking.view` (ver) y `tracking.gestionar` (vehículos, locales obligatorios, ubicar locales). SQL: `sql/tracking_transporte.sql`.

## De dónde sale cada dato
- **GPS**: app **Traccar Client** en el celular del chofer (corre en segundo plano aunque se cierre todo). Manda cada ~30 s a `https://hub-mito.vercel.app/api/tracking` (formato OsmAnd por query o JSON de Traccar 9). Autoriza el **identificador del dispositivo** (`tracking_vehiculos.dispositivo`, corto tipo `master-9588`: nombre + 4 números, editable en «Configurar celular»; se compara sin mayúsculas). Se guarda en `tracking_ubicaciones` (solo escribe la API con service role).
- **Cargas / entregas**: `api/tracking.ts?vista=hub` lee en vivo `bultos_historial` de la base de **Transporte** (con `TRANSPORTE_SERVICE_ROLE_KEY`): carga = bulto escaneado por un usuario `TRANSPORTISTA`; entrega = registro `RECIBIDO` de ese bulto. No se copia nada al hub.
- **Puntos de control = los locales**: cada base de Transporte se ubica una vez con su **dirección** (buscador de OpenStreetMap/Nominatim desde el navegador; muchas veces da el medio de la calle, por eso después centra el mapa para ajustar con un toque) o tocando el mapa, con su radio (`tracking_bases`). A cada vehículo (chofer) se le tildan los locales por donde tiene que pasar sí o sí, con días de la semana y hora límite opcionales (`tracking_recorridos`). RPC `tracking_controles_dia(fecha)` = primera vez que el GPS entró en el radio. Sin pasar y vencida la hora (o día pasado) → rojo.

## Bloqueo en la app Transporte
`D:\PWA\transporte-pwa\src\components\GuardiaUbicacion.tsx` envuelve `/lista/:sesionCodigo`. Para rol `TRANSPORTISTA` pregunta a `api/tracking?vista=chofer` (JWT de Transporte, CORS para su dominio) cada 60 s: si su vehículo no mandó ubicación en **10 min**, no deja escanear (tapa la pantalla y frena la pistola sin perder lo escaneado). Chofer sin vehículo vinculado o sin conexión con el hub → no bloquea.

## Avisos que suenan (ubicación cortada)
pg_cron `tracking-avisos-ubicacion` cada 2 min llama a `api/tracking?vista=alertas`: a cada vehículo vinculado a un chofer que lleva **3 min** sin ubicación, en jornada (lunes a sábado 6-21 h y solo si el chofer ya escaneó algo hoy), le manda una notificación push que suena y vibra, repetida cada 2 min (`tracking_vehiculos.ultimo_aviso`). Suscripciones en `tracking_push` (las registra `AvisosUbicacion.tsx` de la app Transporte con `?vista=push`; el service worker la muestra con `public/push-sw.js`, importado por Workbox). Usa las mismas claves VAPID que `api/push.ts`. En 🚚 Vehículos se ve si el chofer tiene «🔔 avisos activados».

**Candado del mapa**: «Fijar zona» guarda la zona visible (localStorage `tracking-vista-fija`, por navegador); el mapa abre ahí y no se auto-encuadra. «Volver a la zona» la recentra; tocar el candado la suelta.

**Km recorridos**: `kmDelDia` en `TrackingTransporte.tsx` suma la distancia entre ubicaciones de Traccar del día (solo precisión ≤ 50 m, sin saltos > 150 km/h, tramos < 20 m se acumulan). Línea recta entre puntos: en curvas da un poco menos.

**Estadísticas de km** (`/administradores/tracking/km`, `TrackingKm.tsx`; se entra tocando «Km recorridos»): RPC `tracking_km(desde, hasta)` (`sql/tracking_km.sql`, misma cuenta que `kmDelDia`) da km y tiempo andando (puntos a ≥ 5 km/h según Traccar) por vehículo y día. Filtro Día/Semana/Mes/Fechas, comparación con el período anterior, columnas por vehículo con el número adentro (por semana si el rango pasa 62 días), tablas por vehículo y por día (tocar un día abre el tracking con `?fecha=`), Excel.

## Estados en la lista
En ruta (≥5 km/h, ubicación < 5 min) · Detenido · Sin señal (> 15 min) · Sin GPS (chofer sin vehículo).

## Desarrollo
`npx tsx scripts/dev-tracking.mts` sirve la API en :4174 (vite hace proxy de `/api/tracking`); la ingesta local falla porque no hay service role del hub en `.env`.
