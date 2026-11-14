-- Chat IA: consumo de tokens por pregunta (lo escribe api/chat.ts con la service key).
-- Solo los administradores lo leen. No guarda el texto de las preguntas ni de las respuestas.
CREATE TABLE IF NOT EXISTS public.chat_ia_uso (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_at     timestamptz NOT NULL DEFAULT now(),
  usuario_id    uuid,
  proveedor     text NOT NULL,            -- opencode | ollama
  vueltas       int  NOT NULL DEFAULT 0,  -- llamadas al modelo en la pregunta
  herramientas  text[] NOT NULL DEFAULT '{}',
  tokens_entrada int NOT NULL DEFAULT 0,
  tokens_salida  int NOT NULL DEFAULT 0,
  tokens_cache   int NOT NULL DEFAULT 0,  -- leídos de la caché de prompt
  ms            int NOT NULL DEFAULT 0
);

ALTER TABLE public.chat_ia_uso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_ia_uso_admin_lee ON public.chat_ia_uso;
CREATE POLICY chat_ia_uso_admin_lee ON public.chat_ia_uso
  FOR SELECT TO authenticated USING (private.es_admin());

CREATE INDEX IF NOT EXISTS chat_ia_uso_creado_idx ON public.chat_ia_uso (creado_at DESC);
