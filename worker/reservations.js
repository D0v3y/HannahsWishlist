// Gift reservations. Stored in Cloudflare D1 — completely outside Firebase, so the
// owner of the list can't see them — and the result only ever goes out by e-mail.
//   POST     /api/reservations             { wishId, name, email }   (guests only)
//            "Noch frei?" — answers by e-mail: still free (with a link to reserve it),
//            already reserved by someone else, or already reserved for you
//   GET|POST /reservierung/bestaetigen?id&t  reserve link from the "still free" e-mail
//   GET|POST /reservierung/aufheben?id&t     cancel link from the "reserved" e-mail
// The links open a page with a button instead of acting right away, because e-mail
// programs open links on their own to scan them.
import { verifyUser } from "./auth.js";
import { escapeHtml, json, page } from "./http.js";
import { sendMail } from "./smtp.js";

const CONFIRM_HOURS = 48;
const LIMIT_PER_EMAIL = 5; // e-mails per address and hour
const LIMIT_PER_IP = 20; // e-mails per network and hour

export async function handleReserve(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const user = await verifyUser(request, env);
  if (!user) return json({ error: "not signed in" }, 401);
  // Reserving is for visitors with the shared password, not for the list's owner.
  if (user.email !== String(env.GUEST_EMAIL || "").toLowerCase()) return json({ error: "guests only" }, 403);

  const body = await request.json().catch(() => ({}));
  const firstName = cleanFirstName(body.name);
  const email = cleanEmail(body.email);
  const wishId = typeof body.wishId === "string" && /^[\w-]{1,128}$/.test(body.wishId) ? body.wishId : null;
  if (!firstName || !email || !wishId) return json({ error: "invalid input" }, 400);
  // The owner's own addresses get no answers — no peeking at what is already reserved.
  if (isBlocked(env, email)) return json({ error: "blocked" }, 403);

  const wishName = await wishTitle(env, wishId, user.token);
  if (!wishName) return json({ error: "unknown wish" }, 404);

  const db = await database(env);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await overLimit(db, email, ip)) return json({ error: "limit" }, 429);

  const taken = await reservedBy(db, wishId);
  let mail;
  if (taken) {
    // asking again about your own gift (e.g. from another device) must not read "taken by Anna"
    mail = taken.email === email ? yoursMail(env, { firstName, wishName }) : takenMail(env, { firstName, wishName, by: taken.first_name });
  } else {
    const id = randomToken(12);
    const token = randomToken(24);
    await db
      .prepare("INSERT INTO reservations (id, wish_id, wish_name, first_name, email, status, confirm_hash, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
      .bind(id, wishId, wishName, firstName, email, await sha256(token), Date.now())
      .run();
    mail = freeMail(env, { firstName, wishName, link: `${new URL(request.url).origin}/reservierung/bestaetigen?id=${id}&t=${token}` });
  }

  await logMail(db, email, ip, ctx);
  try {
    await sendMail(env, { to: email, ...mail });
  } catch (err) {
    console.error("mail failed:", err.message);
    return json({ error: "mail failed" }, 502);
  }
  return json({ ok: true }); // the same answer either way — the result is only in the e-mail
}

export async function handleConfirm(request, env, ctx) {
  const { id, t } = await linkParams(request);
  const db = await database(env);
  const row = id ? await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first() : null;
  if (!row || !t || row.confirm_hash !== (await sha256(t))) return invalidLink();

  const wish = `„${escapeHtml(row.wish_name)}“`;
  if (row.status === "confirmed") {
    return page("Schon bestätigt", `<div class="icon">🎁</div><h1>Schon bestätigt</h1><p>${wish} ist bereits für dich reserviert.</p>`);
  }
  if (row.status !== "pending" || Date.now() - row.created_at > CONFIRM_HOURS * 3600_000) {
    return page("Link abgelaufen", `<div class="icon">⏳</div><h1>Link abgelaufen</h1><p>Dieser Link ist nicht mehr gültig. Du kannst auf der Wunschliste einfach noch einmal prüfen, ob das Geschenk noch frei ist.</p>`, 410);
  }
  const taken = await reservedBy(db, row.wish_id);
  if (taken) return takenPage(wish, taken, row.email);

  if (request.method !== "POST") {
    return page(
      "Geschenk reservieren",
      `<div class="icon">🎁</div><h1>Geschenk reservieren</h1>
      <p>Hallo ${escapeHtml(row.first_name)}! ${wish} ist noch frei. Möchtest du es für dich reservieren?</p>
      <form method="post"><input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="t" value="${escapeHtml(t)}"><button>Ja, reservieren</button></form>`,
    );
  }

  const cancelToken = randomToken(24);
  try {
    const done = await db
      .prepare("UPDATE reservations SET status = 'confirmed', confirmed_at = ?, cancel_hash = ? WHERE id = ? AND status = 'pending'")
      .bind(Date.now(), await sha256(cancelToken), row.id)
      .run();
    if (!done.meta.changes) return invalidLink();
  } catch (err) {
    // Only one confirmed reservation per wish (unique index): someone was a moment faster.
    if (/unique/i.test(String(err?.message))) return takenPage(wish, await reservedBy(db, row.wish_id), row.email);
    throw err;
  }

  const cancelLink = `${new URL(request.url).origin}/reservierung/aufheben?id=${row.id}&t=${cancelToken}`;
  ctx.waitUntil(
    sendMail(env, { to: row.email, ...reservedMail(env, { firstName: row.first_name, wishName: row.wish_name, link: cancelLink }) })
      .catch((err) => console.error("mail failed:", err.message)),
  );
  return page(
    "Reserviert!",
    `<div class="icon">🎉</div><h1>Reserviert!</h1>
    <p>${wish} ist jetzt für dich reserviert – ${escapeHtml(owner(env))} erfährt davon nichts.</p>
    <p>Wir haben dir eine E-Mail mit einem Link geschickt, mit dem du die Reservierung jederzeit wieder aufheben kannst.</p>
    <p class="small"><a href="${escapeHtml(cancelLink)}">Reservierung aufheben</a></p>`,
  );
}

export async function handleCancel(request, env) {
  const { id, t } = await linkParams(request);
  const db = await database(env);
  const row = id ? await db.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first() : null;
  if (!row || !t || !row.cancel_hash || row.cancel_hash !== (await sha256(t))) return invalidLink();

  const wish = `„${escapeHtml(row.wish_name)}“`;
  if (row.status === "cancelled") {
    return page("Schon aufgehoben", `<div class="icon">👍</div><h1>Schon aufgehoben</h1><p>Die Reservierung für ${wish} wurde bereits aufgehoben.</p>`);
  }
  if (request.method !== "POST") {
    return page(
      "Reservierung aufheben",
      `<div class="icon">🎁</div><h1>Reservierung aufheben?</h1>
      <p>Hallo ${escapeHtml(row.first_name)}! Danach ist ${wish} wieder frei und kann von jemand anderem reserviert werden.</p>
      <form method="post"><input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="t" value="${escapeHtml(t)}"><button>Ja, Reservierung aufheben</button></form>`,
    );
  }
  await db.prepare("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'confirmed'").bind(Date.now(), row.id).run();
  return page("Aufgehoben", `<div class="icon">👍</div><h1>Reservierung aufgehoben</h1><p>${wish} ist wieder frei.</p>`);
}

// ─── E-mails ────────────────────────────────────────────────
const owner = (env) => env.OWNER_NAME || "Hannah";
const possessive = (name) => (/[sßxz]$/i.test(name) ? `${name}’` : `${name}s`); // "Hannahs", "Lukas’"
const short = (text) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
const support = (env) => (env.SUPPORT_EMAIL ? `\n\nBei Problemen oder Fragen kannst du dich gerne an ${env.SUPPORT_EMAIL} wenden.` : "");

// Answer to "Noch frei?": yes — and here is the link to reserve it.
function freeMail(env, { firstName, wishName, link }) {
  return {
    subject: `Noch frei: ${short(wishName)}`,
    text:
      `Hallo ${firstName}!\n\n` +
      `Gute Nachricht: ${possessive(owner(env))} Wunsch „${wishName}“ ist noch frei.\n\n` +
      `Möchtest du ihn schenken? Dann reserviere ihn bitte mit diesem Link, damit ${owner(env)} nichts doppelt bekommt:\n\n${link}\n\n` +
      `Der Link ist ${CONFIRM_HOURS} Stunden gültig. Reserviert ist das Geschenk erst, wenn du den Link geöffnet und dort bestätigt hast. ` +
      `Möchtest du es doch nicht schenken, kannst du diese E-Mail einfach ignorieren.${support(env)}`,
  };
}

function reservedMail(env, { firstName, wishName, link }) {
  return {
    subject: `Reserviert: ${short(wishName)}`,
    text:
      `Hallo ${firstName}!\n\n` +
      `${possessive(owner(env))} Wunsch „${wishName}“ ist jetzt für dich reserviert.\n\n` +
      `Um die Reservierung wieder aufzuheben, kannst du jederzeit diesen Link klicken:\n\n${link}${support(env)}`,
  };
}

// Answer to "Noch frei?" when the asker's own address already holds the reservation.
function yoursMail(env, { firstName, wishName }) {
  return {
    subject: `Schon für dich reserviert: ${short(wishName)}`,
    text:
      `Hallo ${firstName}!\n\n` +
      `${possessive(owner(env))} Wunsch „${wishName}“ ist bereits für dich reserviert – du brauchst nichts weiter zu tun.\n\n` +
      `Den Link zum Aufheben findest du in der E-Mail „Reserviert: …“, die du nach dem Reservieren bekommen hast.${support(env)}`,
  };
}

function takenMail(env, { firstName, wishName, by }) {
  return {
    subject: `Schon reserviert: ${short(wishName)}`,
    text:
      `Hallo ${firstName}!\n\n` +
      `Leider wurde der Wunsch „${wishName}“ bereits von ${by} reserviert. Vielleicht findest du ja etwas anderes.${support(env)}`,
  };
}

// ─── Helpers ────────────────────────────────────────────────
let schemaReady = false;
async function database(env) {
  if (!schemaReady) {
    await env.DB.batch([
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, wish_id TEXT NOT NULL, wish_name TEXT NOT NULL, first_name TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL, confirm_hash TEXT NOT NULL, cancel_hash TEXT, created_at INTEGER NOT NULL, confirmed_at INTEGER, cancelled_at INTEGER)",
      ),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_reservation_per_wish ON reservations (wish_id) WHERE status = 'confirmed'"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS mail_log (email TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS mail_log_at ON mail_log (at)"),
    ]);
    schemaReady = true;
  }
  return env.DB;
}

// Who holds the wish: { first_name, email }, or null while it is free.
async function reservedBy(db, wishId) {
  return (await db.prepare("SELECT first_name, email FROM reservations WHERE wish_id = ? AND status = 'confirmed'").bind(wishId).first()) || null;
}

// The wish's name comes from Firestore (read with the visitor's own sign-in), never from
// the request — so nobody can put their own text into e-mails sent to others.
async function wishTitle(env, wishId, idToken) {
  const base = env.FIRESTORE_URL || "https://firestore.googleapis.com"; // overridable only for local tests
  const res = await fetch(`${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/wishes/${encodeURIComponent(wishId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) return null;
  const name = (await res.json())?.fields?.name?.stringValue;
  return name ? name.replace(/\s+/g, " ").trim().slice(0, 120) : null;
}

async function overLimit(db, email, ip) {
  const row = await db
    .prepare("SELECT COALESCE(SUM(email = ?), 0) AS by_email, COALESCE(SUM(ip = ?), 0) AS by_ip FROM mail_log WHERE at > ?")
    .bind(email, ip, Date.now() - 3600_000)
    .first();
  return row.by_email >= LIMIT_PER_EMAIL || row.by_ip >= LIMIT_PER_IP;
}

async function logMail(db, email, ip, ctx) {
  const now = Date.now();
  await db.prepare("INSERT INTO mail_log (email, ip, at) VALUES (?, ?, ?)").bind(email, ip, now).run();
  // keep only what's needed: the last week of mail counts, unconfirmed reservations for
  // a week, cancelled ones for a month
  ctx.waitUntil(
    db.batch([
      db.prepare("DELETE FROM mail_log WHERE at < ?").bind(now - 7 * 86400_000),
      db.prepare("DELETE FROM reservations WHERE status = 'pending' AND created_at < ?").bind(now - 7 * 86400_000),
      db.prepare("DELETE FROM reservations WHERE status = 'cancelled' AND cancelled_at < ?").bind(now - 30 * 86400_000),
    ]),
  );
}

// Only the first name is used (and stored): "Anna-Lena Müller" → "Anna-Lena".
// Letters, hyphens and apostrophes only — no dots, so nobody can slip a web address
// ("Hallo spam.example!") into e-mails sent to other people.
function cleanFirstName(raw) {
  const first = String(raw || "").trim().split(/\s+/)[0] || "";
  return /^\p{L}[\p{L}'’-]{0,39}$/u.test(first) ? first : null;
}

function cleanEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) ? email : null;
}

// BLOCKED_EMAILS: the owner's addresses, separated by commas or spaces. Compared without
// "+tags", and for Gmail without dots, so anna.b+x@googlemail.com counts as annab@gmail.com.
function isBlocked(env, email) {
  const plain = (address) => {
    const [name, domain = ""] = address.trim().toLowerCase().split("@");
    const gmail = domain === "gmail.com" || domain === "googlemail.com";
    const user = name.split("+")[0];
    return `${gmail ? user.replace(/\./g, "") : user}@${gmail ? "gmail.com" : domain}`;
  };
  const blocked = String(env.BLOCKED_EMAILS || "").split(/[\s,;]+/).filter(Boolean).map(plain);
  return blocked.includes(plain(email));
}

async function linkParams(request) {
  const url = new URL(request.url);
  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    if (form) return { id: String(form.get("id") || ""), t: String(form.get("t") || "") };
  }
  return { id: url.searchParams.get("id") || "", t: url.searchParams.get("t") || "" };
}

function invalidLink() {
  return page("Link ungültig", `<div class="icon">🤔</div><h1>Link ungültig</h1><p>Dieser Link ist nicht (mehr) gültig. Bitte nutze den Link aus deiner neuesten E-Mail.</p>`, 404);
}

// `taken` is the reservation that holds the wish, `email` the address of whoever opened the link.
function takenPage(wish, taken, email) {
  if (taken?.email === email) {
    return page("Schon reserviert", `<div class="icon">🎁</div><h1>Schon reserviert</h1><p>${wish} ist bereits für dich reserviert – du brauchst nichts weiter zu tun.</p>`);
  }
  const by = escapeHtml(taken?.first_name || "jemand anderem");
  return page("Schon reserviert", `<div class="icon">🎁</div><h1>Schon reserviert</h1><p>Leider wurde ${wish} inzwischen von ${by} reserviert. Vielleicht findest du ja etwas anderes.</p>`);
}

function randomToken(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
