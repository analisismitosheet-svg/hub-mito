# Deploy del Hub Mito (GitHub → Vercel)

El repo local ya está inicializado y con el commit inicial. El `.env` NO se sube
(está en `.gitignore`), así que las claves se cargan aparte en Vercel.

## 1. Subir a GitHub

Creá un repo vacío en GitHub (ej. `hub-mito`, sin README ni .gitignore) y luego,
parado en `D:\pwa mito`:

```bash
git remote add origin https://github.com/TU-USUARIO/hub-mito.git
git push -u origin main
```

## 2. Importar en Vercel

1. Vercel → **Add New… → Project → Import** el repo `hub-mito`.
2. Framework: **Vite** (lo detecta solo). Build: `npm run build`. Output: `dist`.
3. Antes de **Deploy**, cargá las Environment Variables (todas empiezan con `VITE_`):

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://qwlugajzxrrwckrqlrjp.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_PNZsrMzU0oX_4ZW-x4VLRg_iZtMyWBx` |
| `VITE_URL_TRANSPORTE` | *(URL de la PWA de transporte, o vacío)* |
| `VITE_URL_CONTROL_LOCALES` | *(URL de la PWA de control-locales, o vacío)* |

4. **Deploy**. Cada `git push` a `main` vuelve a desplegar solo.

## 3. Después del deploy

- En Supabase → hub-mito → **Authentication → URL Configuration**, agregá la URL
  de Vercel (ej. `https://hub-mito.vercel.app`) a los *Redirect URLs* / *Site URL*.
- Creá tu usuario admin (Authentication → Add user) y avisá para promoverlo.

> Nota: las variables `VITE_` se incrustan en el build. Si cambiás una, hay que
> volver a desplegar (Vercel → Redeploy) para que tome efecto.
