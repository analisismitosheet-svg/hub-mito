-- Estado de ENTREGA de cada WhatsApp de los informes (02/11/2026).
-- Meta acepta el mensaje (devuelve un wamid) y recién después avisa por webhook si se
-- entregó, se leyó o falló (ej. 131049 límite de marketing, 131026 no entregable).
-- El webhook es GET/POST /api/informe?evento=whatsapp y escribe estas columnas.

-- El wamid ya venía en `detalle` ("id wamid.XXXX"): columna generada, así no hay que
-- tocar el insert y quedan con id también los envíos viejos.
ALTER TABLE public.informes_envios
  ADD COLUMN IF NOT EXISTS wamid text
    GENERATED ALWAYS AS (substring(detalle FROM 'id (wamid\.[A-Za-z0-9=_+/-]+)')) STORED;

-- sent / delivered / read / failed (lo último que avisó Meta) y el error si falló
ALTER TABLE public.informes_envios ADD COLUMN IF NOT EXISTS estado text;
ALTER TABLE public.informes_envios ADD COLUMN IF NOT EXISTS estado_at timestamptz;
ALTER TABLE public.informes_envios ADD COLUMN IF NOT EXISTS error_entrega text;

CREATE INDEX IF NOT EXISTS informes_envios_wamid_idx ON public.informes_envios (wamid) WHERE wamid IS NOT NULL;
