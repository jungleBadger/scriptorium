const SUBTYPE_LABELS = {
  place: "Place",
  places: "Place",
  location: "Place",
  geo: "Place",
  region: "Region",
  river: "River",
  mountain: "Mountain",
  hill: "Hill",
  city: "City",
  town: "Town",
  village: "Village",
  sea: "Sea",
  lake: "Lake",
  island: "Island",
  desert: "Desert",
  valley: "Valley",
  country: "Country",
  province: "Province",
  territory: "Territory",
  wilderness: "Wilderness",
  plain: "Plain",
  kingdom: "Kingdom",
  person: "Person",
  people: "Person",
  human: "Person",
  character: "Person",
  prophet: "Prophet",
  king: "King",
  queen: "Queen",
  priest: "Priest",
  apostle: "Apostle",
  disciple: "Disciple",
  tribe: "Tribe",
  nation: "Nation",
  group: "Group",
};

function cleanType(type) {
  return String(type || "").trim().toLowerCase();
}

export function getEntityTypeParts(type) {
  const value = cleanType(type);
  if (!value) return { raw: "", groupKey: "other", subtypeKey: "" };

  const parts = value.split(".").filter(Boolean);
  const base = parts[0] || value;
  const last = parts[parts.length - 1] || base;

  let groupKey = "other";
  if (/(person|people|human|tribe|clan|family|ethnic|nation|group|character|prophet|king|queen|priest|apostle|disciple)/.test(value)) {
    groupKey = "people";
  } else if (/(place|location|geo|region|river|mountain|hill|city|town|village|sea|lake|island|desert|valley|country|province|territory|wilderness|plain|kingdom)/.test(value)) {
    groupKey = "places";
  } else if (base === "people") {
    groupKey = "people";
  } else if (base === "place" || base === "places") {
    groupKey = "places";
  }

  let subtypeKey = last;
  if (!subtypeKey || subtypeKey === "other") subtypeKey = "";
  if (subtypeKey === "people" || subtypeKey === "human" || subtypeKey === "character") subtypeKey = "person";
  if (subtypeKey === "place" || subtypeKey === "places" || subtypeKey === "location" || subtypeKey === "geo") subtypeKey = "place";

  return { raw: value, groupKey, subtypeKey };
}

export function formatEntitySubtypeLabel(type, fallback = "Unknown") {
  const { subtypeKey, groupKey } = getEntityTypeParts(type);
  const key = String(subtypeKey || "").trim().toLowerCase();
  if (key && SUBTYPE_LABELS[key]) return SUBTYPE_LABELS[key];
  if (key) {
    return key
      .split(/[_-]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  if (groupKey === "people") return "Person";
  if (groupKey === "places") return "Place";
  return fallback;
}

export function formatEntityTypeLabel(type, { includeGroup = false, fallback = "Unknown" } = {}) {
  const { groupKey } = getEntityTypeParts(type);
  const subtypeLabel = formatEntitySubtypeLabel(type, fallback);
  if (!includeGroup) return subtypeLabel;

  const groupLabel =
    groupKey === "people" ? "People" :
    groupKey === "places" ? "Places" :
    groupKey && groupKey !== "other"
      ? groupKey.charAt(0).toUpperCase() + groupKey.slice(1)
      : "";

  if (!groupLabel) return subtypeLabel;
  const normalizedSubtype = String(subtypeLabel || "").trim().toLowerCase();
  const normalizedGroup = groupLabel.toLowerCase();
  if (!normalizedSubtype || normalizedSubtype === "unknown") return groupLabel;
  if (normalizedSubtype === "person" && normalizedGroup === "people") return groupLabel;
  if (normalizedSubtype === "place" && normalizedGroup === "places") return groupLabel;
  return `${groupLabel} • ${subtypeLabel}`;
}

export function shouldShowEntitySubtypeTag(name, type) {
  const subtypeLabel = formatEntitySubtypeLabel(type, "");
  const subtypeKey = getEntityTypeParts(type).subtypeKey;
  if (!subtypeLabel) return false;
  const n = String(name || "").trim().toLowerCase();
  const k = String(subtypeKey || "").trim().toLowerCase();
  if (!n) return true;
  if (k === "person" || k === "place") return false;
  if (k && (n === k || n.endsWith(` (${k})`))) return false;
  if (n.includes(`(${subtypeLabel.toLowerCase()})`)) return false;
  return true;
}

