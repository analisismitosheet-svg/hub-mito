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
-- Aplicado en Supabase (migración pedidos_venta_lineas_ok). Idempotente.
-- ============================================================================

create table if not exists public.pedidos_venta_lineas_ok (
  codigo          text    not null,
  linea           integer not null,
  marcado_por     uuid    default auth.uid(),
  marcado_nombre  text,
  marcado_at      timestamptz not null default now(),
  unidades        integer not null default 0,   -- lo que faltaba al marcar (para Eficiencia)
  primary key (codigo, linea)
);

alter table public.pedidos_venta_lineas_ok enable row level security;

-- Marcar es cosa del admin; el resto ve el verde a través de estado_lineas_pedido.
drop policy if exists pedidos_venta_lineas_ok_admin on public.pedidos_venta_lineas_ok;
create policy pedidos_venta_lineas_ok_admin on public.pedidos_venta_lineas_ok
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

-- ----------------------------------------------------------------------------
-- El cálculo de siempre pasa a private; la función pública le aplica encima las
-- correcciones del admin (así no hay que repetir la lógica en cada rama).
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
  IF v_arm IS NOT NULL THEN
    RETURN QUERY
    SELECT ai.linea, least(coalesce(ai.escaneadas, 0), ai.cantidad)::integer, ai.estado::text
      FROM public.mayorista_armados_items ai WHERE ai.armado_id = v_arm;
    RETURN;
  END IF;
  IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN RETURN; END IF;

  SELECT l.id INTO v_lote FROM public.mayorista_lotes l
   WHERE l.fecha = v_ped.fecha
     AND EXISTS (SELECT 1 FROM public.mayorista_items mi WHERE mi.lote_id = l.id AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente)))
   ORDER BY l.created_at DESC LIMIT 1;

  IF v_lote IS NULL AND EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    RETURN QUERY
    SELECT i.linea, round(i.cantidad)::integer, 'hecho'::text
      FROM public.pedidos_venta_items i WHERE i.codigo = p_codigo;
    RETURN;
  END IF;

  IF v_lote IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH m AS (
    SELECT upper(btrim(mi.codigo)) AS art, upper(btrim(coalesce(mi.color, ''))) AS col, upper(btrim(coalesce(mi.talle, ''))) AS tal,
           sum(mi.cantidad) AS cant,
           sum(CASE WHEN mi.estado = 'hecho' THEN mi.cantidad ELSE least(coalesce(mi.escaneadas, 0), mi.cantidad) END) AS env,
           bool_and(mi.estado <> 'pendiente') AS cerrado
      FROM public.mayorista_items mi
     WHERE mi.lote_id = v_lote AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente))
     GROUP BY 1, 2, 3
  )
  SELECT i.linea,
         least(coalesce(m.env, 0), round(i.cantidad))::integer,
         CASE WHEN m.art IS NULL THEN 'pendiente'
              WHEN m.env >= m.cant THEN 'hecho'
              WHEN m.cerrado THEN 'faltante'
              ELSE 'pendiente' END
    FROM public.pedidos_venta_items i
    LEFT JOIN m ON m.art = upper(btrim(i.articulo)) AND m.col = upper(btrim(coalesce(i.color, ''))) AND m.tal = upper(btrim(coalesce(i.talle, '')))
   WHERE i.codigo = p_codigo;
END;
$$;

-- `corregida` deja ver que ese verde lo puso el admin y no el piso.
drop function if exists public.estado_lineas_pedido(text);
create or replace function public.estado_lineas_pedido(p_codigo text)
returns table(linea integer, enviadas integer, estado text, corregida boolean, corregida_nombre text)
language sql stable security definer
set search_path to 'public'
as $$
  SELECT coalesce(b.linea, c.linea),
         coalesce(b.enviadas, 0),
         CASE WHEN c.linea IS NOT NULL THEN 'hecho' ELSE b.estado END,
         c.linea IS NOT NULL,
         c.marcado_nombre
    FROM private.estado_lineas_pedido_base(p_codigo) b
    FULL JOIN public.pedidos_venta_lineas_ok c
      ON c.codigo = p_codigo AND c.linea = b.linea
   WHERE private.es_admin() OR private.tengo_permiso('pedidos_venta.view');
$$;

-- Marcar / desmarcar una línea. Sólo admin; no toca el piso ni las estadísticas.
create or replace function public.marcar_linea_pedido(p_codigo text, p_linea integer, p_ok boolean)
returns void language plpgsql security definer
set search_path to 'public'
as $$
declare v_uni integer;
begin
  if not private.es_admin() then
    raise exception 'Sólo un administrador puede marcar líneas' using errcode = '42501';
  end if;
  if p_ok then
    select greatest(round(i.cantidad)::integer - coalesce(b.enviadas, 0), 0) into v_uni
      from public.pedidos_venta_items i
      left join private.estado_lineas_pedido_base(p_codigo) b on b.linea = i.linea
     where i.codigo = p_codigo and i.linea = p_linea;
    insert into public.pedidos_venta_lineas_ok (codigo, linea, marcado_por, marcado_nombre, unidades)
    values (p_codigo, p_linea, auth.uid(),
            (select coalesce(u.nombre, u.email) from public.usuarios u where u.id = auth.uid()),
            coalesce(v_uni, 0))
    on conflict (codigo, linea) do nothing;
  else
    delete from public.pedidos_venta_lineas_ok where codigo = p_codigo and linea = p_linea;
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

revoke all on function public.estado_lineas_pedido(text) from public, anon;
revoke all on function public.marcar_linea_pedido(text, integer, boolean) from public, anon;
grant execute on function public.estado_lineas_pedido(text) to authenticated;
grant execute on function public.marcar_linea_pedido(text, integer, boolean) to authenticated;
revoke all on function public.revisado_admin_por_local(date, date) from public, anon;
grant execute on function public.revisado_admin_por_local(date, date) to authenticated;
