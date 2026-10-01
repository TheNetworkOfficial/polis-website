const cache = new Map();
const lifetime = 24 * 60 * 60 * 1000;

/** Public reference data only; never cache contact records or authorization here. */
export async function loadContactCities(
  state,
  request,
  { signal, now = Date.now } = {},
) {
  const code = String(state || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [];
  if (signal?.aborted)
    throw new DOMException("City lookup cancelled", "AbortError");
  const cached = cache.get(code);
  if (cached && now() - cached.savedAt < lifetime) return [...cached.cities];
  const result = await request(`/api/geo/cities?state=${code}`, {
    signal,
    auth: true,
  });
  if (signal?.aborted)
    throw new DOMException("City lookup cancelled", "AbortError");
  if (
    result?.state !== code ||
    !Array.isArray(result.cities) ||
    result.cities.some((city) => typeof city !== "string")
  )
    throw new Error("City choices could not be loaded. Try again.");
  const cities = [...new Set(result.cities)].sort((a, b) => a.localeCompare(b));
  cache.set(code, { cities, savedAt: now() });
  return [...cities];
}
