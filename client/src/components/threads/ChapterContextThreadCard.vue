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
  places: "Places",
  other: "Other Entities",
};

const GROUP_ORDER = {
  people: 10,
  places: 20,
  other: 100,
};

const SUBTYPE_LABELS = {
  river: "River",
  place: "Place",
  mountain: "Mountain",
  hill: "Hill",
  region: "Region",
  city: "City",
  town: "Town",
  village: "Village",
  country: "Country",
  nation: "Nation",
  sea: "Sea",
  lake: "Lake",
  island: "Island",
  desert: "Desert",
  valley: "Valley",
  wilderness: "Wilderness",
  plain: "Plain",
  province: "Province",
  territory: "Territory",
  kingdom: "Kingdom",
  person: "Person",
  people: "People",
  king: "King",
  queen: "Queen",
  prophet: "Prophet",
  priest: "Priest",
  apostle: "Apostle",
  disciple: "Disciple",
  tribe: "Tribe",
};

function normalizeEntitiesForInsights(source) {
  const deduped = new Map();

  for (const raw of Array.isArray(source) ? source : []) {
    if (!raw || typeof raw !== "object") continue;

    const canonicalName = String(raw.canonical_name || raw.name || "").trim();
    const normalizedType = normalizeEntityType(raw.type);
    const dedupeKey = getEntityDedupeKey(raw, canonicalName, normalizedType.subtypeKey);
    if (!dedupeKey) continue;

    const chapterVerses = normalizeVerseList(raw.chapter_verses);
    const entityId = Number(raw.id);
    const id = Number.isFinite(entityId) ? entityId : null;

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, {
        ...raw,
        id,
        canonical_name: canonicalName || "Unknown",
        type: String(raw.type || ""),
        groupKey: normalizedType.groupKey,
        groupTitle: getGroupTitle(normalizedType.groupKey),
        subtypeKey: normalizedType.subtypeKey,
        subtypeLabel: normalizedType.subtypeLabel,
        chapter_verses: chapterVerses,
        occurrenceCount: chapterVerses.length,
        _sortName: (canonicalName || "Unknown").toLocaleLowerCase(),
        _dedupeKey: dedupeKey,
      });
      continue;
    }

    existing.chapter_verses = normalizeVerseList([...(existing.chapter_verses || []), ...chapterVerses]);
    existing.occurrenceCount = existing.chapter_verses.length;

    // Prefer richer naming/type info if the first record was sparse.
    if ((!existing.canonical_name || existing.canonical_name === "Unknown") && canonicalName) {
      existing.canonical_name = canonicalName;
      existing._sortName = canonicalName.toLocaleLowerCase();
    }
    if (!existing.subtypeKey && normalizedType.subtypeKey) {
      existing.subtypeKey = normalizedType.subtypeKey;
      existing.subtypeLabel = normalizedType.subtypeLabel;
    }
    if (!existing.id && id) existing.id = id;
  }

  return [...deduped.values()];
}

const groupedEntities = computed(() => {
  const groups = new Map();
  for (const entity of normalizeEntitiesForInsights(entities.value)) {
    const groupKey = entity.groupKey || "other";
    const title = entity.groupTitle || getGroupTitle(groupKey);
    const order = GROUP_ORDER[groupKey] ?? 100;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { key: groupKey, title, order, entities: [] });
    }
    groups.get(groupKey).entities.push(entity);
  }

  const entries = [...groups.values()];
  for (const group of entries) {
    group.entities.sort((a, b) => {
      const countDiff = (b.occurrenceCount || 0) - (a.occurrenceCount || 0);
      if (countDiff) return countDiff;
      return String(a._sortName || a.canonical_name || "").localeCompare(String(b._sortName || b.canonical_name || ""));
    });
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
      next[group.key] = group.key === "places" || group.key === "people";
    }

    for (const key of Object.keys(next)) {
      if (!activeKeys.has(key)) delete next[key];
    }

    groupOpenState.value = next;
  },
  { immediate: true }
);

function openEntity(entity) {
  if (!entity?.id) return;
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
    /(place|location|geo|region|river|mountain|hill|city|town|village|sea|lake|island|desert|valley|country|province|territory|wilderness|plain|kingdom)/.test(value)
  ) {
    return "places";
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

function normalizeEntityType(type) {
  const raw = String(type || "").trim().toLowerCase();
  const groupKey = getGroupKey(raw);
  const rawSubtype = formatSubtype(raw);
  const subtypeKey = normalizeSubtypeKey(rawSubtype, groupKey);
  return {
    groupKey,
    subtypeKey,
    subtypeLabel: getSubtypeLabel(subtypeKey, groupKey),
  };
}

function normalizeSubtypeKey(subtype, groupKey) {
  const value = String(subtype || "").trim().toLowerCase();
  if (!value || value === "other") return groupKey === "people" ? "person" : "";
  if (value === "place" || value === "places" || value === "location" || value === "geo") return "place";
  if (value === "people" || value === "human" || value === "character") return "person";
  return value;
}

function getSubtypeLabel(subtypeKey, groupKey) {
  const key = String(subtypeKey || "").trim().toLowerCase();
  if (!key) return groupKey === "people" ? "Person" : "";
  if (SUBTYPE_LABELS[key]) return SUBTYPE_LABELS[key];
  return key
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getEntityDedupeKey(entity, canonicalName, subtypeKey) {
  const numericId = Number(entity?.id);
  if (Number.isFinite(numericId)) return `id:${numericId}`;
  const nameKey = String(canonicalName || "").trim().toLowerCase();
  if (nameKey) return `name:${nameKey}`;
  if (nameKey || subtypeKey) return `nameSubtype:${nameKey}|${String(subtypeKey || "").toLowerCase()}`;
  return null;
}

function normalizeVerseList(values) {
  const unique = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) unique.add(n);
  }
  return [...unique].sort((a, b) => a - b);
}

function formatDate(iso) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
}

function formatVerseHint(chapterVerses) {
  if (!Array.isArray(chapterVerses) || !chapterVerses.length) return "";
  const verses = normalizeVerseList(chapterVerses);
  if (!verses.length) return "";
  const ranges = [];
  let start = verses[0];
  let prev = verses[0];
  for (let i = 1; i < verses.length; i += 1) {
    const current = verses[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  const prefix = verses.length === 1 ? "v." : "vv.";
  return `${prefix} ${ranges.join(", ")}`;
}

function shouldShowSubtypeTag(entity) {
  const subtype = String(entity?.subtypeLabel || "").trim();
  if (!subtype) return false;
  const name = String(entity?.canonical_name || "").trim().toLowerCase();
  const subtypeKey = String(entity?.subtypeKey || "").trim().toLowerCase();
  if (entity?.groupKey === "people" && subtypeKey === "person") return false;
  if (entity?.groupKey === "places" && subtypeKey === "place") return false;
  if (!name) return true;
  if (subtypeKey && (name === subtypeKey || name.endsWith(` (${subtypeKey})`))) return false;
  if (name.includes(`(${subtype.toLowerCase()})`)) return false;
  return true;
}
</script>

<template>
  <div>
    <p v-if="thread.status === 'loading'" class="state-text">Loading chapter context...</p>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <div v-else-if="data" class="stack-list">
      <section v-if="isFirstChapter" class="stack-block">
        <p class="section-label">Book introduction</p>
        <p class="state-text">Book introduction is not available yet.</p>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="toggleChapterSummary">
          <span class="entity-group-title">Chapter summary</span>
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

      <div v-if="groupedEntities.length" class="entity-group-list">
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
              :key="entity.id ?? entity._dedupeKey"
              :class="['entity-context-row', { 'entity-context-row--selected': selectedEntityId === entity.id }]"
              @click="openEntity(entity)"
            >
              <div class="entity-context-body">
                <p class="entity-name">
                  {{ entity.canonical_name }}
                  <span v-if="shouldShowSubtypeTag(entity)" class="entity-subtype" :title="entity.subtypeLabel">
                    {{ entity.subtypeLabel }}
                  </span>
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

