import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import FileLibrary from '@/components/FileLibrary'
import { getArea } from '@/config/areas'

export default function Documentos() {
  const { areaId = '' } = useParams()
  const area = getArea(areaId)
  const scope = useMemo(() => ({ area_id: areaId }), [areaId])

  return (
    <FileLibrary
      titulo={`Archivos · ${area?.name ?? ''}`}
      subtitulo="Fotos, PDF, Excel y otros documentos del área."
      color={area?.color ?? '#e11d2e'}
      table="documentos"
      bucket="documentos"
      permisoPrefix="documentos"
      scope={scope}
      pathPrefix={areaId}
      backTo={`/area/${areaId}`}
      backLabel={area?.name ?? 'Área'}
      icon={FolderOpen}
    />
  )
}
