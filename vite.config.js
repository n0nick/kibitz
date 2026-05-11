import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Resolve a short build hash for the Settings footer. Prefer Vercel's
// build-time env var; otherwise call git directly; fall back to 'dev' so
// local watch mode doesn't fail when git isn't reachable.
function resolveBuildSha() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

const BUILD_SHA = resolveBuildSha();

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB — covers stockfish.wasm (7.3 MB)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,webp,woff,woff2}'],
      },
      manifest: {
        name: 'Kibitz',
        short_name: 'Kibitz',
        description: 'AI-powered chess game reviewer',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
