import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Tema = 'dark' | 'light'

interface ThemeState {
  tema: Tema
  toggle: () => void
}

const ThemeContext = createContext<ThemeState>({ tema: 'dark', toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() => {
    if (typeof window === 'undefined') return 'dark'
    const guardado = localStorage.getItem('hub_tema')
    return guardado === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    if (tema === 'light') root.classList.add('light')
    else root.classList.remove('light')
    localStorage.setItem('hub_tema', tema)
  }, [tema])

  const toggle = useCallback(() => setTema((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return <ThemeContext.Provider value={{ tema, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}