# Quita las tareas "MITO - Puente SQL", "MITO - Sync equivalencias" y "MITO - Sync articulos" del Programador de tareas.
foreach ($t in @('MITO - Puente SQL', 'MITO - Sync equivalencias', 'MITO - Sync articulos')) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Output "OK  Tarea `"$t`" quitada"
  }
}
