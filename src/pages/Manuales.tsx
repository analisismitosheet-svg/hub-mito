import { BookOpen } from 'lucide-react'
import FileLibrary from '@/components/FileLibrary'

export default function Manuales() {
  return (
    <FileLibrary
      titulo="Manuales"
      subtitulo="Instructivos y documentos: Excel, Word, PDF y más."
      color="#16a34a"
      table="manuales"
      bucket="manuales"
      permisoPrefix="manuales"
      pathPrefix="manuales"
      backTo="/area/locales"
      backLabel="Locales"
      icon={BookOpen}
    />
  )
}
