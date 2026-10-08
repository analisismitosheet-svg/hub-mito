# Repos Mayorista y Mi repo

- `Mayorista.tsx` (`/mayorista`): lotes de reposición (repos) que arman los empleados del piso. `RepoDiaria.tsx`.
- `MiRepo.tsx` (`/mayorista/mi-repo`): lo que hace el empleado (escanea, tilda). Permiso `mayorista.repos_piso`. También muestra [[Armado de pedidos]].
- Estadísticas de cada repo: mitad y mitad; tabla local + unidades a reponer (compacta); cuadros de color, **solo "cant. venta" en verde**, con fecha de venta. Los datos salen de lo que hacen los empleados en Mi repo.
- Estado **En proceso / Finalizado** (`sql/mayorista_lote_estado.sql`): se finaliza solo al tildar el 100 %; las viejas quedaron finalizadas con la fecha de carga.
- `EstadisticasRendimiento.tsx` (`/mayorista/estadisticas`).
- El filtro rápido de esta pantalla se replicó en [[Transferencias]].
