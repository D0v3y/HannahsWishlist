import { guestEmail, site } from "./config.js";
import { connect, isPreview } from "./store.js";

const $ = (sel, root = document) => root.querySelector(sel);

const money = new Intl.NumberFormat(site.locale, { style: "currency", currency: site.currency });
const currencySymbol = money.formatToParts(0).find((p) => p.type === "currency")?.value ?? site.currency;

const els = {
  list: $("#wishes"),
  empty: $("#empty"),
  loadError: $("#load-error"),
  count: $("#count"),
  authBtn: $("#auth-btn"),
  editorEmail: $("#editor-email"),
  toast: $("#toast"),
  loginDialog: $("#login-dialog"),
  loginForm: $("#login-form"),
  loginError: $("#login-error"),
  wishDialog: $("#wish-dialog"),
  wishForm: $("#wish-form"),
  wishError: $("#wish-error"),
  gateForm: $("#gate-form"),
  gatePass: $("#gate-pass"),
  gateError: $("#gate-error"),
  link: $("#f-link"),
  name: $("#f-name"),
  desc: $("#f-desc"),
  price: $("#f-price"),
  top: $("#f-top"),
  imageUrl: $("#f-image-url"),
  autofillBtn: $("#autofill-btn"),
  autofillStatus: $("#autofill-status"),
  photoPreview: $("#photo-preview"),
  photoNote: $("#photo-note"),
  saveBtn: $("#save-btn"),
  deleteBtn: $("#delete-btn"),
};

const AUTOFILL_HINT = els.autofillStatus.textContent;

const state = {
  store: null,
  user: null,
  wishes: [],
  stopWishes: null, // ends the live list subscription
  editing: null, // the wish being edited, or null when adding
  image: "", // picture currently in the form (data: URL or https URL)
  lastLookup: "", // link we last tried to auto-fill from
  lookupId: 0, // ignores stale auto-fill results after the form changes
  firstPaint: true,
};

applySiteSettings();
renderSkeleton();
bindEvents();

connect()
  .then((store) => {
    state.store = store;
    $("#preview-banner").hidden = !isPreview;
    $("#preview-hint").hidden = !isPreview;
    $("#gate-preview-hint").hidden = !isPreview;
    store.onUser(onUserChanged);
  })
  .catch((err) => {
    console.error(err);
    showLoadError();
  });

// ─── Rendering ──────────────────────────────────────────────
function applySiteSettings() {
  document.title = site.title;
  $("#site-title").textContent = site.title;
  $("#site-subtitle").textContent = site.subtitle;
  $("#site-subtitle").hidden = !site.subtitle;
  $("#price-currency").textContent = currencySymbol;
  els.price.placeholder = priceForInput(29.99);
}

function renderSkeleton() {
  const bones = `<div class="wish-media"></div><div class="wish-body"><span class="bone title"></span><span class="bone"></span><span class="bone short"></span></div>`;
  els.list.innerHTML = Array.from({ length: 3 }, () => `<li class="wish skeleton" aria-hidden="true">${bones}</li>`).join("");
}

// The list can only be read once someone is signed in: visitors with the
// shared guest password, or an editor (Hannah) with her own account.
function onUserChanged(user) {
  state.user = user;
  renderAuth();
  state.stopWishes?.();
  state.stopWishes = null;
  if (!user) {
    state.wishes = [];
    state.firstPaint = true;
    renderSkeleton();
    els.count.textContent = "";
    els.empty.hidden = true;
    els.loadError.hidden = true;
    return;
  }
  state.stopWishes = state.store.onWishes(
    (wishes) => {
      state.wishes = wishes;
      renderWishes();
    },
    (err) => {
      console.error(err);
      showLoadError();
    },
  );
}

const isGuest = (user) => user?.email?.toLowerCase() === guestEmail.toLowerCase();

function renderAuth() {
  const editor = Boolean(state.user) && !isGuest(state.user);
  document.body.classList.toggle("is-locked", !state.user);
  document.body.classList.toggle("is-editor", editor);
  els.editorEmail.textContent = editor ? state.user.email : "";
  $("span", els.authBtn).textContent = editor ? "Abmelden" : "Anmelden";
  els.authBtn.hidden = false;
}

function renderWishes() {
  const sorted = [...state.wishes].sort(
    (a, b) => Number(Boolean(b.top)) - Number(Boolean(a.top)) || (b.created ?? 0) - (a.created ?? 0),
  );
  els.list.classList.toggle("animate", state.firstPaint);
  state.firstPaint = false;
  els.list.replaceChildren(...sorted.map(wishCard));
  els.loadError.hidden = true;
  els.empty.hidden = sorted.length > 0;
  els.count.textContent = sorted.length ? `${sorted.length} ${sorted.length === 1 ? "Wunsch" : "Wünsche"}` : "";
}

function wishCard(wish) {
  const card = $("#wish-template").content.firstElementChild.cloneNode(true);
  const link = safeLink(wish.link);
  const image = safeImage(wish.image);
  const hasPrice = typeof wish.price === "number";

  card.classList.toggle("is-top", Boolean(wish.top));
  $(".badge", card).hidden = !wish.top;

  if (image) {
    const img = $("img", card);
    card.classList.add("has-image");
    img.addEventListener("error", () => card.classList.remove("has-image"), { once: true });
    img.src = image;
  }

  $(".wish-name", card).textContent = wish.name;
  const desc = $(".wish-desc", card);
  desc.textContent = wish.description ?? "";
  desc.hidden = !wish.description;

  $(".wish-price", card).textContent = hasPrice ? money.format(wish.price) : "";
  $(".wish-link", card).hidden = !link;
  $(".wish-foot", card).hidden = !link && !hasPrice;
  if (link) card.querySelectorAll("a").forEach((a) => (a.href = link));

  const edit = $(".edit", card);
  const del = $(".delete", card);
  edit.setAttribute("aria-label", `„${wish.name}“ bearbeiten`);
  del.setAttribute("aria-label", `„${wish.name}“ löschen`);
  edit.addEventListener("click", () => openWishDialog(wish));
  del.addEventListener("click", () => deleteWish(wish));
  return card;
}

function showLoadError() {
  els.list.replaceChildren();
  els.empty.hidden = true;
  els.loadError.hidden = false;
  els.count.textContent = "";
}

// ─── Events ─────────────────────────────────────────────────
function bindEvents() {
  els.authBtn.addEventListener("click", onAuthButton);
  els.loginForm.addEventListener("submit", onSignIn);

  document.querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => openWishDialog()));
  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => btn.closest("dialog").close()),
  );
  els.wishDialog.addEventListener("close", () => state.lookupId++);

  els.gateForm.addEventListener("submit", onUnlock);
  els.gateForm.addEventListener("input", () => showError(els.gateError, ""));
  $("#gate-login").addEventListener("click", openLogin);

  els.link.addEventListener("paste", () => setTimeout(maybeAutofill, 0));
  els.link.addEventListener("change", maybeAutofill);
  els.autofillBtn.addEventListener("click", autofill);

  $("#f-file").addEventListener("change", onPhotoChosen);
  $("#photo-remove").addEventListener("click", () => setImage(""));
  els.imageUrl.addEventListener("change", onImageUrl);
  $("img", els.photoPreview).addEventListener("error", (e) => {
    if (!state.image || e.target.getAttribute("src") !== state.image) return;
    setImage("");
    setNote(els.photoNote, "Dieses Bild konnte nicht geladen werden – probier ein anderes.", "err");
  });

  els.wishForm.addEventListener("submit", onSave);
  els.wishForm.addEventListener("input", () => showError(els.wishError, ""));
  els.deleteBtn.addEventListener("click", () => deleteWish(state.editing));
}

// ─── Signing in ─────────────────────────────────────────────
async function onUnlock(e) {
  e.preventDefault();
  if (!state.store) return;
  const password = els.gatePass.value;
  if (!password) return showError(els.gateError, "Bitte gib das Passwort ein.");

  const btn = $("button[type=submit]", els.gateForm);
  showError(els.gateError, "");
  setBusy(btn, true, "Einen Moment …");
  try {
    await state.store.signInGuest(password);
    els.gateForm.reset();
  } catch (err) {
    console.error(err);
    showError(els.gateError, signInMessage(err, "Das Passwort stimmt leider nicht. Bitte versuch es noch einmal."));
  } finally {
    setBusy(btn, false);
  }
}

async function onAuthButton() {
  if (!state.store) return;
  if (state.user && !isGuest(state.user)) {
    await state.store.signOut();
    toast("Abgemeldet");
    return;
  }
  openLogin();
}

function openLogin() {
  if (!state.store) return;
  els.loginForm.reset();
  showError(els.loginError, "");
  els.loginDialog.showModal();
}

async function onSignIn(e) {
  e.preventDefault();
  const email = $("#l-email").value.trim();
  const password = $("#l-pass").value;
  if (!email || !password) return showError(els.loginError, "Bitte gib deine E-Mail-Adresse und dein Passwort ein.");

  const btn = $("button[type=submit]", els.loginForm);
  setBusy(btn, true, "Anmelden …");
  try {
    await state.store.signIn(email, password);
    els.loginDialog.close();
    toast("Willkommen! Du kannst jetzt Wünsche eintragen ✨");
  } catch (err) {
    console.error(err);
    showError(els.loginError, signInMessage(err));
  } finally {
    setBusy(btn, false);
  }
}

function signInMessage(err, wrongCredentials = "E-Mail-Adresse oder Passwort stimmen nicht. Bitte versuch es noch einmal.") {
  switch (err?.code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return wrongCredentials;
    case "auth/too-many-requests":
      return "Zu viele Versuche – bitte warte ein paar Minuten und versuch es dann erneut.";
    case "auth/network-request-failed":
      return "Anscheinend gibt es keine Internetverbindung. Bitte versuch es noch einmal.";
    default:
      return "Die Anmeldung hat nicht geklappt. Bitte versuch es noch einmal.";
  }
}

// ─── Add / edit form ────────────────────────────────────────
function openWishDialog(wish = null) {
  state.editing = wish;
  state.lookupId++;
  els.wishForm.reset();
  $("#wish-title").textContent = wish ? "Wunsch bearbeiten" : "Wunsch hinzufügen";
  els.saveBtn.textContent = wish ? "Speichern" : "Hinzufügen";
  els.deleteBtn.hidden = !wish;

  els.link.value = wish?.link ?? "";
  els.name.value = wish?.name ?? "";
  els.desc.value = wish?.description ?? "";
  els.price.value = typeof wish?.price === "number" ? priceForInput(wish.price) : "";
  els.top.checked = Boolean(wish?.top);
  setImage(wish?.image ?? "");
  state.lastLookup = els.link.value;

  setNote(els.autofillStatus, AUTOFILL_HINT);
  setNote(els.photoNote, "");
  showError(els.wishError, "");
  els.wishDialog.showModal();
  $(".sheet-body", els.wishDialog).scrollTop = 0;
}

function setImage(src) {
  state.image = safeImage(src) ? src : "";
  const img = $("img", els.photoPreview);
  const has = Boolean(state.image);
  if (has) img.src = state.image;
  else img.removeAttribute("src");
  img.hidden = !has;
  $("span", els.photoPreview).hidden = has;
  els.photoPreview.classList.toggle("filled", has);
  $("#photo-remove").hidden = !has;
  $("#photo-choose-label").textContent = has ? "Foto ändern" : "Foto auswählen";
  els.imageUrl.value = state.image.startsWith("https://") ? state.image : "";
  if (has) setNote(els.photoNote, "");
}

async function onPhotoChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  setNote(els.photoNote, "Bild wird vorbereitet …", "busy");
  try {
    setImage(await shrinkImage(file));
    setNote(els.photoNote, "");
  } catch (err) {
    console.error(err);
    setNote(els.photoNote, "Hmm, dieses Bild ließ sich nicht öffnen. Probier ein anderes?", "err");
  }
}

function onImageUrl() {
  const value = els.imageUrl.value.trim();
  if (!value) return setImage("");
  const url = normalizeLink(value);
  if (!url?.startsWith("https://")) {
    return setNote(els.photoNote, "Bild-Links müssen mit https:// beginnen.", "err");
  }
  setImage(url);
}

// Pictures are resized in the browser and stored with the wish,
// so a 5 MB phone photo ends up around 100–300 KB.
async function shrinkImage(file) {
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let maxSide = 1000;
  let quality = 0.85;
  let out;
  do {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.fillStyle = "#fff"; // transparent PNGs get a white background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL("image/jpeg", quality);
    if (quality > 0.6) quality -= 0.1;
    else maxSide = Math.round(maxSide * 0.8);
  } while (out.length > 600_000 && maxSide > 300);
  return out;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Unreadable image: ${file.type}`)); };
    img.src = url;
  });
}

// ─── Auto-fill from a shop link ─────────────────────────────
function maybeAutofill() {
  const link = normalizeLink(els.link.value);
  if (link && link !== state.lastLookup && !els.name.value.trim()) autofill();
}

async function autofill() {
  const link = normalizeLink(els.link.value);
  if (!link) {
    setNote(els.autofillStatus, link === null ? "Das sieht noch nicht wie ein Link aus." : "Füge zuerst einen Link ein.", "err");
    return;
  }
  els.link.value = link;
  state.lastLookup = link;
  const id = ++state.lookupId;

  setBusy(els.autofillBtn, true);
  setNote(els.autofillStatus, "Produkt wird gesucht …", "busy");
  try {
    const info = await lookUpProduct(link);
    if (id !== state.lookupId) return;
    const filled = [];
    if (!els.name.value.trim()) { els.name.value = info.title; filled.push("Name"); }
    if (!els.desc.value.trim() && info.description) { els.desc.value = info.description; filled.push("Beschreibung"); }
    if (!state.image && info.image) { setImage(info.image); filled.push("Bild"); }
    const priceTip = els.price.value.trim() ? "" : " Jetzt fehlt nur noch der Preis.";
    setNote(
      els.autofillStatus,
      filled.length ? `${joinWords(filled)} ausgefüllt – schau kurz drüber.${priceTip}` : "Es ist schon alles ausgefüllt.",
      "ok",
    );
  } catch (err) {
    if (id !== state.lookupId) return;
    console.warn("Auto-fill failed:", err);
    setNote(
      els.autofillStatus,
      err.message === "limit"
        ? "Das automatische Ausfüllen macht für heute Pause – bitte trag die Angaben selbst ein."
        : "Diese Shop-Seite konnte nicht gelesen werden – bitte trag die Angaben selbst ein.",
      "err",
    );
  } finally {
    setBusy(els.autofillBtn, false);
  }
}

const JUNK_TITLE = /^(page not found|not found|seite nicht gefunden|404|403|access denied|zugriff verweigert|robot check|just a moment|attention required|amazon(\.[a-z]+)+)\b/i;

async function lookUpProduct(url) {
  // microlink.io reads the page's preview data (the same thing chat apps show for links).
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
  if (res.status === 429) throw new Error("limit");
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "success") throw new Error(`lookup failed (${res.status})`);

  const data = json.data ?? {};
  const title = cleanTitle(data.title);
  if (!title || JUNK_TITLE.test(title)) throw new Error(`unhelpful title: ${data.title}`);
  const image = data.image?.url;
  return {
    title,
    description: clip(data.description ?? "", 280),
    image: image?.startsWith("https://") ? image : "",
  };
}

function cleanTitle(title = "") {
  return title
    .replace(/^amazon(\.[a-z]+)+\s*:\s*/i, "") // "Amazon.de: Product name"
    .split(/\s+[|•·]\s+/)[0] // "Product name | Shop name"
    .trim()
    .slice(0, 200);
}

// ─── Saving & deleting ──────────────────────────────────────
async function onSave(e) {
  e.preventDefault();
  showError(els.wishError, "");

  const name = els.name.value.trim();
  const link = normalizeLink(els.link.value);
  const price = els.price.value.trim() ? parsePrice(els.price.value) : null;
  if (!name) return invalid("Bitte gib deinem Wunsch einen Namen.", els.name);
  if (link === null) return invalid("Der Link sieht nicht ganz richtig aus – er sollte mit https:// beginnen.", els.link);
  if (Number.isNaN(price)) return invalid(`Bitte gib den Preis als Zahl ein, z. B. ${priceForInput(29.99)}.`, els.price);

  const wish = {
    name,
    description: els.desc.value.trim(),
    price,
    link,
    image: state.image,
    top: els.top.checked,
  };
  const editing = state.editing;

  setBusy(els.saveBtn, true, "Speichern …");
  try {
    if (editing) await state.store.updateWish(editing.id, wish);
    else await state.store.addWish(wish);
    els.wishDialog.close();
    toast(editing ? "Änderungen gespeichert" : "Zur Wunschliste hinzugefügt ✨");
  } catch (err) {
    console.error(err);
    showError(els.wishError, saveMessage(err));
  } finally {
    setBusy(els.saveBtn, false);
  }
}

async function deleteWish(wish) {
  if (!wish || !confirm(`„${wish.name}“ von der Wunschliste entfernen?`)) return;
  try {
    await state.store.deleteWish(wish.id);
    if (els.wishDialog.open) els.wishDialog.close();
    toast("Wunsch entfernt");
  } catch (err) {
    console.error(err);
    if (els.wishDialog.open) showError(els.wishError, saveMessage(err));
    else toast(saveMessage(err));
  }
}

function saveMessage(err) {
  switch (err?.code) {
    case "permission-denied":
      return "Dieses Konto darf die Liste nicht ändern. (Steht die E-Mail-Adresse in den Firestore-Regeln?)";
    case "unavailable":
      return "Gerade keine Verbindung – bitte versuch es gleich noch einmal.";
    case "invalid-argument":
    case "resource-exhausted":
      return "Das ist zu groß zum Speichern – probier ein kleineres Bild.";
    default:
      return "Beim Speichern ist etwas schiefgegangen. Bitte versuch es noch einmal.";
  }
}

function invalid(message, input) {
  showError(els.wishError, message);
  input.focus();
}

// ─── Helpers ────────────────────────────────────────────────

// "" when empty, null when it isn't a usable web link, otherwise the full URL.
function normalizeLink(raw) {
  const text = raw.trim();
  if (!text) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

const safeLink = (s) => (typeof s === "string" && /^https?:\/\//i.test(s) ? s : "");
const safeImage = (s) => (typeof s === "string" && /^(https:\/\/|data:image\/)/i.test(s) ? s : "");

// Accepts "29,99", "29.99", "1.299,00", "1,299.00", "€ 30" …
function parsePrice(raw) {
  const s = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return NaN;
  const decimal = s.match(/^(.*?)[.,](\d{1,2})$/); // last separator followed by 1–2 digits = decimals
  const value = decimal
    ? Number(`${decimal[1].replace(/[.,]/g, "") || "0"}.${decimal[2]}`)
    : Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

function priceForInput(n) {
  return n.toLocaleString(site.locale, {
    useGrouping: false,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function clip(text, max) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

function joinWords(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} und ${words.at(-1)}`;
}

function setBusy(btn, busy, label) {
  if (busy) {
    btn.dataset.idle = btn.innerHTML;
    if (label) btn.textContent = label;
    btn.disabled = true;
  } else if (btn.dataset.idle != null) {
    btn.innerHTML = btn.dataset.idle;
    delete btn.dataset.idle;
    btn.disabled = false;
  }
}

function setNote(el, text, kind = "") {
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
  el.classList.toggle("busy", kind === "busy");
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = !message;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}
