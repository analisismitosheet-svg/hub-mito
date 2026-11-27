"""Expande horarios.json a filas legajo + fecha para rrhh_carga_horaria y genera el SQL.

Uso: python expandir.py <horarios.json> <emps.json> <salida.sql> <informe.txt>
"""
import datetime as dt
import json
import re
import sys
import unicodedata

H, EMPS, SQL, INF = sys.argv[1:5]
INI, FIN = dt.date(2026, 9, 28), dt.date(2026, 11, 1)
d = json.load(open(H, encoding='utf-8'))
ACT = ('NOMINA ACTIVA', 'PLANES ACTIVOS')
emps = {}
for e in json.load(open(EMPS, encoding='utf-8')):  # legajos repetidos entre nómina y bajas: gana el activo
    if e['legajo'] not in emps or (e['estado_legajo'] or 'NOMINA ACTIVA') in ACT:
        emps[e['legajo']] = e

# Apodos que el cruce automático dejó en duda (revisados a mano)
MANUAL = {
    'MERY ACOSTA': 'ACOSTA MARIA NOEL', 'AIMI OLMOS': 'OLMOS AIMARA', 'MILI GRASSI': 'GRASSI ARAYA MILAGROS',
    'PEPA LAZCANO       caja': 'LAZCANO RISSO PATRON LOURDES', 'ALE MALDONADO': 'MALDONADO ALEJANDRO',
    'LAURA AREGUI': 'ARREGUI LAURA VALENTINA', 'TOMI ROLDAN': 'ROLDAN TOMAS ALEJANDRO',
    'ANITA SOMMAVILLA - caja': 'SOMMAVILLA ANA', 'ANITA IRRAZABAL': 'IRRAZABAL ROMAN ANA CLARA',
    'LIU QUIROGA': 'QUIROGA TALAN FLORENCIA AGUSTINA', 'PATICIO GALLARDO': 'GALLARDO PATRICIO ARIEL',
    'COTI ACQUARO': 'ACQUARO CONSTANZA ARIADNA', 'MILI SANCHEZ': 'PASTRANA SANCHEZ MILAGROS',
}
por_nombre = {e['nombre']: e for e in emps.values()}
for k, v in MANUAL.items():
    e = por_nombre[v]
    d['nombres'][k].update({'legajo': e['legajo'], 'nombre_hub': e['nombre']})


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Z ]', ' ', s.upper()).split()


def local_emp(e):
    lug = (e['lugar'] or '').strip().upper()
    return lug if lug and lug != 'LOCALES' else (e['area_sector'] or 'SIN LOCAL').strip().upper()


def dia_valor(x):
    """→ ('trabajo', ent, sal) | None"""
    if not x:
        return None
    if 'ent' in x:
        tr = [(x['ent'], x['sal'])] + ([(x['ent2'], x['sal2'])] if x.get('ent2') else [])
        return ('trabajo', tuple(tr))
    m = re.match(r'^(\d{1,2})(?::(\d{2}))?\s*a\s*(\d{1,2})(?::(\d{2}))?$', x['txt'].strip().lower())
    if m:
        h1, m1, h2, m2 = m.groups()
        return ('trabajo', ((f'{int(h1):02d}:{m1 or "00"}', f'{int(h2):02d}:{m2 or "00"}'),))
    return None


avisos = []
# Bloques que no se pueden fechar
for b in d['bloques']:
    if b['hoja'] == 'MAX':
        b['clase'] = 'saltear'
    elif b['hoja'] == '9 DE JULIO' and b['clase'] == 'dudoso':
        b.update({'desde': '2026-10-05', 'hasta': '2026-10-11', 'clase': 'temporal'})
        avisos.append('9 DE JULIO «desde 05/11 (vacaciones Jere Rios)»: tomado como del 05/10 al 11/10 (en noviembre no tiene sentido en la planilla de octubre).')
# CF RIO IV: dos bloques sin fecha; el segundo (sin Ivana) no dice desde cuándo
vistos = set()
for b in d['bloques']:
    if b['clase'] == 'base' and b['hoja'] == 'CFR4':
        if 'CFR4' in vistos:
            b['clase'] = 'saltear'
            avisos.append('CF RIO IV: hay un segundo horario sin fecha (sin Ivana Tuninetti); se usó solo el primero.')
        vistos.add('CFR4')
avisos.append('MARIANO MAX: no se cargó (no tiene empleados en la nómina del hub y los bloques de vacaciones no tienen fecha).')

dias = [INI + dt.timedelta(days=i) for i in range((FIN - INI).days + 1)]
# candidatos[(legajo, fecha)] = lista de (prioridad, valor, hoja, titulo)
cand = {}


def poner(leg, f, prio, val, b):
    cand.setdefault((leg, f), []).append((prio, val, b['hoja'], b['titulo']))


for hoja in sorted({b['hoja'] for b in d['bloques']}):
    bs = [b for b in d['bloques'] if b['hoja'] == hoja and b['clase'] in ('base', 'temporal')]
    bases = sorted([b for b in bs if b['clase'] == 'base'], key=lambda b: b['desde'])
    temps = [b for b in bs if b['clase'] == 'temporal']
    for f in dias:
        fi = f.isoformat()
        # base vigente: por cada grupo de personas, el último «desde» <= f (WEB va aparte de 9 DE JULIO)
        vigentes = []
        for b in bases:
            if b['desde'] > fi:
                continue
            nombres = {p['nombre'] for p in b['personas']}
            vigentes = [v for v in vigentes if len(nombres & {p['nombre'] for p in v['personas']}) * 2 < len(nombres)]
            vigentes.append(b)
        temp_hoy = [t for t in temps if t['desde'] <= fi <= t['hasta']]
        tapados = set()
        for t in temp_hoy:
            tit = set(norm(t['titulo']))
            # personas de la base que tapa este bloque temporal (mismo grupo)
            for v in vigentes:
                if len({p['nombre'] for p in v['personas']} & {p['nombre'] for p in t['personas']}) * 2 >= min(len(v['personas']), len(t['personas'])):
                    tapados.add(id(v))
                    en_temp = {p['nombre'] for p in t['personas']}
                    for p in v['personas']:
                        if p['nombre'] in en_temp:
                            continue
                        leg = d['nombres'][p['nombre']]['legajo']
                        if not leg:
                            continue
                        claves = {x for x in norm(p['nombre']) if len(x) >= 4 and x not in ('CAJA',)}
                        if claves & tit and 'VACACIONES' in tit:
                            poner(leg, fi, 3, ('vacaciones',), t)
                        elif claves & tit and ('CARPETA' in tit or 'MEDICA' in tit):
                            poner(leg, fi, 3, ('licencia',), t)
                        else:
                            poner(leg, fi, 3, None, t)  # no figura esa semana: franco
            dw = f.weekday()
            tit = set(norm(t['titulo']))
            for p in t['personas']:
                leg = d['nombres'][p['nombre']]['legajo']
                if not leg:
                    continue
                val = dia_valor(p['dias'][dw])
                if val is None and all(x is None for x in p['dias']):
                    claves = {x for x in norm(p['nombre']) if len(x) >= 4}
                    if claves & tit and 'VACACIONES' in tit:
                        val = ('vacaciones',)
                    elif claves & tit and ('CARPETA' in tit or 'MEDICA' in tit):
                        val = ('licencia',)
                poner(leg, fi, 3, val, t)
        for v in vigentes:
            prio = 1 if id(v) in tapados else 2
            if prio == 1:
                continue
            for p in v['personas']:
                leg = d['nombres'][p['nombre']]['legajo']
                if leg:
                    poner(leg, fi, 2, dia_valor(p['dias'][f.weekday()]), v)

filas, choques = [], []
for (leg, f), cs in sorted(cand.items()):
    top = max(c[0] for c in cs)
    cs = [c for c in cs if c[0] == top]
    con = [c for c in cs if c[1] is not None]
    if len({c[1] for c in con}) > 1:
        # la persona figura en dos locales el mismo día: gana el de su local en el hub
        loc = local_emp(emps[leg])
        propio = [c for c in con if norm(c[2]) == norm(loc) or norm(c[3])[:2] == norm(loc)[:2]]
        elegido = propio[0] if propio else con[0]
        choques.append(f'{leg} {emps[leg]["nombre"]} {f}: ' + ' | '.join(f'{c[2]}: {c[1]}' for c in con) + f'  → {elegido[2]}')
        val = elegido[1]
    else:
        val = con[0][1] if con else None
    if val is None:
        continue
    e = emps[leg]
    if val[0] == 'trabajo':
        tot = 0
        for ent, sal in val[1]:
            mins = (int(sal[:2]) * 60 + int(sal[3:])) - (int(ent[:2]) * 60 + int(ent[3:]))
            tot += mins + (1440 if mins <= 0 else 0)
        filas.append((leg, f, local_emp(e), ' '.join(f'{a}-{b}' for a, b in val[1]), round(tot / 60, 2), 'trabajo'))
    else:
        filas.append((leg, f, local_emp(e), None, 0, val[0]))

q = lambda s: 'null' if s is None else "'" + str(s).replace("'", "''") + "'"
with open(SQL, 'w', encoding='utf-8') as o:
    o.write('-- Importación de «10 - Horarios OCTUBRE 2026.xlsx» (28/09 al 01/11/2026)\n')
    o.write("delete from public.rrhh_carga_horaria where fecha between '2026-09-28' and '2026-11-01';\n")
    for i in range(0, len(filas), 400):
        o.write('insert into public.rrhh_carga_horaria (legajo, fecha, local, horario, horas, tipo) values\n')
        o.write(',\n'.join(f'({q(a)},{q(b)},{q(c)},{q(h)},{n},{q(t)})' for a, b, c, h, n, t in filas[i:i + 400]))
        o.write('\non conflict (legajo, fecha) do update set local = excluded.local, horario = excluded.horario, horas = excluded.horas, tipo = excluded.tipo, actualizado_at = now();\n')

sin = [k for k, v in d['nombres'].items() if not v['legajo']]
with open(INF, 'w', encoding='utf-8') as o:
    o.write(f'filas: {len(filas)}  (trabajo {sum(1 for f in filas if f[5] == "trabajo")}, vacaciones {sum(1 for f in filas if f[5] == "vacaciones")}, licencia {sum(1 for f in filas if f[5] == "licencia")})\n')
    o.write(f'personas: {len({f[0] for f in filas})}\n\nAVISOS:\n' + '\n'.join(avisos) + '\n\nSIN LEGAJO: ' + ', '.join(sin) + '\n\nCHOQUES:\n' + '\n'.join(choques) + '\n')
print(open(INF, encoding='utf-8').read())
