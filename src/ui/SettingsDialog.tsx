import ThemePicker from './ThemePicker'

/** User settings panel (opened from the gear icon). Home for app preferences;
 *  theme selection lives here now. Add future settings as new sections. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-canvas p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-ink">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded p-1 text-ink-soft hover:bg-surface"
          >
            ✕
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-sm font-medium text-ink">Theme</h3>
          <p className="mt-0.5 text-xs text-ink-faint">
            Pick a colour palette. Saved on this device and carried into the app.
          </p>
          <div className="mt-3">
            <ThemePicker labeled />
          </div>
        </section>
      </div>
    </div>
  )
}
