<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  title: { type: String, default: "Location" },
  language: { type: String, default: "en" },
});

const mapEl = ref(null);

let mapInstance = null;
let markerInstance = null;
let tileLayerInstance = null;
let resizeObserver = null;
let leafletModule = null;
let leafletAssetsLoaded = false;

function hasValidCoords() {
  return Number.isFinite(props.lat) && Number.isFinite(props.lon);
}

const osmHref = computed(() => {
  if (!hasValidCoords()) return "https://www.openstreetmap.org";
  const lat = Number(props.lat).toFixed(6);
  const lon = Number(props.lon).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=9/${lat}/${lon}`;
});

const tileLanguage = computed(() => (String(props.language || "").toLowerCase() === "pt" ? "pt" : "en"));

function getPrimaryTileConfig(language) {
  return {
    url: `https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png?lang=${encodeURIComponent(language)}`,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; Wikimedia maps',
  };
}

function getFallbackTileConfig() {
  return {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

async function loadLeaflet() {
  if (leafletModule) return leafletModule;
  const [{ default: L }] = await Promise.all([
    import("leaflet"),
    import("leaflet/dist/leaflet.css"),
  ]);

  if (!leafletAssetsLoaded) {
    const [icon2x, icon1x, shadow] = await Promise.all([
      import("leaflet/dist/images/marker-icon-2x.png"),
      import("leaflet/dist/images/marker-icon.png"),
      import("leaflet/dist/images/marker-shadow.png"),
    ]);

    L.Icon.Default.mergeOptions({
      iconRetinaUrl: icon2x.default,
      iconUrl: icon1x.default,
      shadowUrl: shadow.default,
    });
    leafletAssetsLoaded = true;
  }

  leafletModule = L;
  return L;
}

function invalidateSizeSoon() {
  if (!mapInstance) return;
  setTimeout(() => {
    if (!mapInstance) return;
    mapInstance.invalidateSize();
  }, 80);
}

function setTileLayer(language) {
  if (!mapInstance || !leafletModule) return;
  const L = leafletModule;

  tileLayerInstance?.remove();
  tileLayerInstance = null;

  const primary = getPrimaryTileConfig(language);
  const fallback = getFallbackTileConfig();
  const primaryLayer = L.tileLayer(primary.url, {
    maxZoom: 19,
    attribution: primary.attribution,
  });

  primaryLayer.addTo(mapInstance);
  tileLayerInstance = primaryLayer;

  let switchedToFallback = false;
  primaryLayer.on("tileerror", () => {
    if (switchedToFallback || !mapInstance) return;
    switchedToFallback = true;
    primaryLayer.remove();
    tileLayerInstance = L.tileLayer(fallback.url, {
      maxZoom: 19,
      attribution: fallback.attribution,
    });
    tileLayerInstance.addTo(mapInstance);
  });
}

async function initMap() {
  if (!mapEl.value || mapInstance || !hasValidCoords()) return;
  const L = await loadLeaflet();
  if (!mapEl.value || mapInstance) return;

  mapInstance = L.map(mapEl.value, {
    scrollWheelZoom: false,
    zoomControl: true,
    attributionControl: true,
    dragging: true,
  });

  setTileLayer(tileLanguage.value);

  markerInstance = L.marker([props.lat, props.lon]).addTo(mapInstance);
  mapInstance.setView([props.lat, props.lon], 8);

  await nextTick();
  invalidateSizeSoon();

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => invalidateSizeSoon());
    resizeObserver.observe(mapEl.value);
  }
}

function syncMarker() {
  if (!mapInstance || !markerInstance || !hasValidCoords()) return;
  markerInstance.setLatLng([props.lat, props.lon]);
  mapInstance.setView([props.lat, props.lon], mapInstance.getZoom() || 8);
  invalidateSizeSoon();
}

function destroyMap() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (mapInstance) {
    mapInstance.remove();
  }
  mapInstance = null;
  markerInstance = null;
  tileLayerInstance = null;
}

watch(
  () => [props.lat, props.lon],
  () => {
    if (!hasValidCoords()) return;
    if (!mapInstance) {
      void initMap();
      return;
    }
    syncMarker();
  }
);

watch(tileLanguage, (nextLanguage, prevLanguage) => {
  if (!mapInstance || !leafletModule) return;
  if (nextLanguage === prevLanguage) return;
  setTileLayer(nextLanguage);
});

onMounted(() => {
  void initMap();
});

onBeforeUnmount(() => {
  destroyMap();
});
</script>

<template>
  <div class="map-card">
    <div ref="mapEl" class="map-card-canvas" role="img" :aria-label="`${title} location map`"></div>
    <div class="map-card-footer">
      <p class="geo-coords">{{ lat.toFixed(4) }}, {{ lon.toFixed(4) }}</p>
      <a class="map-card-link" :href="osmHref" target="_blank" rel="noopener noreferrer">
        Open in OpenStreetMap
      </a>
    </div>
  </div>
</template>
