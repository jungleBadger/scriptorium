<script setup>
defineProps({
  result: { type: Object, required: true },
});
</script>

<template>
  <div class="result-card">
    <div class="result-card__head">
      <h3 class="result-card__title">{{ result.reference }}</h3>
      <span class="result-card__score">
        {{ (result.similarity * 100).toFixed(1) }}%
      </span>
    </div>
    <p class="result-card__text">{{ result.text }}</p>
  </div>
</template>

<style scoped>
.result-card {
  border-radius: 0.75rem;
  border: 1px solid var(--line);
  background: var(--card);
  box-shadow: var(--surface-shadow);
  padding: 1rem;
}

.result-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.result-card__title {
  margin: 0;
  font-weight: 600;
  color: var(--ink);
}

.result-card__score {
  font-size: 0.75rem;
  color: var(--muted);
}

.result-card__text {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--ink);
}
</style>
