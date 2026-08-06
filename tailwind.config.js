/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Soft UI Evolution — sistema elegido con ui-ux-pro-max
      // (hub interno multi-área, teal de confianza + naranja de acción)
      colors: {
        // brand = teal (reemplaza el índigo genérico; mantiene el nombre
        // para que las referencias brand-* existentes migren solas)
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        accent: {
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
          700: '#C2410C',
        },
        ink: '#134E4A',
        paper: '#F0FDFA',
      },
      fontFamily: {
        sans: ['Open Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // sombras suaves (Soft UI): más suaves que flat, más claras que neumorfismo
        soft: '0 1px 2px rgba(19,78,74,0.04), 0 4px 16px rgba(19,78,74,0.06)',
        'soft-lg': '0 2px 6px rgba(19,78,74,0.06), 0 14px 36px rgba(19,78,74,0.12)',
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
