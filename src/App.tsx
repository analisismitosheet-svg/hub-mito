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
import Transferencias from '@/pages/Transferencias'
import Mayorista from '@/pages/Mayorista'
import Opiniones from '@/pages/Opiniones'
import Opinar from '@/pages/Opinar'
import EncuestasAdmin from '@/pages/EncuestasAdmin'
import BannerEditor from '@/pages/BannerEditor'
import Configuraciones from '@/pages/Configuraciones'
import ComingSoon from '@/pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Enlace público para que los clientes puntúen un local (sin login) */}
          <Route path="/opinar/:local" element={<Opinar />} />
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
            path="/transferencias"
            element={
              <PermissionRoute permiso="transferencias.view">
                <Transferencias />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista"
            element={
              <PermissionRoute permiso="mayorista.view">
                <Mayorista />
              </PermissionRoute>
            }
          />
          <Route
            path="/opiniones"
            element={
              <PermissionRoute permiso="opiniones.view">
                <Opiniones />
              </PermissionRoute>
            }
          />
          <Route
            path="/encuestas"
            element={
              <PermissionRoute permiso="encuestas.gestionar">
                <EncuestasAdmin />
              </PermissionRoute>
            }
          />
          <Route
            path="/banner"
            element={
              <PermissionRoute permiso="banner.editar">
                <BannerEditor />
              </PermissionRoute>
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
