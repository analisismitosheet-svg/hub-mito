# scripts/assets

## Geist-Regular.ttf

Fuente **Geist** (Regular), creada por Vercel, usada para dibujar los informes en
formato imagen (PNG). Licencia **SIL Open Font License 1.1**:
https://github.com/vercel/geist-font/blob/main/LICENSE.txt

Se embebe en `src/lib/informeFuente.ts` (base64) con:

```bash
node scripts/gen-font-base64.mjs
```

El `.ttf` queda acá solo como respaldo para poder regenerar el base64.
