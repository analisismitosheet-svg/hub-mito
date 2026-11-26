# Flexxus

Área **Administración** → `/administracion/flexxus` (`Flexxus.tsx`, permiso `flexxus.view`; los admins lo ven siempre). Solo lectura.

Flujo: `src/lib/flexxus.ts` → `GET /api/sql/flexxus?consulta=…` (`src/lib/flexxusApi.ts`, colgado de `api/sql/[ruta].ts`) → Puente SQL `{ accion: 'flexxus' }` (`puente-sql/flexxus.js`, cache 2 min) → servidor vinculado `FLEXXUS` del SQL local → Firebird 2.5 en M1T0O1. Conexión y clave: ver [[Puente SQL y syncs]].

## Solapas
- **Ventas** (`ventas`): `CABEZACOMPROBANTES` con `CLASECOMPROBANTE = 0` y sin anular (las NC ya vienen negativas). Son las del mayorista; las de los locales entran a Flexxus como asientos.
- **Saldos de clientes** (`saldos`): `VISTADEUDACLIENTES` (`DEBE` = lo pendiente) + `CLIENTES`. Antigüedad por vencimiento; las NC y pagos sin aplicar se descuentan de la deuda más vieja. Columna Vencimiento = el más viejo impago + próximo.
- **Asientos** (`asientos`, hasta 93 días): `CABEZAASIENTOS` + `CUERPOASIENTOS` + `PLANDECUENTAS`. Usuario: manuales de `ASIENTOSMANUALES` (orden 1 = alta, >1 = ediciones); automáticos por `COMPROBANTESASIENTOS` (ORIGEN `I` → `CABEZACOMPROBANTES`/`CABEZAPAGOS`, `E` → `CABEZACOMPRAS`/`CABEZAPAGOSCOMPRAS`). Los automáticos no tienen historia de edición.
- **Sumas y saldos** (`balance` + `mayor` al desplegar una cuenta): reglas del contador (`armarBalance` en `flexxus.ts`):
  - cuentas 1, 2 y 3 arrastran saldo: apertura del ejercicio + movimientos desde el inicio del ejercicio hasta el día anterior al rango;
  - las de resultado (4 y 5) arrancan en 0;
  - **Resultados no asignados** (`3300000001`) suma en su saldo inicial el resultado del inicio del ejercicio al día anterior al rango;
  - los asientos automáticos de apertura/cierre (`CODIGOAGRUPACION = 13`) no son movimiento; la apertura va al saldo inicial. En 2026 hay dos pares de apertura (la segunda ajusta la primera): se suman todos.
  - El rango tiene que quedar dentro de un ejercicio (`EJERCICIOS`).
- **Centros de costo** (`centros`): `APROPIACIONCENTROSCOSTO` (por línea de asiento, `MONTO <> 0`) + `CENTROSCOSTO` / `RUBROSCENTROSCOSTO`. Ingresos = cuentas 51…, costos = 4…, gastos = resto de 5…. Lo no apropiado va a «Sin centro de costo asignado».

## Desarrollo
`mock-flexxus` en `.claude/launch.json` (`scripts/mock-flexxus.mjs`, :4179, apunta a la copia del puente en :3199); vite proxyea `/api/sql/flexxus`. Al tocar `flexxus.js` o `server.js` hay que reiniciar el puente.
