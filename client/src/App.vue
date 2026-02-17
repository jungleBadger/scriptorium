<script setup>
import { ref } from "vue";
import SearchBar from "./components/SearchBar.vue";
import ResultsList from "./components/ResultsList.vue";

const results = ref([]);
const loading = ref(false);
const error = ref(null);

function onResults({ results: r, error: e, loading: l }) {
  results.value = r;
  error.value = e;
  loading.value = l;
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header class="bg-white shadow-sm">
      <div class="mx-auto max-w-3xl px-4 py-6">
        <h1 class="text-2xl font-bold tracking-tight">Scriptorium</h1>
        <p class="mt-1 text-sm text-gray-500">Semantic Bible Search</p>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-4 py-8">
      <SearchBar @search="onResults" />
      <ResultsList :results="results" :loading="loading" :error="error" />
    </main>
  </div>
</template>
