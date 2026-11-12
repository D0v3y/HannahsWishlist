import { environment, guestEmail, site } from "./config.js";
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

const autofillAvailable = !isPreview; // needs our server, which preview mode doesn't have
const AUTOFILL_HINT = autofillAvailable ? els.autofillStatus.textContent : ""; // empty hides the hint
const RESERVER_KEY = "wishlist-reserver"; // remembers name + e-mail for the next reservation
const CHECKED_KEY = "wishlist-checked"; // wishes this device has asked about — their shop links are unlocked
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i; // same rule as the server

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
  filter: { min: null, max: null }, // price range chosen by the viewer
  reserving: null, // the wish in the "Noch frei?" window
  checked: readChecked(), // wish id → when this device asked whether it is still free
  introShown: false, // the note for guests appears once per visit
};

// index.html shows a note instead when the browser is too old for the site
if (!document.documentElement.classList.contains("is-unsupported")) start();

function start() {
  applySiteSettings();
  renderSkeleton();
  bindEvents();
  keepDialogsAboveKeyboard();

  connect()
    .then((store) => {
      state.store = store;
      $("#preview-banner").hidden = !isPreview;
      $("#preview-hint").hidden = !isPreview;
      $("#gate-preview-hint").hidden = !isPreview;
      $("#staging-banner").hidden = isPreview || environment !== "staging";
      store.onUser(onUserChanged);
    })
    .catch((err) => {
      console.error(err);
      showLoadError({ blocked: true }); // Firebase didn't load at all — often a content blocker
    });
}

// ─── Rendering ──────────────────────────────────────────────
function applySiteSettings() {
  document.title = site.title;
  $("#site-title").textContent = site.title;
  $("#site-subtitle").textContent = site.subtitle;
  $("#site-subtitle").hidden = !site.subtitle;
  $("#price-currency").textContent = currencySymbol;
  els.price.placeholder = priceForInput(29.99);
  els.autofillBtn.hidden = !autofillAvailable;
  $("#reserve-intro").textContent =
    "Schenkt das schon jemand anderes? Gib deinen Vornamen und deine E-Mail-Adresse an – du bekommst sofort eine E-Mail mit der Antwort. " +
    `Ist das Geschenk noch frei, kannst du es dort mit einem Klick für dich reservieren. ${site.ownerName} erfährt davon nichts.`;
  $("#intro-lead").textContent = `Damit ${site.ownerName} kein Geschenk doppelt bekommt: Bitte reserviere dein Geschenk, bevor du es kaufst.`;
  $("#intro-secret").textContent = `${site.ownerName} erfährt nicht, wer was reserviert – die Überraschung bleibt.`;
  $("#support-line").hidden = !site.supportEmail;
  $("#support-link").textContent = site.supportEmail;
  $("#support-link").href = `mailto:${site.supportEmail}`;
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
  if (isGuest(user)) showIntro();
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

// Guests get this note on every visit: check and reserve a gift before buying it.
function showIntro() {
  if (state.introShown || document.querySelector("dialog[open]")) return;
  state.introShown = true;
  $("#intro-dialog").showModal();
}

function renderAuth() {
  const editor = Boolean(state.user) && !isGuest(state.user);
  document.body.classList.toggle("is-locked", !state.user);
  document.body.classList.toggle("is-editor", editor);
  document.body.classList.toggle("is-guest", Boolean(state.user) && !editor); // guests may reserve gifts
  els.editorEmail.textContent = editor ? state.user.email : "";
  $("span", els.authBtn).textContent = editor ? "Abmelden" : "Anmelden";
  els.authBtn.hidden = false;
}

function renderWishes() {
  const sorted = [...state.wishes].sort(
    (a, b) => Number(Boolean(b.top)) - Number(Boolean(a.top)) || (b.created ?? 0) - (a.created ?? 0),
  );
  const { min, max } = state.filter;
  const filtering = min != null || max != null;
  const shown = filtering
    ? sorted.filter((w) => typeof w.price === "number" && (min == null || w.price >= min) && (max == null || w.price <= max))
    : sorted;
  els.list.classList.toggle("animate", state.firstPaint);
  state.firstPaint = false;
  els.list.replaceChildren(...shown.map(wishCard));
  els.loadError.hidden = true;
  els.empty.hidden = sorted.length > 0;

  const n = sorted.length;
  els.count.textContent = !n ? "" : filtering ? `${shown.length} von ${n} ${n === 1 ? "Wunsch" : "Wünschen"}` : `${n} ${n === 1 ? "Wunsch" : "Wünsche"}`;
  // a price filter only makes sense with at least two prices to compare
  $("#filter").hidden = !filtering && sorted.filter((w) => typeof w.price === "number").length < 2;
  const priceless = sorted.filter((w) => typeof w.price !== "number").length;
  const note = !filtering
    ? ""
    : !shown.length
      ? "Keine Wünsche in dieser Preisspanne."
      : priceless
        ? `${priceless} ${priceless === 1 ? "Wunsch" : "Wünsche"} ohne Preis ${priceless === 1 ? "ist" : "sind"} gerade ausgeblendet.`
        : "";
  setNote($("#filter-note"), note);
}

// ─── Price filter ───────────────────────────────────────────
let filterTimer;
function onFilterInput() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    const read = (input) => {
      const value = input.value.trim() ? parsePrice(input.value) : null;
      return Number.isFinite(value) ? value : null;
    };
    let min = read($("#filter-min"));
    let max = read($("#filter-max"));
    if (min != null && max != null && min > max) [min, max] = [max, min];
    state.filter = { min, max };
    $("#filter-reset").hidden = min == null && max == null;
    renderWishes();
  }, 250);
}

function resetFilter() {
  $("#filter-min").value = "";
  $("#filter-max").value = "";
  onFilterInput();
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

  // Guests get the way to the shop only after asking whether the gift is still free —
  // nobody should buy something without having come across that step.
  const guest = isGuest(state.user);
  const checked = guest && Boolean(state.checked[wish.id]);
  const locked = Boolean(link) && guest && !checked;
  const lock = $(".wish-link-locked", card);
  card.classList.toggle("is-checked", checked);

  $(".wish-price", card).textContent = hasPrice ? money.format(wish.price) : "";
  $("a.wish-link", card).hidden = !link || locked;
  lock.hidden = !locked;
  $(".wish-foot", card).hidden = !link && !hasPrice;
  if (link && !locked) card.querySelectorAll("a").forEach((a) => (a.href = link));

  const edit = $(".edit", card);
  const del = $(".delete", card);
  edit.setAttribute("aria-label", `„${wish.name}“ bearbeiten`);
  del.setAttribute("aria-label", `„${wish.name}“ löschen`);
  edit.addEventListener("click", () => openWishDialog(wish));
  const reserve = $(".wish-reserve", card);
  const label = checked ? "Nochmal prüfen" : "Noch frei? Jetzt prüfen";
  $("span", reserve).textContent = label;
  reserve.setAttribute("aria-label", `${label}: „${wish.name}“`);
  reserve.addEventListener("click", () => openReserveDialog(wish));
  if (locked) {
    const nudge = (e) => {
      e.preventDefault();
      nudgeToCheck(reserve);
    };
    lock.setAttribute("aria-label", `Zum Shop (noch gesperrt): Prüfe zuerst, ob „${wish.name}“ noch frei ist`);
    lock.addEventListener("click", nudge);
    $(".media-link", card).addEventListener("click", nudge); // the picture leads to the shop too
  }
  del.addEventListener("click", () => deleteWish(wish));
  return card;
}

// Someone tried the locked shop link: point them at the button they skipped.
let nudgeTimer;
function nudgeToCheck(button) {
  document.querySelectorAll(".wish-reserve.is-nudged").forEach((b) => b.classList.remove("is-nudged"));
  void button.offsetWidth; // lets the animation start over when tapped again
  button.classList.add("is-nudged");
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => button.classList.remove("is-nudged"), 2600);
  // bring it on screen, clear of the toast at the bottom
  const box = button.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight - 180) button.scrollIntoView({ block: "center", behavior: "smooth" });
  toast("Bitte prüfe zuerst, ob das Geschenk noch frei ist.");
}

function showLoadError({ blocked = false } = {}) {
  els.list.replaceChildren();
  els.empty.hidden = true;
  els.loadError.hidden = false;
  $("#load-error-blocker").hidden = !blocked;
  els.count.textContent = "";
}

// ─── Events ─────────────────────────────────────────────────
function bindEvents() {
  els.authBtn.addEventListener("click", onAuthButton);
  els.loginForm.addEventListener("submit", onSignIn);
  $("#reserve-form").addEventListener("submit", onReserve);
  $("#reserve-form").addEventListener("input", () => showError($("#reserve-error"), ""));
  $("#filter-min").addEventListener("input", onFilterInput);
  $("#filter-max").addEventListener("input", onFilterInput);
  $("#filter-reset").addEventListener("click", resetFilter);
  $("#intro-open").addEventListener("click", () => $("#intro-dialog").showModal());
  // closing the note draws the eye to the ball it can be reopened from
  $("#intro-dialog").addEventListener("close", () => {
    const ball = $("#intro-open");
    ball.classList.remove("is-landing");
    void ball.offsetWidth; // lets the animation start over
    ball.classList.add("is-landing");
  });

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

// ─── On-screen keyboard ─────────────────────────────────────
// Android Chrome shrinks the page for the keyboard by itself (interactive-widget
// in index.html). iOS Safari only shrinks the visual viewport, so we measure how
// much of the screen the keyboard hides and lift the dialog above it (see --kb in style.css).
function keepDialogsAboveKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const measure = () => {
    const zoomed = Math.abs(vv.scale - 1) > 0.01; // pinch-zoom also shrinks the visual viewport
    const hidden = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const visible = Math.round(zoomed ? window.innerHeight : vv.height);
    root.style.setProperty("--kb", `${hidden}px`);
    root.style.setProperty("--vvh", `${visible}px`);
    root.classList.toggle("is-short", visible < 560); // compact dialogs (style.css)
    root.classList.toggle("is-cramped", visible < 320); // whole dialog scrolls
  };
  vv.addEventListener("scroll", measure);
  vv.addEventListener("resize", () => {
    measure();
    // the dialog just got smaller — keep the field being typed in visible
    const field = document.activeElement;
    if (field?.matches("input, textarea") && field.closest("dialog[open]")) {
      requestAnimationFrame(() => field.scrollIntoView({ block: "nearest" }));
    }
  });
  measure();
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
  if (!autofillAvailable) return;
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
    if (!els.price.value.trim() && info.price != null) { els.price.value = priceForInput(info.price); filled.push("Preis"); }
    const priceTip = els.price.value.trim() ? "" : " Jetzt fehlt nur noch der Preis.";
    const breakdown = filled.includes("Preis") && info.priceNote ? ` Preis: ${info.priceNote}.` : "";
    const sold = info.sold ? " Achtung: Der Artikel ist im Shop als verkauft markiert." : "";
    // shops that block our server are read another way — say which, so it's easy to check
    const via = { pi: " (über den Pi)", microlink: " (über microlink)", browser: " (über microlink)" }[info.via] || "";
    setNote(
      els.autofillStatus,
      (filled.length ? `${joinWords(filled)} ausgefüllt${via} – schau kurz drüber.${breakdown}${priceTip}` : "Es ist schon alles ausgefüllt.") + sold,
      "ok",
    );
  } catch (err) {
    if (id !== state.lookupId) return;
    console.warn("Auto-fill failed:", err);
    setNote(
      els.autofillStatus,
      err.message === "limit"
        ? "Das automatische Ausfüllen macht für heute Pause – bitte trag die Angaben selbst ein."
        : err.message === "blocked by shop"
          ? "Dieser Shop lässt sich leider nicht automatisch auslesen – bitte trag die Angaben selbst ein."
          : "Diese Shop-Seite konnte nicht gelesen werden – bitte trag die Angaben selbst ein.",
      "err",
    );
  } finally {
    setBusy(els.autofillBtn, false);
  }
}

async function lookUpProduct(url) {
  // Our Worker (worker/lookup.js) reads the shop page — browsers may not read other websites.
  let data;
  try {
    data = await api(`/api/lookup?url=${encodeURIComponent(url)}`);
  } catch (err) {
    // 502: the shop turned our server away (e.g. Vinted), 422: it found nothing readable.
    // If the Worker already went through microlink with its own key, there's nothing left to try.
    const retry = (err.status === 502 || err.status === 422) && !err.data?.microlinkTried;
    if (!retry) throw new Error(err.status === 429 ? "limit" : err.message);
    data = await lookUpViaMicrolink(url);
  }
  if (!data?.title) throw new Error("nothing found");
  return {
    title: data.title,
    description: data.description || "",
    image: data.image?.startsWith("https://") ? data.image : "",
    price: typeof data.price === "number" && data.price > 0 ? data.price : null,
    priceNote: data.priceNote || "",
    sold: Boolean(data.sold),
    via: data.via || "",
  };
}

// Fallback when the Worker has no microlink key of its own: microlink.io fetches the page
// through its own servers, which some shops let in when they block ours. It only hands over
// the raw page — our Worker reads it like any other. Keyless: a handful of lookups a day.
async function lookUpViaMicrolink(url) {
  const query = new URLSearchParams({ url, "data.page.selector": "html", "data.page.attr": "outerHTML" });
  const res = await fetch(`https://api.microlink.io/?${query}`);
  if (res.status === 429) throw new Error("limit");
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "success") throw new Error(`microlink: ${json?.message || res.status}`);
  const d = json.data || {};
  try {
    return await api("/api/lookup", {
      method: "POST",
      body: { url, html: typeof d.page === "string" ? d.page : "", preview: { title: d.title, description: d.description, image: d.image?.url } },
    });
  } catch (err) {
    throw new Error(err.status === 429 ? "limit" : err.message);
  }
}

// Calls our own server with the visitor's sign-in, so only wishlist visitors can use it.
async function api(path, { method = "GET", body } = {}) {
  const token = await state.store?.getToken();
  if (!token) throw Object.assign(new Error("not signed in"), { status: 401 });
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

// ─── "Noch frei?" — checking and reserving a gift (guests) ──
// The answer (still free, with a link to reserve it / already taken) only goes out by
// e-mail, so nothing about reservations ever shows up on the page. Asking unlocks the
// wish's shop link on this device.
function openReserveDialog(wish) {
  state.reserving = wish;
  $("#reserve-form").classList.remove("is-sent");
  $("#reserve-wish").textContent = `„${wish.name}“`;
  $("#reserve-submit").textContent = "Prüfen";
  showError($("#reserve-error"), "");
  const saved = readStorage(RESERVER_KEY);
  $("#r-name").value = saved?.name || "";
  $("#r-email").value = saved?.email || "";
  $("#reserve-dialog").showModal();
}

async function onReserve(e) {
  e.preventDefault();
  const form = $("#reserve-form");
  if (form.classList.contains("is-sent")) return $("#reserve-dialog").close();

  const error = $("#reserve-error");
  const name = $("#r-name").value.trim();
  const email = $("#r-email").value.trim();
  if (!/^\p{L}[\p{L}'’-]{0,39}$/u.test(name.split(/\s+/)[0])) { // same rule as the server
    showError(error, "Bitte gib deinen Vornamen ein (nur Buchstaben).");
    return $("#r-name").focus();
  }
  if (!EMAIL_PATTERN.test(email)) {
    showError(error, "Bitte gib eine gültige E-Mail-Adresse ein, z. B. anna@beispiel.de.");
    return $("#r-email").focus();
  }

  const button = $("#reserve-submit");
  setBusy(button, true, "Einen Moment …");
  try {
    if (isPreview) await new Promise((r) => setTimeout(r, 500)); // preview mode: no e-mails
    else await api("/api/reservations", { method: "POST", body: { wishId: state.reserving.id, name, email } });
    writeStorage(RESERVER_KEY, { name, email });
    markChecked(state.reserving.id);
    $("#reserve-done-text").textContent =
      `Wir haben dir eine E-Mail an ${email} geschickt. Darin steht, ob das Geschenk noch frei ist – ` +
      "wenn ja, reserviere es dort bitte mit einem Klick, bevor du es kaufst. Keine E-Mail bekommen? Schau auch im Spam-Ordner nach.";
    form.classList.add("is-sent");
    setBusy(button, false);
    button.textContent = "Fertig";
  } catch (err) {
    console.error(err);
    setBusy(button, false);
    showError(error, reserveMessage(err));
  }
}

function reserveMessage(err) {
  switch (err?.status) {
    case 400: return "Bitte prüfe deinen Namen und deine E-Mail-Adresse.";
    case 401: return "Deine Anmeldung ist abgelaufen – bitte lade die Seite neu.";
    case 403: return err.data?.error === "blocked"
      ? "Nicht spicken! 😉 Mit dieser E-Mail-Adresse lassen sich keine Geschenke prüfen."
      : "Mit diesem Konto lassen sich keine Geschenke prüfen.";
    case 404: return "Diesen Wunsch gibt es nicht mehr.";
    case 429: return "Du hast gerade schon einige Anfragen geschickt – bitte versuch es in einer Stunde noch einmal.";
    case 502: return "Die E-Mail konnte gerade nicht verschickt werden. Bitte versuch es später noch einmal.";
    default: return "Das hat leider nicht geklappt. Bitte versuch es noch einmal.";
  }
}

function readChecked() {
  const saved = readStorage(CHECKED_KEY);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function markChecked(wishId) {
  state.checked[wishId] = Date.now();
  writeStorage(CHECKED_KEY, state.checked);
  renderWishes(); // the card now shows the open shop link
}

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode — fine */ }
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
    toast(editing ? "Änderungen gespeichert" : addedMessage());
  } catch (err) {
    console.error(err);
    showError(els.wishError, saveMessage(err));
  } finally {
    setBusy(els.saveBtn, false);
  }
}

// One of the personal messages from config.js, never the same one twice in a row.
// Rarer messages (see messageRarity there) get a smaller share of the draw.
let lastAddedMessage = "";
function addedMessage() {
  const all = (site.addedMessages || [])
    .map((m) => (typeof m === "string" ? { text: m } : m))
    .filter((m) => typeof m?.text === "string" && m.text.trim())
    .map((m) => {
      // a rarity is a name from messageRarity or simply a number; anything else counts as normal
      const chance = typeof m.rarity === "number" ? m.rarity : (site.messageRarity?.[m.rarity] ?? 1);
      return { text: m.text, chance: chance > 0 ? chance : 0 };
    })
    .filter((m) => m.chance > 0);
  if (!all.length) return "Zur Wunschliste hinzugefügt ✨";
  const fresh = all.filter((m) => m.text !== lastAddedMessage);
  const pool = fresh.length ? fresh : all;
  let ticket = Math.random() * pool.reduce((sum, m) => sum + m.chance, 0);
  const drawn = pool.find((m) => (ticket -= m.chance) < 0) || pool[pool.length - 1];
  lastAddedMessage = drawn.text;
  return drawn.text;
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
  let text = raw.trim();
  const inside = text.match(/https?:\/\/[^\s<>"]+/i); // shop apps share "Product name https://…"
  if (inside && inside[0] !== text) text = inside[0];
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
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} und ${words[words.length - 1]}`;
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
  // longer messages stay up longer, so they can be read
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), Math.min(9000, Math.max(2800, message.length * 70)));
}
