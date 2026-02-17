<script setup>
import { ref } from "vue";
import { search } from "../services/api.js";

const emit = defineEmits(["search"]);
const query = ref("");

async function handleSubmit() {
  const q = query.value.trim();
  if (!q) return;

  emit("search", { results: [], error: null, loading: true });

  try {
    const results = await search(q);
    emit("search", { results, error: null, loading: false });
  } catch (err) {
    emit("search", { results: [], error: err.message, loading: false });
  }
}
</script>

<template>
  <form @submit.prevent="handleSubmit" class="flex gap-2">
    <input
      v-model="query"
      type="text"
      placeholder="Search the Bible..."
      class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
    <button
      type="submit"
      class="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      Search
    </button>
  </form>
</template>
