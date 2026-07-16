import { useState } from 'react'
import { THEMES, loadThemeId, applyTheme } from '../app/theme'

/**
 * Theme selector. `labeled` renders a swatch+name grid (for the settings panel);
 * the bare form is a compact swatch row. Persists via applyTheme.
 */
export default function ThemePicker({ labeled = false }: { labeled?: boolean }) {
  const [current, setCurrent] = useState(loadThemeId())
  const pick = (id: string) => {
    applyTheme(id)
    setCurrent(id)
  }

  if (labeled) {
    return (
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            aria-pressed={current === t.id}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
              current === t.id
                ? 'border-accent bg-accent-soft'
                : 'border-edge hover:bg-surface'
            }`}
          >
            <span
              className="h-6 w-6 shrink-0 rounded-full ring-1 ring-edge"
              style={{ background: t.swatch }}
            />
            <span className="text-sm text-ink">{t.name}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => pick(t.id)}
          title={t.name}
          aria-label={`Theme: ${t.name}`}
          aria-pressed={current === t.id}
          className={`h-5 w-5 shrink-0 rounded-full ring-offset-2 ring-offset-canvas transition ${
            current === t.id ? 'scale-110 ring-2 ring-ink' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ background: t.swatch }}
        />
      ))}
    </div>
  )
}
