const PORTABLE_DIRECTORY_NAME = 'CyberCode-Portable'

export function portableFolderPreview(destinationPath: string): string {
  const value = destinationPath.trim()
  if (!value) return ''
  const trimmed = value.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  if (segments.at(-1)?.toLowerCase() === PORTABLE_DIRECTORY_NAME.toLowerCase()) {
    return trimmed
  }
  const separator = value.includes('\\') && !value.includes('/') ? '\\' : '/'
  return `${trimmed || separator}${trimmed ? separator : ''}${PORTABLE_DIRECTORY_NAME}`
}
