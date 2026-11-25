# Carga (o cambia) el usuario y la contraseña de Firebird del servidor vinculado FLEXXUS
# en el SQL Server local (DESKTOP-OA4GU6I). La contraseña se pide por teclado y viaja
# como parámetro: no queda en el historial ni en la línea de comandos.
# Uso: powershell -ExecutionPolicy Bypass -File puente-sql\scripts\flexxus-cargar-clave.ps1

$usuario = Read-Host 'Usuario de Firebird (Enter = SYSDBA)'
if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = 'SYSDBA' }
$segura = Read-Host 'Contraseña' -AsSecureString
$clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))

$cn = New-Object System.Data.SqlClient.SqlConnection 'Server=localhost;Integrated Security=SSPI;TrustServerCertificate=True'
$cn.Open()
try {
  $cmd = $cn.CreateCommand()
  $cmd.CommandText = "EXEC sp_addlinkedsrvlogin @rmtsrvname = N'FLEXXUS', @useself = N'False', @locallogin = NULL, @rmtuser = @u, @rmtpassword = @p"
  [void]$cmd.Parameters.AddWithValue('@u', $usuario)
  [void]$cmd.Parameters.AddWithValue('@p', $clave)
  [void]$cmd.ExecuteNonQuery()
  Write-Host 'Usuario cargado. Probando conexión...'
  $cmd2 = $cn.CreateCommand()
  $cmd2.CommandTimeout = 60
  $cmd2.CommandText = "SELECT * FROM OPENQUERY(FLEXXUS, 'SELECT COUNT(*) AS TABLAS FROM RDB`$RELATIONS WHERE RDB`$SYSTEM_FLAG = 0')"
  Write-Host ("OK: la base tiene {0} tablas." -f $cmd2.ExecuteScalar())
} catch {
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  $cn.Close()
  $clave = $null
}
