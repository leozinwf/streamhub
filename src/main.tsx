import './polyfills'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { isTv, setupTv } from './tv'

setupTv()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

// No app de TV os arquivos já vêm dentro do APK: sem service worker (evita cache velho depois de atualizar).
if (import.meta.env.PROD && !isTv && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
