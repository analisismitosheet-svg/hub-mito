/**
 * Alta de cuenta de empleado (legajo + contraseña) por parte de un admin.
 *
 * Flujo:  PWA (JWT Supabase) -> esta función -> valida admin -> auth.admin.createUser
 *         -> upsert public.usuarios (legajo, estado aprobado) + rol "empleado"
 *
 * ¿Por qué acá y no en el navegador? Porque crear usuarios de Supabase Auth
 * necesita la service role key, que NUNCA puede viajar al navegador.
 *
 * El admin no se chequea con el JWT secret (no siempre está en el env): se
 * reutiliza el token del llamante contra la RPC mi_perfil() + la tabla roles,
 * exactamente igual que decide el front.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL                - mismo proyecto que usa la app
 *   SUPABASE_ANON_KEY           - anon key (para validar el JWT del usuario)
 *   SUPABASE_SERVICE_ROLE_KEY   - service role (crear auth.users y escribir usuarios)
 */

// Con "type": "module", Node (Vercel) exige la extensión .js en imports relativos;
// sin ella la función se cae al cargar (FUNCTION_INVOCATION_FAILED).
import { DOMINIO_LOGIN_EMPLEADO, emailDeLegajo, legajoLimpio, problemaClaveEmpleado } from '../src/lib/loginEmpleado.js'

type Req = {
  method?: string
  headers: { authorization?: string }
  body?: string | Record<string, unknown>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface Perfil {
  id: string
  email: string | null
  nombre: string | null
  rol: string | null
  estado: string | null
  es_admin: boolean
  roles: string[] | null
}

interface EmpleadoRow {
  id: string
  legajo: string | null
  nombre: string | null
}

function base(): { url: string; anon: string } | null {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  return url && anon ? { url: url.replace(/\/$/, ''), anon } : null
}

function serviceHeaders(): Record<string, string> | null {
  const cfg = base()
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!cfg || !service) return null
  return { Authorization: `Bearer ${service}`, apikey: service }
}

/** Valida el JWT de Supabase contra /auth/v1/user. */
async function usuarioValido(token: string): Promise<boolean> {
  const cfg = base()
  if (!cfg) return false
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: cfg.anon },
    })
    return res.ok
  } catch {
    return false
  }
}

/** Llama una RPC de PostgREST con el token DEL LLAMANTE (no con service role). */
async function rpcConToken<T>(token: string, nombre: string): Promise<T | null> {
  const cfg = base()
  if (!cfg) return null
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: cfg.anon,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (Array.isArray(data)) return (data[0] as T) ?? null
    return data as T
  } catch {
    return null
  }
}

/** ¿El llamante es administrador? Misma lógica que useAuth().isAdmin en el front. */
async function esAdmin(token: string): Promise<boolean> {
  const perfil = await rpcConToken<Perfil>(token, 'mi_perfil')
  if (!perfil) return false
  // Un admin desactivado/pendiente con la sesión todavía abierta no puede dar de alta cuentas
  if (perfil.estado !== 'aprobado') return false
  if (perfil.es_admin || perfil.rol === 'administrador') return true
  const roles = perfil.roles ?? []
  if (roles.includes('administrador') || roles.length === 0) return roles.includes('administrador')

  const cfg = base()
  if (!cfg) return false
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/roles?select=codigo,es_admin&codigo=in.(${roles.map(encodeURIComponent).join(',')})`,
      { headers: { Authorization: `Bearer ${token}`, apikey: cfg.anon } },
    )
    if (!res.ok) return false
    const filas = (await res.json()) as Array<{ es_admin?: boolean }>
    return filas.some((r) => r.es_admin === true)
  } catch {
    return false
  }
}

/** Trae la fila del empleado en la nómina por legajo (tolerando espacios). */
async function empleadoPorLegajo(legajo: string): Promise<EmpleadoRow | null> {
  const headers = serviceHeaders()
  const cfg = base()
  if (!headers || !cfg) return null
  const candidatos = Array.from(new Set([legajo, legajo.replace(/[^A-Za-z0-9]/g, '')]))
  for (const c of candidatos) {
    if (!c) continue
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/empleados?select=id,legajo,nombre&legajo=eq.${encodeURIComponent(c)}&limit=1`,
        { headers },
      )
      if (!res.ok) continue
      const filas = (await res.json()) as EmpleadoRow[]
      if (filas[0]) return filas[0]
    } catch {
      /* se prueba el siguiente candidato */
    }
  }
  return null
}

/** Legajo ya usado por otra cuenta de login. */
async function legajoOcupado(legajo: string): Promise<string | null> {
  const headers = serviceHeaders()
  const cfg = base()
  if (!headers || !cfg) return null
  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/usuarios?select=id,email&legajo=eq.${encodeURIComponent(legajo)}&limit=1`,
      { headers },
    )
    if (!res.ok) return null
    const filas = (await res.json()) as Array<{ id: string; email: string | null }>
    return filas[0]?.id ?? null
  } catch {
    return null
  }
}

function leerBody(raw: Req['body']): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      return p && typeof p === 'object' ? (p as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return raw
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const cfg = base()
  const serviceHeadersMap = serviceHeaders()
  if (!cfg || !serviceHeadersMap) {
    return res.status(500).json({
      error: 'Falta configurar SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY en Vercel',
    })
  }

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await usuarioValido(token))) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  if (!(await esAdmin(token))) {
    return res.status(403).json({ error: 'Requiere ser administrador' })
  }

  const body = leerBody(req.body)
  if (!body) return res.status(400).json({ error: 'Cuerpo inválido' })

  const accion = String(body.accion ?? 'crear')
  if (accion !== 'crear') {
    return res.status(400).json({ error: `Acción no soportada: ${accion}` })
  }

  const legajo = legajoLimpio(String(body.legajo ?? ''))
  const password = String(body.password ?? '')

  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/.test(legajo)) {
    return res.status(400).json({ error: 'Legajo inválido.' })
  }
  const problemaClave = problemaClaveEmpleado(password, legajo)
  if (problemaClave) {
    return res.status(400).json({ error: problemaClave })
  }

  const email = emailDeLegajo(legajo)
  if (!email.endsWith(`@${DOMINIO_LOGIN_EMPLEADO}`)) {
    return res.status(400).json({ error: 'No se pudo derivar el email del legajo.' })
  }

  const empleado = await empleadoPorLegajo(legajo)
  if (!empleado) {
    return res.status(400).json({
      error: `No existe el legajo "${legajo}" en la nómina. Cargalo desde RR. HH. > Empleados primero.`,
    })
  }

  const nombre = String(body.nombre ?? empleado.nombre ?? '').trim() || empleado.nombre || legajo

  if (await legajoOcupado(legajo)) {
    return res.status(409).json({ error: 'Ese legajo ya tiene una cuenta de ingreso.' })
  }

  // --- 1. Crear la cuenta en Supabase Auth (ya confirmada: no se manda mail) ---
  let uid: string
  try {
    const resCrear = await fetch(`${cfg.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { ...serviceHeadersMap, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre, legajo, origen: 'ingreso-empleado' },
      }),
    })
    const data = (await resCrear.json().catch(() => ({}))) as {
      id?: string
      error?: string | { msg?: string }
      message?: string
      error_description?: string
    }
    if (!resCrear.ok || !data.id) {
      const detalle =
        data.message ?? data.error_description ??
        (typeof data.error === 'string' ? data.error : data.error?.msg) ??
        `HTTP ${resCrear.status}`
      return res.status(502).json({ error: `No se pudo crear la cuenta: ${detalle}` })
    }
    uid = data.id
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'No se pudo crear la cuenta.' })
  }

  // --- 2. Perfil en public.usuarios (legajo + aprobado + rol empleado) ---
  const perfil = {
    id: uid,
    email,
    nombre,
    legajo,
    rol: 'empleado',
    estado: 'aprobado',
  }

  try {
    const resPatch = await fetch(`${cfg.url}/rest/v1/usuarios?id=eq.${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: { ...serviceHeadersMap, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(perfil),
    })
    const filas = resPatch.ok ? ((await resPatch.json().catch(() => [])) as unknown[]) : null
    // Lo normal: el trigger de alta (handle_new_user) ya creó la fila y el PATCH la actualizó.
    // OJO: NO se corta acá; falta el paso 3 (rol). Antes se hacía `return` y el empleado quedaba sin rol.
    const actualizado = resPatch.ok && Array.isArray(filas) && filas.length > 0

    if (!actualizado) {
      // No existía la fila (no hay trigger de alta): la creamos.
      const resInsert = await fetch(`${cfg.url}/rest/v1/usuarios`, {
        method: 'POST',
        headers: { ...serviceHeadersMap, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(perfil),
      })
      if (!resInsert.ok) {
        const detalle = (await resInsert.text().catch(() => '')).slice(0, 300)
        return res.status(502).json({
          error: `La cuenta de login se creó (${email}) pero no se pudo guardar el perfil en public.usuarios.`,
          detalle,
        })
      }
    }
  } catch (e) {
    return res.status(502).json({
      error: `La cuenta de login se creó (${email}) pero falló el perfil: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // --- 3. Rol base "empleado" (ON CONFLICT DO NOTHING): le da la pantalla "Mi repo" ---
  let avisoRol: string | null = null
  try {
    const resRol = await fetch(`${cfg.url}/rest/v1/usuario_roles`, {
      method: 'POST',
      headers: {
        ...serviceHeadersMap,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ usuario_id: uid, rol_codigo: 'empleado' }),
    })
    if (!resRol.ok) avisoRol = `HTTP ${resRol.status}: ${(await resRol.text().catch(() => '')).slice(0, 200)}`
  } catch (e) {
    avisoRol = e instanceof Error ? e.message : String(e)
  }

  // La cuenta ya existe: no se devuelve error, pero se avisa para asignar el rol a mano.
  return ok(res, uid, email, avisoRol ? `La cuenta se creó pero no se pudo asignar el rol "empleado" (${avisoRol}). Asignalo desde Permisos.` : null)
}

function ok(res: Res, uid: string, email: string, aviso: string | null = null) {
  return res.status(200).json({ ok: true, uid, email, aviso })
}
