<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  thread: { type: Object, required: true },
  selectedEntityId: { type: Number, default: null },
});

const emit = defineEmits(["select-entity", "open-entity"]);

const data = computed(() => props.thread.data || null);
const explanation = computed(() => data.value?.explanation || null);
const entities = computed(() => data.value?.entities || []);
const isFirstChapter = computed(() => {
  const chapterFromData = Number(data.value?.chapter);
  if (Number.isFinite(chapterFromData)) return chapterFromData === 1;
  const chapterFromAnchor = Number(props.thread?.anchor?.chapter);
  return Number.isFinite(chapterFromAnchor) ? chapterFromAnchor === 1 : false;
});
const chapterSummaryMetaTitle = computed(() => {
  const model = String(explanation.value?.model || "").trim();
  const generatedAt = formatDate(explanation.value?.generated_at);
  const parts = [];
  if (model) parts.push(`Model: ${model}`);
  if (generatedAt) parts.push(`Generated: ${generatedAt}`);
  return parts.join(" | ");
});

const GROUP_LABELS = {
  people: "People",
  place: "Places",
  other: "Other Entities",
};

const GROUP_ORDER = {
  people: 20,
  place: 10,
  other: 100,
};

const groupedEntities = computed(() => {
  const groups = new Map();
  for (const entity of entities.value) {
    const groupKey = getGroupKey(entity.type);
    const title = getGroupTitle(groupKey);
    const order = GROUP_ORDER[groupKey] ?? 100;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { key: groupKey, title, order, entities: [] });
    }
    groups.get(groupKey).entities.push(entity);
  }

  const entries = [...groups.values()];
  for (const group of entries) {
    group.entities.sort((a, b) => String(a.canonical_name || "").localeCompare(String(b.canonical_name || "")));
  }

  return entries.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });
});

const groupOpenState = ref({});
const chapterSummaryOpen = ref(true);

watch(
  groupedEntities,
  (groups) => {
    const next = { ...groupOpenState.value };
    const activeKeys = new Set(groups.map((group) => group.key));

    for (const group of groups) {
      if (typeof next[group.key] === "boolean") continue;
      next[group.key] = group.key === "place" || group.key === "people";
    }

    for (const key of Object.keys(next)) {
      if (!activeKeys.has(key)) delete next[key];
    }

    groupOpenState.value = next;
  },
  { immediate: true }
);

function openEntity(entity) {
  if (props.selectedEntityId === entity.id) {
    emit("select-entity", { entityId: null });
    return;
  }
  emit("select-entity", { entityId: entity.id });
  emit("open-entity", {
    entityId: entity.id,
    name: entity.canonical_name,
    anchor: props.thread.anchor,
  });
}

function isGroupOpen(groupKey) {
  return groupOpenState.value[groupKey] !== false;
}

function toggleGroup(groupKey) {
  groupOpenState.value = {
    ...groupOpenState.value,
    [groupKey]: !isGroupOpen(groupKey),
  };
}

function toggleChapterSummary() {
  chapterSummaryOpen.value = !chapterSummaryOpen.value;
}

function getBaseType(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!value) return "other";
  return value.split(".")[0] || "other";
}

function getGroupKey(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!value) return "other";

  if (
    /(person|people|human|tribe|clan|family|ethnic|nation|group|character|prophet|king|queen|priest|apostle|disciple)/.test(value)
  ) {
    return "people";
  }

  if (
    /(place|location|geo|region|river|mountain|city|town|village|sea|lake|island|desert|valley|country)/.test(value)
  ) {
    return "place";
  }

  return getBaseType(type);
}

function getGroupTitle(groupKey) {
  if (GROUP_LABELS[groupKey]) return GROUP_LABELS[groupKey];
  if (groupKey === "other") return GROUP_LABELS.other;
  const normalized = groupKey.replace(/[_-]+/g, " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}s`;
}

function formatSubtype(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!value) return "unknown";
  const parts = value.split(".").filter(Boolean);
  const subtype = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return subtype.replace(/[_-]+/g, " ");
}

function formatDate(iso) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
}

function formatVerseHint(chapterVerses) {
  if (!Array.isArray(chapterVerses) || !chapterVerses.length) return "";
  const verses = chapterVerses
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!verses.length) return "";
  const prefix = verses.length === 1 ? "v." : "vv.";
  return `${prefix} ${verses.join(", ")}`;
}
</script>

<template>
  <div>
    <p v-if="thread.status === 'loading'" class="state-text">Loading chapter context...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <div v-else-if="data" class="stack-list">
      <section v-if="isFirstChapter" class="stack-block">
        <p class="section-label">Book Introduction</p>
        <p class="state-text">Book introduction is not available yet.</p>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="toggleChapterSummary">
          <span class="entity-group-title">Chapter Summary</span>
          <span :class="['entity-group-chevron', { 'entity-group-chevron--open': chapterSummaryOpen }]">
            v
          </span>
        </button>

        <div v-if="chapterSummaryOpen" class="stack-block">
          <p v-if="explanation?.text" class="result-text">{{ explanation.text }}</p>
          <p v-else class="state-text">No summary generated for this chapter yet.</p>
          <p class="ai-disclaimer" :title="chapterSummaryMetaTitle || null">Generated with AI - may contain errors</p>
        </div>
      </section>

      <div v-if="entities.length" class="entity-group-list">
        <section v-for="group in groupedEntities" :key="group.key" class="entity-group">
          <button class="entity-group-toggle" type="button" @click="toggleGroup(group.key)">
            <span class="entity-group-title">{{ group.title }} ({{ group.entities.length }})</span>
            <span :class="['entity-group-chevron', { 'entity-group-chevron--open': isGroupOpen(group.key) }]">
              v
            </span>
          </button>

          <div v-if="isGroupOpen(group.key)" class="entity-context-list">
            <article
              v-for="entity in group.entities"
              :key="entity.id"
              :class="['entity-context-row', { 'entity-context-row--selected': selectedEntityId === entity.id }]"
              @click="openEntity(entity)"
            >
              <div class="entity-context-body">
                <p class="entity-name">
                  {{ entity.canonical_name }}
                  <span class="entity-subtype">({{ formatSubtype(entity.type) }})</span>
                </p>

                <p v-if="entity.chapter_verses?.length" class="verse-hint">
                  Appears in: {{ formatVerseHint(entity.chapter_verses) }}
                </p>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>

    <p v-else class="state-text">No context available for this chapter.</p>
  </div>
</template>

