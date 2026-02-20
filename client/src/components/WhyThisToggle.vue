<script setup>
import { ref } from "vue";

defineProps({
  result: { type: Object, required: true },
});

const open = ref(false);
</script>

<template>
  <div class="why-this">
    <button class="ghost-btn compact" type="button" @click="open = !open">
      {{ open ? "Hide why" : "Why this?" }}
    </button>

    <div v-if="open" class="why-panel">
      <p><strong>Final:</strong> {{ result.final_score?.toFixed(4) }}</p>
      <p><strong>Semantic:</strong> {{ result.semantic_score?.toFixed(4) }}</p>
      <p><strong>Evidence:</strong> {{ result.evidence_score?.toFixed(4) }}</p>

      <div v-if="result.evidence?.keyword_hits?.length" class="chip-row">
        <span class="chip" v-for="hit in result.evidence.keyword_hits" :key="hit">{{ hit }}</span>
      </div>

      <ul v-if="result.evidence?.notes?.length" class="note-list">
        <li v-for="note in result.evidence.notes" :key="note">{{ note }}</li>
      </ul>
    </div>
  </div>
</template>
