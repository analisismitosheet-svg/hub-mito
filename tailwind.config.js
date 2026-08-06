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
        paper: '#0a0a0a', // fondo de página
        surface: '#161616', // tarjetas
        surface2: '#1f1f1f', // elevado / hover
        line: '#262626', // borde
        line2: '#333333', // borde hover
        ink: '#f4f4f5', // texto principal
        sub: '#a1a1aa', // texto secundario
      },
      fontFamily: {
        sans: ['Open Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.5)',
        'soft-lg': '0 2px 6px rgba(0,0,0,0.5), 0 18px 42px rgba(0,0,0,0.6)',
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
