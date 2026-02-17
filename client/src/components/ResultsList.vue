<script setup>
import ResultCard from "./ResultCard.vue";

defineProps({
  results: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
});
</script>

<template>
  <div class="mt-6">
    <p v-if="loading" class="text-sm text-gray-500">Searching...</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-else-if="results.length === 0" class="text-sm text-gray-400">
      No results yet. Try a search above.
    </p>
    <div v-else class="space-y-4">
      <ResultCard v-for="(result, i) in results" :key="i" :result="result" />
    </div>
  </div>
</template>
