export const adminText = (value) =>
  typeof value === "string"
    ? value.trim()
    : value === null || value === undefined
      ? ""
      : String(value).trim();
export const adminEscape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const adminSocialLabels = {
  facebook: "Facebook",
  threads: "Threads",
  bluesky: "Bluesky",
  instagram: "Instagram",
  tiktok: "TikTok",
};
export const adminChannels = [
  {
    key: "phoneCall",
    label: "Call",
    channel: "Phone call",
    icon: "phone",
    tokens: ["firstName", "volunteerName", "campaignName"],
  },
  {
    key: "textMessage",
    label: "Text",
    channel: "Text message",
    icon: "texting",
    tokens: ["firstName", "volunteerName", "campaignName"],
  },
  {
    key: "mailEmail",
    label: "Email",
    channel: "Email",
    icon: "mail",
    tokens: ["firstName", "volunteerName", "campaignName"],
  },
  {
    key: "mailPhysical",
    label: "Postal mail",
    channel: "Postal mail",
    icon: "petition",
    tokens: ["firstName", "campaignName"],
  },
];
export function adminUrl(value) {
  try {
    const url = new URL(adminText(value));
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function adminProfile(source = {}) {
  const raw = source?.coalition || source?.organization || source || {};
  const record = { ...raw.raw, ...raw };
  const socials = record.socials || record.links || {};
  return {
    name: adminText(record.name),
    coalitionType: adminText(record.coalitionType).toLowerCase() || "simple",
    description: adminText(record.description),
    imageUrl: adminUrl(record.imageUrl),
    primaryContactName: adminText(record.primaryContactName),
    email: adminText(record.email),
    phone: adminText(record.phone),
    website: adminText(record.website),
    pacAssociated: record.pacAssociated === true,
    fecNumber: adminText(record.fecNumber),
    ...Object.fromEntries(
      Object.keys(adminSocialLabels).map((key) => [
        key,
        adminText(socials[key]),
      ]),
    ),
  };
}
export function adminPermissions(membership, coalition = {}) {
  const permissions = new Set(
    Array.isArray(membership?.permissions)
      ? membership.permissions.map(adminText)
      : [],
  );
  const role = adminText(membership?.roleKey || membership?.role).toLowerCase();
  const active = ["active", "approved"].includes(
    adminText(membership?.status || membership?.state).toLowerCase(),
  );
  const admin = active && ["admin", "officer"].includes(role);
  const profile = active && (admin || permissions.has("profile_manage"));
  const leadership =
    active &&
    (admin ||
      profile ||
      ["roles_manage", "members_manage", "join_requests_manage"].some((key) =>
        permissions.has(key),
      ));
  const enabled =
    coalition.voterMapEnabled === true || coalition.voter_map_enabled === true;
  const scriptsView =
    active &&
    enabled &&
    (admin ||
      ["voter_map_access", "cta_manage"].some((key) => permissions.has(key)));
  return {
    active,
    admin,
    profile,
    view: leadership,
    scriptsView,
    scripts: admin && scriptsView,
  };
}
export function adminProfileErrors(profile) {
  const errors = {};
  for (const [name, label] of Object.entries({
    imageUrl: "an organization image",
    name: "the organization name",
    description: "a description",
    primaryContactName: "the primary contact",
    phone: "a phone number",
    email: "an email address",
  }))
    if (!adminText(profile[name])) errors[name] = `Add ${label}.`;
  if (adminText(profile.imageUrl) && !adminUrl(profile.imageUrl))
    errors.imageUrl = "Use a complete http:// or https:// image address.";
  if (
    adminText(profile.email) &&
    !/^[^\s@]+@[^\s@]+$/.test(adminText(profile.email))
  )
    errors.email = "Enter a valid email address.";
  for (const name of ["website", ...Object.keys(adminSocialLabels)])
    if (adminText(profile[name]) && !adminUrl(profile[name]))
      errors[name] = "Use a complete http:// or https:// address.";
  if (!["simple", "constitutional"].includes(adminText(profile.coalitionType)))
    errors.coalitionType = "Choose Simple or Constitutional.";
  if (profile.pacAssociated && !adminText(profile.fecNumber))
    errors.fecNumber =
      "Add the FEC number for this PAC-associated organization.";
  return errors;
}
export function adminProfilePayload(profile) {
  const errors = adminProfileErrors(profile);
  if (Object.keys(errors).length)
    throw Object.assign(
      new Error("Complete the required organization profile fields."),
      { fields: errors },
    );
  const socials = Object.fromEntries(
    Object.keys(adminSocialLabels)
      .filter((key) => adminText(profile[key]))
      .map((key) => [key, adminText(profile[key])]),
  );
  return {
    ...Object.fromEntries(
      ["name", "description", "primaryContactName", "phone", "email"].map(
        (key) => [key, adminText(profile[key])],
      ),
    ),
    imageUrl: adminUrl(profile.imageUrl),
    website: adminText(profile.website) ? adminUrl(profile.website) : null,
    coalitionType: adminText(profile.coalitionType),
    pacAssociated: profile.pacAssociated === true,
    fecNumber: profile.pacAssociated ? adminText(profile.fecNumber) : "",
    socials: Object.keys(socials).length ? socials : null,
  };
}
export function adminScripts(source = {}) {
  const templates = source?.templates || source?.items || source || {};
  return Object.fromEntries(
    adminChannels.map(({ key }) => [
      key,
      {
        title: adminText(templates[key]?.title),
        body: adminText(templates[key]?.body),
      },
    ]),
  );
}
export function adminScriptsPayload(scripts) {
  for (const { key } of adminChannels) {
    if (
      String(scripts[key]?.title || "").length > 120 ||
      String(scripts[key]?.body || "").length > 5000
    )
      throw new Error(
        "Template titles are limited to 120 characters and bodies to 5,000.",
      );
  }
  return { templates: adminScripts(scripts) };
}
export function adminRevision(payload) {
  const raw =
    payload?.revision ??
    payload?.coalition?.organizationMutationRevision ??
    payload?.organizationMutationRevision;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function adminUpload(payload = {}) {
  const asset = payload.cfAsset || {};
  const uid = adminText(
    payload.uid || payload.uploadId || payload.id || asset.uid,
  );
  const uploadUrl = adminUrl(
    payload.uploadURL ||
      payload.uploadUrl ||
      asset.uploadURL ||
      asset.uploadUrl,
  );
  const deliveryUrl = adminUrl(
    payload.deliveryUrl ||
      payload.publicUrl ||
      asset.deliveryUrl ||
      asset.publicUrl,
  );
  if (
    !uid ||
    !uploadUrl ||
    !deliveryUrl ||
    new URL(uploadUrl).protocol !== "https:"
  )
    throw new Error("The image upload session was incomplete. Try again.");
  return {
    uid,
    uploadUrl,
    deliveryUrl,
    fields:
      payload.fields && typeof payload.fields === "object"
        ? payload.fields
        : {},
    fileFieldName: adminText(payload.fileFieldName) || "file",
  };
}
export const adminEqual = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
