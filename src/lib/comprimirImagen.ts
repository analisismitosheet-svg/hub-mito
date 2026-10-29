/**
 * Achica una foto antes de subirla: lado mayor `max` px y JPEG de calidad `calidad`.
 * Las fotos del celular pesan 3-12 MB y a veces vienen como HEIF, que el bucket no acepta
 * (límite 10 MB, solo jpeg/png/webp/heic): así siempre sube un JPEG de pocos cientos de KB.
 * Si el navegador no puede leer la imagen, devuelve el archivo original.
 */
export async function comprimirImagen(archivo: File, max = 1600, calidad = 0.85): Promise<File> {
  try {
    const url = URL.createObjectURL(archivo)
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => mal(new Error('No se pudo leer la imagen'))
      i.src = url
    })
    URL.revokeObjectURL(url)
    const escala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const ancho = Math.max(1, Math.round(img.naturalWidth * escala))
    const alto = Math.max(1, Math.round(img.naturalHeight * escala))
    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) return archivo
    ctx.drawImage(img, 0, 0, ancho, alto)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', calidad))
    if (!blob) return archivo
    const nombre = (archivo.name.replace(/\.[^.]+$/, '') || 'foto') + '.jpg'
    return new File([blob], nombre, { type: 'image/jpeg' })
  } catch {
    return archivo
  }
}
