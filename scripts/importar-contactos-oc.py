"""
Completa contacto, teléfono y mail de las OC importadas desde la planilla «Alta Órdenes de Compras Mito»
(hoja «Planilla de OC», columnas M-O). La importación original no los copiaba; el formulario de la OC
los usa para autocompletar el proveedor desde el historial (06/11/2026).

  python -I scripts/importar-contactos-oc.py "D:/Descargas/Alta Órdenes de Compras Mito.xlsx" sql/ordenes_compra_import_contactos.sql
  node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_import_contactos.sql

Solo toca OC con importada = true y solo los campos vacíos (lo cargado en el hub no se pisa). Idempotente.
"""
import sys
import warnings

import openpyxl

warnings.filterwarnings('ignore')
origen, destino = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(origen, read_only=True)['Planilla de OC']


def txt(v):
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    t = ' '.join(str(v).split())
    return t or None


def lit(v):
    return 'null' if v is None else "'" + v.replace("'", "''") + "'"


filas = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if not isinstance(row[0], (int, float)):
        continue
    contacto, telefono, mail = txt(row[12]), txt(row[13]), txt(row[14])
    if mail and '@' not in mail:
        mail = None
    if contacto or telefono or mail:
        filas.append(f'({int(row[0])}, {lit(contacto)}, {lit(telefono)}, {lit(mail)})')

with open(destino, 'w', encoding='utf-8') as f:
    f.write('-- Generado por scripts/importar-contactos-oc.py: contacto/teléfono/mail de la planilla en las OC importadas.\n')
    f.write('-- Solo campos vacíos de OC importadas. Idempotente.\n')
    f.write('update public.ordenes_compra o\n'
            '   set contacto = coalesce(o.contacto, v.contacto),\n'
            '       telefono = coalesce(o.telefono, v.telefono),\n'
            '       mail = coalesce(o.mail, v.mail)\n'
            '  from (values\n  ' + ',\n  '.join(filas) + '\n'
            ') v(numero, contacto, telefono, mail)\n'
            ' where o.numero = v.numero and o.importada\n'
            '   and (o.contacto is null or o.telefono is null or o.mail is null);\n')
print(f'{len(filas)} OC con datos de contacto -> {destino}')
