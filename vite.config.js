import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'math-field',
        },
      },
    }),
    vueDevTools(),
  ],
  // libcellml.js finds its WebAssembly next to itself (new URL(…,
  // import.meta.url)), which pre-bundling would break.
  optimizeDeps: {
    exclude: ['vue3-libcellml.js', 'libcellml.js'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
