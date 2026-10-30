import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import PedidosCompra from '@/pages/PedidosCompra'
import EstadoPedidos from '@/pages/EstadoPedidos'
import Cancelaciones from '@/pages/Cancelaciones'
import PedidosHub from '@/pages/PedidosHub'
import PedidosVenta from '@/pages/PedidosVenta'
import Mayorista from '@/pages/Mayorista'
import MiRepo from '@/pages/MiRepo'
import Deposito from '@/pages/Deposito'
import Rma from '@/pages/Rma'
import Picking from '@/pages/Picking'
import RecepcionIndo from '@/pages/RecepcionIndo'
import Opiniones from '@/pages/Opiniones'
import ContadorClientes from '@/pages/ContadorClientes'
import IaCamaras from '@/pages/IaCamaras'
import TasaConversion from '@/pages/TasaConversion'
import ObjetivosLocales from '@/pages/ObjetivosLocales'
import CalibrarCamara from '@/pages/CalibrarCamara'
import Opinar from '@/pages/Opinar'
import EncuestasAdmin from '@/pages/EncuestasAdmin'
import QrEtiquetaEditor from '@/pages/QrEtiquetaEditor'
import Configuraciones from '@/pages/Configuraciones'
import Informes from '@/pages/Informes'
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
import PausasPendientes from '@/pages/PausasPendientes'
import MapeoEscanear from '@/pages/MapeoEscanear'
import MapeoOrden from '@/pages/MapeoOrden'
import MapeoUbicaciones from '@/pages/MapeoUbicaciones'
import ConsultaArticulos from '@/pages/ConsultaArticulos'
import CargaNovedades from '@/pages/CargaNovedades'
import ResumenNovedades from '@/pages/ResumenNovedades'
import MotivosNovedades from '@/pages/MotivosNovedades'
import CarpetaArea from '@/pages/CarpetaArea'
import DatosSql from '@/pages/DatosSql'
import SqlConexion from '@/pages/SqlConexion'
import ComingSoon from '@/pages/ComingSoon'
import Replicas from '@/pages/Replicas'
import MayoristaFranquicias from '@/pages/MayoristaFranquicias'
import FranquiciasReposicionAuto from '@/pages/FranquiciasReposicionAuto'
import MayoristaFranquiciasPropuestas from '@/pages/MayoristaFranquiciasPropuestas'
import MayoristaFranquiciasMateriales from '@/pages/MayoristaFranquiciasMateriales'
import SistemasFranquicias from '@/pages/SistemasFranquicias'
import PropuestaFranquicia from '@/pages/PropuestaFranquicia'

// Pantallas nuevas: se cargan bajo demanda para no agrandar el bundle principal
// (el service worker no precachea archivos de más de 2 MB y la build falla).
const ComparativaPrecios = lazy(() => import('@/pages/ComparativaPrecios'))
const TrackingTransporte = lazy(() => import('@/pages/TrackingTransporte'))
const TrackingKm = lazy(() => import('@/pages/TrackingKm'))
const StockValorizado = lazy(() => import('@/pages/StockValorizado'))
const VentasWeb = lazy(() => import('@/pages/VentasWeb'))

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
          {/* Propuesta de reposición para una franquicia: link público por token (sin usuario) */}
          <Route path="/p/:token" element={<PropuestaFranquicia />} />
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
            path="/compras/pedidos"
            element={
              <PermissionRoute permiso="pedidos_compra.view">
                <PedidosHub />
              </PermissionRoute>
            }
          />
          <Route
            path="/compras/comparativa-precios"
            element={
              <PermissionRoute permiso="compras_precios.view">
                <Suspense fallback={null}>
                  <ComparativaPrecios />
                </Suspense>
              </PermissionRoute>
            }
          />
          <Route
            path="/compras/cancelaciones"
            element={
              <PermissionRoute permiso="pedidos_compra.view">
                <Cancelaciones />
              </PermissionRoute>
            }
          />
          <Route
            path="/compras/estado-pedidos"
            element={
              <PermissionRoute permiso="pedidos_compra.view">
                <EstadoPedidos />
              </PermissionRoute>
            }
          />
          <Route
            path="/compras/pedidos-compra"
            element={
              <PermissionRoute permiso="pedidos_compra.view">
                <PedidosCompra />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/pedidos-venta"
            element={
              <PermissionRoute permiso="pedidos_venta.view">
                <PedidosVenta />
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
            path="/mayorista/pausas"
            element={
              <PermissionRoute permiso="mayorista.pausas.autorizar">
                <PausasPendientes />
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
            path="/mayorista/consulta-articulos"
            element={
              <PermissionRoute permiso="mayorista.articulos.view">
                <ConsultaArticulos />
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
            path="/mayorista/franquicias"
            element={
              <PermissionRoute permiso="mayorista.franquicias.view">
                <FranquiciasReposicionAuto />
              </PermissionRoute>
            }
          />
          {/* Pantallas anteriores: fuera del menú por ahora (27/10/2026), siguen andando por link */}
          <Route
            path="/mayorista/franquicias/diaria"
            element={
              <PermissionRoute permiso="mayorista.franquicias.view">
                <MayoristaFranquicias />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/franquicias/propuestas"
            element={
              <PermissionRoute permiso="mayorista.franquicias.view">
                <MayoristaFranquiciasPropuestas />
              </PermissionRoute>
            }
          />
          <Route
            path="/mayorista/franquicias/materiales"
            element={
              <PermissionRoute permiso="mayorista.franquicias.view">
                <MayoristaFranquiciasMateriales />
              </PermissionRoute>
            }
          />
          <Route path="/mayorista/franquicias/calzado" element={<Navigate to="/mayorista/franquicias/materiales" replace />} />
          <Route path="/mayorista/franquicias/clientes" element={<Navigate to="/sistemas/franquicias" replace />} />
          <Route
            path="/sistemas/franquicias"
            element={
              <PermissionRoute permiso="mayorista.franquicias.view">
                <SistemasFranquicias />
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
            path="/deposito/picking"
            element={
              <PermissionRoute permiso="picking.view">
                <Picking />
              </PermissionRoute>
            }
          />
          <Route
            path="/deposito/recepcion-indo"
            element={
              <PermissionRoute permiso="deposito.view">
                <RecepcionIndo />
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
            path="/administradores/tracking/km"
            element={
              <PermissionRoute permiso="tracking.view">
                <Suspense fallback={null}>
                  <TrackingKm />
                </Suspense>
              </PermissionRoute>
            }
          />
          <Route
            path="/administradores/stock-valorizado"
            element={
              <PermissionRoute permiso="stock_valorizado.view">
                <Suspense fallback={null}>
                  <StockValorizado />
                </Suspense>
              </PermissionRoute>
            }
          />
          <Route
            path="/administradores/ventas-web"
            element={
              <PermissionRoute permiso="tiendanube.view">
                <Suspense fallback={null}>
                  <VentasWeb />
                </Suspense>
              </PermissionRoute>
            }
          />
          <Route
            path="/administradores/tracking"
            element={
              <PermissionRoute permiso="tracking.view">
                <Suspense fallback={null}>
                  <TrackingTransporte />
                </Suspense>
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
            path="/objetivos-locales"
            element={
              <PermissionRoute permiso="objetivos.view">
                <ObjetivosLocales />
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
            path="/arquitectura/gestion-obras"
            element={
              <ProtectedRoute>
                <CarpetaArea carpetaId="arquitectura-obras" titulo="Gestión de Obras" color="#0d9488" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/presupuestos/nuevo"
            element={
              <ProtectedRoute>
                <ComingSoon title="Cargar presupuesto" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/pagos/nuevo"
            element={
              <ProtectedRoute>
                <ComingSoon title="Solicitar pago" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/solicitudes/pendientes"
            element={
              <ProtectedRoute>
                <ComingSoon title="Solicitudes pendientes" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/solicitudes/aprobadas"
            element={
              <ProtectedRoute>
                <ComingSoon title="Solicitudes aprobadas" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/solicitudes/rechazadas"
            element={
              <ProtectedRoute>
                <ComingSoon title="Solicitudes rechazadas" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/obras"
            element={
              <ProtectedRoute>
                <ComingSoon title="Obras" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/arquitectura/reportes"
            element={
              <ProtectedRoute>
                <ComingSoon title="Reportes" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replicas"
            element={
              <ProtectedRoute>
                <Replicas />
              </ProtectedRoute>
            }
          />
          <Route
            path="/informes"
            element={
              <PermissionRoute permiso="sistemas.informes.view">
                <Informes />
              </PermissionRoute>
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
