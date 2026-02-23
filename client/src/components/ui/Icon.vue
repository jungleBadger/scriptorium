<script setup>
import { computed, useAttrs, watchEffect } from "vue";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Copy,
  FileText,
  Gauge,
  Link,
  MapPin,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Users,
  Volume2,
  X,
} from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const ICONS = {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Copy,
  FileText,
  Gauge,
  Link,
  MapPin,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Users,
  Volume2,
  X,
};

const warnedMissingIcons = new Set();

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 18 },
});

const attrs = useAttrs();

const icon = computed(() => {
  const key = String(props.name || "").trim();
  return key ? ICONS[key] || null : null;
});

watchEffect(() => {
  const key = String(props.name || "").trim();
  if (!key || icon.value || warnedMissingIcons.has(key)) return;
  warnedMissingIcons.add(key);
  console.warn(`[Icon] Unknown icon name "${key}"`);
});
</script>

<template>
  <component
    v-if="icon"
    :is="icon"
    :size="size"
    class="inline-block stroke-[1.75]"
    v-bind="attrs"
  />
</template>
