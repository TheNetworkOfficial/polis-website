(() => {
  "use strict";

  const status = document.getElementById("thumbnail-status");
  const message = document.getElementById("thumbnail-message");
  const detail = document.getElementById("thumbnail-detail");
  const retry = document.getElementById("retry-thumbnail");
  const fallback = document.getElementById("thumbnail-fallback");
  const picture = document.getElementById("thumbnail-picture");
  const image = document.getElementById("house-thumbnail");
  const explore = document.getElementById("explore-thumbnail");
  const copyright = document.getElementById("thumbnail-copyright");
  const report = document.getElementById("report-thumbnail");
  const tileOrigin = "https://tile.googleapis.com";
  const sessionStorageKey = "polis.street-view.tiles-session.v1";
  let externalViewAvailable = false;

  function coordinate(parameters, name, limit) {
    const raw = parameters.get(name);
    if (raw === null || !/^-?\d+(?:\.\d+)?$/.test(raw)) {
      throw new Error("This house photo link is invalid.");
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > limit) {
      throw new Error("This house photo link is invalid.");
    }
    return value;
  }

  function readTarget() {
    if (window.location.hash.length > 256) {
      throw new Error("This house photo link is invalid.");
    }
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    for (const name of parameters.keys()) {
      if (
        !["lat", "lng"].includes(name) ||
        parameters.getAll(name).length !== 1
      ) {
        throw new Error("This house photo link is invalid.");
      }
    }
    return {
      lat: coordinate(parameters, "lat", 90),
      lng: coordinate(parameters, "lng", 180),
    };
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "strict-origin-when-cross-origin",
        ...options,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("House photo unavailable.");
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function googleUrl(path, parameters) {
    const url = new URL(path, tileOrigin);
    url.search = new URLSearchParams(parameters);
    return url;
  }

  function validSessionToken(session) {
    return (
      typeof session === "string" &&
      session.length > 0 &&
      session.length <= 4096
    );
  }

  function reusableSessionExpiry(expiry) {
    return Number.isFinite(expiry) && expiry > Date.now() / 1000 + 300;
  }

  /** Reuse only Google's session token; never retain house data or imagery. */
  function readSession(key) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(sessionStorageKey));
      if (
        saved?.apiKey === key &&
        validSessionToken(saved.session) &&
        reusableSessionExpiry(saved.expiry)
      ) {
        return saved.session;
      }
    } catch {
      // Storage can be unavailable; the normal session request still works.
    }
    return null;
  }

  function saveSession(key, sessionResult) {
    const expiry = Number(sessionResult.expiry);
    if (!reusableSessionExpiry(expiry)) return;
    try {
      window.localStorage.setItem(
        sessionStorageKey,
        JSON.stringify({ apiKey: key, session: sessionResult.session, expiry }),
      );
    } catch {
      // The current page can use its fresh session without persistent storage.
    }
  }

  function forgetSession(key, session) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(sessionStorageKey));
      if (saved?.apiKey === key && saved.session === session) {
        window.localStorage.removeItem(sessionStorageKey);
      }
    } catch {
      // Do not turn a provider or storage failure into an automatic retry.
    }
  }

  /** Point the thumbnail camera from its actual panorama toward the house. */
  function bearing(panorama, target) {
    const rad = (value) => (value * Math.PI) / 180;
    const delta = rad(target.lng - panorama.lng);
    const y = Math.sin(delta) * Math.cos(rad(target.lat));
    const x =
      Math.cos(rad(panorama.lat)) * Math.sin(rad(target.lat)) -
      Math.sin(rad(panorama.lat)) * Math.cos(rad(target.lat)) * Math.cos(delta);
    return (Math.atan2(y, x) * 180) / Math.PI + 360;
  }

  function setExploreLink(target, pano, heading = 0) {
    const url = new URL("https://www.google.com/maps/@");
    url.search = new URLSearchParams({
      api: "1",
      map_action: "pano",
      viewpoint: `${target.lat},${target.lng}`,
      heading: String(heading),
      pitch: "0",
      fov: "80",
      ...(pano ? { pano } : {}),
    });
    explore.href = url.href;
    fallback.href = url.href;
    externalViewAvailable = true;
  }

  function showError(text) {
    status.textContent = "House photo unavailable";
    picture.hidden = true;
    message.hidden = false;
    detail.textContent = text;
    retry.hidden = false;
    fallback.hidden = !externalViewAvailable;
  }

  retry.addEventListener("click", () => window.location.reload());

  async function openThumbnail() {
    const target = readTarget();
    setExploreLink(target);
    const config = await requestJson("/street-view-test/tiles-config.json", {
      cache: "no-store",
    });
    const key = config.tilesApiKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{20,256}$/.test(key)) {
      throw new Error("The house photo is not configured yet.");
    }
    const cachedSession = readSession(key);
    let session = cachedSession;
    if (!session) {
      const sessionResult = await requestJson(
        googleUrl("/v1/createSession", { key }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapType: "streetview",
            language: "en-US",
            region: "US",
          }),
        },
      );
      if (!validSessionToken(sessionResult.session)) {
        throw new Error("House photo unavailable.");
      }
      session = sessionResult.session;
      saveSession(key, sessionResult);
    }
    let metadata;
    try {
      metadata = await requestJson(
        googleUrl("/v1/streetview/metadata", {
          session,
          key,
          lat: String(target.lat),
          lng: String(target.lng),
          radius: "40",
        }),
      );
    } catch (error) {
      if (cachedSession) forgetSession(key, cachedSession);
      throw error;
    }
    if (
      typeof metadata.panoId !== "string" ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(metadata.panoId) ||
      !Number.isFinite(metadata.lat) ||
      Math.abs(metadata.lat) > 90 ||
      !Number.isFinite(metadata.lng) ||
      Math.abs(metadata.lng) > 180 ||
      typeof metadata.copyright !== "string" ||
      !metadata.copyright.trim() ||
      typeof metadata.reportProblemLink !== "string"
    ) {
      throw new Error("House photo unavailable.");
    }
    const reportUrl = new URL(metadata.reportProblemLink);
    if (
      reportUrl.protocol !== "https:" ||
      reportUrl.username ||
      reportUrl.password ||
      !(
        /^cbks?\d+\.googleapis\.com$/.test(reportUrl.hostname) ||
        ["www.google.com", "maps.google.com"].includes(reportUrl.hostname)
      )
    ) {
      throw new Error("House photo unavailable.");
    }
    const heading = bearing(metadata, target) % 360;
    copyright.textContent = metadata.copyright;
    report.href = reportUrl.href;
    setExploreLink(target, metadata.panoId, heading);

    image.addEventListener(
      "load",
      () => {
        message.hidden = true;
        picture.hidden = false;
        status.textContent = "House photo ready. Tap the photo to explore.";
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => showError("Check your connection, then retry or open Google Maps."),
      { once: true },
    );
    // One image request per page; no prefetch, automatic retry or paid fallback.
    image.src = googleUrl("/v1/streetview/thumbnail", {
      session,
      key,
      panoId: metadata.panoId,
      width: "600",
      height: "250",
      pitch: "0",
      yaw: heading.toFixed(2),
      fov: "80",
    }).href;
  }

  openThumbnail().catch((error) => {
    // Do not print provider errors or URLs containing the browser key/session.
    const knownMessages = new Set([
      "This house photo link is invalid.",
      "The house photo is not configured yet.",
    ]);
    showError(
      knownMessages.has(error.message)
        ? error.message
        : "Check your connection, then retry or open Google Maps.",
    );
  });
})();
