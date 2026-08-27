# Migración RBAC — Polo52 / Mayorista / Facturación

Profesionaliza el sistema de permisos de la PWA hacia un modelo **RBAC + Scopes + RLS**
apoyado en el stack real del proyecto: **React + TypeScript + Supabase (Postgres + RLS +
PostgREST)**. No existe un backend Express/Laravel: la capa "no-bypasseable" es **Postgres RLS**.

---

## Arquitectura objetivo (reglas de negocio)

| Regla | Mayorista | Polo52 | Dónde se impone |
|-------|-----------|--------|-----------------|
| **A. Visibilidad** | Ve TODO (`scope=all`, sin filtro) | Ve `polo = 'A POLO52' OR created_by = <yo>` (`scope=own`) | **RLS** (`SELECT`) |
| **B. Creación** | `polo` puede quedar NULL o elegir local | Backend **fuerza** `polo='A POLO52'` y `created_by=auth.uid()` | **RLS** (`INSERT`) |
| **C. Editar/Eliminar/Marcar** | Cualquier fila | Solo filas donde `created_by=<yo>` (idem Regla A). Otras -> 403 | **RLS** (`UPDATE`/`DELETE`) |
| **D. Panel permisos** | Matriz Módulos × Acciones (sin nombres duplicados) | — | **UI** (`Roles.tsx`) |

---

## Archivos entregados

```
sql/rbac_schema.sql                 # 1/2 esquema: catálogo normalizado + columnas polo/created_by + helpers
sql/rbac_policies_facturacion.sql   # 2/2 policies RLS (Reglas A, B, C)
src/components/Can.tsx               # componente declarativo de autorización
src/lib/rbac.ts                      # detección de "no autorizado" (403 / RLS 42501)
src/context/AuthContext.tsx          # (ya existente) can() + useCan + perfil + permisos al login
src/pages/FacturacionFabrica.tsx     # created_by + polo en alta; POLO x rol
src/pages/Roles.tsx                  # matriz módulos×acciones, deduplicada
MIGRACION_RBAC.md                    # este documento
```

---

## Paso a paso (checklist de despliegue seguro)

### Etapa 1 — Backup (SIEMPRE primero)
1. En Supabase → **Database → Backups** → descarga un backup del esquema actual.
2. O capturá las tabs SQL existentes en `sql/` (que ya son el snapshot).

### Etapa 2 — Aplicar migraciones SQL (en este orden)
3. Ejecutar `sql/renovar_permisos.sql` (asegura la tabla `permisos` con las claves actuales).
4. Ejecutar `sql/rbac_schema.sql` (crea `permission_catalog`, agrega `polo` + `created_by`
   a `facturacion_fabrica`, backfill de `polo='A POLO52'`, define helpers `app_roles()` /
   `app_es_mayorista()` / `app_es_polo52()`).
5. Ejecutar `sql/rbac_policies_facturacion.sql` (habilita RLS y crea las policies).
   > ⚠️ Esta es la parte que "apaga" la lectura total para usuarios sin permisos. Probalo
   > en una fila de prueba antes.

### Etapa 3 — Verificar RLS (Reglas A/B/C)
6. Con una cuenta **Mayorista**: `GET /rest/v1/facturacion_fabrica` debe devolver TODAS las filas.
7. Con una cuenta **Polo52**: debe devolver solo `polo='A POLO52'` o `created_by=<uid>`.
8. Polo52 intentando `PATCH` una fila ajena debe recibir **HTTP 403**.
9. Polo52 `INSERT` con `polo <> 'A POLO52'` debe ser **rechazado**.

### Etapa 4 — Frontend
10. `npm run build` (verificar). Luego deploy del bundle (Vercel).
11. El login ya carga perfil + permisos vía `mi_perfil()`/`mis_permisos()`. Usar `can()`,
    `useCan()` y `<Can>` en los botones.

---

## Cómo sigue usando la app sin romper

- La tabla `permisos` original y el RPC `mis_permisos()` siguen funcionando -> **BC**.
- La columna booleana `polo52` se conserva; la nueva columna `polo`/`created_by` la
  complementa para RLS.

---

## Pendientes / recomendaciones

- El formulario de Facturación aún tiene un branch restringido para `modoPolo52`
  (solo F.Envio/QuienRetira). Para abolir ese branch y permitir edición completa con
  RLS, quitar el retorno temprano en `handleSubmit` cuando `modoPolo52` (RLS ya protege).
- Migrar el resto de recursos (transportes, clientes, guías, mayorista/depósito) a
  policies RLS por `created_by` cuando apliquen scopes `own`.
