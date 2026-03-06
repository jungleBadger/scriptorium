<script setup>
import ResultCard from "./ResultCard.vue";

defineProps({
  results: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});
</script>

<template>
  <div class="results-list">
    <p v-if="loading" class="results-list__muted">Searching...</p>
    <p v-else-if="error" class="results-list__error">{{ error }}</p>
    <p v-else-if="results.length === 0" class="results-list__muted">
      No results yet. Try a search above.
    </p>
    <div v-else class="space-y-4">
      <ResultCard v-for="(result, i) in results" :key="i" :result="result" />
    </div>
  </div>
</template>

<style scoped>
.results-list {
  margin-top: 1.5rem;
}

.results-list__muted,
.results-list__error {
  font-size: 0.875rem;
}

.results-list__muted {
  color: var(--muted);
}

.results-list__error {
  color: var(--error);
}
</style>
