import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import PermissionRoute from '@/components/PermissionRoute'
import AdminRoute from '@/components/AdminRoute'
import SoloPisoRedirect from '@/components/SoloPisoRedirect'
import Login from '@/pages/Login'
import Ingreso from '@/pages/Ingreso'
import Register from '@/pages/Register'
import Acceso from '@/pages/Acceso'
import Denegado from '@/pages/Denegado'
import Menu from '@/pages/Menu'
import Area from '@/pages/Area'
import CuentaAmigos from '@/pages/CuentaAmigos'
import Documentos from '@/pages/Documentos'
import Manuales from '@/pages/Manuales'
import Transferencias from '@/pages/Transferencias'
import EstadisticasTransferencias from '@/pages/EstadisticasTransferencias'
import Mayorista from '@/pages/Mayorista'
import MiRepo from '@/pages/MiRepo'
import Deposito from '@/pages/Deposito'
import Rma from '@/pages/Rma'
import Opiniones from '@/pages/Opiniones'
import ContadorClientes from '@/pages/ContadorClientes'
import IaCamaras from '@/pages/IaCamaras'
import TasaConversion from '@/pages/TasaConversion'
import CalibrarCamara from '@/pages/CalibrarCamara'
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
import Cumpleanios from '@/pages/Cumpleanios'
import ProveedoresPacho from '@/pages/ProveedoresPacho'
import GuiaPacho from '@/pages/GuiaPacho'
import Transportes from '@/pages/Transportes'
import Clientes from '@/pages/Clientes'
import FacturacionFabrica from '@/pages/FacturacionFabrica'
import Guias from '@/pages/Guias'
import NotasCredito from '@/pages/NotasCredito'
import EstadisticasRendimiento from '@/pages/EstadisticasRendimiento'
import MapeoEscanear from '@/pages/MapeoEscanear'
import MapeoOrden from '@/pages/MapeoOrden'
import MapeoUbicaciones from '@/pages/MapeoUbicaciones'
import CargaNovedades from '@/pages/CargaNovedades'
import ResumenNovedades from '@/pages/ResumenNovedades'
import MotivosNovedades from '@/pages/MotivosNovedades'
import CarpetaArea from '@/pages/CarpetaArea'
import DatosSql from '@/pages/DatosSql'
import SqlConexion from '@/pages/SqlConexion'
import ComingSoon from '@/pages/ComingSoon'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Ingreso de empleados: legajo + contraseña asignada por el admin */}
          <Route path="/ingreso" element={<Ingreso />} />
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
                <SoloPisoRedirect>
                  <Menu />
                </SoloPisoRedirect>
              </ProtectedRoute>
            }
          />
          <Route
            path="/area/:areaId"
            element={
              <ProtectedRoute>
                <SoloPisoRedirect>
                  <Area />
                </SoloPisoRedirect>
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
            path="/transferencias/estadisticas"
            element={
              <PermissionRoute permiso="transferencias.view">
                <EstadisticasTransferencias />
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
          {/* Vista de piso: el empleado solo ve los (lote, local) que le asignaron */}
          <Route
            path="/mayorista/mi-repo"
            element={
              <PermissionRoute permiso="mayorista.repos_piso" soloLegajo>
                <MiRepo />
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
            path="/mayorista/notas-credito"
            element={
              <PermissionRoute permiso="mayorista.notas_credito.view">
                <NotasCredito />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/mapeo"
            element={
              <PermissionRoute permiso="mayorista.mapeo.view">
                <CarpetaArea carpetaId="mayorista-mapeo" titulo="Mapeo depósito" color="#d97706" />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/mapeo/escanear"
            element={
              <PermissionRoute permiso="mayorista.mapeo.escanear">
                <MapeoEscanear />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/mapeo/orden"
            element={
              <PermissionRoute permiso="mayorista.mapeo.view">
                <MapeoOrden />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/mapeo/ubicaciones"
            element={
              <PermissionRoute permiso="mayorista.mapeo.view">
                <MapeoUbicaciones />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/estadisticas"
            element={
              <PermissionRoute permiso="mayorista.estadisticas.view">
                <EstadisticasRendimiento />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/novedades"
            element={
              <PermissionRoute permiso="rrhh.novedades.view">
                <CarpetaArea carpetaId="rrhh-novedades" />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/novedades/carga"
            element={
              <PermissionRoute permiso="rrhh.novedades.create">
                <CargaNovedades />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/novedades/resumen"
            element={
              <PermissionRoute permiso="rrhh.novedades.view">
                <ResumenNovedades />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/novedades/motivos"
            element={
              <PermissionRoute permiso="rrhh.novedades.view">
                <MotivosNovedades />
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
            path="/deposito/rma"
            element={
              <PermissionRoute permiso="deposito.view">
                <Rma />
              </PermissionRoute>
            }
          />
          <Route
            path="/deposito/rma/proveedores"
            element={
              <PermissionRoute permiso="deposito.view">
                <ProveedoresPacho />
              </PermissionRoute>
            }
          />
          <Route
            path="/deposito/rma/guia"
            element={
              <PermissionRoute permiso="deposito.view">
                <GuiaPacho />
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
            path="/contador-clientes"
            element={
              <PermissionRoute permiso="contador.view">
                <ContadorClientes />
              </PermissionRoute>
            }
          />
          <Route
            path="/tasa-conversion"
            element={
              <PermissionRoute permiso="conversion.view">
                <TasaConversion />
              </PermissionRoute>
            }
          />
          <Route
            path="/ia-camaras/calibrar"
            element={
              <PermissionRoute permiso="contador.gestionar">
                <CalibrarCamara />
              </PermissionRoute>
            }
          />
          <Route
            path="/ia-camaras"
            element={
              <PermissionRoute permiso="ia_camaras.view">
                <IaCamaras />
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
            path="/rrhh/empleados"
            element={
              <PermissionRoute permiso="rrhh.empleados.view">
                <EmpleadosPage />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/cumpleanios"
            element={
              <PermissionRoute permiso="rrhh.empleados.view">
                <Cumpleanios />
              </PermissionRoute>
            }
          />
          <Route
            path="/rrhh/empleados/:estado"
            element={
              <PermissionRoute permiso="rrhh.empleados.view">
                <EmpleadosPage />
              </PermissionRoute>
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
