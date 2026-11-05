"""
Importa la planilla «Alta Órdenes de Compras Mito» (hoja «Planilla de OC») a public.ordenes_compra.

  python -I scripts/importar-ordenes-compra.py "D:/Descargas/Alta Órdenes de Compras Mito.xlsx" sql/ordenes_compra_import.sql
  node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_import.sql

- Las OC entran con importada = true y los tildes del Excel (por «planilla»; el autorizador con su nombre).
- NO se pide ninguna autorización ni se manda ningún WhatsApp: pedida_at queda vacío.
- Reimportar no pisa lo que ya se tocó en el hub: solo inserta las OC que no existen.
- No se copian contactos/teléfonos/mails (se ven en la OC original si hacen falta).
"""
import datetime
import json
import sys
import warnings

import openpyxl

warnings.filterwarnings('ignore')
origen, destino = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(origen, read_only=True)
ws = wb['Planilla de OC']

TIPOS = {'producto': 'Producto', 'gastos': 'Gastos', 'servicios': 'Servicios', 'talleres': 'Talleres'}
PASOS = [('valid', 16), ('autor', 17), ('env', 19), ('acep', 20), ('f_oc', 22), ('f_rem', 23), ('f_fac', 24)]


def txt(v):
    return str(v).strip() if v is not None else ''


def fecha(v):
    if isinstance(v, (datetime.datetime, datetime.date)) and 2020 <= v.year <= 2030:
        return v.strftime('%Y-%m-%d')
    return None


def si(v):
    return v is True or (isinstance(v, str) and v.strip().upper() in ('TRUE', 'VERDADERO'))


def q(v):
    if v is None or v == '':
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


filas = []
vistos = set()
for r in ws.iter_rows(min_row=2, values_only=True):
    if not isinstance(r[0], (int, float)):
        continue
    n = int(r[0])
    if n in vistos:
        continue
    vistos.add(n)
    f = fecha(r[7])
    at = (f or '2025-01-01') + 'T12:00:00-03:00'
    aut = txt(r[18]).upper()
    if aut in ('-', 'NO AUTORIZADO') or aut.startswith('='):
        aut = ''
    pasos = {}
    for clave, col in PASOS:
        if si(r[col]):
            pasos[clave] = {'por': (aut.title() if clave == 'autor' and aut else 'planilla Excel'), 'at': at, 'via': 'planilla'}
    plan = txt(r[2]).rstrip('.').lower()
    met = txt(r[3]).lower()
    metodo = 'Con anticipo' if met.startswith('con') else 'Compra directa' if met.startswith('compra') else 'Sin anticipo'
    monto = round(r[11], 2) if isinstance(r[11], (int, float)) and abs(r[11]) < 1e13 else None
    cancel = si(r[21])
    link = txt(r[15])
    filas.append('(' + ','.join([
        str(n),
        q(TIPOS.get(txt(r[1]).lower(), 'Gastos')),
        'false' if plan == 'no' else 'true',
        q(metodo),
        q(txt(r[4]).upper() or None),
        q(txt(r[5]) or '(sin proveedor)'),
        q(txt(r[6]) or None),
        q(f), q(fecha(r[8])),
        q(txt(r[9]) or None), q(txt(r[10]) or None),
        'null' if monto is None else str(monto),
        q(link if link.startswith('http') else None),
        q(txt(r[27]) or None),
        q(json.dumps(pasos, ensure_ascii=False)) + '::jsonb',
        (q(at) if cancel else 'null'), q('planilla Excel' if cancel else None), q('Reprobada, cancelada o vencida (planilla)' if cancel else None),
        'true' if si(r[26]) else 'false',
        "'ok'" if si(r[26]) else 'null',
        q(txt(r[4]).title() or 'planilla Excel'),
        q(at),
        'true',
    ]) + ')')

cols = ('numero, tipo, planificable, metodo, responsable, proveedor, observacion, fecha_compra, fecha_entrega, '
        'forma_pago, plazo, monto_bruto, archivo_url, obs_propias, pasos, cancelada_at, cancelada_por, cancelada_motivo, '
        'dragon, dragon_estado, creada_por_nombre, creada_at, importada')
with open(destino, 'w', encoding='utf-8') as out:
    out.write('-- Generado por scripts/importar-ordenes-compra.py: OC de la planilla (no pisa las que ya existen)\n')
    for i in range(0, len(filas), 250):
        out.write(f'insert into public.ordenes_compra ({cols}) values\n')
        out.write(',\n'.join(filas[i:i + 250]))
        out.write('\non conflict (numero) do nothing;\n')
print(len(filas), 'OC ->', destino)
