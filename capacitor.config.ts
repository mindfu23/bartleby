import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 7 (Node 20 — v8 requires Node 22+).
 *
 * The web build in `dist/` IS the app: the same core/app layers, a second thin
 * client over them, per the three-layer boundary contract.
 *
 * OAuth note: the WebView origin here is not a URL Dropbox will accept as a
 * redirect, so native auth uses the `bartleby://auth` custom scheme (legal only
 * under PKCE) and receives the code via a deep link. The scheme is declared in
 * android/app/src/main/AndroidManifest.xml and must be registered in the
 * Dropbox App Console.
 */
const config: CapacitorConfig = {
  appId: 'com.anideasmith.bartleby',
  appName: 'Bartleby',
  webDir: 'dist',
}

export default config
