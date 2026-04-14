# Polis Website Move: Cloudflare to AWS Lightsail

This is the simplest low-cost setup for the current Polis website:

- one small Amazon Lightsail Linux server
- Nginx for the public website
- one small Node process for the public backend
- GoDaddy stays as the registrar
- GoDaddy DNS stays in place unless you deliberately move DNS later

This path is designed to get these working first:

- public website pages
- external post share links like `/posts/:postId`
- branded social-card images like `/posts/:postId/social-card.png`
- social OAuth relay pages like `/oauth/meta/callback`
- Android and iPhone app-link files under `/.well-known/*`

It does **not** require the legacy database-heavy website backend to be live.
If you later want the old website APIs too, you can run the full backend on the
same server with a local SQLite file instead of Postgres.

## Why this is the easiest path

The existing full website backend in [`backend/src/server.js`](../backend/src/server.js) tries to boot:

- Redis-backed sessions
- a SQL database connection
- older admin/contact/news routes

That is unnecessary for the share-link feature. The lightweight server in [`backend/src/publicServer.js`](../backend/src/publicServer.js) only runs the public routes you need for link previews and OAuth relay, plus it serves the built frontend.

## What you must not shut down first

Do **not** delete the old Cloudflare zone or change the old domain nameservers yet if your app still uses any old-domain hostnames such as:

- `www.<old-domain>`
- `app.<old-domain>`
- `ws.<old-domain>`

Your mobile app and backend currently still reference old-domain hosts in multiple places, including:

- [`android/gradle.properties`](/home/lux/Programming/coalitionApp/coalitio_app_v2/android/gradle.properties)
- [`ios/Flutter/Release.xcconfig`](/home/lux/Programming/coalitionApp/coalitio_app_v2/ios/Flutter/Release.xcconfig)
- [`ios/Flutter/Debug.xcconfig`](/home/lux/Programming/coalitionApp/coalitio_app_v2/ios/Flutter/Debug.xcconfig)
- [`video-backend/src/shareCards.js`](/home/lux/Programming/coalitionApp/video-backend/src/shareCards.js)
- [`video-backend/src/social.js`](/home/lux/Programming/coalitionApp/video-backend/src/social.js)

If you remove the old domain from Cloudflare too early, you can break the live app.

## Recommended migration order

1. Stand up the new AWS-hosted website on the **new domain**
2. Verify the new domain serves:
   - `/`
   - `/posts/<real-post-id>`
   - `/posts/<real-post-id>/social-card.png`
   - `/.well-known/assetlinks.json`
   - `/.well-known/apple-app-site-association`
3. Update the app and backend config to use the new public website domain
4. Release the app update if you want app links to open directly from the new domain
5. Only then disable the old Cloudflare website routes

## Estimated monthly cost

Typical starting cost:

- Amazon Lightsail Linux instance: about **$5/month** for the 1 GB plan, or **$10/month** if you want more headroom
- Route 53: **not required** if you keep DNS at GoDaddy

If you want AWS DNS later, Route 53 hosted zones are billed separately at **$0.50/month** per hosted zone.

## Step 1: Build the website locally

From the repo root:

```bash
cd /home/lux/Programming/polis-website
npm run build:frontend
```

That writes the public site to:

- [`frontend/dist`](../frontend/dist)

## Step 2: Create a small Lightsail instance

Use:

- Platform: Linux/Unix
- Blueprint: Ubuntu 24.04 LTS, or the Lightsail Node.js blueprint
- Plan: start with 1 GB RAM if budget matters; 2 GB is safer if you expect traffic spikes
- Region: keep it close to your users, likely `us-west-2` or the nearest Lightsail region you prefer

After creation:

1. Attach a static IP
2. Open firewall ports:
   - `22` for SSH
   - `80` for HTTP
   - `443` for HTTPS

## Step 3: SSH into the server and install packages

On the server:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Create folders:

```bash
sudo mkdir -p /var/www/polis-website
sudo mkdir -p /etc/polis-website
sudo chown -R $USER:$USER /var/www/polis-website
```

## Step 4: Copy the website to the server

From your local machine:

```bash
cd /home/lux/Programming/polis-website
npm run build:frontend
rsync -avz deploy/ lux@YOUR_SERVER_IP:/var/www/polis-website/deploy/
rsync -avz backend/ lux@YOUR_SERVER_IP:/var/www/polis-website/backend/
rsync -avz frontend/dist/ lux@YOUR_SERVER_IP:/var/www/polis-website/frontend/dist/
```

On the server:

```bash
cd /var/www/polis-website/backend
npm install --omit=dev
```

## Step 5: Create the backend env file

Copy [`deploy/lightsail/backend.env.example`](../deploy/lightsail/backend.env.example) to `/etc/polis-website/backend.env`.

At minimum set:

```bash
NODE_ENV=production
PORT=3000
PUBLIC_WEB_BASE_URL=https://polisapp.io
VIDEO_BACKEND_BASE_URL=https://YOUR-VIDEO-BACKEND-ID.execute-api.us-west-2.amazonaws.com/prod
ANDROID_APP_PACKAGE=com.luxcorp.polis
ANDROID_SHA256_CERT_FINGERPRINTS=...
IOS_APP_ID=...
```

For Polis production, set `PUBLIC_WEB_BASE_URL` to `https://polisapp.io`.
Do not point that variable at `https://www.polisapp.io` if shared post links
are expected to resolve on the apex domain.

If you are not ready to move app links yet, you can still use the new domain for web previews only. In that case the site preview will work, but direct app-opening from the new domain will not be trusted by the installed app until you ship a mobile update.

If you want the legacy website API routes too, also set:

```bash
SESSION_SECRET=replace-me
DB_SQLITE_PATH=/var/lib/polis-website/site.sqlite
```

## Step 6: Install the systemd service

For the cheapest first cut, use the lightweight public server:

```bash
sudo cp /var/www/polis-website/deploy/lightsail/polis-website.service /etc/systemd/system/polis-website.service
```

If you want the old website APIs too, use the full service file instead:

```bash
sudo cp /var/www/polis-website/deploy/lightsail/polis-website-full.service /etc/systemd/system/polis-website.service
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable polis-website
sudo systemctl restart polis-website
sudo systemctl status polis-website
```

## Step 7: Configure Nginx

Copy [`deploy/lightsail/polis-website.nginx.conf.example`](../deploy/lightsail/polis-website.nginx.conf.example) to:

```bash
/etc/nginx/sites-available/polis-website
```

Replace:

- `example.com`
- `www.example.com`

with your new domain values.

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/polis-website /etc/nginx/sites-enabled/polis-website
sudo nginx -t
sudo systemctl reload nginx
```

If you are using the lightweight public server, remove the `location ^~ /api/`
block from the Nginx config. That small server is only for:

- website pages
- `/posts/*`
- `/feed`
- `/candidates*`
- `/events*`
- `/manage-events*`
- `/profile*`
- `/messages*`
- `/oauth/*`
- `/.well-known/*`

If you are using the full backend service, keep the `/api/` proxy block.

## Step 8: Point the new GoDaddy domain to Lightsail

Leave the domain registered at GoDaddy.

In GoDaddy DNS for the **new** domain:

- add an `A` record for `@` pointing to the Lightsail static IP
- add a `CNAME` record for `www` pointing to `@`, or another `A` record pointing to the same static IP

Wait for DNS to propagate.

Before HTTPS, test:

```bash
curl -I http://NEW-DOMAIN.com
curl -I http://www.NEW-DOMAIN.com
```

## Step 9: Turn on HTTPS

Run Certbot on the server after DNS is pointing correctly:

```bash
sudo certbot --nginx -d NEW-DOMAIN.com -d www.NEW-DOMAIN.com
```

Then test:

```bash
curl -I https://NEW-DOMAIN.com
curl -I https://www.NEW-DOMAIN.com
```

## Step 10: Verify the share-link feature

Test a real public post:

```bash
curl -I https://polisapp.io/posts/REAL_POST_ID
curl -I https://polisapp.io/posts/REAL_POST_ID/social-card.png
curl https://polisapp.io/.well-known/assetlinks.json
curl https://polisapp.io/.well-known/apple-app-site-association
```

You should see:

- HTML for `/posts/REAL_POST_ID`
- `image/png` for `/posts/REAL_POST_ID/social-card.png`
- JSON from both `/.well-known/*` routes

## Step 11: Update app and backend to the new website domain

These all need to point to the same public website host used for sharing.
For Polis production, that host is `https://polisapp.io`:

- app runtime `PUBLIC_WEB_BASE_URL`
- video backend `PUBLIC_WEB_BASE_URL` or `WEB_BASE_URL`
- mobile app link host values

Important files:

- [`env/prod.example.json`](/home/lux/Programming/coalitionApp/coalitio_app_v2/env/prod.example.json)
- [`android/gradle.properties`](/home/lux/Programming/coalitionApp/coalitio_app_v2/android/gradle.properties)
- [`ios/Flutter/Release.xcconfig`](/home/lux/Programming/coalitionApp/coalitio_app_v2/ios/Flutter/Release.xcconfig)
- [`ios/Flutter/Debug.xcconfig`](/home/lux/Programming/coalitionApp/coalitio_app_v2/ios/Flutter/Debug.xcconfig)
- [`video-backend/template.yaml`](/home/lux/Programming/coalitionApp/video-backend/template.yaml)

## Step 12: Only after the new site works, retire the old Cloudflare website

Safe order:

1. Remove the old domain’s custom domain binding from the Cloudflare Pages project, if one exists
2. Remove or disable any old Worker routes that served the website
3. Leave the old domain zone and DNS in place if the app or backend still uses any old-domain subdomains
4. If the old domain will no longer be used for anything, then migrate DNS or stop serving it entirely

## Recommended first cut

For the first move, use the new domain only for:

- website pages
- post shares
- social-card images
- social OAuth relay

Do **not** move the app API or websocket host as part of the same cutover.

That keeps the migration small and makes the share-link problem solvable immediately.

## Which server mode to pick

Use the lightweight public server if:

- your priority is fixing external post shares fast
- you want the simplest and cheapest AWS setup
- you do not need the older website admin/contact/news APIs on day one

Use the full backend server if:

- you also need routes like `/api/contact` or `/api/mailing-list`
- you are okay keeping a local SQLite database file on the server
- you want the whole legacy website backend moved in the same cut
