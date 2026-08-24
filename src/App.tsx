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
import Deposito from '@/pages/Deposito'
import Opiniones from '@/pages/Opiniones'
import Opinar from '@/pages/Opinar'
import EncuestasAdmin from '@/pages/EncuestasAdmin'
import QrEtiquetaEditor from '@/pages/QrEtiquetaEditor'
import Configuraciones from '@/pages/Configuraciones'
import SectoresQr from '@/pages/SectoresQr'
import QrLocales from '@/pages/QrLocales'
import Usuarios from '@/pages/Usuarios'
import Roles from '@/pages/Roles'
import LocalesPage from '@/pages/Locales'
import EmpleadosPage from '@/pages/Empleados'
import Transportes from '@/pages/Transportes'
import Clientes from '@/pages/Clientes'
import FacturacionFabrica from '@/pages/FacturacionFabrica'
import Guias from '@/pages/Guias'
import DatosSql from '@/pages/DatosSql'
import SqlConexion from '@/pages/SqlConexion'
import ComingSoon from '@/pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Enlace público para que los clientes puntúen un local (compatibilidad) */}
          <Route path="/opinar/:local" element={<Opinar />} />
          {/* Enlace público único por (local + sector) resuelto por token */}
          <Route path="/opinar/qr/:token" element={<Opinar />} />
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
            path="/mayorista/transportes"
            element={
              <PermissionRoute permiso="mayorista.transportes.view">
                <Transportes />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/clientes"
            element={
              <PermissionRoute permiso="mayorista.clientes.view">
                <Clientes />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/facturacion-fabrica"
            element={
              <PermissionRoute permiso="mayorista.facturacion.view">
                <FacturacionFabrica />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/guias"
            element={
              <PermissionRoute permiso="mayorista.guias.view">
                <Guias />
              </PermissionRoute>
            }
          />
          <Route
            path="/deposito"
            element={
              <PermissionRoute permiso="deposito.view">
                <Deposito />
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
            path="/qr-etiqueta"
            element={
              <PermissionRoute permiso="banner.editar">
                <QrEtiquetaEditor />
              </PermissionRoute>
            }
          />
          <Route
            path="/sectores-qr"
            element={
              <PermissionRoute permiso="sectores.gestionar">
                <SectoresQr />
              </PermissionRoute>
            }
          />
          <Route
            path="/qr-locales"
            element={
              <AdminRoute>
                <QrLocales />
              </AdminRoute>
            }
          />
          <Route
            path="/datos-sql"
            element={
              <PermissionRoute permiso="datos_sql.view">
                <DatosSql />
              </PermissionRoute>
            }
          />
          <Route
            path="/configuraciones/sql"
            element={
              <AdminRoute>
                <SqlConexion />
              </AdminRoute>
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
            path="/usuarios"
            element={
              <AdminRoute>
                <Usuarios />
              </AdminRoute>
            }
          />
          <Route
            path="/roles"
            element={
              <AdminRoute>
                <Roles />
              </AdminRoute>
            }
          />
          <Route
            path="/locales"
            element={
              <AdminRoute>
                <LocalesPage />
              </AdminRoute>
            }
          />
          <Route
            path="/empleados"
            element={
              <AdminRoute>
                <EmpleadosPage />
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
