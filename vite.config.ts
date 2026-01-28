import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
    const appBase = process.env.VITE_APP_BASE || '/';
    return {
      base: appBase,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          strategies: 'injectManifest',
          srcDir: 'src',
          filename: 'sw.ts',
          injectRegister: null,
          injectManifest: {
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            globIgnores: ['**/tablet-kiosk-instructions.html'],
          },
          registerType: 'autoUpdate',
          devOptions: {
            enabled: true,
          },
          includeAssets: ['menufaz-logo.svg'],
          manifest: {
            name: 'MenuFaz',
            short_name: 'MenuFaz',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            theme_color: '#dc2626',
            background_color: '#ffffff',
            icons: [
              {
                src: '/menufaz-logo.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable',
              },
            ],
          },
        }),
      ],
      define: {},
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
