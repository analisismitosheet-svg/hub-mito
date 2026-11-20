-- Habilita en el hub la vista de stock de Polo 52 por SKU (sql/vw_STOCK_SKU_POLO.sql).
-- La usa la Reposición de franquicias sugerida para completar con Polo lo que MITO no cubre.
update public.config_app
   set valor = valor::jsonb || '[{"label": "Stock Polo por SKU", "vista": "DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_POLO"}]'::jsonb
 where clave = 'sql_vistas'
   and not (valor::jsonb @> '[{"vista": "DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_POLO"}]'::jsonb);
