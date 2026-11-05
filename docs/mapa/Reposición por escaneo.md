# Reposición por escaneo (`/deposito/reposicion-escaneo`)

Se carga el Excel de reposición, se escanea la prenda y la pantalla dice en grande y en voz alta en qué caja (local) va, y la descuenta. Alta: 05/11/2026.

- Pantalla `src/pages/ReposicionEscaneo.tsx`, lib `src/lib/repoEscaneo.ts`, SQL `sql/repo_escaneo.sql`. App `deposito-repo-escaneo` en el área Depósito.
- **Excel**: cada hoja es una reposición. Fila de títulos = la primera con 5 o más celdas; columnas Articulo / Descripcion / Color / Talle (si no están por nombre, las 4 primeras); el resto son locales, salvo AAH, TOTAL, STOCK, VENTA, PRIORIDAD y OBS. Una celda que no sea un entero de 1 a 50 queda afuera y se lista abajo en la pantalla (`raros`). El mismo artículo repetido se suma.
- **Volver a cargar** un archivo con el mismo nombre retoma la reposición abierta y no lee el Excel de nuevo. Si el Excel cambió: cerrar la reposición y volver a cargarlo.
- **Tablas**: `repo_escaneo` (cabecera, `cerrada_at`), `repo_escaneo_items` (`pedido`, `escaneado`), `repo_escaneo_lecturas` (quién y cuándo, `deshecha_at`). Escrituras solo por RPC `repo_escaneo_*`. Cerrar no borra nada, solo la saca de la lista.
- **Códigos**: `private.parsear_codigo_barras` y `private.mismo_color`, los mismos de [[Repos Mayorista y Mi repo]] (`ART!COL!TALLE`, `ART%COLTALLE`, equivalencias de EAN). Con solo el artículo y varias variantes en la hoja responde `ambiguo` y no cuenta.
- **A qué caja**: la que más le falta de esa variante. Si la pusieron en otra, se toca esa caja y `repo_escaneo_mover` corrige todo junto.
- **Varias personas a la vez**: `repo_escaneo_escanear` bloquea las filas de la variante. Los demás ven el avance por Realtime (`repo_escaneo_lecturas`) con `repo_escaneo_avance`, más un respaldo cada 60 s que frena con la pestaña oculta. Deshacer afecta solo la última lectura propia.
- **Nombres de los locales**: tabla `locales`, con alias para los códigos del Excel que no coinciden (RUTA9D, BUSTOS, GRALPAZ) en `repoEscaneo.ts`. POLO52, MAYORD y DEPO están fijos ahí. Los demás se muestran y se dicen por código.

## Permisos
| Permiso | Qué hace | Roles |
|---|---|---|
| `repo_escaneo.view` | ver y escanear | deposito |
| `repo_escaneo.cargar` | cargar el Excel y cerrar | deposito |

Mockup: `mockups/reposicion-escaneo.html`.
