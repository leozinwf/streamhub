/**
 * Brings a section's top into view when the page is scrolled past it. Picking a
 * category should show its list, not jump up to the player.
 */
export function scrollToSection(selector: string) {
  window.requestAnimationFrame(() => {
    const element = document.querySelector(selector)
    if (!element) return
    const header = document.querySelector('.topbar, .yt-topbar')?.getBoundingClientRect().height ?? 56
    const top = element.getBoundingClientRect().top + window.scrollY - header - 8
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' })
  })
}
