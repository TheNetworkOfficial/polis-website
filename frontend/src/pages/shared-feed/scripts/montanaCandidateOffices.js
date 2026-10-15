const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();

export const montanaStateOffices = Object.freeze([
  "Governor",
  "Lieutenant Governor",
  "Secretary of State",
  "Attorney General",
  "Superintendent of Public Instruction",
  "State Auditor",
  "State Representative",
  "State Senator",
  "Public Service Commissioner",
  "Supreme Court Chief Justice",
  "Supreme Court Justice",
  "Clerk of the Supreme Court",
  "District Court Judge",
]);

const aliases = new Map(
  [
    [
      "State Representative / Assembly Member / Delegate",
      "State Representative",
    ],
    ["Public Service / Utilities Commissioner", "Public Service Commissioner"],
    ["Auditor / Comptroller", "State Auditor"],
    ["Insurance Commissioner", "State Auditor"],
    [
      "Superintendent of Public Instruction / Education Commissioner",
      "Superintendent of Public Instruction",
    ],
    ["State Supreme Court Justice", "Supreme Court Justice"],
    ["State Supreme Court Chief Justice", "Supreme Court Chief Justice"],
  ].map(([alias, office]) => [key(alias), office]),
);
for (const office of montanaStateOffices) aliases.set(key(office), office);

export const montanaJudicialDepartments = Object.freeze({
  1: 4,
  2: 2,
  3: 1,
  4: 5,
  5: 1,
  6: 1,
  7: 2,
  8: 4,
  9: 1,
  10: 1,
  11: 5,
  12: 1,
  13: 10,
  14: 1,
  15: 1,
  16: 2,
  17: 1,
  18: 4,
  19: 1,
  20: 2,
  21: 2,
  22: 1,
});

export function isMontanaCandidateState(candidate = {}) {
  return (
    key(candidate.level || candidate.levelOfOffice) === "state" &&
    ["mt", "montana"].includes(key(candidate.state))
  );
}

export function canonicalMontanaCandidateOffice(office) {
  return aliases.get(key(office)) || text(office);
}

/** Exact office geography is enforced on the server; these rules guide signup. */
export function montanaCandidateOfficeSpec(candidate = {}) {
  if (!isMontanaCandidateState(candidate)) return null;
  const office = canonicalMontanaCandidateOffice(
    candidate.office || candidate.officeTitle,
  );
  if (!montanaStateOffices.includes(office)) return null;
  const districts = {
    "State Representative": [100, "State House district", "state_house"],
    "State Senator": [50, "State Senate district", "state_senate"],
    "Public Service Commissioner": [
      5,
      "Public Service Commission district",
      "public_service_commission",
    ],
    "District Court Judge": [22, "Judicial district", "judicial"],
  };
  const [
    maxDistrict = 0,
    districtLabel = "District",
    districtType = "statewide",
  ] = districts[office] || [];
  const maxSeat =
    office === "Supreme Court Justice"
      ? 6
      : office === "District Court Judge"
        ? montanaJudicialDepartments[Number(candidate.district)] || 0
        : 0;
  return {
    office,
    maxDistrict,
    districtLabel,
    districtType,
    maxSeat,
    requiresSeat: ["Supreme Court Justice", "District Court Judge"].includes(
      office,
    ),
    seatLabel:
      office === "District Court Judge"
        ? "District Court department"
        : "Supreme Court justice seat",
  };
}

export function montanaCandidateOfficeLabel(office) {
  const canonical = canonicalMontanaCandidateOffice(office);
  return (
    {
      "State Representative": "Montana State House",
      "State Senator": "Montana State Senate",
      "Public Service Commissioner": "Montana Public Service Commission",
      "State Auditor":
        "State Auditor / Commissioner of Securities and Insurance",
    }[canonical] || canonical
  );
}

export function validateMontanaCandidateScope(candidate = {}) {
  if (!isMontanaCandidateState(candidate)) return "";
  const spec = montanaCandidateOfficeSpec(candidate);
  if (!spec) return "Select a Montana elected state office.";
  const number = (value) => (/^\d+$/u.test(text(value)) ? Number(value) : NaN);
  if (spec.maxDistrict) {
    const district = number(candidate.district);
    if (
      !Number.isInteger(district) ||
      district < 1 ||
      district > spec.maxDistrict
    ) {
      return `Select a ${spec.districtLabel.toLowerCase()} from 1 to ${spec.maxDistrict}.`;
    }
  } else if (
    text(candidate.district) &&
    key(candidate.district) !== "statewide"
  ) {
    return "This Montana office serves statewide; clear the district.";
  }
  if (spec.requiresSeat) {
    const seat = number(candidate.seat);
    if (!Number.isInteger(seat) || seat < 1 || seat > spec.maxSeat)
      return `Select a valid ${spec.seatLabel.toLowerCase()}.`;
  } else if (text(candidate.seat))
    return "This office does not use a separate judicial seat.";
  return "";
}

export function montanaCandidateDistrictLabel(candidate = {}) {
  const spec = montanaCandidateOfficeSpec(candidate);
  if (!spec) return "";
  const district = text(candidate.district);
  const label = spec.maxDistrict
    ? `MT ${spec.districtLabel} ${district}`
    : "MT statewide";
  return spec.requiresSeat && text(candidate.seat)
    ? `${label} · ${spec.office === "District Court Judge" ? "Department" : "Justice seat"} ${text(candidate.seat)}`
    : label;
}

/** Project every server boundary vertex into the existing schematic map view. */
export function candidateBoundarySvgPath(geojson, bbox) {
  const geometry = geojson?.type === "Feature" ? geojson.geometry : geojson;
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : null;
  const west = Number(bbox?.west),
    east = Number(bbox?.east),
    south = Number(bbox?.south),
    north = Number(bbox?.north);
  if (
    !Array.isArray(polygons) ||
    ![west, east, south, north].every(Number.isFinite) ||
    east <= west ||
    north <= south
  )
    return "";
  const paths = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) return "";
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return "";
      const projected = [];
      for (const coordinate of ring) {
        if (
          !Array.isArray(coordinate) ||
          !Number.isFinite(coordinate[0]) ||
          !Number.isFinite(coordinate[1])
        )
          return "";
        projected.push(
          `${5 + ((coordinate[0] - west) / (east - west)) * 90},${95 - ((coordinate[1] - south) / (north - south)) * 90}`,
        );
      }
      paths.push(`M${projected.join("L")}Z`);
    }
  }
  return paths.join("");
}
