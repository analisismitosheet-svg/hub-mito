// Tipos del motor de encuestas configurable.

export type TipoPregunta =
  | 'estrellas'
  | 'si_no'
  | 'opcion_unica'
  | 'opcion_multiple'
  | 'texto'
  | 'numero'
  | 'fecha'

export const TIPOS_PREGUNTA: { value: TipoPregunta; label: string }[] = [
  { value: 'estrellas', label: 'Estrellas' },
  { value: 'si_no', label: 'Sí / No' },
  { value: 'opcion_unica', label: 'Opción única' },
  { value: 'opcion_multiple', label: 'Opción múltiple' },
  { value: 'texto', label: 'Texto' },
  { value: 'numero', label: 'Número' },
  { value: 'fecha', label: 'Fecha' },
]

export interface ValorEstrella {
  estrellas: number
  valor: number
}
export interface OpcionConfig {
  label: string
  valor: number
}

/** config JSONB según el tipo de pregunta */
export interface PreguntaConfig {
  // estrellas
  max?: number
  medio_punto?: boolean
  valores?: ValorEstrella[]
  // si_no
  valor_si?: number
  valor_no?: number
  /** pedir un texto cuando la respuesta es "No" */
  detalle_no?: boolean
  detalle_no_label?: string
  detalle_no_obligatorio?: boolean
  // opcion_unica / opcion_multiple
  opciones?: OpcionConfig[]
  // numero
  min?: number
  max_num?: number
}

export interface Encuesta {
  id: string
  nombre: string
  descripcion: string | null
  contexto: 'local' | 'general'
  publica: boolean
  estado: 'borrador' | 'activa' | 'inactiva'
  version: number
  created_at: string
  updated_at: string
}

export interface Pregunta {
  id: string
  encuesta_id: string
  orden: number
  texto: string
  ayuda: string | null
  tipo: TipoPregunta
  obligatoria: boolean
  estado: 'activa' | 'inactiva'
  config: PreguntaConfig
  version: number
  created_at: string
  updated_at: string
}

/** Forma que devuelve el RPC encuesta_publica */
export interface EncuestaPublica {
  encuesta: { id: string; nombre: string; descripcion: string | null; version: number }
  local: string
  local_nombre: string | null
  preguntas: {
    id: string
    version: number
    texto: string
    ayuda: string | null
    tipo: TipoPregunta
    obligatoria: boolean
    config: PreguntaConfig
    orden: number
  }[]
}

/** Item que envía el cliente al responder (el valor lo calcula el backend) */
export interface ItemRespuesta {
  pregunta_id: string
  estrellas?: number | null
  valor_texto?: string | null
  opciones?: string[] | null
  /** detalle cuando Sí/No = No */
  detalle?: string | null
}

/** Genera la escala de valores por defecto 1..n */
export function valoresPorDefecto(max: number): ValorEstrella[] {
  return Array.from({ length: max }, (_, i) => ({ estrellas: i + 1, valor: i + 1 }))
}
