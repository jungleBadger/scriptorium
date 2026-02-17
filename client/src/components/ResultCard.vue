<script setup>
defineProps({
  result: { type: Object, required: true },
});
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
    <div class="flex items-baseline justify-between">
      <h3 class="font-semibold text-gray-900">{{ result.reference }}</h3>
      <span class="text-xs text-gray-400">
        {{ (result.similarity * 100).toFixed(1) }}%
      </span>
    </div>
    <p class="mt-2 text-sm leading-relaxed text-gray-700">{{ result.text }}</p>
  </div>
</template>
