import './polyfills'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { isAndroidApp, setupTv } from './tv'

setupTv()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

// No app Android (TV e celular) os arquivos já vêm dentro do APK: sem service worker (evita cache velho depois de atualizar).
if (import.meta.env.PROD && !isAndroidApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
