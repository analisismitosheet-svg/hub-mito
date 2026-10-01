/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Tema oscuro: negro + rojo (acción/marca), íconos con color propio
      colors: {
        // brand = rojo (marca / acciones / foco)
        brand: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#e11d2e',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        accent: {
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        paper: 'var(--paper)', // fondo de página
        surface: 'var(--surface)', // tarjetas
        surface2: 'var(--surface2)', // elevado / hover
        line: 'var(--line)', // borde
        line2: 'var(--line2)', // borde hover
        ink: 'var(--ink)', // texto principal
        sub: 'var(--sub)', // texto secundario
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // sombras por tema (index.css): en claro son mucho más suaves
        soft: 'var(--shadow-soft)',
        'soft-lg': 'var(--shadow-soft-lg)',
        glow: '0 0 0 1px rgba(225,29,46,0.35), 0 10px 34px rgba(225,29,46,0.22)',
      },
      transitionDuration: {
        250: '250ms',
      },
      transitionTimingFunction: {
        'out-strong': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'in-out-strong': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
    },
  },
  plugins: [],
}
