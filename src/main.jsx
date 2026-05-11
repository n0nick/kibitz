import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// iOS home screen apps don't poll for SW updates reliably — force a check on every launch.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration().then(r => r?.update());
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
