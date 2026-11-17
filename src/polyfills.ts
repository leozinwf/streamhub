// Recursos recentes que faltam no WebView de aparelhos mais antigos (Fire TV / Android TV).
// Cada um só é instalado se o navegador ainda não tiver.

function define(target: object, name: string, value: unknown) {
  if (!(name in target)) Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

function at(this: ArrayLike<unknown>, index: number) {
  const length = this.length
  const i = Math.trunc(index) || 0
  const k = i < 0 ? length + i : i
  return k < 0 || k >= length ? undefined : this[k]
}

define(Array.prototype, 'at', at)
define(String.prototype, 'at', at)
define(Array.prototype, 'findLast', function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (predicate(this[i], i, this)) return this[i]
  return undefined
})
define(Array.prototype, 'findLastIndex', function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (predicate(this[i], i, this)) return i
  return -1
})
define(Object, 'hasOwn', (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key))
define(String.prototype, 'replaceAll', function (this: string, search: string | RegExp, replacement: string) {
  if (search instanceof RegExp) return this.replace(search, replacement)
  return this.split(search).join(replacement)
})
if (typeof crypto !== 'undefined' && !('randomUUID' in crypto)) {
  define(crypto, 'randomUUID', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  })
}
