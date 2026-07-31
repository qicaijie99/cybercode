export function basenameForDisplay(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).pop() || value
}

export function compactPathForDisplay(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 2) return value
  return `.../${parts.slice(-2).join('/')}`
}
