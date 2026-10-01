# Quita las tareas "MITO - Puente SQL", "MITO - Sync equivalencias", "MITO - Sync articulos", "MITO - Sync pedidos compra" y las de pedidos de venta del Programador de tareas.
foreach ($t in @('MITO - Puente SQL', 'MITO - Sync equivalencias', 'MITO - Sync articulos', 'MITO - Sync pedidos compra', 'MITO - Sync pedidos venta', 'MITO - Sync pedidos venta completo')) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Output "OK  Tarea `"$t`" quitada"
  }
}
