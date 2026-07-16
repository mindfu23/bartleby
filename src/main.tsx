import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './ui/ErrorBoundary'
import { initTheme } from './app/theme'
import { completeAuthFromRedirect } from './app/dropboxauth'

initTheme() // apply the saved theme before first paint

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )

// If we're returning from the Dropbox authorize redirect, finish the token
// exchange BEFORE rendering, so the app comes up already connected. A failure
// must not block the app — the picker surfaces it on the next attempt.
completeAuthFromRedirect()
  .catch((e) => console.error('Dropbox auth did not complete:', e))
  .finally(render)
