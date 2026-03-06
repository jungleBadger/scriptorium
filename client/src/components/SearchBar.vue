<script setup>
import { ref } from "vue";
import { getApiErrorMessage, search } from "../services/api.js";

const emit = defineEmits(["search"]);
const query = ref("");

async function handleSubmit() {
  const q = query.value.trim();
  if (!q) return;

  emit("search", { results: [], error: null, loading: true });

  try {
    const results = await search({ q });
    emit("search", { results, error: null, loading: false });
  } catch (err) {
    emit("search", {
      results: [],
      error: getApiErrorMessage(err, { context: "search" }),
      loading: false,
    });
  }
}
</script>

<template>
  <form class="search-bar" @submit.prevent="handleSubmit">
    <input
      v-model="query"
      type="text"
      placeholder="Search the Bible..."
      class="search-bar__input"
    />
    <button
      type="submit"
      class="search-bar__submit"
    >
      Search
    </button>
  </form>
</template>

<style scoped>
.search-bar {
  display: flex;
  gap: 0.5rem;
}

.search-bar__input {
  flex: 1;
  border-radius: 0.65rem;
  border: 1px solid var(--line);
  background: var(--input-bg);
  color: var(--ink);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}

.search-bar__input::placeholder {
  color: var(--muted);
}

.search-bar__input:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.search-bar__submit {
  border-radius: 0.65rem;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text);
  padding: 0.5rem 0.9rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.search-bar__submit:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.search-bar__submit:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
</style>
