"""Lee '10 - Horarios OCTUBRE 2026.xlsx' y arma la carga horaria día por día.

Uso: python leer_horarios.py <xlsx> <emps.json> <salida.json>
"""
import datetime as dt
import json
import re
import sys
import unicodedata

import openpyxl

XLSX, EMPS, SALIDA = sys.argv[1], sys.argv[2], sys.argv[3]
ANIO = 2026
INI, FIN = dt.date(2026, 9, 28), dt.date(2026, 11, 1)  # semanas completas de octubre
SALTEAR = {'Modelo Personal', 'Modelo Cobertura', 'Hoja1'}


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Z ]', ' ', s.upper()).split()


def fecha(d, m):
    return dt.date(ANIO, int(m), int(d))


def periodo(tit):
    """(desde, hasta, clase): clase base | temporal | dudoso"""
    t = tit.upper()
    m = re.search(r'FERIADO\s+(\d{1,2})/(\d{1,2})', t)
    if m:
        f = fecha(*m.groups())
        return f, f, 'temporal'
    m = re.search(r'(\d{1,2})(?:/(\d{1,2}))?\s*AL\s*(\d{1,2})/(\d{1,2})', t)
    if m:
        d1, m1, d2, m2 = m.groups()
        return fecha(d1, m1 or m2), fecha(d2, m2), 'temporal'
    m = re.search(r'(\d{1,2})/(\d{1,2})', t)
    if m:
        f = fecha(*m.groups())
        if not (INI - dt.timedelta(days=14) <= f <= FIN):
            return f, None, 'dudoso'
        return f, None, 'base'
    if re.search(r'VACACIONES|CARPETA|LICENCIA', t):
        return None, None, 'dudoso'
    return INI, None, 'base'


def hhmm(v):
    if isinstance(v, dt.time):
        return f'{v.hour:02d}:{v.minute:02d}'
    if isinstance(v, dt.datetime):
        return f'{v.hour:02d}:{v.minute:02d}'
    return None


wb = openpyxl.load_workbook(XLSX, data_only=True)
bloques = []
for ws in wb.worksheets:
    if ws.title in SALTEAR:
        continue
    filas = list(ws.iter_rows(values_only=True))
    for i, r in enumerate(filas):
        if not any(isinstance(v, str) and v.strip().upper() == 'LUNES' for v in r):
            continue
        col0 = next(j for j, v in enumerate(r) if isinstance(v, str) and v.strip().upper() == 'LUNES')
        tit = next((v for v in filas[i - 1] if isinstance(v, str) and v.strip()), '')
        desde, hasta, clase = periodo(tit)
        personas = []
        j = i + 1
        while j < len(filas):
            f = filas[j]
            nombre = f[col0 - 1] if col0 >= 1 else None
            if isinstance(nombre, str) and nombre.strip():
                if nombre.strip().upper() == 'LUNES':
                    break
                dias = []
                for d in range(7):
                    e, s = f[col0 + d * 2], f[col0 + d * 2 + 1]
                    he, hs = hhmm(e), hhmm(s)
                    if he and hs:
                        dias.append({'ent': he, 'sal': hs})
                    elif isinstance(e, str) and e.strip():
                        dias.append({'txt': e.strip()})
                    else:
                        dias.append(None)
                tipo = f[col0 - 2] if col0 >= 2 else None
                personas.append({'tipo': (str(tipo).strip() if tipo else ''), 'nombre': nombre.strip(), 'dias': dias})
                j += 2
                # turno cortado: fila sin nombre con horarios (+ su fila de horas) debajo de la persona
                while j < len(filas):
                    g = filas[j]
                    sin_nombre = not (isinstance(g[col0 - 1], str) and g[col0 - 1].strip())
                    pares = [(hhmm(g[col0 + d * 2]), hhmm(g[col0 + d * 2 + 1])) for d in range(7)]
                    if not sin_nombre or not any(a and b for a, b in pares) or isinstance(g[col0 + 1], (int, float)):
                        break
                    for d, (a, b) in enumerate(pares):
                        if a and b:
                            if dias[d] and 'ent' in dias[d]:
                                dias[d].update({'ent2': a, 'sal2': b})
                            else:
                                dias[d] = {'ent': a, 'sal': b}
                    j += 2
                continue
            # fin del bloque: fila de cobertura (hora + número) o fila vacía larga
            if hhmm(f[col0]) and isinstance(f[col0 + 1], (int, float)):
                break
            if all(v in (None, '') for v in f[:col0 + 14]) and j > i + 3 and all(v in (None, '') for v in (filas[j + 1] if j + 1 < len(filas) else [])[:col0 + 14]):
                break
            j += 1
        bloques.append({'hoja': ws.title, 'fila': i, 'titulo': tit.strip(), 'desde': desde and desde.isoformat(),
                        'hasta': hasta and hasta.isoformat(), 'clase': clase, 'personas': personas})

# ---------------- cruce con legajos ----------------
emps = json.load(open(EMPS, encoding='utf-8'))
for e in emps:
    e['tok'] = norm(e['nombre'])
    e['activo'] = (e['estado_legajo'] or 'NOMINA ACTIVA') in ('NOMINA ACTIVA', 'PLANES ACTIVOS')
    lug = (e['lugar'] or '').strip().upper()
    e['local'] = lug if lug and lug != 'LOCALES' else (e['area_sector'] or 'SIN LOCAL').strip().upper()


def puntaje(tok_hoja, tok_emp):
    exactos = sum(1 for t in tok_hoja if len(t) >= 3 and t in tok_emp)
    prefijos = sum(1 for t in tok_hoja if t not in tok_emp and len(t) >= 3 and any(x.startswith(t) or (len(x) >= 4 and t.startswith(x[:4])) for x in tok_emp))
    return exactos, prefijos


def buscar(nombre):
    tok = norm(nombre)
    cand = []
    for e in emps:
        ex, pr = puntaje(tok, e['tok'])
        if ex == 0:
            continue
        cand.append((ex * 2 + pr + (0.5 if e['activo'] else 0), ex, pr, e))
    if not cand:
        return None, []
    cand.sort(key=lambda c: -c[0])
    mejor = cand[0]
    empatados = [c for c in cand if c[0] == mejor[0]]
    # con un solo token exacto y sin nombre que coincida, solo si es único
    if len(empatados) > 1:
        return None, [c[3]['nombre'] for c in empatados[:4]]
    if mejor[1] + mejor[2] < min(2, len([t for t in tok if len(t) >= 3])):
        return None, [mejor[3]['nombre']]
    return mejor[3], []


nombres = {}
for b in bloques:
    for p in b['personas']:
        if p['nombre'] not in nombres:
            e, dudas = buscar(p['nombre'])
            nombres[p['nombre']] = {'legajo': e and e['legajo'], 'nombre_hub': e and e['nombre'], 'local': e and e['local'],
                                    'activo': e and e['activo'], 'dudas': dudas}

json.dump({'bloques': bloques, 'nombres': nombres}, open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
sin = {k: v for k, v in nombres.items() if not v['legajo']}
print('bloques', len(bloques), 'personas', len(nombres), 'sin legajo', len(sin))
for b in bloques:
    print(f"  {b['hoja']:<11} {b['clase']:<8} {b['desde']} -> {b['hasta']}  {len(b['personas'])} p.  | {b['titulo'][:70]}")
print('\nSIN LEGAJO:')
for k, v in sin.items():
    print('  ', k, '-> dudas:', v['dudas'])
print('\nCRUCES:')
for k, v in nombres.items():
    if v['legajo']:
        print(f"   {k:<28} -> {v['legajo']:<6} {v['nombre_hub']:<40} {v['local']}{'' if v['activo'] else '  (BAJA)'}")
