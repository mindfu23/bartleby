/**
 * Theme selection (Phase A). A theme is just a `data-theme` value backed by a
 * block of CSS custom properties in index.css. Adding one is pure data: a new
 * palette block + a THEMES entry — no component changes.
 */
export interface Theme {
  id: string
  name: string
  /** accent colour, for the picker swatch */
  swatch: string
}

export const THEMES: Theme[] = [
  { id: 'light', name: 'Parchment', swatch: '#9c6f2e' },
  { id: 'dark', name: 'Warm Dark', swatch: '#e8a838' },
  { id: 'lavender', name: 'Burgundy', swatch: '#b8405f' },
  { id: 'mint', name: 'Mint', swatch: '#86efac' },
  { id: 'coral', name: 'Coral', swatch: '#f7a8c4' },
]

const STORAGE_KEY = 'bartleby-theme'
const DEFAULT_THEME = 'dark'

export function loadThemeId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* storage blocked — fall through to default */
  }
  return DEFAULT_THEME
}

export function applyTheme(id: string): void {
  document.documentElement.setAttribute('data-theme', id)
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* best-effort persistence */
  }
}

/** Apply the saved theme at startup (call before first render to avoid a flash). */
export function initTheme(): void {
  applyTheme(loadThemeId())
}
