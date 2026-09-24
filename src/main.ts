import 'primeicons/primeicons.css'
import 'katex/dist/katex.min.css'

import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import App from './App.vue'

const app = createApp(App)

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: false,
    },
  },
})

// Units checking uses libCellML, through the vue3-libcellml.js plugin. The
// editor works without it: open the page with ?nolibcellml to see the demo as
// an application without the plugin would run it.
if (new URLSearchParams(window.location.search).has('nolibcellml')) {
  app.mount('#app')
} else {
  import('vue3-libcellml.js').then(({ default: libcellml }) => {
    app.use(libcellml)
    app.mount('#app')
  })
}
