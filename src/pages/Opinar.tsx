import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import StarRating from '@/components/StarRating'
import type { EncuestaPublica, ItemRespuesta } from '@/types/encuestas'

type Resp = { estrellas?: number; valor_texto?: string; opciones?: string[]; detalle?: string }

/**
 * Página pública que se abre al escanear un QR.
 * Soporta dos rutas:
 *   /opinar/:local                → compatibilidad con QRs viejos (por local)
 *   /opinar/qr/:token             → QR único por (local + sector); resuelve todo el backend
 */
export default function Opinar() {
  const { local = '', token = '' } = useParams()
  const esQr = Boolean(token)

  const [data, setData] = useState<EncuestaPublica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [resp, setResp] = useState<Record<string, Resp>>({})
  const [busy, setBusy] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    if (esQr && !token) return
    if (!esQr && !local) return
    ;(async () => {
      const call = esQr
        ? supabase!.rpc('encuesta_por_qr', { p_token: token })
        : supabase!.rpc('encuesta_publica', { p_local: local })
      const { data: d } = await call
      setData((d as EncuestaPublica | null) ?? null)
      setCargando(false)
    })()
  }, [esQr, local, token])

  const preguntas = useMemo(() => data?.preguntas ?? [], [data])

  function set(id: string, patch: Resp) {
    setResp((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
  }

  function faltaObligatoria(): string | null {
    for (const q of preguntas) {
      const r = resp[q.id]
      if (
        q.tipo === 'si_no' &&
        r?.valor_texto === 'no' &&
        q.config.detalle_no &&
        q.config.detalle_no_obligatorio &&
        !r?.detalle?.trim()
      ) {
        return q.texto
      }
      if (!q.obligatoria) continue
      if (q.tipo === 'estrellas') {
        if (!r?.estrellas) return q.texto
      } else if (q.tipo === 'opcion_multiple') {
        if (!r?.opciones || r.opciones.length === 0) return q.texto
      } else {
        if (!r?.valor_texto || !r.valor_texto.trim()) return q.texto
      }
    }
    return null
  }

  async function enviar() {
    if (!supabase || !data) return
    const falta = faltaObligatoria()
    if (falta) {
      setError(`Falta responder: ${falta}`)
      return
    }
    setBusy(true)
    setError(null)
    const items: ItemRespuesta[] = preguntas.map((q) => {
      const r = resp[q.id] ?? {}
      return {
        pregunta_id: q.id,
        estrellas: q.tipo === 'estrellas' ? r.estrellas ?? null : null,
        valor_texto:
          q.tipo === 'opcion_multiple' || q.tipo === 'estrellas' ? null : r.valor_texto ?? null,
        opciones: q.tipo === 'opcion_multiple' ? r.opciones ?? null : null,
        detalle: q.tipo === 'si_no' && r.valor_texto === 'no' ? r.detalle ?? null : null,
      }
    })
    const { error } = esQr
      ? await supabase.rpc('responder_por_qr', { p_token: token, p_items: items })
      : await supabase.rpc('responder_encuesta', {
          p_encuesta: data.encuesta.id,
          p_local: local,
          p_items: items,
        })
    setBusy(false)
    if (error) {
      setError('No se pudo enviar. Probá de nuevo.')
      return
    }
    setEnviado(true)
  }

  const tituloUbicacion = data
    ? data.sector_nombre
      ? `${data.local_nombre ?? data.local} · ${data.sector_nombre}`
      : data.local_nombre ?? data.local
    : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-soft-lg">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-display text-lg font-bold text-white shadow-glow">
          M
        </div>

        {cargando ? (
          <p className="py-8 text-center text-sm text-sub">Cargando…</p>
        ) : enviado ? (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
              <Check size={28} aria-hidden />
            </div>
            <h1 className="font-display text-xl font-semibold text-ink">¡Gracias por tu opinión!</h1>
            <p className="mt-2 text-sm text-sub">Tu respuesta nos ayuda a mejorar.</p>
          </div>
        ) : !data ? (
          <div className="text-center">
            <h1 className="font-display text-lg font-semibold text-ink">Encuesta no disponible</h1>
            <p className="mt-2 text-sm text-sub">
              {esQr
                ? 'El QR no es válido o fue reemplazado por uno nuevo. Pedí uno actualizado al personal.'
                : 'En este momento no hay una encuesta activa para este local.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5 text-center">
              <h1 className="font-display text-xl font-semibold text-ink">{data.encuesta.nombre}</h1>
              <p className="mt-1 text-sm text-sub">{tituloUbicacion}</p>
              {data.encuesta.descripcion && (
                <p className="mt-1 text-xs text-sub">{data.encuesta.descripcion}</p>
              )}
            </div>

            <div className="space-y-5">
              {preguntas.map((q) => {
                const r = resp[q.id] ?? {}
                return (
                  <div key={q.id} className="rounded-xl border border-line bg-surface2 p-4">
                    <label className="block text-sm font-medium text-ink">
                      {q.texto}
                      {q.obligatoria && <span className="ml-1 text-brand-400">*</span>}
                    </label>
                    {q.ayuda && <p className="mt-0.5 text-xs text-sub">{q.ayuda}</p>}

                    <div className="mt-3">
                      {q.tipo === 'estrellas' && (
                        <div className="flex flex-col items-center gap-1">
                          <StarRating
                            value={r.estrellas ?? 0}
                            max={q.config.max ?? 5}
                            allowHalf={q.config.medio_punto ?? false}
                            size={36}
                            onChange={(v) => set(q.id, { estrellas: v })}
                          />
                          {r.estrellas ? (
                            <span className="text-xs text-sub">{r.estrellas} / {q.config.max ?? 5}</span>
                          ) : null}
                        </div>
                      )}

                      {q.tipo === 'si_no' && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            {['si', 'no'].map((op) => (
                              <button
                                key={op}
                                type="button"
                                onClick={() => set(q.id, { valor_texto: op })}
                                className={`btn-press flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize ${
                                  r.valor_texto === op
                                    ? 'border-brand-500 bg-brand-600 text-white'
                                    : 'border-line bg-surface text-ink hover:border-line2'
                                }`}
                              >
                                {op === 'si' ? 'Sí' : 'No'}
                              </button>
                            ))}
                          </div>
                          {r.valor_texto === 'no' && q.config.detalle_no && (
                            <textarea
                              value={r.detalle ?? ''}
                              onChange={(e) => set(q.id, { detalle: e.target.value })}
                              rows={2}
                              maxLength={1000}
                              placeholder={q.config.detalle_no_label || 'Contanos por qué (opcional)'}
                              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                            />
                          )}
                        </div>
                      )}

                      {q.tipo === 'opcion_unica' && (
                        <div className="space-y-2">
                          {(q.config.opciones ?? []).map((o) => (
                            <button
                              key={o.label}
                              type="button"
                              onClick={() => set(q.id, { valor_texto: o.label })}
                              className={`btn-press flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                                r.valor_texto === o.label
                                  ? 'border-brand-500 bg-brand-600/15 text-ink'
                                  : 'border-line bg-surface text-ink hover:border-line2'
                              }`}
                            >
                              <span
                                className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                                  r.valor_texto === o.label ? 'border-brand-500 bg-brand-500' : 'border-line2'
                                }`}
                              />
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {q.tipo === 'opcion_multiple' && (
                        <div className="space-y-2">
                          {(q.config.opciones ?? []).map((o) => {
                            const sel = r.opciones?.includes(o.label) ?? false
                            return (
                              <button
                                key={o.label}
                                type="button"
                                onClick={() => {
                                  const cur = r.opciones ?? []
                                  set(q.id, {
                                    opciones: sel ? cur.filter((x) => x !== o.label) : [...cur, o.label],
                                  })
                                }}
                                className={`btn-press flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                                  sel
                                    ? 'border-brand-500 bg-brand-600/15 text-ink'
                                    : 'border-line bg-surface text-ink hover:border-line2'
                                }`}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                    sel ? 'border-brand-500 bg-brand-500 text-white' : 'border-line2'
                                  }`}
                                >
                                  {sel && <Check size={11} aria-hidden />}
                                </span>
                                {o.label}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {q.tipo === 'texto' && (
                        <textarea
                          value={r.valor_texto ?? ''}
                          onChange={(e) => set(q.id, { valor_texto: e.target.value })}
                          rows={3}
                          maxLength={1000}
                          placeholder="Escribí acá…"
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        />
                      )}

                      {q.tipo === 'numero' && (
                        <input
                          type="number"
                          value={r.valor_texto ?? ''}
                          min={q.config.min}
                          max={q.config.max_num}
                          onChange={(e) => set(q.id, { valor_texto: e.target.value })}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none transition focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        />
                      )}

                      {q.tipo === 'fecha' && (
                        <input
                          type="date"
                          value={r.valor_texto ?? ''}
                          onChange={(e) => set(q.id, { valor_texto: e.target.value })}
                          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none transition focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {error && <p className="mt-3 text-center text-sm text-brand-400">{error}</p>}

            <button
              onClick={enviar}
              disabled={busy}
              className="btn-press mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 font-medium text-white shadow-soft hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {busy ? 'Enviando…' : 'Enviar'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
