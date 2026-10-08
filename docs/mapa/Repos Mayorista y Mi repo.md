# Repos Mayorista y Mi repo

- `Mayorista.tsx` (`/mayorista`): lotes de reposición (repos) que arman los empleados del piso. `RepoDiaria.tsx`.
- `MiRepo.tsx` (`/mayorista/mi-repo`): lo que hace el empleado (escanea, tilda). Permiso `mayorista.repos_piso`. También muestra [[Armado de pedidos]].
- Estadísticas de cada repo: mitad y mitad; tabla local + unidades a reponer (compacta); cuadros de color, **solo "cant. venta" en verde**, con fecha de venta. Los datos salen de lo que hacen los empleados en Mi repo.
- Estado **En proceso / Finalizado** (`sql/mayorista_lote_estado.sql`): se finaliza solo al tildar el 100 %; las viejas quedaron finalizadas con la fecha de carga.
- `EstadisticasRendimiento.tsx` (`/mayorista/estadisticas`).
- El filtro rápido de esta pantalla se replicó en [[Transferencias]].
- **Eficiencia mayorista** (`/mayorista/estadisticas`, `EstadisticasRendimiento.tsx`): arriba la **Estadística VTD** (`src/components/EstadisticaVtd.tsx`, RPC `estadistica_vtd` en `sql/estadistica_vtd.sql`): Hoy (repo del día, ◀ ▶) / Por semana (una fila por repo como la planilla), cuadro por local. Horas = cronómetro de Mi repo; Prendas/HS = prendas escaneadas con cronómetro ÷ esas horas. Abajo, Tiempo real en piso. La tabla vieja por empleado (items separados) se sacó.
- Mi repo: **Pausar tiene cooldown de 15 min** (`sql/repo_pausa_cooldown.sql`, `repo_proxima_pausa`).
- **Pausas con motivo** (`sql/piso_pausas.sql`): tabla `piso_pausas` (repo y armado: quién, motivo, desde, hasta). `repo_pausar(p_sesion, p_motivo, p_detalle)` (la versión vieja sin motivo ya no pausa), `armado_pausar` / `armado_reanudar` / `armado_proxima_pausa` (mismo cooldown de 15 min). Las pausas se cierran solas al Reanudar/Finalizar (triggers). Cuadro `src/components/MotivoPausa.tsx` (motivos: baño, comida, otra tarea, falta mercadería, equipo, otro con detalle). Estadística `estadistica_pausas` → `src/components/PausasPiso.tsx` en Eficiencia mayorista.
