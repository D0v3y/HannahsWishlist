# Hannahs Wunschliste 🎁

A password-protected Christmas wishlist (German UI) that runs on GitHub Pages. Family and friends open the link,
enter the shared password once, and can browse the wishes. Hannah signs in with her own account and can add,
edit and remove wishes right on the page.

- **Adding a wish:** tap *Wunsch hinzufügen* → paste a shop link (or the text the *Teilen* button of a shop app
  copies) → name, picture and price are filled in automatically when the shop allows it → *Hinzufügen*.
  This needs the small lookup service from step 4 below; without it, everything is typed in by hand.
- Photos can also be uploaded straight from the phone; they're shrunk automatically.
- *Top-Wunsch* puts a wish at the top with a little badge.

Files: `index.html` (page), `style.css` (look), `app.js` (behaviour), `store.js` (saving),
`config.js` (**the only file you need to edit**), `firestore.rules` (who may read and edit),
`worker/lookup.js` (the lookup service behind *Ausfüllen*).

---

## Try it locally

Until Firebase is connected, the site runs in **preview mode** with sample wishes: any password opens the list,
any e-mail/password signs you in as an editor, and changes are only kept in your own browser.

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

---

## Go live (about 15 minutes, free)

### 1. Firebase: logins + database

1. Go to <https://console.firebase.google.com>, click **Create a project**, give it a name (e.g. `hannahs-wunschliste`).
   Google Analytics isn't needed. The free **Spark** plan is enough — no credit card.
2. **Build → Authentication → Get started → Sign-in method → Email/Password →** enable → **Save**.
3. **Authentication → Users → Add user** — create these accounts:
   - **Hannah:** her e-mail and a password she'll remember. Add yourself too if you want to be able to edit.
   - **Guests:** e-mail `gast@example.com` (or whatever `guestEmail` says in `config.js`) and the
     **shared password** you'll give to family and friends. This address doesn't need to be a real mailbox.
     Pick something not too easy to guess — e.g. three words like `zimt-schlitten-polarlicht`.
4. *(Recommended)* **Authentication → Settings → User actions**: untick **Enable create (sign-up)**
   so nobody else can make an account.
5. **Build → Firestore Database → Create database** → pick a location near you (e.g. `eur3 (europe)`)
   → **Start in production mode**.
6. In Firestore open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules),
   put in the real e-mail addresses from step 3 (lower-case) — editors in `isEditor()`, the guest account in
   `isGuest()` — and click **Publish**.
7. Click the ⚙️ next to *Project Overview* → **Project settings → Your apps →** the **`</>`** (Web) icon.
   Register the app (no Firebase Hosting needed). Copy the values from the `firebaseConfig` it shows you
   into [`config.js`](config.js).

Reload the page — the yellow preview banner disappears and the list is now live and shared.

### 2. GitHub Pages: hosting

1. Create a new **public** repository on GitHub (e.g. `HannahsWishlist`) and push these files to it.
   The code is public, but the wishes aren't in it — they live in Firebase behind the password.
2. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch →** `main` / `(root)` → **Save**.
3. After a minute the site is at `https://<your-username>.github.io/HannahsWishlist/`.

### 3. Sharing

- **Family & friends:** send them the link and the shared password. They enter it once per device.
- **Hannah:** on the password screen, tap *Liste bearbeiten? Mit E-Mail anmelden* (or *Anmelden* at the top right
  once the list is open) and sign in with her own account. The browser remembers it.
  Tip: *Teilen → Zum Home-Bildschirm* makes it feel like an app.

### 4. Lookup service for *Ausfüllen* (optional, free)

Browsers may not read other websites, so a tiny service of your own fetches the shop page and hands
name, picture and price to the form. It runs on Cloudflare Workers (free plan: 100,000 lookups a day).

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. **Workers & Pages → Create → Create Worker** (the "Hello World" starter), name it e.g. `wunschliste-lookup`,
   click **Deploy**.
3. Click **Edit code**, replace everything with the contents of [`worker/lookup.js`](worker/lookup.js),
   click **Deploy** again.
4. Copy the Worker's address (`https://wunschliste-lookup.<your-name>.workers.dev`) into `lookupUrl` in
   [`config.js`](config.js) and push. The *Ausfüllen* button appears.

The service only answers requests from the addresses in `ALLOWED_ORIGINS` at the top of `worker/lookup.js`
(your GitHub Pages site and `localhost:5173` for testing) — add yours there if the site moves.
Prefer the command line? `cd worker && npx wrangler deploy` does the same.

---

## Good to know

- **Customising:** title, subtitle ("Weihnachten 2026"), currency and number format are at the top of `config.js`.
- **Security:** the values in `config.js` aren't secret (they only identify the project). What keeps strangers out
  is `firestore.rules`: only the guest account and the editors can *read* the list, only the editors can change it.
  Firebase also slows down repeated wrong password attempts.
- **Changing the shared password:** in Authentication → Users, delete the guest account and add it again with the
  same e-mail and a new password. Devices that were signed in with the old one lose access within about an hour.
- **Ausfüllen** reads the price from Amazon's price fields or the standard product data most shops include for
  search engines. Some shops block automated visitors (Amazon at times shows a robot check); then the form simply
  asks to fill in the details by hand. Links go only to your own service — no third party sees them.
- **Pictures** are resized in the browser (max. 1000 px) and saved together with the wish, so no paid file storage is
  needed. Firestore's free tier (1 GB, 50,000 reads/day) is far more than a wishlist will ever use.
