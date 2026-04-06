/* global __CTA_API_BASE_URL__, __CTA_APP_DEEP_LINK_BASE_URL__, __CTA_IOS_STORE_URL__, __CTA_ANDROID_STORE_URL__ */

import "./css/cta-invite.css";

function readToken() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken.trim();
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "cta-invite") {
    return decodeURIComponent(parts[1] || "");
  }
  return "";
}

function apiBaseUrl() {
  return (__CTA_API_BASE_URL__ || "").trim().replace(/\/$/, "");
}

function appDeepLinkBase() {
  const configured = (__CTA_APP_DEEP_LINK_BASE_URL__ || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return window.location.origin.replace(/\/$/, "");
}

function formatDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "TBD";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value;
}

async function loadInvitation() {
  const token = readToken();
  if (!token) {
    setText("cta-title", "Invitation unavailable");
    setText("cta-subtitle", "This CTA invite link is missing its token.");
    return;
  }

  const apiBase = apiBaseUrl();
  if (!apiBase) {
    setText("cta-title", "Invitation unavailable");
    setText("cta-subtitle", "CTA_API_BASE_URL is not configured for this site.");
    return;
  }

  const response = await fetch(`${apiBase}/api/cta-invite/${encodeURIComponent(token)}`);
  if (!response.ok) {
    setText("cta-title", "Invitation unavailable");
    setText("cta-subtitle", "We couldn't load this CTA invitation.");
    return;
  }
  const payload = await response.json();
  const event = payload?.event || {};
  const coalitionName = String(event.hostCoalitionName || "").trim();
  const title = String(event.title || "Call to Action").trim();
  const description = String(event.description || "").trim();
  const bannerImageUrl =
    String(event?.ctaPayload?.bannerImageUrl || event.imageUrl || "").trim();
  const openAppUrl = `${appDeepLinkBase()}/cta-invite/${encodeURIComponent(token)}`;

  setText("cta-title", title);
  setText(
    "cta-subtitle",
    coalitionName
      ? `${coalitionName} invited you to a private coalition event.`
      : "You've been invited to a private coalition event.",
  );
  setText("cta-time", formatDate(event.startAtIso || event.startAt));
  setText("cta-address", String(event.address || "TBD").trim() || "TBD");
  setText("cta-description", description);

  const transportEnabled = Boolean(event?.transportConfig?.enabled);
  const remainingSeats = Number(event?.transportState?.remainingSeats || 0);
  setText(
    "cta-transport",
    transportEnabled
      ? `${remainingSeats} seat(s) currently available.`
      : "Not provided",
  );

  const image = document.getElementById("cta-image");
  if (image && bannerImageUrl) {
    image.src = bannerImageUrl;
    image.hidden = false;
  }

  const openAppButton = document.getElementById("cta-open-app");
  if (openAppButton) {
    openAppButton.href = openAppUrl;
  }

  const iosButton = document.getElementById("cta-ios-store");
  if (iosButton) {
    iosButton.href = (__CTA_IOS_STORE_URL__ || "").trim() || "#";
  }

  const androidButton = document.getElementById("cta-android-store");
  if (androidButton) {
    androidButton.href = (__CTA_ANDROID_STORE_URL__ || "").trim() || "#";
  }
}

loadInvitation().catch(() => {
  setText("cta-title", "Invitation unavailable");
  setText("cta-subtitle", "We couldn't load this CTA invitation.");
});
