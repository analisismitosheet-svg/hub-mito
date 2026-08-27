-- ============================================================
-- RENOVAR PERMISOS: asegura que existan todos los permisos usados
-- por la app (áreas, módulos mayorista y resto).
-- Ejecutar en Supabase SQL Editor. Idempotente (ON CONFLICT DO NOTHING).
-- ============================================================

-- ---- Permisos de acceso a ÁREAS (menú principal) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('area_administracion.view', 'administracion', 'view',  'Área Administración', 10),
  ('area_tesoreria.view',      'tesoreria',      'view',  'Área Tesorería',       20),
  ('area_rrhh.view',           'rrhh',           'view',  'Área RR.HH.',          30),
  ('area_mayorista.view',      'mayorista',      'view',  'Área Mayorista',       40),
  ('area_marketing.view',      'marketing',      'view',  'Área Marketing',       50),
  ('area_compras.view',        'compras',        'view',  'Área Compras',         60),
  ('area_sistemas.view',       'sistemas',       'view',  'Área Sistemas',        70),
  ('area_locales.view',        'locales',        'view',  'Área Locales',         80),
  ('area_diseno.view',         'diseno',         'view',  'Área Diseño',          90),
  ('area_deposito.view',       'deposito',       'view',  'Área Depósito',       100),
  ('area_polo52.view',         'polo52',         'view',  'Área Polo 52',        110),
  ('area_arquitectura.view',   'arquitectura',   'view',  'Área Arquitectura',   120),
  ('area_recepcion.view',      'recepcion',      'view',  'Área Recepción',      130),
  ('area_mantenimiento.view',  'mantenimiento',  'view',  'Área Mantenimiento',  140)
ON CONFLICT (clave) DO NOTHING;

-- ---- Cuenta Amigos (Tesorería) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('cuentas_amigos.view',   'tesoreria', 'view',   'Ver Cuentas Amigos', 200),
  ('cuentas_amigos.create', 'tesoreria', 'create', 'Crear Cuentas Amigos', 201),
  ('cuentas_amigos.edit',   'tesoreria', 'edit',   'Editar Cuentas Amigos', 202)
ON CONFLICT (clave) DO NOTHING;

-- ---- Manuales y Documentos (Locales) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('manuales.view',    'locales', 'view',   'Ver manuales',    300),
  ('manuales.create',  'locales', 'create', 'Crear manuales',  301),
  ('manuales.edit',    'locales', 'edit',   'Editar manuales', 302),
  ('manuales.delete',  'locales', 'delete', 'Eliminar manuales', 303),
  ('documentos.view',  'locales', 'view',   'Ver documentos',  310),
  ('documentos.create','locales', 'create', 'Crear documentos', 311),
  ('documentos.edit',  'locales', 'edit',   'Editar documentos', 312),
  ('documentos.delete','locales', 'delete', 'Eliminar documentos', 313)
ON CONFLICT (clave) DO NOTHING;

-- ---- Transferencias (Compras) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('transferencias.view',     'compras', 'view',     'Ver transferencias',    400),
  ('transferencias.import',   'compras', 'import',   'Importar transferencias', 401),
  ('transferencias.ver_todo', 'compras', 'ver_todo', 'Ver todas las transferencias', 402)
ON CONFLICT (clave) DO NOTHING;

-- ---- Mayorista (área) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.view',   'mayorista', 'view',   'Ver Mayorista',       500),
  ('mayorista.import', 'mayorista', 'import', 'Importar (Mayorista)', 501),
  ('mayorista.mark',   'mayorista', 'mark',   'Marcar (Mayorista)',   502)
ON CONFLICT (clave) DO NOTHING;

-- ---- Mayorista: Transportes ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.transportes.view',   'mayorista', 'transportes.view',   'Ver transportes',    600),
  ('mayorista.transportes.create', 'mayorista', 'transportes.create', 'Crear transportes',  601),
  ('mayorista.transportes.edit',   'mayorista', 'transportes.edit',   'Editar transportes', 602),
  ('mayorista.transportes.delete', 'mayorista', 'transportes.delete', 'Eliminar transportes', 603)
ON CONFLICT (clave) DO NOTHING;

-- ---- Mayorista: Clientes ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.clientes.view',   'mayorista', 'clientes.view',   'Ver clientes',    700),
  ('mayorista.clientes.create', 'mayorista', 'clientes.create', 'Crear clientes',  701),
  ('mayorista.clientes.edit',   'mayorista', 'clientes.edit',   'Editar clientes', 702),
  ('mayorista.clientes.delete', 'mayorista', 'clientes.delete', 'Eliminar clientes', 703)
ON CONFLICT (clave) DO NOTHING;

-- ---- Mayorista: Facturación Fábrica ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.facturacion.view',   'mayorista', 'facturacion.view',   'Ver facturación',    710),
  ('mayorista.facturacion.create', 'mayorista', 'facturacion.create', 'Crear facturación',  711),
  ('mayorista.facturacion.edit',   'mayorista', 'facturacion.edit',   'Editar facturación', 712),
  ('mayorista.facturacion.delete', 'mayorista', 'facturacion.delete', 'Eliminar facturación', 713)
ON CONFLICT (clave) DO NOTHING;

-- ---- Mayorista: Guías ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.guias.view',   'mayorista', 'guias.view',   'Ver guías',    720),
  ('mayorista.guias.create', 'mayorista', 'guias.create', 'Crear guías',  721),
  ('mayorista.guias.edit',   'mayorista', 'guias.edit',   'Editar guías', 722),
  ('mayorista.guias.delete', 'mayorista', 'guias.delete', 'Eliminar guías', 723)
ON CONFLICT (clave) DO NOTHING;

-- ---- Depósito ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('deposito.view',   'deposito', 'view',   'Ver depósito',        810),
  ('deposito.import', 'deposito', 'import', 'Importar (Depósito)', 811),
  ('deposito.mark',   'deposito', 'mark',   'Marcar (Depósito)',   812)
ON CONFLICT (clave) DO NOTHING;

-- ---- Opiniones (Locales) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('opiniones.view',   'locales', 'view',   'Ver opiniones',    820),
  ('opiniones.borrar', 'locales', 'borrar', 'Borrar opiniones', 821)
ON CONFLICT (clave) DO NOTHING;

-- ---- Marketing ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('encuestas.gestionar', 'marketing', 'gestionar', 'Gestionar encuestas', 830),
  ('banner.editar',       'marketing', 'editar',    'Editar banner',       831)
ON CONFLICT (clave) DO NOTHING;

-- ---- Locales / QR ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('sectores.gestionar', 'locales', 'gestionar', 'Gestionar sectores QR', 840),
  ('qr.regenerar',       'locales', 'regenerar', 'Regenerar QR',          841)
ON CONFLICT (clave) DO NOTHING;

-- ---- Datos SQL (Sistemas) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('datos_sql.view', 'sistemas', 'view', 'Ver datos SQL', 850)
ON CONFLICT (clave) DO NOTHING;
