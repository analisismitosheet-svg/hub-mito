import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import PermissionRoute from '@/components/PermissionRoute'
import AdminRoute from '@/components/AdminRoute'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import Acceso from '@/pages/Acceso'
import Denegado from '@/pages/Denegado'
import Menu from '@/pages/Menu'
import Area from '@/pages/Area'
import CuentaAmigos from '@/pages/CuentaAmigos'
import Documentos from '@/pages/Documentos'
import Manuales from '@/pages/Manuales'
import Configuraciones from '@/pages/Configuraciones'
import ComingSoon from '@/pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Pantalla para autenticados no aprobados (pendiente/rechazado/desactivado) */}
          <Route path="/acceso" element={<Acceso />} />

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
              <PermissionRoute permiso="cuentas_amigos.view">
                <CuentaAmigos />
              </PermissionRoute>
            }
          />
          <Route
            path="/archivos/:areaId"
            element={
              <PermissionRoute permiso="documentos.view">
                <Documentos />
              </PermissionRoute>
            }
          />
          <Route
            path="/manuales"
            element={
              <PermissionRoute permiso="manuales.view">
                <Manuales />
              </PermissionRoute>
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
            path="/configuraciones"
            element={
              <AdminRoute>
                <Configuraciones />
              </AdminRoute>
            }
          />
          <Route
            path="/denegado"
            element={
              <ProtectedRoute>
                <Denegado />
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
