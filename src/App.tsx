import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Menu from '@/pages/Menu'
import Area from '@/pages/Area'
import CuentaAmigos from '@/pages/CuentaAmigos'
import ComingSoon from '@/pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Menu />
              </ProtectedRoute>
            }
          />
          <Route
            path="/area/:areaId"
            element={
              <ProtectedRoute>
                <Area />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cuenta-amigos"
            element={
              <ProtectedRoute>
                <CuentaAmigos />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repo-diaria"
            element={
              <ProtectedRoute>
                <ComingSoon title="Repo Diaria" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replicas"
            element={
              <ProtectedRoute>
                <ComingSoon title="Réplicas" />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <ComingSoon title="Página no encontrada" />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
