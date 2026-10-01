export const escapeText = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const customerText = (value) =>
  String(value ?? "")
    .replace(/\b(?:prompt|telnyx)_/gi, "texting_")
    .replace(/\b(?:Prompt(?:\.io)?|Telnyx)(?:'s)?\b/gi, "texting service");
export const label = (value) =>
  customerText(String(value ?? "").replace(/^(?:prompt|telnyx)_/, "")).replace(
    /_/g,
    " ",
  );
export const money = (value) =>
  Number.isSafeInteger(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(value / 1000000)
    : "Unavailable";
export const rateMoney = (value) =>
  Number.isSafeInteger(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(value / 1000000)
    : "Unavailable";
export const count = (value) =>
  Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString("en-US")
    : "—";
export const id = (value) => encodeURIComponent(String(value));
export const uuid = () => crypto.randomUUID();
export const list = (value) => (Array.isArray(value) ? value : []);
export const checkedUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
};
export const tag = (value) =>
  `<span class="pt-tag">${escapeText(label(value))}</span>`;
export const notice = (title, text = "") =>
  `<div class="pt-notice" role="status"><strong>${escapeText(title)}</strong>${text ? `<p>${escapeText(text)}</p>` : ""}</div>`;
export const button = (
  action,
  text,
  { secondary = false, disabled = false, value = "" } = {},
) =>
  `<button type="button" class="pt-btn${secondary ? " pt-btn--secondary" : ""}" data-workspace-action="${escapeText(action)}" data-value="${escapeText(value)}"${disabled ? " disabled" : ""}>${escapeText(text)}</button>`;
export const go = (section, text, resource = "", secondary = false) =>
  button("navigate", text, {
    secondary,
    value: JSON.stringify([section, resource]),
  });
export const head = (eyebrow, title, subtitle = "", action = "") =>
  `<header class="pt-page-head"><div><div class="pt-eyebrow">${escapeText(eyebrow)}</div><h1>${escapeText(title)}</h1>${subtitle ? `<p class="pt-muted">${escapeText(subtitle)}</p>` : ""}</div>${action}</header>`;
export const stat = (title, value) =>
  `<div class="pt-card pt-workspace-stat"><strong>${escapeText(value)}</strong><span class="pt-muted">${escapeText(title)}</span></div>`;
export const field = (
  name,
  title,
  value = "",
  { type = "text", required = false, max = 200, wide = false, extra = "" } = {},
) =>
  `<label class="pt-field${wide ? " pt-wide" : ""}"><span>${escapeText(title)}</span><input name="${escapeText(name)}" type="${type}" value="${escapeText(value)}" maxlength="${max}"${required ? " required" : ""} ${extra}></label>`;
export const select = (name, title, options, value = "", required = false) =>
  `<label class="pt-field"><span>${escapeText(title)}</span><select name="${escapeText(name)}" aria-label="${escapeText(title)}"${required ? " required" : ""}>${options.map(([key, text]) => `<option value="${escapeText(key)}"${key === value ? " selected" : ""}>${escapeText(text)}</option>`).join("")}</select></label>`;
export const textarea = (
  name,
  title,
  value = "",
  required = false,
  max = 1600,
) =>
  `<label class="pt-field pt-wide"><span>${escapeText(title)}</span><textarea name="${escapeText(name)}" rows="6" maxlength="${max}"${required ? " required" : ""}>${escapeText(value)}</textarea></label>`;
export const details = (title, rows) =>
  `<details class="pt-workspace-details"><summary>${escapeText(title)}</summary>${rows}</details>`;
export const reasons = (values) =>
  list(values).length
    ? details(
        "What needs attention",
        `<ul>${values.map((v) => `<li>${escapeText(label(v))}</li>`).join("")}</ul>`,
      )
    : "";

/** Mirrors the server's GSM-7/UCS-2 estimator. It displays a quote only; the server reserves the actual price. */
export function smsSegments(value) {
  const basic = new Set(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  );
  const extension = new Set("^{}\\[~]|€");
  let units = 0;
  for (const c of value) {
    if (basic.has(c)) units++;
    else if (extension.has(c)) units += 2;
    else return value.length <= 70 ? 1 : Math.ceil(value.length / 67);
  }
  return units <= 160 ? 1 : Math.ceil(units / 153);
}
export const streamLabel = (stream) =>
  stream === "opt_in" ? "Opt-in texting" : "Standard texting";

export function messagePrice(
  billing,
  text,
  media = false,
  stream = "standard",
) {
  if (billing?.rateStatus !== "verified") return null;
  if (stream === "opt_in") {
    const tariff = billing.optInRates;
    if (tariff?.rateStatus !== "verified") return null;
    const rate = media ? tariff.mmsMicros : tariff.smsSegmentMicros;
    if (!Number.isSafeInteger(rate) || rate < 1) return null;
    const total = rate * (media ? 1 : smsSegments(text));
    return Number.isSafeInteger(total) ? total : null;
  }
  if (media)
    return Number.isSafeInteger(billing.mmsMicros) && billing.mmsMicros > 0
      ? billing.mmsMicros
      : null;
  const base = billing.smsUpToTwoSegmentsMicros,
    extra = Math.max(0, smsSegments(text) - 2),
    rate = billing.smsAdditionalSegmentMicros;
  if (
    !Number.isSafeInteger(base) ||
    base < 1 ||
    (extra && (!Number.isSafeInteger(rate) || rate < 1))
  )
    return null;
  const total = base + extra * (rate || 0);
  return Number.isSafeInteger(total) ? total : null;
}
/** Non-admin summaries deliberately omit prices; the server still checks the
 * exact message cost atomically when a human confirms the send. */
export function messageFundingReady(
  workspace,
  billing,
  text,
  media = false,
  stream = "standard",
) {
  if (billing?.sendingBlocked !== false) return false;
  if (workspace?.capabilities?.manageBilling !== true) return true;
  const cost = messagePrice(billing, text, media, stream);
  return (
    cost !== null &&
    Number.isSafeInteger(billing.availableMicros) &&
    billing.availableMicros >= cost
  );
}
export function queueCanConfirm(
  item,
  workspace,
  billing,
  mediaLoaded = false,
  now = Date.now(),
) {
  const p = item?.preview;
  return (
    workspace?.canSend === true &&
    workspace?.capabilities?.manualQueue === true &&
    billing?.sendingBlocked === false &&
    item?.state === "awaiting_confirmation" &&
    item.humanConfirmation &&
    typeof item.humanConfirmation === "object" &&
    Number.isSafeInteger(item.expiresAtMs) &&
    item.expiresAtMs > now &&
    list(item.blockedReasons).length === 0 &&
    typeof p?.contactPhone === "string" &&
    /^\+[1-9]\d{7,14}$/.test(p.contactPhone) &&
    typeof p.message === "string" &&
    p.message.length > 0 &&
    (!(p.attachmentUrl || p.mediaId) ||
      (mediaLoaded &&
        ((item.stream === "opt_in" &&
          /^[A-Za-z0-9_-]{1,100}$/.test(p.mediaId || "")) ||
          checkedUrl(p.attachmentUrl)))) &&
    messageFundingReady(
      workspace,
      billing,
      p.message,
      !!(p.attachmentUrl || p.mediaId),
      item.stream,
    )
  );
}

/** Only bounded image bytes from authenticated Polis media endpoints become inline images. */
export function protectedMediaData(media) {
  return media &&
    ["image/png", "image/gif", "image/jpeg", "image/webp"].includes(
      media.mimeType,
    ) &&
    typeof media.dataBase64 === "string" &&
    media.dataBase64.length > 0 &&
    media.dataBase64.length <= 7_000_000 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(media.dataBase64)
    ? `data:${media.mimeType};base64,${media.dataBase64}`
    : "";
}
