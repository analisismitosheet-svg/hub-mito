import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Loader2, Plus, Trash2, Check, X, ChevronRight, MapPin, Search, Copy, Users, Eraser, ShieldCheck, UserRound } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { coloresUnicos } from '@/lib/coloresUnicos'
import {
  AREAS,
  APPS,
  cargarOverridesAreas,
  invalidarOverridesAreas,
  cargarAccionesArea,
  invalidarAccionesArea,
  ACCIONES_AREA,
  ACCIONES_AREA_LABEL,
  moduloDePermiso,
  type AccionArea,
} from '@/config/areas'
import {
  GRUPOS_PERMISOS,
  AREA_CONFIGURACION,
  ACCIONES_PERMISO,
  ACCION_PERMISO_LABEL,
  NIVEL_LABEL,
  claveArea,
  clavesDeGrupo,
  clavesDeNivel,
  nivelesDe,
  nivelActual,
  type GrupoPermisos,
} from '@/config/permisosCatalogo'

interface Rol {
  codigo: string
  nombre: string
  es_admin: boolean
  protegido: boolean
}
interface Usuario {
  id: string
  nombre: string | null
  email: string | null
  legajo: string | null
}
type Pestana = 'rol' | 'persona' | 'ubicacion'
/** Para cada clave: true = prendida, false = apagada (solo las que cambian) */
type Overrides = Record<string, boolean>

const CLAVES_CATALOGO = [
  ...new Set([...GRUPOS_PERMISOS.flatMap(clavesDeGrupo), ...AREAS.map((a) => claveArea(a.id))]),
]

const AREAS_PANTALLA = [
  ...AREAS.map((a) => ({ id: a.id, name: a.name, color: a.color })),
  AREA_CONFIGURACION,
]

/** Estilo del nivel prendido (Sin acceso gris, Solo ver celeste, Ver y cargar ámbar, Todo verde, A medida violeta). */
const NIVEL_ON: Record<string, string> = {
  '0': 'bg-slate-500/20 text-ink',
  '1': 'bg-sky-500/20 text-sky-400',
  '2': 'bg-amber-500/20 text-amber-400',
  '3': 'bg-emerald-500/20 text-emerald-400',
  medida: 'bg-violet-500/20 text-violet-400',
}

export default function Roles() {
  const [pestana, setPestana] = useState<Pestana>('rol')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [usuarioRoles, setUsuarioRoles] = useState<Record<string, string[]>>({})
  // Permisos por rol y overrides por persona: lo guardado y lo que se está editando
  const [rolPermsOrig, setRolPermsOrig] = useState<Record<string, Set<string>>>({})
  const [rolPerms, setRolPerms] = useState<Record<string, Set<string>>>({})
  const [overOrig, setOverOrig] = useState<Record<string, Overrides>>({})
  const [over, setOver] = useState<Record<string, Overrides>>({})
  const [guardando, setGuardando] = useState(false)

  const [rolSel, setRolSel] = useState('')
  const [personaSel, setPersonaSel] = useState('')
  const [buscar, setBuscar] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setError(null)
    const [rl, p, rp, us, ur, up] = await Promise.all([
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden'),
      // Solo las claves del catálogo (la tabla tiene más de 1.000 filas y la consulta corta ahí)
      supabase.from('permisos').select('clave').in('clave', CLAVES_CATALOGO),
      supabase.from('rol_permisos').select('rol,permiso_clave'),
      supabase.from('usuarios').select('id,nombre,email,legajo').eq('estado', 'aprobado').order('nombre'),
      supabase.from('usuario_roles').select('usuario_id,rol_codigo'),
      supabase.from('usuario_permisos').select('usuario_id,permiso_clave,efecto'),
    ])
    const err = rl.error ?? p.error ?? rp.error ?? us.error ?? ur.error ?? up.error
    if (err) setError(err.message)

    const listaRoles = (rl.data as Rol[]) ?? []
    setRoles(listaRoles)
    setExistentes(new Set(((p.data as { clave: string }[]) ?? []).map((r) => r.clave)))
    setUsuarios((us.data as Usuario[]) ?? [])

    const porRol: Record<string, Set<string>> = {}
    for (const r of listaRoles) porRol[r.codigo] = new Set()
    for (const r of (rp.data as { rol: string; permiso_clave: string }[]) ?? []) (porRol[r.rol] ??= new Set()).add(r.permiso_clave)
    setRolPermsOrig(porRol)
    setRolPerms(clonarRoles(porRol))

    const roles: Record<string, string[]> = {}
    for (const r of (ur.data as { usuario_id: string; rol_codigo: string }[]) ?? []) (roles[r.usuario_id] ??= []).push(r.rol_codigo)
    setUsuarioRoles(roles)

    const ov: Record<string, Overrides> = {}
    for (const r of (up.data as { usuario_id: string; permiso_clave: string; efecto: string }[]) ?? []) {
      ;(ov[r.usuario_id] ??= {})[r.permiso_clave] = r.efecto === 'grant'
    }
    setOverOrig(ov)
    setOver(clonarOver(ov))

    setRolSel((s) => s || listaRoles.find((r) => !r.es_admin)?.codigo || '')
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  // Catálogo limitado a las claves que existen en la base
  const grupos = useMemo(
    () =>
      GRUPOS_PERMISOS.map((g) => ({
        ...g,
        acciones: Object.fromEntries(Object.entries(g.acciones).filter(([, c]) => c && existentes.has(c))),
        especiales: g.especiales?.filter((e) => existentes.has(e.clave)),
      })).filter((g) => clavesDeGrupo(g).length > 0) as GrupoPermisos[],
    [existentes],
  )

  // ===== Cambios pendientes =====
  const cambiosRoles = useMemo(() => {
    const out: { rol: string; agregar: string[]; quitar: string[] }[] = []
    for (const rol of Object.keys(rolPerms)) {
      const a = rolPerms[rol], o = rolPermsOrig[rol] ?? new Set<string>()
      const agregar = [...a].filter((c) => !o.has(c))
      const quitar = [...o].filter((c) => !a.has(c))
      if (agregar.length || quitar.length) out.push({ rol, agregar, quitar })
    }
    return out
  }, [rolPerms, rolPermsOrig])

  const cambiosPersonas = useMemo(() => {
    const out: { uid: string; limpiar: string[]; grants: string[]; revokes: string[] }[] = []
    for (const uid of new Set([...Object.keys(over), ...Object.keys(overOrig)])) {
      const a = over[uid] ?? {}, o = overOrig[uid] ?? {}
      const limpiar: string[] = [], grants: string[] = [], revokes: string[] = []
      for (const c of new Set([...Object.keys(a), ...Object.keys(o)])) {
        if (a[c] === o[c]) continue
        if (a[c] === undefined) limpiar.push(c)
        else if (a[c]) grants.push(c)
        else revokes.push(c)
      }
      if (limpiar.length || grants.length || revokes.length) out.push({ uid, limpiar, grants, revokes })
    }
    return out
  }, [over, overOrig])

  const totalCambios =
    cambiosRoles.reduce((n, c) => n + c.agregar.length + c.quitar.length, 0) +
    cambiosPersonas.reduce((n, c) => n + c.limpiar.length + c.grants.length + c.revokes.length, 0)

  async function guardar() {
    if (!supabase) return
    setGuardando(true); setError(null)
    try {
      for (const c of cambiosRoles) {
        if (c.quitar.length) {
          const { error } = await supabase.from('rol_permisos').delete().eq('rol', c.rol).in('permiso_clave', c.quitar)
          if (error) throw error
        }
        if (c.agregar.length) {
          const { error } = await supabase.from('rol_permisos').insert(c.agregar.map((permiso_clave) => ({ rol: c.rol, permiso_clave })))
          if (error) throw error
        }
      }
      for (const c of cambiosPersonas) {
        const { error } = await supabase.rpc('set_usuario_permisos', { uid: c.uid, limpiar: c.limpiar, grants: c.grants, revokes: c.revokes })
        if (error) throw error
      }
      setRolPermsOrig(clonarRoles(rolPerms))
      setOverOrig(clonarOver(over))
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
    } finally {
      setGuardando(false)
    }
  }

  function descartar() {
    setRolPerms(clonarRoles(rolPermsOrig))
    setOver(clonarOver(overOrig))
  }

  // ===== Lo que se edita: un rol o una persona =====
  const rol = roles.find((r) => r.codigo === rolSel)
  const persona = usuarios.find((u) => u.id === personaSel)
  const rolesPersona = persona ? usuarioRoles[persona.id] ?? [] : []
  const personaEsAdmin = rolesPersona.some((c) => roles.find((r) => r.codigo === c)?.es_admin)

  const porRolDe = useCallback(
    (uid: string, clave: string) => (usuarioRoles[uid] ?? []).some((c) => rolPermsOrig[c]?.has(clave)),
    [usuarioRoles, rolPermsOrig],
  )
  const efectivo = useCallback(
    (uid: string, clave: string) => {
      const o = over[uid]?.[clave]
      return o === undefined ? porRolDe(uid, clave) : o
    },
    [over, porRolDe],
  )

  /** ¿Tiene la clave el rol o la persona que se está editando? */
  const tiene = (clave: string) =>
    pestana === 'persona' ? (persona ? efectivo(persona.id, clave) : false) : !!rolPerms[rolSel]?.has(clave)

  /** Prende/apaga claves en el rol o la persona que se está editando. */
  function setClaves(claves: string[], valor: boolean) {
    if (pestana === 'persona') {
      if (!persona) return
      const uid = persona.id
      setOver((prev) => {
        const o = { ...(prev[uid] ?? {}) }
        for (const c of claves) {
          if (valor === porRolDe(uid, c)) delete o[c]
          else o[c] = valor
        }
        return { ...prev, [uid]: o }
      })
    } else {
      if (!rolSel) return
      setRolPerms((prev) => {
        const s = new Set(prev[rolSel] ?? [])
        for (const c of claves) valor ? s.add(c) : s.delete(c)
        return { ...prev, [rolSel]: s }
      })
    }
  }

  function aplicarNivel(g: GrupoPermisos, n: 0 | 1 | 2 | 3) {
    const prender = new Set(clavesDeNivel(g, n))
    const todas = clavesDeGrupo(g)
    setClaves(todas.filter((c) => prender.has(c)), true)
    setClaves(todas.filter((c) => !prender.has(c)), false)
  }

  function toggleClave(g: GrupoPermisos, clave: string) {
    const valor = !tiene(clave)
    const ver = g.acciones.ver
    // Cualquier acción necesita "ver" para entrar; sacar "ver" apaga todo el grupo
    if (valor && ver && clave !== ver) setClaves([clave, ver], true)
    else if (!valor && clave === ver) setClaves(clavesDeGrupo(g), false)
    else setClaves([clave], valor)
  }

  // ===== Filtro de búsqueda / área =====
  const q = buscar.trim().toLowerCase()
  const secciones = AREAS_PANTALLA.map((area) => {
    const gs = grupos.filter(
      (g) =>
        g.areaId === area.id &&
        (!q || `${g.titulo} ${g.descripcion} ${area.name}`.toLowerCase().includes(q)),
    )
    const verArea = existentes.has(claveArea(area.id)) && (!q || area.name.toLowerCase().includes(q) || gs.length > 0)
    return { area, grupos: gs, verArea }
  }).filter((s) => (!filtroArea || s.area.id === filtroArea) && (s.grupos.length > 0 || s.verArea))

  const personasPorRol = (codigo: string) => usuarios.filter((u) => (usuarioRoles[u.id] ?? []).includes(codigo))

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Roles y permisos</h1>
        <p className="mt-1 text-sm text-sub">Elegí un rol o una persona y tocá el nivel de acceso de cada app. Se guarda todo junto.</p>
      </header>

      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {([
          ['rol', 'Por rol'],
          ['persona', 'Por persona'],
          ['ubicacion', 'Ubicación de menús'],
        ] as [Pestana, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`btn-press rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${pestana === id ? 'bg-surface2 text-ink' : 'text-sub hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : pestana === 'ubicacion' ? (
        <UbicacionMenus />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ===== Lista de roles o personas ===== */}
          {pestana === 'rol' ? (
            <ListaRoles
              roles={roles}
              sel={rolSel}
              onSel={setRolSel}
              cantidad={(c) => personasPorRol(c).length}
              onCreado={async (codigo) => { await cargar(); setRolSel(codigo) }}
              onError={setError}
            />
          ) : (
            <ListaPersonas usuarios={usuarios} sel={personaSel} onSel={setPersonaSel} roles={roles} usuarioRoles={usuarioRoles} />
          )}

          {/* ===== Panel de permisos ===== */}
          <div className="min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-soft">
            {pestana === 'rol' && rol && (
              <CabeceraRol
                rol={rol}
                personas={personasPorRol(rol.codigo)}
                appsConAcceso={grupos.filter((g) => clavesDeGrupo(g).some((c) => rolPerms[rol.codigo]?.has(c))).length}
                onDuplicar={async () => {
                  if (!supabase) return
                  const nombre = `${rol.nombre} (copia)`
                  const codigo = `${rol.codigo}_copia_${Date.now().toString(36).slice(-4)}`
                  const { error: e1 } = await supabase.from('roles').insert({ codigo, nombre })
                  if (e1) { setError(e1.message); return }
                  const filas = [...(rolPermsOrig[rol.codigo] ?? [])].map((permiso_clave) => ({ rol: codigo, permiso_clave }))
                  if (filas.length) {
                    const { error: e2 } = await supabase.from('rol_permisos').insert(filas)
                    if (e2) { setError(e2.message); return }
                  }
                  await cargar(); setRolSel(codigo)
                }}
                onBorrar={() =>
                  setConfirm({
                    message: `¿Borrar el rol "${rol.nombre}"? Los usuarios que lo tengan pasarán a "Usuario".`,
                    onConfirm: async () => {
                      if (!supabase) return
                      const { error } = await supabase.from('roles').delete().eq('codigo', rol.codigo)
                      if (error) { setError(error.message); return }
                      setRolSel('')
                      await cargar()
                    },
                  })
                }
              />
            )}
            {pestana === 'persona' && (
              persona ? (
                <CabeceraPersona
                  persona={persona}
                  roles={rolesPersona.map((c) => roles.find((r) => r.codigo === c)?.nombre ?? c)}
                  otros={usuarios.filter((u) => u.id !== persona.id)}
                  onCopiar={(otro) => {
                    // Deja a la persona con los mismos permisos efectivos que "otro" (sus roles no cambian)
                    const claves = [...grupos.flatMap(clavesDeGrupo), ...AREAS_PANTALLA.map((a) => claveArea(a.id))]
                    const o: Overrides = { ...(over[persona.id] ?? {}) }
                    for (const c of claves) {
                      const quiero = efectivo(otro.id, c)
                      if (quiero === porRolDe(persona.id, c)) delete o[c]
                      else o[c] = quiero
                    }
                    setOver((prev) => ({ ...prev, [persona.id]: o }))
                  }}
                  onQuitarExtras={() => setOver((prev) => ({ ...prev, [persona.id]: {} }))}
                  tieneExtras={Object.keys(over[persona.id] ?? {}).length > 0}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-sub">
                  <UserRound size={28} aria-hidden />
                  Elegí una persona de la lista para ver y cambiar sus permisos.
                </div>
              )
            )}

            {((pestana === 'rol' && rol?.es_admin) || (pestana === 'persona' && persona && personaEsAdmin)) ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
                <ShieldCheck size={20} aria-hidden />
                {pestana === 'rol' ? 'Este rol tiene acceso total a todo el hub.' : 'Es administrador: tiene acceso total a todo el hub.'}
              </div>
            ) : ((pestana === 'rol' && rol) || (pestana === 'persona' && persona)) && (
              <>
                {pestana === 'persona' && (
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-sub">
                    <Origen tipo="rol" /> viene de su rol
                    <Origen tipo="extra" texto="+ extra" /> se lo diste a esta persona
                    <Origen tipo="quitado" texto="− quitado" /> se lo sacaste aunque el rol lo dé
                  </div>
                )}

                <label className="relative mb-2.5 block">
                  <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
                  <input
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                    placeholder="Buscar app… (ej: factu, picking, mapeo)"
                    className="h-11 w-full rounded-xl border border-line bg-surface2 pl-10 pr-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  />
                </label>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  <Chip on={!filtroArea} onClick={() => setFiltroArea('')}>Todas</Chip>
                  {AREAS_PANTALLA.filter((a) => grupos.some((g) => g.areaId === a.id)).map((a) => (
                    <Chip key={a.id} on={filtroArea === a.id} onClick={() => setFiltroArea(filtroArea === a.id ? '' : a.id)}>
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: a.color }} />
                      {a.name}
                    </Chip>
                  ))}
                </div>

                {secciones.length === 0 && <p className="py-10 text-center text-sm text-sub">No hay apps con “{buscar}”.</p>}

                {secciones.map(({ area, grupos: gs, verArea }) => {
                  const colores = coloresUnicos(gs.map((g) => g.color))
                  const cArea = claveArea(area.id)
                  return (
                    <section key={area.id} className="mb-5">
                      <div className="mb-2 flex flex-wrap items-center gap-2 px-0.5">
                        <span className="h-3.5 w-1 rounded-full" style={{ background: area.color }} />
                        <h2 className="text-xs font-bold uppercase tracking-wider text-sub">{area.name}</h2>
                        {verArea && (
                          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-sub">
                            {pestana === 'persona' && persona && <OrigenClave over={over[persona.id]?.[cArea]} porRol={porRolDe(persona.id, cArea)} />}
                            Ve el área en el menú
                            <Interruptor on={tiene(cArea)} onClick={() => setClaves([cArea], !tiene(cArea))} />
                          </label>
                        )}
                      </div>
                      {gs.map((g, i) => (
                        <TarjetaGrupo
                          key={g.id}
                          grupo={g}
                          color={colores[i]}
                          tiene={tiene}
                          abierto={abiertos.has(g.id)}
                          onAbrir={() => setAbiertos((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n })}
                          onNivel={(n) => aplicarNivel(g, n)}
                          onClave={(c) => toggleClave(g, c)}
                          cambiado={
                            pestana === 'persona'
                              ? !!persona && clavesDeGrupo(g).some((c) => over[persona.id]?.[c] !== undefined)
                              : clavesDeGrupo(g).some((c) => !!rolPerms[rolSel]?.has(c) !== !!rolPermsOrig[rolSel]?.has(c))
                          }
                          origen={
                            pestana === 'persona' && persona
                              ? <OrigenGrupo grupo={g} over={over[persona.id] ?? {}} porRol={(c) => porRolDe(persona.id, c)} />
                              : null
                          }
                        />
                      ))}
                    </section>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Barra de guardado ===== */}
      <div
        className={`fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-line2 bg-surface-solid/95 py-2 pl-4 pr-2 shadow-soft-lg backdrop-blur transition-transform duration-300 ease-out-strong ${totalCambios > 0 ? 'translate-y-0' : 'translate-y-[200%]'}`}
      >
        <span className="whitespace-nowrap text-sm font-medium text-ink">
          {totalCambios} cambio{totalCambios === 1 ? '' : 's'} sin guardar
        </span>
        <button onClick={descartar} disabled={guardando} className="btn-press rounded-xl border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line">
          Descartar
        </button>
        <button onClick={() => void guardar()} disabled={guardando} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {guardando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
          Guardar
        </button>
      </div>

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }}
      />
    </Layout>
  )
}

function clonarRoles(m: Record<string, Set<string>>) {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(v)]))
}
function clonarOver(m: Record<string, Overrides>) {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v }]))
}

// ===================== Piezas =====================

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`btn-press inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${on ? 'border-line2 bg-surface2 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

function Interruptor({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-line2'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

function Origen({ tipo, texto }: { tipo: 'rol' | 'extra' | 'quitado'; texto?: string }) {
  const cls = {
    rol: 'border-sky-500/35 bg-sky-500/10 text-sky-400',
    extra: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    quitado: 'border-brand-600/40 bg-brand-600/10 text-brand-400',
  }[tipo]
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-px text-[10.5px] font-bold ${cls}`}>{texto ?? 'por rol'}</span>
}

function OrigenClave({ over, porRol }: { over: boolean | undefined; porRol: boolean }) {
  if (over === true) return <Origen tipo="extra" texto="+ extra" />
  if (over === false) return <Origen tipo="quitado" texto="− quitado" />
  return porRol ? <Origen tipo="rol" /> : null
}

function etiquetaClave(g: GrupoPermisos, clave: string) {
  for (const a of ACCIONES_PERMISO) if (g.acciones[a] === clave) return g.etiquetas?.[a] ?? ACCION_PERMISO_LABEL[a]
  return g.especiales?.find((e) => e.clave === clave)?.label ?? clave
}

function OrigenGrupo({ grupo, over, porRol }: { grupo: GrupoPermisos; over: Overrides; porRol: (c: string) => boolean }) {
  const claves = clavesDeGrupo(grupo)
  const mas = claves.filter((c) => over[c] === true)
  const menos = claves.filter((c) => over[c] === false)
  if (!mas.length && !menos.length) return claves.some(porRol) ? <Origen tipo="rol" /> : null
  return (
    <>
      {mas.length > 0 && <Origen tipo="extra" texto={`+ ${mas.map((c) => etiquetaClave(grupo, c)).join(', ')}`} />}
      {menos.length > 0 && <Origen tipo="quitado" texto={`− ${menos.map((c) => etiquetaClave(grupo, c)).join(', ')}`} />}
    </>
  )
}

function TarjetaGrupo({
  grupo: g, color, tiene, abierto, onAbrir, onNivel, onClave, cambiado, origen,
}: {
  grupo: GrupoPermisos
  color: string
  tiene: (c: string) => boolean
  abierto: boolean
  onAbrir: () => void
  onNivel: (n: 0 | 1 | 2 | 3) => void
  onClave: (c: string) => void
  cambiado: boolean
  origen: ReactNode
}) {
  const Icon = g.icon
  const niveles = nivelesDe(g)
  const actual = nivelActual(g, tiene)
  const acciones = ACCIONES_PERMISO.filter((a) => g.acciones[a])
  const tieneDetalle = clavesDeGrupo(g).length > 1

  return (
    <div
      className={`mb-2 rounded-2xl border bg-surface p-3 transition-colors ${cambiado ? 'border-amber-500/50' : 'border-line hover:border-line2'}`}
      style={{ '--c': color } as CSSProperties}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="icon-tile h-10 w-10 shrink-0 rounded-xl">
          <Icon size={19} aria-hidden />
        </div>
        <div className="min-w-[160px] flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
            {g.titulo} {origen}
          </p>
          <p className="text-xs text-sub">{g.descripcion}</p>
        </div>
        <div className="grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-xl border border-line bg-black/20 p-0.5 sm:inline-flex sm:w-auto">
          {niveles.map((n) => (
            <button
              key={n}
              onClick={() => onNivel(n)}
              className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:px-2.5 ${actual === n ? NIVEL_ON[String(n)] : 'text-sub hover:text-ink'}`}
            >
              {n === 1 && clavesDeGrupo(g).length === 1 ? g.etiquetas?.ver ?? 'Con acceso' : NIVEL_LABEL[n]}
            </button>
          ))}
          {actual === 'medida' && (
            <span className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-center text-xs font-semibold sm:px-2.5 ${NIVEL_ON.medida}`}>A medida</span>
          )}
        </div>
        {tieneDetalle && (
          <button onClick={onAbrir} className="inline-flex items-center gap-1 px-1 py-1.5 text-xs font-semibold text-sub hover:text-ink">
            <ChevronRight size={13} aria-hidden className={`transition-transform ${abierto ? 'rotate-90' : ''}`} />
            Detalle
          </button>
        )}
      </div>
      {abierto && tieneDetalle && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="mr-1 text-[11px] font-bold text-sub">Acciones</span>
          {acciones.map((a) => (
            <CasillaAccion key={a} on={tiene(g.acciones[a]!)} onClick={() => onClave(g.acciones[a]!)}>
              {g.etiquetas?.[a] ?? ACCION_PERMISO_LABEL[a]}
            </CasillaAccion>
          ))}
          {!!g.especiales?.length && (
            <>
              <span className="mx-1 h-4 w-px bg-line" />
              <span className="mr-1 text-[11px] font-bold text-sub">Especiales</span>
              {g.especiales.map((e) => (
                <CasillaAccion key={e.clave} on={tiene(e.clave)} onClick={() => onClave(e.clave)} punteada>
                  {e.label}
                </CasillaAccion>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CasillaAccion({ on, onClick, punteada, children }: { on: boolean; onClick: () => void; punteada?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`btn-press inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${punteada ? 'border-dashed' : ''} ${on ? 'border-emerald-500/45 bg-emerald-500/10 text-ink' : 'border-line bg-surface text-sub hover:text-ink'}`}
    >
      <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${on ? 'border-emerald-500 bg-emerald-500 text-emerald-950' : 'border-line2'}`}>
        {on && <Check size={10} strokeWidth={3.5} aria-hidden />}
      </span>
      {children}
    </button>
  )
}

function ListaRoles({
  roles, sel, onSel, cantidad, onCreado, onError,
}: {
  roles: Rol[]
  sel: string
  onSel: (c: string) => void
  cantidad: (codigo: string) => number
  onCreado: (codigo: string) => Promise<void>
  onError: (e: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const colores = coloresUnicos(roles.map(() => '#0ea5e9'))

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const codigo = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!codigo) { onError('Poné un nombre válido.'); return }
    setCreando(true)
    const { error } = await supabase.from('roles').insert({ codigo, nombre: nombre.trim() })
    setCreando(false)
    if (error) { onError(error.message); return }
    setNombre(''); setAbierto(false)
    await onCreado(codigo)
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-surface p-2 shadow-soft lg:sticky lg:top-4 lg:flex-col lg:overflow-visible">
      <p className="hidden px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-sub lg:block">Roles</p>
      {roles.map((r, i) => (
        <button
          key={r.codigo}
          onClick={() => onSel(r.codigo)}
          className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-2.5 py-2 text-left text-sm font-semibold transition lg:w-full ${sel === r.codigo ? 'border-line2 bg-surface2 text-ink' : 'border-transparent text-sub hover:bg-surface2 hover:text-ink'}`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colores[i] }} />
          <span className="lg:flex-1 lg:truncate">{r.nombre}</span>
          <span className="text-[11px] font-medium text-sub">{r.es_admin ? 'total' : `${cantidad(r.codigo)} pers.`}</span>
        </button>
      ))}
      {abierto ? (
        <form onSubmit={crear} className="flex shrink-0 items-center gap-1.5 lg:mt-1">
          <input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del rol"
            className="h-9 min-w-[140px] flex-1 rounded-lg border border-line bg-surface2 px-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
          <button type="submit" disabled={creando} aria-label="Crear rol" className="btn-press grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white disabled:opacity-50">
            {creando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
          </button>
          <button type="button" onClick={() => setAbierto(false)} aria-label="Cancelar" className="grid h-9 w-9 place-items-center rounded-lg text-sub hover:bg-line">
            <X size={15} aria-hidden />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAbierto(true)}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-dashed border-line2 px-2.5 py-2 text-sm font-semibold text-sub hover:text-ink lg:mt-1 lg:w-full"
        >
          <Plus size={15} aria-hidden /> Nuevo rol
        </button>
      )}
    </div>
  )
}

function ListaPersonas({
  usuarios, sel, onSel, roles, usuarioRoles,
}: {
  usuarios: Usuario[]
  sel: string
  onSel: (id: string) => void
  roles: Rol[]
  usuarioRoles: Record<string, string[]>
}) {
  const [q, setQ] = useState('')
  const lista = usuarios.filter((u) => !q || `${u.nombre ?? ''} ${u.email ?? ''} ${u.legajo ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const nombreRol = (c: string) => roles.find((r) => r.codigo === c)?.nombre ?? c
  return (
    <div className="rounded-2xl border border-line bg-surface p-2 shadow-soft lg:sticky lg:top-4">
      <p className="hidden px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-sub lg:block">Personas</p>
      <label className="relative mb-1.5 block">
        <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar persona…"
          className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        />
      </label>
      <div className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
        {lista.map((u) => (
          <button
            key={u.id}
            onClick={() => onSel(u.id)}
            className={`rounded-xl border px-2.5 py-1.5 text-left transition ${sel === u.id ? 'border-line2 bg-surface2' : 'border-transparent hover:bg-surface2'}`}
          >
            <span className="block truncate text-sm font-semibold text-ink">{u.nombre || u.email}</span>
            <span className="block truncate text-[11px] text-sub">{(usuarioRoles[u.id] ?? []).map(nombreRol).join(' + ') || 'sin rol'}</span>
          </button>
        ))}
        {lista.length === 0 && <p className="px-2 py-4 text-center text-xs text-sub">Nadie con “{q}”.</p>}
      </div>
    </div>
  )
}

function CabeceraRol({
  rol, personas, appsConAcceso, onDuplicar, onBorrar,
}: {
  rol: Rol
  personas: Usuario[]
  appsConAcceso: number
  onDuplicar: () => Promise<void>
  onBorrar: () => void
}) {
  const [verPersonas, setVerPersonas] = useState(false)
  const [duplicando, setDuplicando] = useState(false)
  useEffect(() => { setVerPersonas(false) }, [rol.codigo])
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{rol.nombre}</h2>
          <p className="mt-0.5 text-xs text-sub">
            {personas.length} persona{personas.length === 1 ? '' : 's'} con este rol
            {!rol.es_admin && ` · entra a ${appsConAcceso} app${appsConAcceso === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setVerPersonas((v) => !v)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold text-ink hover:border-line2">
            <Users size={14} aria-hidden /> Ver personas
          </button>
          {!rol.es_admin && (
            <button
              onClick={async () => { setDuplicando(true); await onDuplicar(); setDuplicando(false) }}
              disabled={duplicando}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold text-ink hover:border-line2 disabled:opacity-50"
            >
              {duplicando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Copy size={14} aria-hidden />} Duplicar rol
            </button>
          )}
          {!rol.protegido && (
            <button onClick={onBorrar} aria-label={`Borrar rol ${rol.nombre}`} className="btn-press rounded-xl border border-brand-600/30 bg-brand-600/10 px-2.5 py-2 text-brand-400 hover:bg-brand-600/20">
              <Trash2 size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {verPersonas && (
        <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface2/60 p-2.5">
          {personas.length === 0 ? (
            <span className="text-xs text-sub">Nadie tiene este rol todavía.</span>
          ) : (
            personas.map((p) => (
              <span key={p.id} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-ink">{p.nombre || p.email}</span>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function CabeceraPersona({
  persona, roles, otros, onCopiar, onQuitarExtras, tieneExtras,
}: {
  persona: Usuario
  roles: string[]
  otros: Usuario[]
  onCopiar: (otro: Usuario) => void
  onQuitarExtras: () => void
  tieneExtras: boolean
}) {
  const [copiar, setCopiar] = useState(false)
  const [q, setQ] = useState('')
  const iniciales = (persona.nombre || persona.email || '?').split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
  const lista = otros.filter((u) => !q || `${u.nombre ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface2/60 p-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">{iniciales}</div>
      <div className="min-w-[160px] flex-1">
        <p className="font-semibold text-ink">{persona.nombre || persona.email}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {roles.length === 0 && <span className="text-xs text-sub">Sin rol</span>}
          {roles.map((r) => (
            <span key={r} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-px text-[11px] font-bold text-sky-400">{r}</span>
          ))}
        </div>
      </div>
      <button onClick={() => setCopiar(true)} className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold text-ink hover:border-line2">
        <Copy size={14} aria-hidden /> Copiar permisos de…
      </button>
      <button
        onClick={onQuitarExtras}
        disabled={!tieneExtras}
        className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs font-semibold text-ink hover:border-line2 disabled:opacity-40"
      >
        <Eraser size={14} aria-hidden /> Quitar extras
      </button>

      {copiar && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={() => setCopiar(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl border border-line2 bg-surface-solid p-4 shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-ink">Copiar permisos de…</h3>
            <p className="mb-3 mt-1 text-xs text-sub">
              {persona.nombre} queda con los mismos accesos que la persona que elijas. Sus roles no cambian; la diferencia queda como extras. Después lo guardás con “Guardar”.
            </p>
            <label className="relative mb-2 block">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…" className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2.5 text-sm text-ink outline-none" />
            </label>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {lista.map((u) => (
                <button
                  key={u.id}
                  onClick={() => { onCopiar(u); setCopiar(false) }}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm font-semibold text-ink hover:border-line2"
                >
                  {u.nombre || u.email}
                </button>
              ))}
            </div>
            <button onClick={() => setCopiar(false)} className="btn-press mt-3 rounded-xl border border-line bg-surface2 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== Ubicación de menús =====================

function UbicacionMenus() {
  const [ubicacion, setUbicacion] = useState<Record<string, string[]>>({})
  const [acciones, setAcciones] = useState<Record<string, string[]>>({})
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    let activo = true
    void Promise.all([cargarOverridesAreas(), cargarAccionesArea()]).then(([mapa, mapaAcciones]) => {
      if (!activo) return
      setUbicacion(mapa)
      setAcciones(mapaAcciones)
      setCargando(false)
    })
    return () => { activo = false }
  }, [])

  async function guardarUbicacion(appId: string, areaId: string, marcado: boolean) {
    if (!supabase) return
    const arr = ubicacion[appId] ?? []
    setUbicacion({ ...ubicacion, [appId]: marcado ? [...new Set([...arr, areaId])] : arr.filter((a) => a !== areaId) })
    invalidarOverridesAreas()
    if (marcado) await supabase.from('app_areas').insert({ app_id: appId, area_id: areaId })
    else await supabase.from('app_areas').delete().eq('app_id', appId).eq('area_id', areaId)
  }

  // activa: estado previo de esa acción
  async function guardarAccion(appId: string, areaId: string, accion: AccionArea, activa: boolean) {
    if (!supabase) return
    const clave = `${appId}|${areaId}`
    const arr = acciones[clave] ?? []
    setAcciones({ ...acciones, [clave]: activa ? arr.filter((a) => a !== accion) : [...new Set([...arr, accion])] })
    invalidarAccionesArea()
    if (activa) await supabase.from('app_area_acciones').delete().eq('app_id', appId).eq('area_id', areaId).eq('accion', accion)
    else await supabase.from('app_area_acciones').insert({ app_id: appId, area_id: areaId, accion })
  }

  if (cargando) {
    return <div className="flex items-center gap-2 py-6 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</div>
  }

  const apps = APPS.filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()))

  return (
    <section className="max-w-5xl rounded-2xl border border-line bg-surface p-4 shadow-soft">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><MapPin size={15} className="text-brand-500" aria-hidden /> Ubicación de menús</h2>
      <p className="mb-3 text-xs text-sub">
        En qué áreas aparece cada app y qué se puede hacer en cada una. Casi nunca hace falta: sin tildes, cada app vive en su área con los permisos del rol.
      </p>
      <label className="relative mb-3 block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar app…" className="h-10 w-full rounded-xl border border-line bg-surface2 pl-9 pr-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
      </label>
      <div className="space-y-2">
        {apps.map((app) => {
          const marcadas = ubicacion[app.id] ?? []
          const porDefecto = [app.areaId, ...(app.areaIds ?? [])]
          const modulo = moduloDePermiso(app.permiso)
          return (
            <details key={app.id} className="rounded-xl border border-line bg-surface2/60">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-ink">
                <span className="flex-1 truncate">
                  {app.title}
                  {app.enMenu && <span className="ml-2 text-[11px] font-normal text-sub/80">acceso directo del menú principal · lo ve quien pueda ver alguna de estas áreas</span>}
                </span>
                <span className="text-[11px] text-sub/70">{marcadas.length > 0 ? `${marcadas.length} área(s)` : 'por defecto'}</span>
                <ChevronRight size={13} aria-hidden className="text-sub" />
              </summary>
              <div className="grid grid-cols-1 gap-1 border-t border-line px-3 py-2 md:grid-cols-2">
                {AREAS.map((area) => {
                  const marcado = marcadas.includes(area.id)
                  const accionesDeEsta = acciones[`${app.id}|${area.id}`] ?? []
                  return (
                    <div key={area.id} className="rounded-lg border border-line/60 bg-surface/40 px-2 py-1.5">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                        <input type="checkbox" checked={marcado} onChange={(e) => void guardarUbicacion(app.id, area.id, e.target.checked)} className="h-3.5 w-3.5 rounded border-line bg-surface2 accent-brand-600" />
                        <span className="truncate font-medium">{area.name}</span>
                        {porDefecto.includes(area.id) && !marcado && <span className="text-[10px] text-sub/60">def</span>}
                      </label>
                      {marcado && modulo && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t border-line/50 pl-5 pt-1">
                          {ACCIONES_AREA.map((acc) => {
                            const activa = accionesDeEsta.includes(acc)
                            return (
                              <label key={acc} className="flex cursor-pointer items-center gap-1 text-[11px] text-sub">
                                <input type="checkbox" checked={activa} onChange={() => void guardarAccion(app.id, area.id, acc, activa)} className="h-3 w-3 rounded border-line bg-surface2 accent-brand-600" />
                                {ACCIONES_AREA_LABEL[acc]}
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}
