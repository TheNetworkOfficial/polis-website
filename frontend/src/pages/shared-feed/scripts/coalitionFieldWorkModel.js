import { geometryBounds, pointInGeometry } from "./territoryBuilderModel.js";

export const fieldText = (value) => String(value ?? "").trim();
export const fieldEscape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const fieldArray = (value, keys = ["items"]) =>
  Array.isArray(value)
    ? value
    : keys.map((key) => value?.[key]).find(Array.isArray) || [];
export const fieldNumber = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
export const fieldGeometry = (value) => {
  if (value?.type === "Feature") return fieldGeometry(value.geometry);
  if (value?.type === "FeatureCollection") {
    const polygons = (value.features || []).flatMap((row) => {
      const geometry = fieldGeometry(row);
      return geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    });
    return polygons.length
      ? { type: "MultiPolygon", coordinates: polygons }
      : null;
  }
  return value?.type === "Polygon" || value?.type === "MultiPolygon"
    ? value
    : null;
};
export const fieldPoint = (record) => {
  const lat = fieldNumber(record?.lat),
    lng = fieldNumber(record?.lng);
  return lat !== null &&
    lng !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? [lng, lat]
    : null;
};
export const fieldPinStatus = (record) =>
  ({
    red: "remaining",
    green: "reserved",
    blue: "clear",
    remaining: "remaining",
    reserved: "reserved",
    clear: "clear",
  })[
    fieldText(
      record?.pinStatus?.state || record?.pinStatus || record?.outreachStatus,
    )
  ] || "unknown";
export const fieldStatusLabels = {
  remaining: "Outreach remaining",
  reserved: "Reserved",
  clear: "No pending outreach",
  unknown: "Outreach status unavailable",
};

export function fieldAccess(payload = {}) {
  const access = payload.access || payload;
  return {
    ...access,
    scope: fieldText(access.scope),
    territories: fieldArray(access, ["territories"]).map(fieldTerritory),
    canManageTerritories: access.canManageTerritories === true,
    canAuthor:
      access.canManageTerritories === true &&
      ["full", "territories"].includes(access.scope) &&
      access.capabilities?.territoryAuthoringAccess === true,
  };
}
export function fieldTerritory(raw = {}) {
  return {
    ...raw,
    territoryId: fieldText(raw.territoryId || raw.id),
    name: fieldText(raw.name || raw.label) || "Territory",
    geojson: fieldGeometry(raw.geojson || raw.geometry),
    status: fieldText(raw.status).toLowerCase() || "published",
    version: Number(raw.currentVersion || raw.version) || 1,
    description: fieldText(raw.description),
    instructions: fieldText(raw.instructions || raw.volunteerMessage),
  };
}
export function fieldVoter(raw = {}, point = null) {
  const merged = { ...raw, ...(point || {}), address: raw.address || {} };
  return {
    ...merged,
    recordId: fieldText(raw.recordId || point?.recordId),
    name:
      fieldText(raw.displayName || point?.displayName || raw.name) ||
      "Voter record",
    addressLine1: fieldText(
      raw.addressLine1 || raw.address?.addressLine1 || point?.addressLine1,
    ),
    city: fieldText(raw.city || raw.address?.city || point?.city),
    state: fieldText(raw.state || raw.address?.state || point?.state),
    postalCode: fieldText(
      raw.postalCode || raw.address?.postalCode || point?.postalCode,
    ),
    status: fieldPinStatus(point || raw),
    lat: fieldNumber(raw.lat ?? point?.lat),
    lng: fieldNumber(raw.lng ?? point?.lng),
  };
}
export function fieldPerson(raw = {}) {
  const user = raw.user || raw.profile || raw;
  return {
    ...raw,
    userId: fieldText(raw.userId || raw.memberUserId || user.userId || user.id),
    name:
      fieldText(
        raw.displayName ||
          raw.fullName ||
          user.displayName ||
          user.fullName ||
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          raw.username ||
          user.username,
      ) || "Coalition member",
    username: fieldText(raw.username || user.username),
    role: fieldText(raw.role || raw.membership?.role) || "Member",
  };
}
export function fieldAssignmentActive(row, now = Date.now()) {
  const status = fieldText(row.status).toLowerCase();
  const time = (value) =>
    typeof value === "number"
      ? value
      : /^\d+$/u.test(String(value))
        ? Number(value)
        : Date.parse(value);
  const starts = row.startsAt ? time(row.startsAt) : 0,
    ends = row.endsAt ? time(row.endsAt) : Infinity;
  return (
    !["revoked", "inactive", "expired", "cancelled"].includes(status) &&
    Number.isFinite(starts) &&
    starts <= now &&
    (ends === Infinity || (Number.isFinite(ends) && ends > now))
  );
}
export function fieldBounds(territories = [], voters = []) {
  const bounds = territories
    .map(
      (territory) =>
        geometryBounds(territory.geojson) ||
        normalizeFieldBounds(territory.bbox),
    )
    .filter(Boolean);
  voters.forEach((record) => {
    const point = fieldPoint(record);
    if (point) bounds.push([...point, ...point]);
  });
  return bounds.length
    ? bounds.reduce((all, b) => [
        Math.min(all[0], b[0]),
        Math.min(all[1], b[1]),
        Math.max(all[2], b[2]),
        Math.max(all[3], b[3]),
      ])
    : null;
}
export function normalizeFieldBounds(value) {
  const values = Array.isArray(value)
    ? value
    : value && [
        value.west ?? value.minLng,
        value.south ?? value.minLat,
        value.east ?? value.maxLng,
        value.north ?? value.maxLat,
      ];
  return values?.length === 4 &&
    values.every((v) => fieldNumber(v) !== null) &&
    Number(values[0]) <= Number(values[2]) &&
    Number(values[1]) <= Number(values[3])
    ? values.map(Number)
    : null;
}
export function fieldInTerritory(record, territory) {
  const point = fieldPoint(record);
  if (!point || !territory) return false;
  if (territory.geojson) return pointInGeometry(point, territory.geojson);
  const b = normalizeFieldBounds(territory.bbox);
  return Boolean(
    b &&
      point[0] >= b[0] &&
      point[0] <= b[2] &&
      point[1] >= b[1] &&
      point[1] <= b[3],
  );
}

/** Filter only records the server returned; local filters never grant access. */
export function fieldFilterRecords(
  records,
  {
    query = "",
    area = "all",
    outreach = "all",
    territories = [],
    myTerritoryIds = [],
  } = {},
) {
  const q = fieldText(query).toLowerCase();
  return records.filter((record) => {
    if (
      q &&
      ![
        record.name,
        record.addressLine1,
        record.city,
        record.state,
        record.postalCode,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
      return false;
    if (outreach !== "all" && record.status !== outreach) return false;
    const allowed =
      area === "mine"
        ? territories.filter((t) => myTerritoryIds.includes(t.territoryId))
        : territories.filter((t) => t.territoryId === area);
    return (
      area === "all" ||
      allowed.some((territory) => fieldInTerritory(record, territory))
    );
  });
}
