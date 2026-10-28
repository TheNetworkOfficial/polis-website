# County processor release check

The geocoding cohort bundle uses a separately emitted browser worker. The
shared bundle and CSS alone are not a complete release. The October 28 repair
adds an exact `/570.js` compatibility route to the unchanged, hash-verified county
processor so existing browser sessions work again.

`prepare-geocode-cohort-routing.cjs` now reads the compiled worker reference,
requires both the worker and its license, adds their exact routes, and records
their byte lengths and SHA-256 values in `requiredStageAssets`. Include these
files when staging the release. Before activation, run this check against the
reviewed and actual staged distribution directories:

```powershell
node scripts/ballot-worker-assets.cjs --dist D:/review/frontend/dist --staged D:/staged/frontend/dist
```

For a remote staged directory, run the same check on the server or compare
read-only staged file hashes and sizes against every `requiredStageAssets`
entry. Local inventory presence alone is not stage verification. Verify the
public worker returns JavaScript and the expected bytes after activation.

A missing file, HTML response, changed linker, ambiguous worker, changed staged
bytes, or existing numeric worker route blocks preparation or verification.
An existing `/570.js` compatibility route needs an explicit mapping review;
silently keeping a previous numeric route could serve an outdated processor.
The guard does not change ballot parsing, county quotas, geocoding, or customer
data and does not authorize a production import.
