import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'
import './index.css'
import App from './App.tsx'
import { installBrowserLockdown } from '@sakay/shared'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerSW({
  immediate: true
})

// Panel comment (D-P7): in a production build the developer-tools shortcuts and the right-click menu are blocked (a deterrent; see browserLockdown.ts).
installBrowserLockdown({ enabled: import.meta.env.PROD && import.meta.env.VITE_ALLOW_DEVTOOLS !== '1' })

