/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// The vue3-libcellml.js plugin (demo only): provides '$libcellml' and
// '$libcellml_ready'. It has no type declarations of its own.
declare module 'vue3-libcellml.js' {
  import type { Plugin } from 'vue'

  const plugin: Plugin
  export default plugin
}
