/** Utilidades de interfaz que no son componentes. */

/** Mueve el foco al primer campo con error, en el orden indicado. */
export function focusFirstError(errors: object, fieldIds: [key: string, elementId: string][]): void {
  const first = fieldIds.find(([key]) => Boolean((errors as Record<string, unknown>)[key]))
  if (first) document.getElementById(first[1])?.focus()
}

/** Años para el selector: los que aparecen en los datos y unos cuantos alrededor del actual. */
export function yearRange(currentYear: number, dates: readonly string[], selectedYear: number): number[] {
  let min = currentYear - 3
  let max = currentYear + 3
  for (const date of dates) {
    const year = Number(date.slice(0, 4))
    if (year) {
      min = Math.min(min, year)
      max = Math.max(max, year)
    }
  }
  min = Math.min(min, selectedYear)
  max = Math.max(max, selectedYear)
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

/** Descarga un texto como archivo (copia JSON o CSV). */
export function downloadFile(content: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
