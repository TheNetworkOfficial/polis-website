# Isolated house-photo trial

The new page is separate from the free interactive viewer used by earlier test
APKs. Open `https://polisapp.io/street-view-test/thumbnail.html` with only
`#lat=...&lng=...`. Unknown or duplicate fragment parameters are rejected. No
Polis authentication, addresses, voter data, or existing Static API panorama IDs
are passed to this page.

## Google configuration

Enable **Map Tiles API** (`tile.googleapis.com`). Create a dedicated browser key
restricted to this API and `https://polisapp.io/*`. Put the public key into the
deployed `tiles-config.json` as `tilesApiKey`; leave the checked-in copy blank.
Do not alter the existing Embed API key or `config.json`.

The page reuses a valid session or makes one session POST (`mapType: streetview`,
`language: en-US`, `region: US`), followed by one metadata request by house
coordinates with radius 40 metres and at most one 600 × 250 thumbnail request.
It derives the heading from that
metadata's camera coordinates toward the house and uses that same metadata's
panorama ID, with pitch 0 and field of view 80. No `panoIds` or image-tile calls,
prefetch, automatic retries, imagery/metadata caches, local counters, or paid fallback are
implemented. Retry is an explicit user action that reloads the page.

Only the Google session token, its API key and Google's actual expiry are kept
in one versioned localStorage record. A key mismatch, malformed record or expiry
within five minutes triggers normal session creation. Blocked storage falls back
to the same flow. A failed metadata request with a reused token removes only its
matching record so manual Retry can create a fresh token. No image, panorama ID,
house coordinates or metadata are stored. Session-token reuse is documented by
Google; the returned expiry controls validity rather than an assumed duration.

Only `https://tile.googleapis.com` is added to the page's image/connect CSP.
Requests omit credentials and use an origin-only cross-origin referrer. Google
response cache headers remain under normal browser control; imagery is not
copied, stored or proxied by Polis.

## Presentation and deployment

The thumbnail implementation is integrated for the next app release. Its
existing hosted URL remains stable so review and release builds use the same
viewer. Ordinary app builds retain their store identity.

For a full production website build, set
`POLIS_STREET_VIEW_TILES_CONFIG_PATH` to the populated runtime JSON outside Git.
The build checks that `tilesApiKey` contains an API key. An unset/blank
configuration fails the build rather than replacing the working hosted viewer
with a disabled template. The key must remain restricted to Map Tiles API and
the approved `https://polisapp.io/*` referrer. Never commit the populated file or
print its contents. Preserve this runtime configuration during deployments.

The photo displays without cropping or distortion. Google Maps text and the exact
copyright from metadata appear below the photo, with Google's supplied
report-problem link at its bottom right. The constrained mobile preview uses the
text attribution allowed by Google's current policy. Tapping the photo opens a
public Google Maps Street View URL; the Android navigation delegate must open
that externally. Links use normal navigation so they do not need a popup window.
The app must keep its non-Google map removed and inactive while this page is open.

After review, copy only `thumbnail.html`, `thumbnail.js`, `thumbnail.css` and the
populated runtime `tiles-config.json` into the existing verified static directory:

```text
/var/www/polis-website-releases/polis-ballot-autosave-20261018/frontend/dist/street-view-test/
```

Do not replace the four existing free-viewer files. No full build, restart,
nginx change or new infrastructure is necessary. Verify the current root before
deployment and compare the website service PID/state before and after.

References: [session creation](https://developers.google.com/maps/documentation/tile/session_tokens),
[Street View metadata and thumbnails](https://developers.google.com/maps/documentation/tile/streetview),
[attribution and caching policy](https://developers.google.com/maps/documentation/tile/policies).
