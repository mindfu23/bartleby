/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dropbox app key — a PUBLIC OAuth/PKCE client identifier, not a secret.
   * See .env.example for why VITE_ is correct here. The app SECRET is never
   * used client-side.
   */
  readonly VITE_DROPBOX_APP_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
