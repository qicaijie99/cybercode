export function subscribeToViewportChanges(listener: () => void): () => void {
  window.addEventListener('resize', listener)
  window.addEventListener('scroll', listener, true)

  const visualViewport = window.visualViewport
  visualViewport?.addEventListener('resize', listener)
  visualViewport?.addEventListener('scroll', listener)

  return () => {
    window.removeEventListener('resize', listener)
    window.removeEventListener('scroll', listener, true)
    visualViewport?.removeEventListener('resize', listener)
    visualViewport?.removeEventListener('scroll', listener)
  }
}
