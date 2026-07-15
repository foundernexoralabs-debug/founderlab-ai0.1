export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(event.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const ACCEPTED_IMAGE_TYPES = 'image/*,image/png,image/jpeg,image/webp,image/gif'
