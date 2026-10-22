-- ============================================================================
-- Pedidos de venta: el admin pasa a verde una línea que quedó en rojo (faltante)
--
-- Por qué una tabla aparte: el rojo sale de `mayorista_items` /
-- `mayorista_armados_items`, y de ESAS MISMAS tablas sale Eficiencia mayorista
-- (`estadistica_vtd`), igual que `pedidos_venta_estado` alimenta `avance_vtd_rep`.
-- Si la corrección tocara cualquiera de las tres, cambiaría el rendimiento del
-- piso. Por eso vive sola acá y sólo la lee `estado_lineas_pedido`, que es lo
-- que pinta el detalle del pedido. Eficiencia queda igual.
--
-- TODO va por SKU (artículo + color + talle), nunca por número de línea: el puente
-- de Dragonfish re-sincroniza pedidos_venta_items con DELETE + INSERT y renumera
-- las líneas, así que la línea 1 del armado/repo puede ser la 2 del pedido
-- (ver también estado_lineas_pedido_sku.sql, 13/10/2026).
--
-- Aplicado en Supabase (migraciones pedidos_venta_lineas_ok y
-- estado_lineas_por_sku_y_correcciones). Idempotente.
-- ============================================================================

create table if not exists public.pedidos_venta_lineas_ok (
  codigo          text    not null,
  linea           integer,                       -- la línea que se tocó (sólo informativa)
  articulo        text    not null,
  color           text    not null default '',
  talle           text    not null default '',
  marcado_por     uuid    default auth.uid(),
  marcado_nombre  text,
  marcado_at      timestamptz not null default now(),
  unidades        integer not null default 0,   -- lo que faltaba al marcar (para Eficiencia)
  primary key (codigo, articulo, color, talle)
);

-- Instalaciones viejas: la clave era (codigo, linea). Se pasa a SKU.
alter table public.pedidos_venta_lineas_ok add column if not exists articulo text;
alter table public.pedidos_venta_lineas_ok add column if not exists color text not null default '';
alter table public.pedidos_venta_lineas_ok add column if not exists talle text not null default '';
update public.pedidos_venta_lineas_ok lo
   set articulo = upper(btrim(i.articulo)),
       color    = upper(btrim(coalesce(i.color, ''))),
       talle    = upper(btrim(coalesce(i.talle, '')))
  from public.pedidos_venta_items i
 where lo.articulo is null and i.codigo = lo.codigo and i.linea = lo.linea;
do $$
begin
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
              where c.conname = 'pedidos_venta_lineas_ok_pkey' and a.attname = 'linea') then
    alter table public.pedidos_venta_lineas_ok drop constraint pedidos_venta_lineas_ok_pkey;
    alter table public.pedidos_venta_lineas_ok alter column articulo set not null;
    alter table public.pedidos_venta_lineas_ok alter column linea drop not null;
    alter table public.pedidos_venta_lineas_ok add primary key (codigo, articulo, color, talle);
  end if;
end $$;

alter table public.pedidos_venta_lineas_ok enable row level security;

-- Marcar es cosa del admin; el resto ve el verde a través de estado_lineas_pedido.
drop policy if exists pedidos_venta_lineas_ok_admin on public.pedidos_venta_lineas_ok;
create policy pedidos_venta_lineas_ok_admin on public.pedidos_venta_lineas_ok
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

-- ----------------------------------------------------------------------------
-- Estado del piso por renglón del pedido. Se junta lo hecho por SKU (del armado
-- si hay; si no, de la repo del día para VTD) y se reparte entre las líneas
-- ACTUALES del pedido con ese SKU, en orden de línea: si un SKU aparece dos
-- veces en el pedido, lo enviado no se cuenta dos veces.
-- ----------------------------------------------------------------------------
create or replace function private.estado_lineas_pedido_base(p_codigo text)
returns table(linea integer, enviadas integer, estado text)
language plpgsql stable security definer
set search_path to 'public'
as $$
DECLARE
  v_arm  uuid;
  v_ped  public.pedidos_venta%ROWTYPE;
  v_lote uuid;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('pedidos_venta.view')) THEN
    RETURN;
  END IF;

  SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = p_codigo;
  IF v_ped.codigo IS NULL THEN RETURN; END IF;

  SELECT a.id INTO v_arm FROM public.mayorista_armados a
   WHERE a.pedido_codigo = p_codigo ORDER BY a.creado_at DESC LIMIT 1;

  IF v_arm IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
      RETURN QUERY
      SELECT i.linea, round(i.cantidad)::integer, 'hecho'::text
        FROM public.pedidos_venta_items i WHERE i.codigo = p_codigo;
      RETURN;
    END IF;

    IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN RETURN; END IF;

    SELECT l.id INTO v_lote FROM public.mayorista_lotes l
     WHERE l.fecha = v_ped.fecha
       AND EXISTS (SELECT 1 FROM public.mayorista_items mi WHERE mi.lote_id = l.id AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente)))
     ORDER BY l.created_at DESC LIMIT 1;
    IF v_lote IS NULL THEN RETURN; END IF;
  END IF;

  RETURN QUERY
  WITH src AS (
    -- Armado (un solo pedido por armado)
    SELECT upper(btrim(ai.articulo)) AS art, upper(btrim(coalesce(ai.color, ''))) AS col, upper(btrim(coalesce(ai.talle, ''))) AS tal,
           sum(least(coalesce(ai.escaneadas, 0), ai.cantidad)) AS env,
           bool_or(ai.estado = 'faltante') OR bool_and(ai.estado <> 'pendiente') AS cerrado
      FROM public.mayorista_armados_items ai
     WHERE v_arm IS NOT NULL AND ai.armado_id = v_arm
     GROUP BY 1, 2, 3
    UNION ALL
    -- Repo diaria del local (VTD)
    SELECT upper(btrim(mi.codigo)), upper(btrim(coalesce(mi.color, ''))), upper(btrim(coalesce(mi.talle, ''))),
           sum(CASE WHEN mi.estado = 'hecho' THEN mi.cantidad ELSE least(coalesce(mi.escaneadas, 0), mi.cantidad) END),
           bool_and(mi.estado <> 'pendiente')
      FROM public.mayorista_items mi
     WHERE v_arm IS NULL AND mi.lote_id = v_lote AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente))
     GROUP BY 1, 2, 3
  ), lin AS (
    SELECT i.linea AS lin, round(i.cantidad)::integer AS cant,
           upper(btrim(i.articulo)) AS art, upper(btrim(coalesce(i.color, ''))) AS col, upper(btrim(coalesce(i.talle, ''))) AS tal,
           coalesce(sum(round(i.cantidad)) OVER (PARTITION BY upper(btrim(i.articulo)), upper(btrim(coalesce(i.color, ''))), upper(btrim(coalesce(i.talle, '')))
                                                 ORDER BY i.linea ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS antes
      FROM public.pedidos_venta_items i
     WHERE i.codigo = p_codigo
  ), r AS (
    SELECT lin.lin, lin.cant, s.art AS hay, s.cerrado,
           least(lin.cant, greatest(coalesce(s.env, 0) - lin.antes, 0))::integer AS env
      FROM lin
      LEFT JOIN src s ON s.art = lin.art AND s.col = lin.col AND s.tal = lin.tal
  )
  SELECT r.lin, r.env,
         CASE WHEN r.hay IS NULL THEN 'pendiente'
              WHEN r.env >= r.cant THEN 'hecho'
              WHEN r.cerrado THEN 'faltante'
              ELSE 'pendiente' END
    FROM r;
END;
$$;

-- `corregida` deja ver que ese verde lo puso el admin y no el piso. La corrección
-- se cruza por SKU y sólo la del pedido pedido (en un FULL/LEFT JOIN el filtro
-- de código tiene que ir en la subconsulta, no en el ON).
drop function if exists public.estado_lineas_pedido(text);
create or replace function public.estado_lineas_pedido(p_codigo text)
returns table(linea integer, enviadas integer, estado text, corregida boolean, corregida_nombre text)
language sql stable security definer
set search_path to 'public'
as $$
  SELECT i.linea,
         coalesce(b.enviadas, 0),
         CASE WHEN c.articulo IS NOT NULL THEN 'hecho' ELSE b.estado END,
         c.articulo IS NOT NULL,
         c.marcado_nombre
    FROM public.pedidos_venta_items i
    LEFT JOIN private.estado_lineas_pedido_base(p_codigo) b ON b.linea = i.linea
    LEFT JOIN (SELECT lo.articulo, lo.color, lo.talle, lo.marcado_nombre
                 FROM public.pedidos_venta_lineas_ok lo WHERE lo.codigo = p_codigo) c
      ON c.articulo = upper(btrim(i.articulo)) AND c.color = upper(btrim(coalesce(i.color, ''))) AND c.talle = upper(btrim(coalesce(i.talle, '')))
   WHERE i.codigo = p_codigo
     AND (b.linea IS NOT NULL OR c.articulo IS NOT NULL)
     AND (private.es_admin() OR private.tengo_permiso('pedidos_venta.view'));
$$;

-- Marcar / desmarcar. Llega la línea que tocó el admin, pero se guarda su SKU
-- (y cubre todas las líneas del pedido con ese SKU). No toca el piso ni las estadísticas.
create or replace function public.marcar_linea_pedido(p_codigo text, p_linea integer, p_ok boolean)
returns void language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_art text; v_col text; v_tal text;
  v_uni integer;
begin
  if not private.es_admin() then
    raise exception 'Sólo un administrador puede marcar líneas' using errcode = '42501';
  end if;
  select upper(btrim(i.articulo)), upper(btrim(coalesce(i.color, ''))), upper(btrim(coalesce(i.talle, '')))
    into v_art, v_col, v_tal
    from public.pedidos_venta_items i where i.codigo = p_codigo and i.linea = p_linea;
  if v_art is null then
    raise exception 'La línea % no está en el pedido', p_linea;
  end if;
  if p_ok then
    select sum(greatest(round(i.cantidad)::integer - coalesce(b.enviadas, 0), 0))::integer into v_uni
      from public.pedidos_venta_items i
      left join private.estado_lineas_pedido_base(p_codigo) b on b.linea = i.linea
     where i.codigo = p_codigo
       and upper(btrim(i.articulo)) = v_art and upper(btrim(coalesce(i.color, ''))) = v_col and upper(btrim(coalesce(i.talle, ''))) = v_tal;
    insert into public.pedidos_venta_lineas_ok (codigo, linea, articulo, color, talle, marcado_por, marcado_nombre, unidades)
    values (p_codigo, p_linea, v_art, v_col, v_tal, auth.uid(),
            (select coalesce(u.nombre, u.email) from public.usuarios u where u.id = auth.uid()),
            coalesce(v_uni, 0))
    on conflict (codigo, articulo, color, talle) do nothing;
  else
    delete from public.pedidos_venta_lineas_ok
     where codigo = p_codigo and articulo = v_art and color = v_col and talle = v_tal;
  end if;
end;
$$;

-- Columna «Revisado admin» del cuadro por local de Eficiencia mayorista (EstadisticaVtd.tsx).
-- Es informativa: no entra en venta, repo ni no mandados.
create or replace function public.revisado_admin_por_local(p_desde date, p_hasta date)
returns table(local text, unidades integer)
language sql stable security definer
set search_path to 'public'
as $$
  select upper(btrim(pv.cliente)) as local, sum(lo.unidades)::integer
    from public.pedidos_venta_lineas_ok lo
    join public.pedidos_venta pv on pv.codigo = lo.codigo
   where pv.fecha between p_desde and p_hasta
     and (private.es_admin() or private.tengo_permiso('mayorista.estadisticas.view'))
   group by 1
  having sum(lo.unidades) > 0;
$$;

revoke all on function private.estado_lineas_pedido_base(text) from public, anon;
revoke all on function public.estado_lineas_pedido(text) from public, anon;
revoke all on function public.marcar_linea_pedido(text, integer, boolean) from public, anon;
grant execute on function public.estado_lineas_pedido(text) to authenticated;
grant execute on function public.marcar_linea_pedido(text, integer, boolean) to authenticated;
revoke all on function public.revisado_admin_por_local(date, date) from public, anon;
grant execute on function public.revisado_admin_por_local(date, date) to authenticated;
