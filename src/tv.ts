// Modo TV (app do Fire TV / Android TV): navegação pelo controle remoto.
// Só liga quando o app Android se identifica no User-Agent ("StreamHubTV").
// No navegador e no app de Windows nada aqui é executado.

type Direction = 'left' | 'right' | 'up' | 'down'

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const FOCUSABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
// Itens secundários dos cartões (título repete a miniatura; favoritar fica na tela do canal): pulados no controle.
const SKIP = '.yt-title, .yt-avatar, .yt-fav'
const MODAL = '[aria-modal="true"], .settings-overlay'

export const isTv = typeof navigator !== 'undefined' && /StreamHubTV/i.test(navigator.userAgent)

let lastRect: DOMRect | null = null

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
  element.focus({ preventScroll: true })
  // Centraliza na vertical (o cabeçalho fixo não cobre o item) e o mínimo na horizontal.
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  lastRect = element.getBoundingClientRect()
}

function firstVisible() {
  const list = candidates().filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight && rect.left >= 0 && rect.left < window.innerWidth)
  list.sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left))
  return list.find(({ element }) => isUsable(element))?.element ?? null
}

function move(direction: Direction) {
  const active = document.activeElement as HTMLElement | null
  const hasFocus = active && active !== document.body && document.contains(active) && (scope() === document || (scope() as Element).contains(active))
  const from = hasFocus ? active!.getBoundingClientRect() : lastRect
  if (!from || (!hasFocus && from.width === 0)) {
    const first = firstVisible()
    if (first) focusElement(first)
    return
  }
  const ranked = candidates()
    .filter(({ element }) => element !== active)
    .map((item) => ({ ...item, score: score(from, item.rect, direction) }))
    .filter((item) => item.score !== Infinity)
    .sort((a, b) => a.score - b.score)
  const next = ranked.find(({ element }) => isUsable(element))
  if (next) focusElement(next.element)
  else if (!hasFocus) { const first = firstVisible(); if (first) focusElement(first) }
}

function activeVideo() {
  const videos = Array.from(document.querySelectorAll('video'))
  return videos.find((video) => !video.paused) ?? videos[0] ?? null
}

function onKeyDown(event: KeyboardEvent) {
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
  if (event.key === 'Enter' && active instanceof HTMLElement && active !== document.body) {
    // Elementos clicáveis que não são botões de verdade também respondem ao OK do controle.
    const native = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)
    if (!native) { event.preventDefault(); active.click() }
  }
}

/** Botão "voltar" do controle. Devolve true se tratou; false deixa o app perguntar se quer sair. */
function back(): boolean {
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
  if (!isTv) return
  document.documentElement.classList.add('tv')
  // Layout de computador em tela de TV: 1280 px de largura, ampliado para a tela toda.
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=1280')
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null
    if (target && target !== document.body) lastRect = target.getBoundingClientRect()
  })
  const w = window as unknown as Record<string, unknown>
  w.__streamhubBack = back
  w.__streamhubMedia = media
}
