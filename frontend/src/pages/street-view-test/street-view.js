(() => {
  "use strict";

  const status = document.getElementById("viewer-status");
  const message = document.getElementById("viewer-message");
  const detail = document.getElementById("viewer-detail");
  const retry = document.getElementById("retry-viewer");
  const externalLink = document.getElementById("open-google-maps");
  const surface = document.querySelector(".viewer__surface");
  let externalViewAvailable = false;
  const allowedParameters = new Set([
    "lat",
    "lng",
    "pano",
    "heading",
    "pitch",
    "fov",
  ]);

  function numberParameter(parameters, name, minimum, maximum, fallback) {
    const raw = parameters.get(name);
    if (raw === null && fallback !== undefined) return fallback;
    if (raw === null || !/^-?\d+(?:\.\d+)?$/.test(raw)) {
      throw new Error("This house view link is incomplete.");
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error("This house view link is invalid.");
    }
    return value;
  }

  /** Accept only camera information; never forward Polis identity or tokens. */
  function readViewParameters() {
    if (window.location.hash.length > 2048) {
      throw new Error("This house view link is invalid.");
    }
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    for (const name of parameters.keys()) {
      if (
        !allowedParameters.has(name) ||
        parameters.getAll(name).length !== 1
      ) {
        throw new Error("This house view link is invalid.");
      }
    }
    const pano = parameters.get("pano");
    if (pano !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(pano)) {
      throw new Error("This house view link is invalid.");
    }
    return {
      lat: numberParameter(parameters, "lat", -90, 90),
      lng: numberParameter(parameters, "lng", -180, 180),
      pano,
      heading: numberParameter(parameters, "heading", 0, 360, 0),
      pitch: numberParameter(parameters, "pitch", -90, 90, 0),
      fov: numberParameter(parameters, "fov", 10, 100, 80),
    };
  }

  function showError(text) {
    status.textContent = "House view unavailable";
    detail.textContent = text;
    message.hidden = false;
    retry.hidden = false;
    externalLink.hidden = !externalViewAvailable;
  }

  retry.addEventListener("click", () => window.location.reload());

  async function openViewer() {
    const view = readViewParameters();
    const location = `${view.lat},${view.lng}`;
    const externalUrl = new URL("https://www.google.com/maps/@");
    externalUrl.search = new URLSearchParams({
      api: "1",
      map_action: "pano",
      viewpoint: location,
      heading: String(view.heading),
      pitch: String(view.pitch),
      fov: String(view.fov),
      ...(view.pano ? { pano: view.pano } : {}),
    });
    externalLink.href = externalUrl.href;
    externalViewAvailable = true;

    const response = await fetch("/street-view-test/config.json", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw new Error("The house viewer could not be opened.");
    const config = await response.json();
    const key = config.googleMapsEmbedApiKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{20,256}$/.test(key)) {
      throw new Error("The house viewer is not configured yet.");
    }

    const embedUrl = new URL("https://www.google.com/maps/embed/v1/streetview");
    embedUrl.search = new URLSearchParams({
      key,
      location,
      heading: String(view.heading),
      pitch: String(view.pitch),
      fov: String(view.fov),
      ...(view.pano ? { pano: view.pano } : {}),
    });
    const frame = document.createElement("iframe");
    frame.title = "Google Street View house view";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    // Cross-origin iframe loads cannot confirm imagery or detect Google errors.
    // Keep Google's own error messages, controls and attribution unobstructed.
    frame.addEventListener("load", () => {
      status.textContent = "House view · Google Street View";
    });
    frame.src = embedUrl.href;
    message.hidden = true;
    surface.appendChild(frame);
  }

  openViewer().catch((error) => {
    // Never expose a provider URL (containing its public key) in diagnostics.
    const knownMessages = new Set([
      "This house view link is incomplete.",
      "This house view link is invalid.",
      "The house viewer is not configured yet.",
      "The house viewer could not be opened.",
    ]);
    showError(
      knownMessages.has(error.message)
        ? error.message
        : "Check your connection, then retry or open Google Maps.",
    );
  });
})();
