# Quita las tareas "MITO - Puente SQL" y "MITO - Sync equivalencias" del Programador de tareas.
foreach ($t in @('MITO - Puente SQL', 'MITO - Sync equivalencias')) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Output "OK  Tarea `"$t`" quitada"
  }
}
