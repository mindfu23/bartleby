import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import ErrorBoundary from './ui/ErrorBoundary'
import { initTheme } from './app/theme'
import { completeAuthFromRedirect, initAuth, initNativeAuthListener } from './app/dropboxauth'

initTheme() // apply the saved theme before first paint

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )

// Hydrate stored auth (async on native) and, if we're returning from the web
// authorize redirect, finish the token exchange — all BEFORE rendering, so the
// app comes up already connected. Failures must not block the app; the picker
// surfaces them on the next attempt.
void (async () => {
  try {
    await initAuth()
    await initNativeAuthListener()
    await completeAuthFromRedirect()
  } catch (e) {
    console.error('Dropbox auth did not complete:', e)
  } finally {
    render()
  }
})()
