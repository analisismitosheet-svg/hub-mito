# Requerimientos (arreglos de los locales)

Reemplaza el Google Form «CARGA DE REQUERIMIENTO» (04/11/2026). Área Arquitectura → carpeta **Requerimientos** (`/arquitectura/requerimientos`); la tarjeta de Locales «Nuevo requerimiento» (id `carga-requerimientos`, antes el link al Form) abre el formulario.

## Circuito
1. **Local** carga (`RequerimientoNuevo.tsx`, `/arquitectura/requerimientos/nuevo`): local **siempre** el de la cuenta (`usuarios.local`), quién lo solicita = nómina activa de RR. HH. (`empleados.estado_legajo = 'NOMINA ACTIVA'`; en locales el local está en `area_sector`, `lugar` dice LOCALES), rubro (11), prioridad alta/media/baja, descripción, hasta 3 fotos, «ya está resuelto, solo dejo constancia».
2. **Arquitectura** programa (`RequerimientosBandeja.tsx`, `/arquitectura/requerimientos/bandeja`): día, horario y **una o más** personas de mantenimiento (`area_sector = 'MANTENIMIENTO'`), nota. Pestañas por estado, orden por fecha asc/desc, filtros. No puede dar por resuelto: solo «No corresponde» o reabrir.
3. **Mantenimiento** (`TareasMantenimiento.tsx`, `/mantenimiento/tareas`, estilo Mi repo): Empezar → Terminar con comentario y foto → queda `a_confirmar`.
4. **El local que lo pidió** da la conformidad arriba del formulario: «Quedó listo» (→ `resuelto`) o «No quedó bien» con motivo (→ vuelve a `pendiente`, `rechazo_motivo`, `rechazos + 1`).

Estados: `pendiente → programado → en_curso → a_confirmar → resuelto` (o `no_corresponde`).

## Base (`sql/requerimientos.sql`)
- Tabla `requerimientos` (RLS: gestionar/tareas ven todo; cargar solo `local = private.mi_local()`), sin escrituras directas. Realtime publicado.
- RPC: `requerimientos_personas(p_sector)`, `requerimiento_crear`, `_programar(p_legajos text[])`, `_iniciar`, `_terminar`, `_confirmar`, `_no_quedo`, `_descartar`, `_reabrir`.
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

## Pendiente
- Push al celular de mantenimiento cuando le programan una tarea.

Ver [[Permisos y usuarios]], [[Arquitectura]].
