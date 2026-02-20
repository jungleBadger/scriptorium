// ingest/scripts/load_openbible_full.mjs
// Deterministic OpenBible ingest:
//   source.jsonl -> image.jsonl -> geometry.jsonl -> modern.jsonl -> ancient.jsonl
//
// Usage:
//   node ingest/scripts/load_openbible_full.mjs ingest/data

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Client } from "pg";
import { parseUsx } from "./015_osis_book_map.mjs";

const SOURCE_ID_RE = /^s[0-9a-f]{6}$/i;
const IMAGE_ID_RE = /^i[0-9a-f]{6}$/i;
const MODERN_ID_RE = /^m[0-9a-f]{6}$/i;
const GEOMETRY_ID_RE = /^g[0-9a-f]{6}$/i;

function normalizeId(value) {
    if (typeof value !== "string") return null;
    const t = value.trim();
    if (!t) return null;
    return t.toLowerCase();
}

function parseLonLat(rawLonLat) {
    if (typeof rawLonLat !== "string" || !rawLonLat.includes(",")) {
        return null;
    }
    const [lonStr, latStr] = rawLonLat.split(",", 2);
    const lon = Number.parseFloat(lonStr);
    const lat = Number.parseFloat(latStr);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    return { lon, lat };
}

function toInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

function toFloat(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

function asJson(value, fallback) {
    if (value == null) return JSON.stringify(fallback);
    return JSON.stringify(value);
}

function extractMatches(text, regex) {
    if (typeof text !== "string") return [];
    const out = [];
    const r = new RegExp(regex.source, regex.flags);
    let m = r.exec(text);
    while (m) {
        out.push(m[0].toLowerCase());
        m = r.exec(text);
    }
    return out;
}

function extractGeometryId(value) {
    if (typeof value !== "string") return null;
    const m = value.match(/\bg[0-9a-f]{6}\b/i);
    return m ? m[0].toLowerCase() : null;
}

function dedupeByKey(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = keyFn(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function pushImageRef(list, imageId, role, context) {
    const image_id = normalizeId(imageId);
    if (!image_id || !IMAGE_ID_RE.test(image_id)) return;
    list.push({
        image_id,
        role: role || "unspecified",
        context: context || {},
    });
}

function collectImageRefs(value, pathParts = [], out = []) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            collectImageRefs(value[i], [...pathParts, String(i)], out);
        }
        return out;
    }
    if (!value || typeof value !== "object") return out;

    if (typeof value.image_id === "string") {
        const role = typeof value.role === "string"
            ? value.role
            : (pathParts[pathParts.length - 1] || "unspecified");
        pushImageRef(out, value.image_id, role, {
            path: pathParts.join("."),
            file: value.file || null,
            description: value.description || null,
        });
    }

    for (const [k, v] of Object.entries(value)) {
        collectImageRefs(v, [...pathParts, k], out);
    }
    return out;
}

function collectGeometryRefs(value, pathParts = [], out = []) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            collectGeometryRefs(value[i], [...pathParts, String(i)], out);
        }
        return out;
    }
    if (!value || typeof value !== "object") return out;

    for (const [k, v] of Object.entries(value)) {
        if (typeof v === "string") {
            const geometry_id = extractGeometryId(v);
            if (geometry_id && GEOMETRY_ID_RE.test(geometry_id)) {
                const role = k === "id"
                    ? (pathParts[pathParts.length - 1] || "id")
                    : k;
                out.push({
                    geometry_id,
                    role: role || "unspecified",
                    context: { path: [...pathParts, k].join(".") },
                });
            }
        }
        collectGeometryRefs(v, [...pathParts, k], out);
    }
    return out;
}

function tupleCompare(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return -1;
    }
    return 0;
}

function scoreValue(v) {
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

function chooseBestAncientResolution(identifications, counters) {
    let best = null;

    for (let i = 0; i < identifications.length; i++) {
        const ident = identifications[i];
        const resolutions = Array.isArray(ident?.resolutions) ? ident.resolutions : [];
        const identTime = scoreValue(ident?.score?.time_total);
        const identVote = scoreValue(ident?.score?.vote_total);

        for (let j = 0; j < resolutions.length; j++) {
            const res = resolutions[j];
            if (res?.lonlat && !parseLonLat(res.lonlat)) {
                counters.invalidAncientCoords++;
            }
            const parsed = parseLonLat(res?.lonlat);
            if (!parsed) continue;

            const tuple = [
                scoreValue(res?.best_time_score),
                scoreValue(res?.best_path_score),
                identTime,
                identVote,
                -i,
                -j,
            ];
            if (!best || tupleCompare(tuple, best.tuple) > 0) {
                best = { ...parsed, resolution: res, tuple };
            }
        }
    }

    return best;
}

function parseExtraJson(extra) {
    if (typeof extra !== "string" || !extra.trim()) return null;
    try {
        return JSON.parse(extra);
    } catch {
        return null;
    }
}

function getDataFiles(inputDir) {
    const required = {
        ancient: path.join(inputDir, "ancient.jsonl"),
        modern: path.join(inputDir, "modern.jsonl"),
        geometry: path.join(inputDir, "geometry.jsonl"),
        source: path.join(inputDir, "source.jsonl"),
        image: path.join(inputDir, "image.jsonl"),
    };

    for (const [name, filePath] of Object.entries(required)) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing required file for ${name}: ${filePath}`);
        }
    }

    return required;
}

async function forEachJsonl(filePath, onRecord) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });

    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        const t = line.trim();
        if (!t) continue;
        let rec;
        try {
            rec = JSON.parse(t);
        } catch {
            throw new Error(`Invalid JSON in ${filePath}:${lineNo}`);
        }
        await onRecord(rec, lineNo);
    }
}

async function main() {
    const inputDir = process.argv[2] || path.join("ingest", "data");
    const files = getDataFiles(inputDir);

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });

    const counters = {
        sources: 0,
        images: 0,
        geometries: 0,
        modern: 0,
        modernSourceLinks: 0,
        modernImageLinks: 0,
        modernGeometryLinks: 0,
        ancient: 0,
        aliases: 0,
        verses: 0,
        entityModernLinks: 0,
        entitySourceLinks: 0,
        entityImageLinks: 0,
        entityGeometryLinks: 0,
        invalidAncientCoords: 0,
        invalidModernCoords: 0,
    };

    const seenOpenBibleEntityIds = new Set();

    const insertSource = `
        INSERT INTO openbible_sources (
            id, friendly_id, display_name, abbreviation, source_type, publisher, year, url, vote_count, contributors, raw
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
        ON CONFLICT (id) DO UPDATE SET
            friendly_id = EXCLUDED.friendly_id,
            display_name = EXCLUDED.display_name,
            abbreviation = EXCLUDED.abbreviation,
            source_type = EXCLUDED.source_type,
            publisher = EXCLUDED.publisher,
            year = EXCLUDED.year,
            url = EXCLUDED.url,
            vote_count = EXCLUDED.vote_count,
            contributors = EXCLUDED.contributors,
            raw = EXCLUDED.raw
    `;

    const insertImage = `
        INSERT INTO openbible_images (
            id, description, credit, credit_url, license, color, role, person, meters_per_pixel,
            image_url, thumbnail_url_pattern, width, height, descriptions, thumbnails, raw
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
            description = EXCLUDED.description,
            credit = EXCLUDED.credit,
            credit_url = EXCLUDED.credit_url,
            license = EXCLUDED.license,
            color = EXCLUDED.color,
            role = EXCLUDED.role,
            person = EXCLUDED.person,
            meters_per_pixel = EXCLUDED.meters_per_pixel,
            image_url = EXCLUDED.image_url,
            thumbnail_url_pattern = EXCLUDED.thumbnail_url_pattern,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            descriptions = EXCLUDED.descriptions,
            thumbnails = EXCLUDED.thumbnails,
            raw = EXCLUDED.raw
    `;

    const insertGeometry = `
        INSERT INTO openbible_geometries (
            id, format, name, source, source_url, source_urls, geometry_type, modifier, land_or_water,
            geojson_file, simplified_geojson_file, kml_file, isobands_geojson_file, min_confidence, max_confidence, raw
        ) VALUES (
            $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
            format = EXCLUDED.format,
            name = EXCLUDED.name,
            source = EXCLUDED.source,
            source_url = EXCLUDED.source_url,
            source_urls = EXCLUDED.source_urls,
            geometry_type = EXCLUDED.geometry_type,
            modifier = EXCLUDED.modifier,
            land_or_water = EXCLUDED.land_or_water,
            geojson_file = EXCLUDED.geojson_file,
            simplified_geojson_file = EXCLUDED.simplified_geojson_file,
            kml_file = EXCLUDED.kml_file,
            isobands_geojson_file = EXCLUDED.isobands_geojson_file,
            min_confidence = EXCLUDED.min_confidence,
            max_confidence = EXCLUDED.max_confidence,
            raw = EXCLUDED.raw
    `;

    const insertModern = `
        INSERT INTO openbible_modern (
            id, friendly_id, url_slug, class, modern_type, geometry, geometry_credit, land_or_water,
            lon, lat, preceding_article, geojson_file, kml_file, root, custom_lonlat,
            coordinates_source, precision, names, media, ancient_associations,
            accuracy_claims, precision_claims, raw
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15,
            $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb,
            $21::jsonb, $22::jsonb, $23::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
            friendly_id = EXCLUDED.friendly_id,
            url_slug = EXCLUDED.url_slug,
            class = EXCLUDED.class,
            modern_type = EXCLUDED.modern_type,
            geometry = EXCLUDED.geometry,
            geometry_credit = EXCLUDED.geometry_credit,
            land_or_water = EXCLUDED.land_or_water,
            lon = EXCLUDED.lon,
            lat = EXCLUDED.lat,
            preceding_article = EXCLUDED.preceding_article,
            geojson_file = EXCLUDED.geojson_file,
            kml_file = EXCLUDED.kml_file,
            root = EXCLUDED.root,
            custom_lonlat = EXCLUDED.custom_lonlat,
            coordinates_source = EXCLUDED.coordinates_source,
            precision = EXCLUDED.precision,
            names = EXCLUDED.names,
            media = EXCLUDED.media,
            ancient_associations = EXCLUDED.ancient_associations,
            accuracy_claims = EXCLUDED.accuracy_claims,
            precision_claims = EXCLUDED.precision_claims,
            raw = EXCLUDED.raw
    `;

    const insertModernSourceLink = `
        INSERT INTO openbible_modern_source_links (modern_id, source_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_modern WHERE id = $1)
          AND EXISTS (SELECT 1 FROM openbible_sources WHERE id = $2)
        ON CONFLICT (modern_id, source_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    const insertModernImageLink = `
        INSERT INTO openbible_modern_image_links (modern_id, image_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_modern WHERE id = $1)
          AND EXISTS (SELECT 1 FROM openbible_images WHERE id = $2)
        ON CONFLICT (modern_id, image_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    const insertModernGeometryLink = `
        INSERT INTO openbible_modern_geometry_links (modern_id, geometry_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_modern WHERE id = $1)
          AND EXISTS (SELECT 1 FROM openbible_geometries WHERE id = $2)
        ON CONFLICT (modern_id, geometry_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    const upsertEntity = `
        INSERT INTO entities (canonical_name, type, lon, lat, source, source_id, metadata)
        VALUES ($1, $2, $3, $4, 'openbible', $5, $6::jsonb)
        ON CONFLICT (source, source_id) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            type           = EXCLUDED.type,
            lon            = EXCLUDED.lon,
            lat            = EXCLUDED.lat,
            metadata       = EXCLUDED.metadata
        RETURNING id
    `;

    const insertAlias = `
        INSERT INTO entity_aliases (entity_id, name_form, lang)
        VALUES ($1, $2, 'en')
    `;

    const insertVerse = `
        INSERT INTO entity_verses (entity_id, book_id, chapter, verse)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
    `;

    const insertEntityModernLink = `
        INSERT INTO entity_modern_links (entity_id, modern_id, score, name, url_slug, identification_ids, metadata)
        SELECT $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_modern WHERE id = $2)
        ON CONFLICT (entity_id, modern_id) DO UPDATE SET
            score = EXCLUDED.score,
            name = EXCLUDED.name,
            url_slug = EXCLUDED.url_slug,
            identification_ids = EXCLUDED.identification_ids,
            metadata = EXCLUDED.metadata
    `;

    const insertEntitySourceLink = `
        INSERT INTO entity_source_links (entity_id, source_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_sources WHERE id = $2)
        ON CONFLICT (entity_id, source_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    const insertEntityImageLink = `
        INSERT INTO entity_image_links (entity_id, image_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_images WHERE id = $2)
        ON CONFLICT (entity_id, image_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    const insertEntityGeometryLink = `
        INSERT INTO entity_geometry_links (entity_id, geometry_id, role, context)
        SELECT $1, $2, $3, $4::jsonb
        WHERE EXISTS (SELECT 1 FROM openbible_geometries WHERE id = $2)
        ON CONFLICT (entity_id, geometry_id, role) DO UPDATE SET
            context = EXCLUDED.context
    `;

    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL synchronous_commit = off");

    try {
        await client.query(`
            DELETE FROM entity_geometry_links WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);
        await client.query(`
            DELETE FROM entity_image_links WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);
        await client.query(`
            DELETE FROM entity_source_links WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);
        await client.query(`
            DELETE FROM entity_modern_links WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);
        await client.query(`
            DELETE FROM entity_verses WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);
        await client.query(`
            DELETE FROM entity_aliases WHERE entity_id IN
                (SELECT id FROM entities WHERE source = 'openbible')
        `);

        await client.query(`
            TRUNCATE TABLE
                entity_modern_links,
                entity_source_links,
                entity_image_links,
                entity_geometry_links,
                openbible_modern_geometry_links,
                openbible_modern_source_links,
                openbible_modern_image_links,
                openbible_modern,
                openbible_geometries,
                openbible_images,
                openbible_sources
        `);

        console.log("Loading source.jsonl ...");
        await forEachJsonl(files.source, async (rec) => {
            const id = normalizeId(rec.id);
            if (!id || !SOURCE_ID_RE.test(id)) return;

            await client.query(insertSource, [
                id,
                rec.friendly_id || null,
                rec.display_name || null,
                rec.abbreviation || null,
                rec.type || null,
                rec.publisher || null,
                toInt(rec.year),
                rec.url || null,
                toInt(rec.vote_count),
                asJson(rec.contributors, []),
                asJson(rec, {}),
            ]);
            counters.sources++;
        });

        console.log("Loading image.jsonl ...");
        await forEachJsonl(files.image, async (rec) => {
            const id = normalizeId(rec.id);
            if (!id || !IMAGE_ID_RE.test(id)) return;

            await client.query(insertImage, [
                id,
                rec.descriptions && typeof rec.descriptions === "object"
                    ? Object.values(rec.descriptions)[0] || null
                    : null,
                rec.credit || null,
                rec.credit_url || null,
                rec.license || null,
                rec.color || null,
                rec.role || null,
                rec.person || null,
                toFloat(rec.meters_per_pixel),
                rec.file_url || rec.url || null,
                rec.thumbnail_url_pattern || null,
                toInt(rec.width),
                toInt(rec.height),
                asJson(rec.descriptions, {}),
                asJson(rec.thumbnails, {}),
                asJson(rec, {}),
            ]);
            counters.images++;
        });

        console.log("Loading geometry.jsonl ...");
        await forEachJsonl(files.geometry, async (rec) => {
            const id = normalizeId(rec.id);
            if (!id || !GEOMETRY_ID_RE.test(id)) return;

            await client.query(insertGeometry, [
                id,
                rec.format || null,
                rec.name || null,
                rec.source || null,
                rec.source_url || null,
                asJson(rec.source_urls, []),
                rec.geometry || null,
                rec.modifier || null,
                rec.land_or_water || null,
                rec.geojson_file || null,
                rec.simplified_geojson_file || null,
                null,
                rec.isobands_geojson_file || null,
                null,
                null,
                asJson(rec, {}),
            ]);
            counters.geometries++;
        });

        console.log("Loading modern.jsonl ...");
        await forEachJsonl(files.modern, async (rec) => {
            const id = normalizeId(rec.id);
            if (!id || !MODERN_ID_RE.test(id)) return;

            const parsedLonLat = parseLonLat(rec.custom_lonlat || rec.lonlat);
            if ((rec.custom_lonlat || rec.lonlat) && !parsedLonLat) {
                counters.invalidModernCoords++;
            }

            await client.query(insertModern, [
                id,
                rec.friendly_id || id,
                rec.url_slug || null,
                rec.class || null,
                rec.type || null,
                rec.geometry || null,
                rec.geometry_credit || null,
                rec.land_or_water || null,
                parsedLonLat ? parsedLonLat.lon : null,
                parsedLonLat ? parsedLonLat.lat : null,
                rec.preceding_article || null,
                rec.geojson_file || null,
                rec.kml_file || null,
                rec.root || null,
                rec.custom_lonlat || null,
                asJson(rec.coordinates_source, {}),
                asJson(rec.precision, {}),
                asJson(rec.names, []),
                asJson(rec.media, {}),
                asJson(rec.ancient_associations, {}),
                asJson(rec.accuracy_claims, []),
                asJson(rec.precision_claims, []),
                asJson(rec, {}),
            ]);
            counters.modern++;

            const modernSourceLinks = [];
            if (typeof rec?.coordinates_source?.source_id === "string") {
                modernSourceLinks.push({
                    source_id: normalizeId(rec.coordinates_source.source_id),
                    role: "coordinates_source",
                    context: { coordinates_source: rec.coordinates_source },
                });
            }

            if (Array.isArray(rec.secondary_sources)) {
                for (const src of rec.secondary_sources) {
                    const source_id = normalizeId(src?.source_id);
                    if (!source_id || !SOURCE_ID_RE.test(source_id)) continue;
                    modernSourceLinks.push({
                        source_id,
                        role: "secondary_source",
                        context: src,
                    });
                }
            }

            const accuracyClaims = Array.isArray(rec.accuracy_claims) ? rec.accuracy_claims : [];
            const precisionClaims = Array.isArray(rec.precision_claims) ? rec.precision_claims : [];
            for (const claim of accuracyClaims) {
                const ids = extractMatches(claim, /\bs[0-9a-f]{6}\b/ig);
                for (const source_id of ids) {
                    modernSourceLinks.push({
                        source_id,
                        role: "accuracy_claim",
                        context: { claim },
                    });
                }
            }
            for (const claim of precisionClaims) {
                const ids = extractMatches(claim, /\bs[0-9a-f]{6}\b/ig);
                for (const source_id of ids) {
                    modernSourceLinks.push({
                        source_id,
                        role: "precision_claim",
                        context: { claim },
                    });
                }
            }

            for (const link of dedupeByKey(modernSourceLinks, (l) => `${l.source_id}|${l.role}`)) {
                if (!SOURCE_ID_RE.test(link.source_id)) continue;
                await client.query(insertModernSourceLink, [
                    id,
                    link.source_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.modernSourceLinks++;
            }

            const modernImageLinks = dedupeByKey(
                collectImageRefs(rec.media || {}, ["media"]),
                (l) => `${l.image_id}|${l.role}`,
            );
            for (const link of modernImageLinks) {
                await client.query(insertModernImageLink, [
                    id,
                    link.image_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.modernImageLinks++;
            }

            const modernGeometryLinks = dedupeByKey(
                collectGeometryRefs(
                    {
                        geometry_id: rec.geometry_id,
                        local_geometry_id: rec.local_geometry_id,
                        precise_geometry_id: rec.precise_geometry_id,
                        geojson_roles: rec.geojson_roles,
                        precision: rec.precision,
                        precision_claims: rec.precision_claims,
                    },
                    ["modern"],
                ),
                (l) => `${l.geometry_id}|${l.role}`,
            );
            for (const link of modernGeometryLinks) {
                await client.query(insertModernGeometryLink, [
                    id,
                    link.geometry_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.modernGeometryLinks++;
            }

            if (counters.modern % 250 === 0) {
                console.log(`  modern processed: ${counters.modern}`);
            }
        });

        console.log("Loading ancient.jsonl + canonical entities ...");
        await forEachJsonl(files.ancient, async (rec) => {
            const sourceId = normalizeId(rec.id);
            if (!sourceId) return;
            seenOpenBibleEntityIds.add(sourceId);

            const identifications = Array.isArray(rec.identifications) ? rec.identifications : [];
            const best = chooseBestAncientResolution(identifications, counters);
            const placeTypeSeed = Array.isArray(rec.types) && rec.types.length > 0
                ? rec.types[0]
                : (best?.resolution?.type || null);
            const placeType = placeTypeSeed ? `place.${placeTypeSeed}` : "place";

            const metadata = {};
            if (rec.linked_data) metadata.linked_data = rec.linked_data;
            if (rec.media) metadata.media = rec.media;
            if (rec.modern_associations) metadata.modern_associations = rec.modern_associations;
            if (rec.identification_sources) metadata.identification_sources = rec.identification_sources;
            if (rec.url_slug) metadata.url_slug = rec.url_slug;
            if (rec.preceding_article) metadata.preceding_article = rec.preceding_article;
            if (rec.comment) metadata.comment = rec.comment;
            if (rec.geometry_credit) metadata.geometry_credit = rec.geometry_credit;
            const parsedExtra = parseExtraJson(rec.extra);
            if (parsedExtra) metadata.extra = parsedExtra;

            const { rows } = await client.query(upsertEntity, [
                rec.friendly_id || sourceId,
                placeType,
                best ? best.lon : null,
                best ? best.lat : null,
                sourceId,
                asJson(metadata, {}),
            ]);
            const entityId = rows[0].id;
            counters.ancient++;

            const aliases = rec.translation_name_counts && typeof rec.translation_name_counts === "object"
                ? Object.keys(rec.translation_name_counts)
                : [];
            for (const name of aliases) {
                await client.query(insertAlias, [entityId, name]);
                counters.aliases++;
            }

            const verses = Array.isArray(rec.verses) ? rec.verses : [];
            for (const v of verses) {
                const parsed = parseUsx(v.usx);
                if (!parsed) continue;
                await client.query(insertVerse, [entityId, parsed.book_id, parsed.chapter, parsed.verse]);
                counters.verses++;
            }

            const modernAssociations = rec.modern_associations && typeof rec.modern_associations === "object"
                ? rec.modern_associations
                : {};
            for (const [rawModernId, assoc] of Object.entries(modernAssociations)) {
                const modern_id = normalizeId(rawModernId);
                if (!modern_id || !MODERN_ID_RE.test(modern_id)) continue;
                await client.query(insertEntityModernLink, [
                    entityId,
                    modern_id,
                    toInt(assoc?.score),
                    assoc?.name || null,
                    assoc?.url_slug || null,
                    asJson(assoc?.identification_ids, []),
                    asJson(assoc || {}, {}),
                ]);
                counters.entityModernLinks++;
            }

            const sourceRefs = [];
            const linkedData = rec.linked_data && typeof rec.linked_data === "object"
                ? rec.linked_data
                : {};
            for (const [source_id_raw, payload] of Object.entries(linkedData)) {
                const source_id = normalizeId(source_id_raw);
                if (!source_id || !SOURCE_ID_RE.test(source_id)) continue;
                sourceRefs.push({
                    source_id,
                    role: "linked_data",
                    context: payload,
                });
            }

            const identificationSources = rec.identification_sources && typeof rec.identification_sources === "object"
                ? rec.identification_sources
                : {};
            for (const [source_id_raw, payload] of Object.entries(identificationSources)) {
                const source_id = normalizeId(source_id_raw);
                if (!source_id || !SOURCE_ID_RE.test(source_id)) continue;
                sourceRefs.push({
                    source_id,
                    role: "identification_source",
                    context: payload,
                });
            }

            for (const link of dedupeByKey(sourceRefs, (l) => `${l.source_id}|${l.role}`)) {
                await client.query(insertEntitySourceLink, [
                    entityId,
                    link.source_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.entitySourceLinks++;
            }

            const entityImageLinks = dedupeByKey(
                collectImageRefs(
                    {
                        media: rec.media,
                        identifications: rec.identifications,
                        modern_associations: rec.modern_associations,
                    },
                    ["ancient"],
                ),
                (l) => `${l.image_id}|${l.role}`,
            );
            for (const link of entityImageLinks) {
                await client.query(insertEntityImageLink, [
                    entityId,
                    link.image_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.entityImageLinks++;
            }

            const entityGeometryLinks = dedupeByKey(
                collectGeometryRefs(
                    {
                        identifications: rec.identifications,
                        extra: parsedExtra,
                    },
                    ["ancient"],
                ),
                (l) => `${l.geometry_id}|${l.role}`,
            );
            for (const link of entityGeometryLinks) {
                await client.query(insertEntityGeometryLink, [
                    entityId,
                    link.geometry_id,
                    link.role,
                    asJson(link.context, {}),
                ]);
                counters.entityGeometryLinks++;
            }

            if (counters.ancient % 200 === 0) {
                console.log(`  ancient processed: ${counters.ancient}`);
            }
        });

        const seenIds = [...seenOpenBibleEntityIds];
        await client.query(
            `DELETE FROM entities WHERE source = 'openbible' AND NOT (source_id = ANY($1::text[]))`,
            [seenIds],
        );

        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        await client.end();
    }

    console.log("OpenBible full ingest complete.");
    console.log(JSON.stringify(counters, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
