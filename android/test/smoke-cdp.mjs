// Conecta no WebView do app (via DevTools) para conferir o que aparece e se o vídeo toca.
// Uso: node smoke-cdp.mjs <passo>   passos: estado | importar | video
import { chromium } from 'playwright-core'

const step = process.argv[2] || 'estado'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages().find((p) => p.url().includes('127.0.0.1:51730')) || browser.contexts()[0].pages()[0]
page.on('console', (m) => console.log('[console]', m.type(), m.text()))

const state = () => page.evaluate(() => {
  const a = document.activeElement
  const v = Array.from(document.querySelectorAll('video'))
  return {
    url: location.href,
    tv: document.documentElement.classList.contains('tv'),
    width: innerWidth,
    home: !!document.querySelector('.yt-home'),
    focus: a ? `${a.tagName}.${a.className} "${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40)}" inputmode=${a.getAttribute('inputmode')}` : null,
    videos: v.map((x) => ({ src: (x.currentSrc || x.src || '').slice(0, 80), t: +x.currentTime.toFixed(1), paused: x.paused, rs: x.readyState, w: x.videoWidth, h: x.videoHeight, err: x.error && x.error.code })),
    errorText: document.querySelector('.video-error')?.textContent?.slice(0, 200) || null,
  }
})

console.log(`== CDP ${step}`, JSON.stringify(await state()))
if (step === 'video') {
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(4000); console.log('   +4s', JSON.stringify((await state()).videos)) }
}
await browser.close().catch(() => undefined)
