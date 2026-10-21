# Isolated Street View test viewer

This standalone page replaces the Android test build's paid photo request with
the official Google Maps Embed API Street View iframe. It does not change the
website's existing DoorKnocker flow or deploy itself.

## Page contract

The test app opens `https://polisapp.io/street-view-test/viewer.html` in a WebView
with only camera parameters in its URL fragment:

```text
#lat=47.501483806988&lng=-111.225855155865&heading=175.62&pitch=0&fov=80
```

`lat` and `lng` are required and bounded to valid latitude/longitude ranges.
Optional `pano` accepts only letters, digits, hyphens and underscores (up to 256
characters). Optional heading is 0–360, pitch is −90–90, and field of view is
10–100. Unknown or duplicate fields are rejected. No address, voter record,
organization identifier, Polis token or user identifier belongs in this URL.
Fragments are not sent to the Polis web server or included in HTTP referrers.
The iframe sends only the Polis origin as its cross-origin referrer, using
`strict-origin-when-cross-origin` rather than exposing the viewer's path.

The page constructs a fixed-origin official Embed URL. It never accepts an
arbitrary iframe URL, copies imagery, requests the paid Static Street View API,
or proxies Google responses. Google controls and attribution stay visible. The
app must remove and deactivate its non-Google map before opening this page and
keep that map inactive until the WebView is closed.

## Configuration and narrow deployment

1. Enable Maps Embed API and create a browser key restricted to that API and
   the actual HTTPS viewer domain (`https://polisapp.io/*`). Do not reuse a
   backend or unrestricted key.
2. Leave the checked-in `config.json` blank. Set `googleMapsEmbedApiKey` in the
   deployed copy only. This browser key is public by design; its API and domain
   restrictions provide the protection.
3. Find the **current** nginx frontend static root on the existing website
   host. Release directories have changed in the past; do not assume the path
   from the example nginx file is current.
4. Copy only the four files from `frontend/src/pages/street-view-test/` into
   `street-view-test/` under that live static root. No full website build,
   backend deploy, new instance, CI run or nginx reload is needed for static
   files if the current configuration already serves that directory.
5. Check that the HTTPS page, stylesheet, script and config return their expected
   content (not a fallback HTML page), then verify imagery on the test Pixel.
   Use the explicit nested `viewer.html` URL: the live site's existing index and
   trailing-slash redirects cause a loop for directory/index page URLs. No nginx
   change is needed for this file path. The build configuration also emits these
   four files on future normal frontend builds.

Configuration is requested with `cache: "no-store"` and no credentials. There is
no imagery cache, analytics, Polis API call or paid fallback in this page.
An iframe load event does **not** prove imagery is available: Google owns the
cross-origin content and displays its own key/coverage errors. The optional
external Google Maps link remains available for connection or imagery issues.

Rollback the test app to its previous build or remove its viewer URL setting.
Do not reenable paid image requests silently. The four static files can remain
unlinked or be removed after the app no longer uses them.
