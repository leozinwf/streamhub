// Conecta no WebView do app (protocolo DevTools) para conferir a tela e se o vídeo toca.
// Uso: node smoke-cdp.mjs <passo>   passos: estado | video | eval:<js>
const step = process.argv[2] || 'estado'
const pages = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = pages.find((p) => p.type === 'page' && p.url.includes('127.0.0.1:51730')) || pages[0]
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return res.result?.result?.value ?? res.result?.exceptionDetails?.text ?? res
}

const STATE = `(() => {
  const a = document.activeElement
  const v = Array.from(document.querySelectorAll('video'))
  return {
    url: location.href, tv: document.documentElement.classList.contains('tv'), width: innerWidth,
    home: !!document.querySelector('.yt-home'), landing: !!document.querySelector('.landing'),
    focus: a ? a.tagName + '.' + a.className + ' "' + (a.getAttribute('aria-label') || a.value || a.textContent || '').trim().slice(0, 60) + '" inputmode=' + a.getAttribute('inputmode') : null,
    urlError: document.querySelector('.url-error')?.textContent || null,
    videos: v.map((x) => ({ src: (x.currentSrc || x.src || '').slice(0, 70), t: +x.currentTime.toFixed(1), paused: x.paused, rs: x.readyState, w: x.videoWidth, h: x.videoHeight, err: x.error && x.error.code })),
    errorText: document.querySelector('.video-error')?.textContent?.slice(0, 200) || null,
  }
})()`

if (step.startsWith('eval:')) console.log('== CDP eval', JSON.stringify(await evaluate(step.slice(5))))
else console.log(`== CDP ${step}`, JSON.stringify(await evaluate(STATE)))
if (step === 'video') {
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 4000)); console.log('   +4s', JSON.stringify((await evaluate(STATE)).videos)) }
}
ws.close()
process.exit(0)
