# Importar la planilla de horarios de RR. HH. a Carga horaria

Planilla mensual («10 - Horarios OCTUBRE 2026.xlsx»): una hoja por local, bloques semanales
(«desde 28/09» = horario base; «del 12/10 al 18/10 - vacaciones X» = pisa esa semana), entrada/salida
por día y una fila extra debajo cuando hay turno cortado.

1. Bajar los empleados (con legajo) a JSON: `node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp <sql> --raw`
   con `select legajo, nombre, lugar, area_sector, horas, estado_legajo from empleados where legajo is not null;`
2. `python -I -X utf8 leer_horarios.py <xlsx> <emps.json> horarios.json` → bloques y cruce de nombres con legajos.
3. Revisar «SIN LEGAJO» y completar el diccionario `MANUAL` de `expandir.py`; ajustar `INI`/`FIN` (semanas del mes) en los dos scripts.
4. `python -I -X utf8 expandir.py horarios.json <emps.json> importar.sql informe.txt` y aplicar `importar.sql`
   (borra y vuelve a cargar ese rango de fechas en `rrhh_carga_horaria`).

Octubre 2026 (27/11/2026): 4370 días de 169 personas. Mariano Max no se cargó (sin nómina en el hub).
