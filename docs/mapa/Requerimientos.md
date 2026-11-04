# Requerimientos (arreglos de los locales)

Reemplaza el Google Form «CARGA DE REQUERIMIENTO» (04/11/2026). Área Arquitectura → carpeta **Requerimientos** (`/arquitectura/requerimientos`); la tarjeta de Locales «Nuevo requerimiento» (id `carga-requerimientos`, antes el link al Form) abre el formulario.

## Circuito
1. **Local** carga (`RequerimientoNuevo.tsx`, `/arquitectura/requerimientos/nuevo`): local **siempre** el de la cuenta (`usuarios.local`); solo el **admin** lo elige de una lista (`requerimiento_crear(..., p_local)` lo ignora si no es admin), quién lo solicita = nómina activa de RR. HH. (`empleados.estado_legajo = 'NOMINA ACTIVA'`; en locales el local está en `area_sector`, `lugar` dice LOCALES), rubro (11), prioridad alta/media/baja, descripción, hasta 3 fotos, «ya está resuelto, solo dejo constancia».
2. **Arquitectura** programa (`RequerimientosBandeja.tsx`, `/arquitectura/requerimientos/bandeja`): día, horario y **una o más** personas de mantenimiento: nómina activa con `empleados.ubicacion = 'MANTENIMIENTO'` (la carga RR. HH. en Empleados; hoy 752 Blat y 1077 Fernández), nota. Pestañas por estado, orden por fecha asc/desc, filtros. Botón **Terminado** (también desde Sin programar): lo deja «a confirmar» igual que mantenimiento; el cierre lo sigue dando el local. Además «No corresponde» y reabrir.
3. **Mantenimiento** (`TareasMantenimiento.tsx`, `/mantenimiento/tareas`, estilo Mi repo): Empezar → Terminar con comentario y foto → queda `a_confirmar`.
   Abajo del formulario el local ve sus pedidos en pestañas **Abiertos** / **Terminados** (de a 50 con «Ver más»): quién lo hizo, qué se hizo, fotos del arreglo y cuándo dio el OK. El **admin** ve todos los locales (selector) y puede confirmar cualquiera. En Abiertos cada pedido tiene botones: «a confirmar» → Quedó listo / No quedó bien; el resto → **Terminado** (el local lo cierra directo como resuelto, con comentario opcional; `requerimiento_confirmar(p_id, p_comentario)`).
4. **El local que lo pidió** da la conformidad arriba del formulario: «Quedó listo» (→ `resuelto`) o «No quedó bien» con motivo (→ vuelve a `pendiente`, `rechazo_motivo`, `rechazos + 1`).

Estados: `pendiente → programado → en_curso → a_confirmar → resuelto` (o `no_corresponde`).

## Base (`sql/requerimientos.sql`)
- Tabla `requerimientos` (RLS: gestionar/tareas ven todo; cargar solo `local = private.mi_local()`), sin escrituras directas. Realtime publicado.
- RPC: `requerimientos_personas(p_ubicacion)`, `requerimiento_crear`, `_programar(p_legajos text[])`, `_iniciar`, `_terminar`, `_confirmar`, `_no_quedo`, `_descartar`, `_reabrir`.
- Fotos: bucket privado `requerimientos` (`createSignedUrl`); las de la planilla vieja son links de Drive.
- Permisos: `requerimientos.cargar` (rol `locales`, `arquitecto`), `requerimientos.gestionar` (rol `arquitecto`), `requerimientos.tareas` (rol nuevo `mantenimiento`, con `area_mantenimiento.view`; lo tiene `mantenimiento.mito@gmail.com`).
- Importados los 1.941 pedidos de la planilla (`origen = 'planilla'`): 1.823 resueltos, 118 pendientes; 110 filas venían dañadas; 573 resueltos sin fecha de ejecución (no muestran días).

## Avisos al local (04/11/2026)
- Al programar, la bandeja llama `avisarRequerimiento(id)` → `/api/push?tipo=requerimiento` (permiso `requerimientos.gestionar`): push a las cuentas del local (`usuarios.local`) con rubro, día y hora (zona Córdoba), N°, tarea, quién va y la nota. Una vez por programación: `push_local_at` (se limpia al reprogramar).
- Los locales pueden anotar el celular: `push_suscribir` acepta `requerimientos.cargar` / `.tareas` (definición en `sql/avisos_deposito_indo.sql`). Cartel «Activar avisos» arriba del formulario.
- Campana del local (`CampanaNotificaciones.tsx`, grupo «Locales · Arreglos»): los programados/en curso con día y hora, y los «a confirmar».

## Rubros editables (04/11/2026)
- Tabla `requerimientos_rubros` (nombre, ícono, color, orden, activo); pantalla `RequerimientosRubros.tsx` (`/arquitectura/requerimientos/rubros`), permiso `requerimientos.rubros` (rol `arquitecto`).
- RPC `requerimiento_rubro_guardar` (renombrar actualiza los pedidos) y `requerimiento_rubro_borrar` (si tiene pedidos lo oculta, `activo = false`; si no, lo borra). `requerimiento_crear` valida contra los activos.
- Front: `useRubros()` en `src/lib/requerimientos.ts`; íconos elegibles en `ICONOS_RUBRO`.

## Manual de uso (04/11/2026)
- Tarjeta **Manual de uso** en el área Arquitectura (`/arquitectura/manual`, `ManualRequerimientos.tsx`, permiso `requerimientos.gestionar`): recorrido de estados clickeable, 9 pasos con captura (`?paso=N`, flechas del teclado) y preguntas rápidas.
- Capturas en `public/manual/requerimientos/*.webp` (800×552, sacadas de la vista previa con pedidos «EJEMPLO DEL MANUAL» N° 1946-1947, ya cerrados y sin local). WebP a propósito: el precache del SW solo toma png/svg, así no lo baja todo el mundo. Si cambian las pantallas, rehacer las capturas.

## Pendiente
- Push al celular de mantenimiento cuando le programan una tarea.

Ver [[Permisos y usuarios]], [[Arquitectura]].
