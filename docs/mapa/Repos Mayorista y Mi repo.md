# Repos Mayorista y Mi repo

- `Mayorista.tsx` (`/mayorista`): lotes de reposición (repos) que arman los empleados del piso. `RepoDiaria.tsx`.
- `MiRepo.tsx` (`/mayorista/mi-repo`): lo que hace el empleado (escanea, tilda). Permiso `mayorista.repos_piso`. También muestra [[Armado de pedidos]].
- Estadísticas de cada repo: mitad y mitad; tabla local + unidades a reponer (compacta); cuadros de color, **solo "cant. venta" en verde**, con fecha de venta. Los datos salen de lo que hacen los empleados en Mi repo.
- Estado **En proceso / Finalizado** (`sql/mayorista_lote_estado.sql`): se finaliza solo al tildar el 100 %; las viejas quedaron finalizadas con la fecha de carga.
- `EstadisticasRendimiento.tsx` (`/mayorista/estadisticas`).
- El filtro rápido de esta pantalla se replicó en [[Transferencias]].
- **Eficiencia mayorista** (`/mayorista/estadisticas`, `EstadisticasRendimiento.tsx`): arriba la **Estadística VTD** (`src/components/EstadisticaVtd.tsx`, RPC `estadistica_vtd` en `sql/estadistica_vtd.sql`): Hoy (repo del día, ◀ ▶) / Por semana (una fila por repo como la planilla), cuadro por local. Horas = cronómetro de Mi repo; Prendas/HS = prendas escaneadas con cronómetro ÷ esas horas. Abajo, Tiempo real en piso. La tabla vieja por empleado (items separados) se sacó.
- Mi repo: el cartel «terminaste tus repos» no aparece si hay armados pendientes o en curso.
- Mi repo: **Pausar tiene cooldown de 15 min** (`sql/repo_pausa_cooldown.sql`, `repo_proxima_pausa`).
- **Pausas con motivo** (`sql/piso_pausas.sql`): tabla `piso_pausas` (repo y armado: quién, motivo, desde, hasta). `repo_pausar(p_sesion, p_motivo, p_detalle)` (la versión vieja sin motivo ya no pausa), `armado_pausar` / `armado_reanudar` / `armado_proxima_pausa` (mismo cooldown de 15 min). Las pausas se cierran solas al Reanudar/Finalizar (triggers). Cuadro `src/components/MotivoPausa.tsx` (motivos: baño, comida, otra tarea, falta mercadería, equipo, otro con detalle). Estadística `estadistica_pausas` → `src/components/PausasPiso.tsx` en Eficiencia mayorista.

## Pausas con autorización (09/10/2026, `sql/pausas_autorizacion.sql`)
- El legajo **pide** la pausa y sigue trabajando (el cronómetro no frena); arranca recién cuando la autorizan. Si la rechazan o nadie la autoriza, se anula.
- `piso_pausas` suma `estado` (`pendiente|autorizada|rechazada|cancelada`; viejas y automáticas = `autorizada`), `solicitada_at`, `autorizada_por/at`, `motivo_rechazo`, `push_at`; `desde` es nullable (se llena al autorizar). Publicada en Realtime.
- RPC: `repo_solicitar_pausa`, `armado_solicitar_pausa`, `pausa_cancelar`, `pausa_autorizar`, `pausa_rechazar(pausa, motivo)`, `pausas_pendientes()`. Las viejas `repo_pausar` / `armado_pausar` ya **no pausan** ("Actualizá la app…").
- Permiso **`mayorista.pausas.autorizar`** (puesto3indo@gmail.com). RLS: el autorizador ve todas; el legajo, solo las suyas.
- Pantalla del puesto: `PausasPendientes.tsx` (`/mayorista/pausas`): Autorizar / Rechazar, Realtime + respaldo 30 s. Campana tipo `pausas` y push `avisarPausa()` → `api/push.ts?tipo=pausa` (admin + permiso directo o por rol).
- Legajo (MiRepo / ArmadoPedido): banner ámbar «Pausa pedida… esperando que la autoricen» con Cancelar.
- Motivos: **se sacó `comida`** (almuerzo/merienda); quedan `bano | otra_tarea | falta_mercaderia | equipo | otro`. Las viejas con `comida` se muestran por `MOTIVOS_VIEJOS` en `MotivoPausa.tsx`.
- `estadistica_pausas` y los triggers de cierre cuentan solo las `autorizada`; el cooldown de 15 min corre desde `coalesce(desde, solicitada_at)` y no cuenta `cancelada` ni las automáticas `otra_tarea`.
- **Eficiencia con armados (14/10/2026, `sql/eficiencia_con_armados.sql`)**: desde el 09/10 la repo diaria VTD se hace como **armado** del pedido (no se suben más repos en Repos Mayorista). `estadistica_vtd` suma una "repo" por día con los armados de pedidos VTD (local = cliente, venta/repo/faltante de los ítems, horas = cronómetro del armado, responsable = quien lo aceptó; si ese día hay repo subida para el local, manda la repo). `vw_tiempos_piso` suma los armados terminados por empleado y día (`private.empleado_de_usuario`).
