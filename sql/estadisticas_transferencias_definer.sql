-- ============================================================================
-- Estadísticas de Transferencias: arreglo de fondo del statement timeout
--
-- Ejecutar en Supabase SQL Editor. Idempotente (CREATE OR REPLACE).
--
-- La función era SECURITY INVOKER: cada fila de transfer_items pasaba por las
-- policies de RLS, que llaman a private.es_admin() / tiene_permiso() / mi_local()
-- (STABLE, leen tablas) FILA POR FILA. Con ~27k ítems se pasaba del timeout
-- (ver sql/fix_estadisticas_transferencias_timeout.sql y CONTEXTO.md).
--
-- Ahora es SECURITY DEFINER (como listar_transfer_items) y resuelve los
-- permisos UNA sola vez en el CTE `vis`, replicando EXACTAMENTE las policies:
--
--   transfer_items_select_full : es_admin() OR tiene_permiso('transferencias.import')
--                                OR tiene_permiso('transferencias.ver_todo')  -> todo
--   transfer_items_select_local: tiene_permiso('transferencias.view') AND origen es
--                                mi_local(), o su par sin "2"/"D" final, o con "D"
--   transfer_lotes             : es_admin() OR tiene_permiso('transferencias.view')
--
-- Sin permisos devuelve el tablero vacío (igual que antes con RLS).
-- El cuerpo de las agregaciones no cambia.
--
-- p_tipo (filtro "Tipo" de la pantalla), por el NOMBRE del lote:
--   'diaria' -> lotes cuyo nombre contiene "diaria" (ej. "REPO VENTA DIARIA 30-09", "REPO DIARIA 19/08") (sin importar mayúsculas)
--   'otras'  -> todos los demás
--   NULL     -> todos
-- ============================================================================

-- La firma cambia (se agrega p_tipo): se borra la anterior para no dejar dos.
DROP FUNCTION IF EXISTS public.estadisticas_transferencias(date, date, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.estadisticas_transferencias(
  p_desde date DEFAULT NULL::date,
  p_hasta date DEFAULT NULL::date,
  p_origen text DEFAULT NULL::text,
  p_destino text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_estado text DEFAULT NULL::text,
  p_local text DEFAULT NULL::text,
  p_gran text DEFAULT 'dia'::text,
  p_tipo text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with ml as materialized (
  select coalesce(private.mi_local(), '') as ml
),
-- Permisos del que llama, calculados una sola vez (no por fila)
vis as materialized (
  select
    (private.es_admin()
       or private.tiene_permiso('transferencias.import')
       or private.tiene_permiso('transferencias.ver_todo')) as todo,
    private.tiene_permiso('transferencias.view') as ver,
    (private.es_admin() or private.tiene_permiso('transferencias.view')) as ve_lotes,
    -- los orígenes que cuentan como "mi local" (variantes + sinónimos, sql/locales_sinonimos.sql)
    private.mis_origenes() as origenes
  from ml
),
params as (
  select p_desde as desde,
         p_hasta as hasta,
         case when p_desde is not null and p_hasta is not null
              then p_desde - ((p_hasta - p_desde) + 1) end as prev_desde,
         case when p_desde is not null and p_hasta is not null
              then p_desde - 1 end as prev_hasta
),
datos as (
  select i.lote_id,
         i.origen,
         i.destino,
         i.estado,
         coalesce(i.cantidad, 1)::numeric as cant,
         l.fecha,
         coalesce(nullif(btrim(l.motivo), ''), 'SIN MOTIVO') as motivo,
         i.created_at,
         i.hecho_at,
         case
           when p.desde is null or l.fecha between p.desde and p.hasta then 'act'
           when p.prev_desde is not null and l.fecha between p.prev_desde and p.prev_hasta then 'prev'
         end as ventana
  from transfer_items i
  join transfer_lotes l on l.id = i.lote_id
  cross join params p
  cross join vis v
  where v.ve_lotes
    and (v.todo or (v.ver and upper(coalesce(i.origen, '')) = any(v.origenes)))
    and (p.desde is null or l.fecha >= coalesce(p.prev_desde, p.desde))
    and (p.hasta is null or l.fecha <= p.hasta)
    and (p_origen is null or i.origen = p_origen)
    and (p_destino is null or i.destino = p_destino)
    and (p_motivo is null or coalesce(nullif(btrim(l.motivo), ''), 'SIN MOTIVO') = p_motivo)
    and (p_estado is null or i.estado = p_estado)
    and (p_local is null or i.origen = p_local or i.destino = p_local)
    and (p_tipo is null
         or (p_tipo = 'diaria' and coalesce(l.nombre, '') ilike '%diaria%')
         or (p_tipo = 'otras' and coalesce(l.nombre, '') not ilike '%diaria%'))
),
act as (select * from datos where ventana = 'act'),
prev as (select * from datos where ventana = 'prev'),
kpi_act as (
  select count(*)::int as items,
         coalesce(sum(cant), 0)::float as unidades,
         count(distinct lote_id)::int as lotes,
         (select count(*) from (select origen as l from act union select destino from act) z)::int as locales,
         coalesce(round(100.0 * count(*) filter (where estado in ('hecho', 'senado')) / nullif(count(*), 0)), 0)::int as cumplido,
         coalesce(round(avg(extract(epoch from (hecho_at - created_at)) / 3600)
                    filter (where hecho_at is not null and created_at is not null and hecho_at > created_at)::numeric, 1), 0)::float as tiempo
  from act
),
kpi_prev as (
  select count(*)::int as items,
         coalesce(sum(cant), 0)::float as unidades,
         count(distinct lote_id)::int as lotes,
         (select count(*) from (select origen as l from prev union select destino from prev) z)::int as locales,
         coalesce(round(100.0 * count(*) filter (where estado in ('hecho', 'senado')) / nullif(count(*), 0)), 0)::int as cumplido,
         coalesce(round(avg(extract(epoch from (hecho_at - created_at)) / 3600)
                    filter (where hecho_at is not null and created_at is not null and hecho_at > created_at)::numeric, 1), 0)::float as tiempo
  from prev
),
por_destino as (select destino as name, sum(cant)::float as valor from act group by 1 order by 2 desc limit 12),
por_origen as (select origen as name, sum(cant)::float as valor from act group by 1 order by 2 desc limit 12),
por_motivo as (select motivo as name, sum(cant)::float as valor from act group by 1 order by 2 desc limit 8),
por_estado as (select estado as name, sum(cant)::float as valor from act group by 1 order by 2 desc),
serie as (
  select case p_gran
           when 'mes' then to_char(fecha, 'YYYY-MM')
           when 'semana' then to_char(date_trunc('week', fecha), 'YYYY-MM-DD')
           else to_char(fecha, 'YYYY-MM-DD')
         end as name,
         sum(cant)::float as unidades,
         coalesce(round(100.0 * count(*) filter (where estado in ('hecho', 'senado')) / nullif(count(*), 0)), 0)::int as cumplido
  from act group by 1 order by 1
),
tiempos as (
  select origen as local,
         round(avg(extract(epoch from (hecho_at - created_at)) / 3600)::numeric, 1)::float as "promedioHs",
         round((avg(extract(epoch from (hecho_at - created_at)) / 3600) / 24)::numeric, 2)::float as "promedioDias",
         count(*)::int as n
  from act
  where estado in ('hecho', 'senado') and hecho_at is not null and created_at is not null and hecho_at > created_at
  group by 1 order by 2 desc
),
pend as (
  select origen,
         greatest(0, extract(epoch from (now() - coalesce(created_at, fecha::timestamptz))) / 3600) as edad
  from act where estado = 'pendiente'
),
buckets as (
  select count(*) filter (where edad < 24)::int as b1,
         count(*) filter (where edad >= 24 and edad < 48)::int as b2,
         count(*) filter (where edad >= 48 and edad < 168)::int as b3,
         count(*) filter (where edad >= 168)::int as b4,
         count(*)::int as total
  from pend
),
aging as (
  select origen as local,
         count(*) filter (where edad < 24)::int as b1,
         count(*) filter (where edad >= 24 and edad < 48)::int as b2,
         count(*) filter (where edad >= 48 and edad < 168)::int as b3,
         count(*) filter (where edad >= 168)::int as b4,
         count(*)::int as total,
         round((max(edad) / 24)::numeric, 1)::float as "masViejoDias"
  from pend group by 1 order by b4 desc, b3 desc, total desc
),
faltantes as (
  select origen as local,
         count(*) filter (where estado = 'faltante')::int as faltante,
         count(*)::int as total,
         round(100.0 * count(*) filter (where estado = 'faltante') / nullif(count(*), 0), 1)::float as porcentaje
  from act group by 1 having count(*) filter (where estado = 'faltante') > 0 order by 4 desc
),
tabla as (
  select local,
         sum(enviado)::float as enviado,
         sum(recibido)::float as recibido
  from (
    select origen as local, cant as enviado, 0::numeric as recibido from act
    union all
    select destino, 0::numeric, cant from act
  ) z
  group by 1 order by (sum(enviado) + sum(recibido)) desc
)
select jsonb_build_object(
  'kpis', (select to_jsonb(k) from kpi_act k),
  'kpisPrev', case when (select count(*) from prev) = 0 then null else (select to_jsonb(k) from kpi_prev k) end,
  'porDestino', coalesce((select jsonb_agg(to_jsonb(x)) from por_destino x), '[]'::jsonb),
  'porOrigen', coalesce((select jsonb_agg(to_jsonb(x)) from por_origen x), '[]'::jsonb),
  'porMotivo', coalesce((select jsonb_agg(to_jsonb(x)) from por_motivo x), '[]'::jsonb),
  'porEstado', coalesce((select jsonb_agg(to_jsonb(x)) from por_estado x), '[]'::jsonb),
  'serie', coalesce((select jsonb_agg(to_jsonb(x)) from serie x), '[]'::jsonb),
  'tiempos', coalesce((select jsonb_agg(to_jsonb(x)) from tiempos x), '[]'::jsonb),
  'buckets', (select to_jsonb(b) from buckets b),
  'aging', coalesce((select jsonb_agg(to_jsonb(x)) from aging x), '[]'::jsonb),
  'faltantes', coalesce((select jsonb_agg(to_jsonb(x)) from faltantes x), '[]'::jsonb),
  'tabla', coalesce((select jsonb_agg(to_jsonb(x)) from tabla x), '[]'::jsonb),
  'locales', coalesce((select jsonb_agg(local order by local) from tabla), '[]'::jsonb)
);
$function$;
