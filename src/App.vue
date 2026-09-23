<script setup lang="ts">
import EquationWorkbench from './components/EquationWorkbench.vue'

// Demo switch: open the page with ?cellml for CellML mode.
const cellml = new URLSearchParams(window.location.search).has('cellml')
</script>

<template>
  <main class="app-shell">
    <section class="hero">
      <h1>Math Equation Workbench</h1>
      <p>Canonical AST editing for LaTeX and Content MathML output.</p>
    </section>

    <EquationWorkbench :cellml="cellml" />
  </main>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding: 2rem 1rem 3rem;
  background:
    radial-gradient(circle at 15% 15%, #f1f5ff 0%, #f8fafc 35%),
    radial-gradient(circle at 85% 0%, #dcfce7 0%, transparent 40%), #f8fafc;
}

.hero {
  max-width: 1100px;
  margin: 0 auto 1.25rem;
}

.hero h1 {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2.2rem);
  letter-spacing: -0.02em;
  color: #0f172a;
}

.hero p {
  margin: 0.35rem 0 0;
  color: #334155;
}
</style>
