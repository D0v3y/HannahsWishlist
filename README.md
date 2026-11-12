# Hannahs Wunschliste 🎁

A password-protected Christmas wishlist (German UI) at **https://hannahswunschliste.com**.
Family and friends open the link, enter the shared password once, and browse the wishes.
Hannah signs in with her own account to add, edit and remove wishes.

- **Adding a wish:** *Wunsch hinzufügen* → paste a shop link (or the text a shop app's *Teilen* button copies)
  → *Ausfüllen* fills in name, picture and price → *Hinzufügen*. For Vestiaire Collective the price includes
  shipping to Germany and duties/taxes.
- **Checking and reserving a gift (guests):** *Noch frei? Jetzt prüfen* → first name + e-mail → an e-mail says
  whether the gift is still free and, if so, carries the link that reserves it. Reservations live outside
  Firebase, so Hannah never sees them; the answer only goes out by e-mail.
- **Against double gifts:** guests get a note on every visit asking them to reserve before buying, and a wish's
  shop link stays locked on their device until they have checked that wish (tapping it points at the button).
- **Price filter:** "Preis von … bis … €" above the list.

## How it's built

| Part | Where |
|---|---|
| Site (HTML/CSS/JS, no build step) | [`site/`](site) |
| API: shop lookup, reservations, e-mail | [`worker/`](worker) — a Cloudflare Worker that also serves `site/` |
| Wishes, logins | Firebase (Authentication + Firestore), rules in [`firestore.rules`](firestore.rules) |
| Reservations | Cloudflare D1 database |
| E-mails | Gmail via SMTP with an app password |
| Settings | [`site/config.js`](site/config.js) (site) and [`wrangler.toml`](wrangler.toml) (Worker) |

### Two environments

| | Test copy | The real list |
|---|---|---|
| Address | https://test.hannahswunschliste.com | https://hannahswunschliste.com |
| Git branch | `staging` | `main` |
| Firebase project | `hannahs-wishlist-staging` | `hannahs-wishlist` |
| D1 database | `wunschliste-staging` | `wunschliste` |
| Worker | `wunschliste-staging` | `wunschliste` |

Every push deploys automatically ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).
Work on `staging`, try it on the test copy, then merge into `main`. The site picks its Firebase project by
address (`PRODUCTION_HOSTS` in `site/config.js`), so the test copy never touches Hannah's wishes.

## Setup (already done — for reference)

**Firebase** (once per environment): Email/Password sign-in; users for Hannah, you and the guest account
(`gast@example.com` with the shared password); Firestore in production mode with `firestore.rules`
(real e-mail addresses filled in); the web app config pasted into `site/config.js`.
Restrict the browser API key (Google Cloud → APIs & Services → Credentials) to the environment's addresses.

**Cloudflare:**
- GitHub repository secret `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" + D1 Edit).
- D1 databases `wunschliste` and `wunschliste-staging` (IDs in `wrangler.toml`).
- Secrets on each Worker (Settings → Variables and Secrets → Add → type **Secret**):
  `SMTP_USER` (Gmail address) and `SMTP_PASS` (its Google app password); optionally `MICROLINK_KEY`
  (see *Ausfüllen* below).
- Email Routing for `support@hannahswunschliste.com` → your inbox.

## Working on it

```bash
python -m http.server 5173 --directory site
```

Opens the site at http://localhost:5173 against the test Firebase project (no API there — for the full
stack use `npx wrangler dev`, which serves site + API at http://localhost:8787).

## Good to know

- **Changing the shared password:** delete the guest user in Firebase and add it again with the same e-mail
  and a new password. Devices signed in with the old one lose access within about an hour.
- **Reservations:** only the guest account can reserve (not Hannah's). Max. 5 e-mails per address and 20 per
  network per hour. Unconfirmed reservations are deleted after a week, cancelled ones after a month.
  To clear one by hand: Cloudflare → D1 → `wunschliste` → Console.
- **Ausfüllen:** the Worker reads the shop page itself. Some shops (e.g. Vinted) turn Cloudflare's servers away;
  then, in this order: the **home helper on the Raspberry Pi** (below) fetches it from the home connection;
  **microlink.io** with the secret `MICROLINK_KEY` (free account, 25 lookups a day); without a key, the visitor's
  browser uses microlink's keyless service (a few a day per network). Each page is read with the same rules.

## Home helper on the Raspberry Pi

[`pi/fetch.py`](pi/fetch.py) — a small service (Python standard library only) that fetches shop pages from the
home connection for the Worker. It only listens on `127.0.0.1:8790`; a **Cloudflare Tunnel** connects it to
`https://fetch.hannahswunschliste.com`. It needs the key from `/etc/wunschliste-fetch.env` (header `X-Fetch-Key`)
and only fetches public internet addresses — never the router or anything else at home, also not via redirects.

Installed on the Pi (`blue-raspberry`, Raspberry Pi OS Lite):

```bash
sudo install -D -m 644 pi/fetch.py /opt/wunschliste-fetch/fetch.py
sudo install -m 644 pi/wunschliste-fetch.service /etc/systemd/system/
printf "FETCH_KEY=%s\n" "$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" | sudo tee /etc/wunschliste-fetch.env >/dev/null
sudo chmod 600 /etc/wunschliste-fetch.env
sudo systemctl enable --now wunschliste-fetch
```

Then: Cloudflare → Zero Trust → Networks → Tunnels → create a tunnel, run its `cloudflared service install …`
command on the Pi, and add the public hostname `fetch.hannahswunschliste.com` → `http://localhost:8790`.
Put the same key into both Workers as the secret `HOME_FETCH_KEY` (`HOME_FETCH_URL` is in `wrangler.toml`).

Check: `systemctl status wunschliste-fetch` · log: `journalctl -u wunschliste-fetch` (shop names only).
If the Pi is off, lookups simply fall back to microlink.
- **Old address:** `d0v3y.github.io/HannahsWishlist` forwards to the new one (root `index.html`).
- The values in `site/config.js` and `wrangler.toml` aren't secret; the protection is the Firestore rules,
  the sign-in check in the Worker and the API key restrictions.
