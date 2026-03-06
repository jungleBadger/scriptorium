<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "../ui/Icon.vue";
import { shouldShowEntitySubtypeTag } from "../../utils/entityTypeLabels.js";

const { t, te } = useI18n();

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

const GROUP_ORDER = {
  people: 10,
  places: 20,
  other: 100,
};

function getGroupTitle(groupKey) {
  if (groupKey === "people") return t("entities.groups.people");
  if (groupKey === "places") return t("entities.groups.places");
  if (groupKey === "other") return t("entities.groups.other");
  const normalized = groupKey.replace(/[_-]+/g, " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}s`;
}

function getSubtypeLabel(subtypeKey, groupKey) {
  const key = String(subtypeKey || "").trim().toLowerCase();
  if (!key) return groupKey === "people" ? t("entities.subtypes.person") : "";
  const normalizedKey = key.replace(/[\s_-]+/g, "_");
  const localeKey = `entities.subtypes.${normalizedKey}`;
  if (te(localeKey)) return t(localeKey);
  // Fall back to title-casing the raw key
  return key.split(/[\s_-]+/g).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

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

function getGroupIconName(groupKey) {
  if (groupKey === "places") return "MapPin";
  if (groupKey === "people") return "Users";
  return null;
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
    /(place|location|geo|region|river|mountain|hill|city|town|village|sea|lake|island|desert|valley|country|province|territory|wilderness|plain|kingdom|garden|spring|water)/.test(value)
  ) {
    return "places";
  }

  return getBaseType(type);
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
  const prefix = verses.length === 1 ? t("threads.chapterContext.verse") : t("threads.chapterContext.verses");
  return `${prefix} ${ranges.join(", ")}`;
}

function shouldShowSubtypeTag(entity) {
  return shouldShowEntitySubtypeTag(entity?.canonical_name, entity?.type);
}
</script>

<template>
  <div>
    <div
      v-if="thread.status === 'loading'"
      class="context-thread-skeleton"
      role="status"
      aria-live="polite"
      :aria-label="t('threads.chapterContext.loading')"
    >
      <section class="entity-group context-thread-skeleton__group">
        <div class="entity-group-toggle context-thread-skeleton__toggle" aria-hidden="true">
          <span class="context-thread-skeleton__toggle-line"></span>
          <span class="context-thread-skeleton__toggle-dot"></span>
        </div>
        <div class="stack-block context-thread-skeleton__body">
          <div class="context-thread-skeleton__line context-thread-skeleton__line--1"></div>
          <div class="context-thread-skeleton__line context-thread-skeleton__line--2"></div>
          <div class="context-thread-skeleton__line context-thread-skeleton__line--3"></div>
          <div class="context-thread-skeleton__line context-thread-skeleton__line--4"></div>
        </div>
      </section>

      <section class="entity-group context-thread-skeleton__group">
        <div class="entity-group-toggle context-thread-skeleton__toggle" aria-hidden="true">
          <span class="context-thread-skeleton__toggle-line context-thread-skeleton__toggle-line--short"></span>
          <span class="context-thread-skeleton__toggle-dot"></span>
        </div>
        <div class="entity-context-list context-thread-skeleton__list" aria-hidden="true">
          <div class="entity-context-row context-thread-skeleton__row">
            <div class="entity-context-body">
              <div class="context-thread-skeleton__name"></div>
              <div class="context-thread-skeleton__meta"></div>
            </div>
          </div>
          <div class="entity-context-row context-thread-skeleton__row">
            <div class="entity-context-body">
              <div class="context-thread-skeleton__name context-thread-skeleton__name--short"></div>
              <div class="context-thread-skeleton__meta context-thread-skeleton__meta--short"></div>
            </div>
          </div>
        </div>
      </section>

      <section class="entity-group context-thread-skeleton__group">
        <div class="entity-group-toggle context-thread-skeleton__toggle" aria-hidden="true">
          <span class="context-thread-skeleton__toggle-line context-thread-skeleton__toggle-line--shorter"></span>
          <span class="context-thread-skeleton__toggle-dot"></span>
        </div>
      </section>
    </div>
    <p v-else-if="thread.status === 'error'" class="state-error">{{ thread.error }}</p>
    <div v-else-if="data" class="stack-list">
      <section v-if="isFirstChapter" class="stack-block">
        <p class="section-label">{{ t('threads.chapterContext.bookIntro') }}</p>
        <p class="state-text">{{ t('threads.chapterContext.bookIntroUnavailable') }}</p>
      </section>

      <section class="entity-group">
        <button class="entity-group-toggle" type="button" @click="toggleChapterSummary">
          <span class="entity-group-title flex items-center gap-2">
            <Icon name="FileText" :size="18" class="text-neutral-600" aria-hidden="true" />
            <span>{{ t('threads.chapterContext.chapterSummary') }}</span>
          </span>
          <span class="entity-group-chevron">
            <Icon :name="chapterSummaryOpen ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
          </span>
        </button>

        <div v-if="chapterSummaryOpen" class="stack-block">
          <p v-if="explanation?.text" class="result-text">{{ explanation.text }}</p>
          <p v-else class="state-text">{{ t('threads.chapterContext.noSummary') }}</p>
          <p class="ai-disclaimer" :title="chapterSummaryMetaTitle || null">{{ t('threads.chapterContext.aiGenerated') }}</p>
        </div>
      </section>

      <div v-if="groupedEntities.length" class="entity-group-list">
        <section v-for="group in groupedEntities" :key="group.key" class="entity-group">
          <button class="entity-group-toggle" type="button" @click="toggleGroup(group.key)">
            <span class="entity-group-title flex items-center gap-2">
              <Icon
                v-if="getGroupIconName(group.key)"
                :name="getGroupIconName(group.key)"
                :size="18"
                class="text-neutral-600"
                aria-hidden="true"
              />
              <span>{{ group.title }} ({{ group.entities.length }})</span>
            </span>
            <span class="entity-group-chevron">
              <Icon :name="isGroupOpen(group.key) ? 'ChevronUp' : 'ChevronDown'" :size="16" class="text-neutral-600" aria-hidden="true" />
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
                  {{ t('threads.chapterContext.appearsIn') }} {{ formatVerseHint(entity.chapter_verses) }}
                </p>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>

    <p v-else class="state-text">{{ t('threads.chapterContext.noContext') }}</p>
  </div>
</template>
