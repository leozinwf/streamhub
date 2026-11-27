// Modo TV (app do Fire TV / Android TV): navegação pelo controle remoto.
// Só liga quando o app Android se identifica no User-Agent ("StreamHubTV").
// No navegador e no app de Windows nada aqui é executado.

type Direction = 'left' | 'right' | 'up' | 'down'

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const FOCUSABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
// Itens secundários dos cartões (título repete a miniatura; favoritar fica na tela do canal): pulados no controle.
const SKIP = '.yt-title, .yt-avatar, .yt-fav'
// Barras fixas no topo (cabeçalho, filtros): no ↑ ↓ só ganham quando não há conteúdo mais perto.
const BARS = 'header, .yt-chips, .subcategory-strip, .category-strip, .content-tabs'
const MODAL = '[aria-modal="true"], .settings-overlay'

export const isTv = typeof navigator !== 'undefined' && /StreamHubTV/i.test(navigator.userAgent)
/** Inside the Android app (TV or phone): files come from the APK, back button is handled natively. */
export const isAndroidApp = typeof navigator !== 'undefined' && /StreamHub(TV|Android)/i.test(navigator.userAgent)

let lastFocused: HTMLElement | null = null
// Primeiro foco quando nada está selecionado: o conteúdo (cartões), não o menu.
const PREFERRED = '.tv-autofocus, .tv-list, .md-play, .yt-thumb, .channel-card, .media-card, .md-episode, .shp-btn'

function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false
  if (element.tagName === 'TEXTAREA') return true
  if (element.tagName !== 'INPUT') return false
  const type = (element as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(type)
}

function scope(): ParentNode {
  const modals = document.querySelectorAll(MODAL)
  return modals.length ? modals[modals.length - 1] : document
}

function isUsable(element: HTMLElement) {
  if ((element as HTMLButtonElement).disabled) return false
  if (element.closest('[aria-hidden="true"], [inert]')) return false
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function inHorizontalScroller(element: HTMLElement) {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 2) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

function candidates() {
  const width = window.innerWidth
  const result: { element: HTMLElement; rect: DOMRect }[] = []
  scope().querySelectorAll<HTMLElement>(FOCUSABLE).forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2 || element.matches(SKIP)) return
    // Itens fora da tela na horizontal (menu recolhido etc.) só contam dentro de fileiras com rolagem.
    if ((rect.right <= 0 || rect.left >= width) && !inHorizontalScroller(element)) return
    result.push({ element, rect })
  })
  return result
}

function score(from: DOMRect, to: DOMRect, direction: Direction) {
  const horizontal = direction === 'left' || direction === 'right'
  let primary: number
  if (direction === 'right') primary = to.left - from.right
  else if (direction === 'left') primary = from.left - to.right
  else if (direction === 'down') primary = to.top - from.bottom
  else primary = from.top - to.bottom
  // Precisa estar à frente na direção (tolerância para itens encostados/sobrepostos).
  const fromCenter = horizontal ? from.left + from.width / 2 : from.top + from.height / 2
  const toCenter = horizontal ? to.left + to.width / 2 : to.top + to.height / 2
  const ahead = direction === 'right' || direction === 'down' ? toCenter > fromCenter + 1 : toCenter < fromCenter - 1
  if (!ahead || primary < -Math.min(horizontal ? from.width : from.height, 40) / 2) return Infinity
  // Distância no eixo perpendicular: zero quando estão na mesma linha/coluna.
  const gap = horizontal
    ? Math.max(0, Math.max(from.top, to.top) - Math.min(from.bottom, to.bottom))
    : Math.max(0, Math.max(from.left, to.left) - Math.min(from.right, to.right))
  const centerOffset = horizontal
    ? Math.abs((from.top + from.height / 2) - (to.top + to.height / 2))
    : Math.abs((from.left + from.width / 2) - (to.left + to.width / 2))
  return Math.max(primary, 0) + gap * 3 + centerOffset * 0.15
}

function focusElement(element: HTMLElement) {
  // Passar por um campo de texto não abre o teclado da TV; ele só abre com OK (ver onKeyDown).
  if (isTextField(element)) element.setAttribute('inputmode', 'none')
  element.focus({ preventScroll: true })
  // Centraliza na vertical (o cabeçalho fixo não cobre o item) e o mínimo na horizontal.
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  lastFocused = element
}

function firstVisible() {
  const list = candidates().filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight && rect.left >= 0 && rect.left < window.innerWidth)
  list.sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left))
  const usable = list.filter(({ element }) => isUsable(element))
  return (usable.find(({ element }) => element.matches(PREFERRED)) ?? usable[0])?.element ?? null
}

function move(direction: Direction) {
  const active = document.activeElement as HTMLElement | null
  const hasFocus = active && active !== document.body && document.contains(active) && (scope() === document || (scope() as Element).contains(active))
  if (!hasFocus) {
    // Nada selecionado: volta ao último item (se ainda existe) ou vai para o primeiro cartão visível.
    const target = lastFocused && lastFocused.isConnected && isUsable(lastFocused) ? lastFocused : firstVisible()
    if (target) focusElement(target)
    return
  }
  const from = active!.getBoundingClientRect()
  const ranked = candidates()
    .filter(({ element }) => element !== active)
    .map((item) => ({ ...item, score: score(from, item.rect, direction) + ((direction === 'up' || direction === 'down') && !active!.closest(BARS) && item.element.closest(BARS) ? 600 : 0) }))
    .filter((item) => item.score !== Infinity)
    .sort((a, b) => a.score - b.score)
  const next = ranked.find(({ element }) => isUsable(element))
  if (next) focusElement(next.element)
}

/** Pede ao app Android para abrir o teclado da TV (o WebView não abre sozinho ao focar pelo JavaScript). */
function openKeyboard() {
  const native = (window as unknown as { StreamHubNative?: { showKeyboard?: () => void } }).StreamHubNative
  try { native?.showKeyboard?.() } catch { /* app antigo sem a ponte */ }
}

function activeVideo() {
  const videos = Array.from(document.querySelectorAll('video'))
  return videos.find((video) => !video.paused) ?? videos[0] ?? null
}

type Hooks = { __streamhubWatchKey?: (event: KeyboardEvent) => boolean; __streamhubWatchBack?: () => boolean }
const hooks = () => window as unknown as Hooks

function onKeyDown(event: KeyboardEvent) {
  // Watching full screen with the channel menu closed: the app handles the keys
  // (↑ ↓ change channel, OK opens the menu, ← → seek in movies).
  const root = document.documentElement.classList
  if (root.contains('tv-watching') && !root.contains('tv-menu-open') && hooks().__streamhubWatchKey?.(event)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  // Lists/grids of the TV interface move their own selection (only the visible rows exist in
  // the page); they return false at an edge so the focus can leave to the next column.
  const own = (document.activeElement as (HTMLElement & { __tvKey?: (event: KeyboardEvent) => boolean }) | null)?.__tvKey
  if (own && own(event)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  const direction = ARROWS[event.key]
  const active = document.activeElement
  if (direction) {
    // Em campos de texto, ← → movem o cursor; só saem do campo nas pontas.
    if (isTextField(active) && (direction === 'left' || direction === 'right')) {
      const field = active as HTMLInputElement
      const atStart = (field.selectionStart ?? 0) === 0 && (field.selectionEnd ?? 0) === 0
      const atEnd = (field.selectionStart ?? 0) >= field.value.length
      if ((direction === 'left' && !atStart) || (direction === 'right' && !atEnd)) return
    }
    // Controles deslizantes (volume) continuam usando ← → para ajustar.
    if (active instanceof HTMLInputElement && active.type === 'range' && (direction === 'left' || direction === 'right')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    move(direction)
    return
  }
  if (event.key === 'Enter' && isTextField(active) && active.getAttribute('inputmode') === 'none') {
    // OK num campo de texto: abre o teclado da TV para digitar.
    event.preventDefault()
    event.stopImmediatePropagation()
    const field = active
    field.removeAttribute('inputmode')
    field.blur()
    // Foca de novo no próximo ciclo (com o inputmode já atualizado) e pede o teclado ao app.
    setTimeout(() => { field.focus({ preventScroll: true }); openKeyboard() }, 30)
    return
  }
  if (event.key === 'Enter' && active instanceof HTMLElement && active !== document.body) {
    // Elementos clicáveis que não são botões de verdade também respondem ao OK do controle.
    const native = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)
    if (!native) { event.preventDefault(); active.click() }
  }
}

/** Botão "voltar" do controle. Devolve true se tratou; false deixa o app perguntar se quer sair. */
function back(): boolean {
  // Full-screen watching: closes the channel menu, then leaves full screen.
  if (hooks().__streamhubWatchBack?.()) return true
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return true }
  const active = document.activeElement as HTMLElement | null
  if (isTextField(active)) { active.blur(); return true }
  const escape = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  }
  // 1. Janelas e menus abertos fecham primeiro.
  if (document.querySelector(MODAL)) {
    escape()
    const close = document.querySelector<HTMLElement>('.settings-close')
    if (close) close.click()
    return true
  }
  if (document.querySelector('[aria-expanded="true"], .mobile-drawer')) { escape(); return true }
  // 2. Dentro de uma série, volta para a lista de séries.
  const seriesBack = document.querySelector<HTMLElement>('.series-back')
  if (seriesBack) { seriesBack.click(); return true }
  // 3. Fora da página inicial, volta para ela.
  const logo = document.querySelector<HTMLElement>('.yt-logo')
  if (!document.querySelector('.yt-home') && logo) {
    logo.click()
    setTimeout(() => { window.scrollTo({ top: 0 }); const first = firstVisible(); if (first) focusElement(first) }, 150)
    return true
  }
  // 4. Na página inicial rolada, sobe para o topo antes de oferecer a saída.
  if (window.scrollY > 200) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => { const first = firstVisible(); if (first) focusElement(first) }, 350)
    return true
  }
  return false
}

function media(action: string) {
  const video = activeVideo()
  if (!video) return
  if (action === 'playpause') { if (video.paused) void video.play().catch(() => undefined); else video.pause() }
  else if (action === 'rewind') video.currentTime = Math.max(0, video.currentTime - 10)
  else if (action === 'forward') video.currentTime = video.currentTime + 10
}

export function setupTv() {
  if (isAndroidApp && !isTv) {
    // Phone app: touch UI as in the browser; only the Android back button needs wiring.
    const w = window as unknown as Record<string, unknown>
    w.__streamhubBack = back
    w.__streamhubMedia = media
    return
  }
  if (!isTv) return
  document.documentElement.classList.add('tv')
  // Layout de computador em tela de TV: 1280 px de largura, ampliado para a tela toda.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=1280')
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null
    if (target && target !== document.body) lastFocused = target
  })
  const w = window as unknown as Record<string, unknown>
  w.__streamhubBack = back
  w.__streamhubMedia = media
}
