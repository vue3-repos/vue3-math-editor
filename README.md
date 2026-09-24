# vue3-math-editor

A semantic equation editor for Vue 3: equations are edited WYSIWYG, rendered with KaTeX,
and exported as MathJSON, Content MathML (optionally ready for CellML 2.0) and LaTeX.

## Documentation

See [docs/](docs/README.md):

- [Writing equations](docs/writing-equations.md): how to use the editor, and how input is
  interpreted.
- [Equation editor design](docs/design.md): how it works inside.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
npx playwright install chromium   # once, for the browser tests
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

### Run the Tests

```sh
npm test               # unit tests (Vitest)
npm run test:e2e       # browser tests (Playwright)
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
