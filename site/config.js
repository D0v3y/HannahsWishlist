// ─── Site settings ──────────────────────────────────────────
export const site = {
  title: "Hannahs Wunschliste",
  subtitle: "Weihnachten 2026",
  ownerName: "Hannah", // used in texts like "ein Geschenk für Hannah"
  supportEmail: "support@hannahswunschliste.com", // shown at the bottom of the page ("" hides the line)
  // Little messages for Hannah: one of them, picked at random, pops up each time she adds a wish.
  // One message per line, with a comma at the end. Add as many as you like.
  //   "Text"                                   a normal message
  //   { text: "Text", rarity: "selten" }       shows up less often — see messageRarity below
  addedMessages: [
    "Zur Wunschliste hinzugefügt ✨",
    "Gute Wahl Popi <3",
    "Das hätte ich mir auch gewünscht!😮",
    "Darf ich das dann auch benutzen?👉🏻👈🏻",
    
  ],
  // How likely a message of each rarity is, compared with a normal one (1).
  // 0.25 = a quarter as often. Rename these, change the numbers or add your own.
  messageRarity: {
    selten: 0.25,
    "sehr selten": 0.08,
    legendär: 0.02,
  },
  currency: "EUR", // ISO code: "EUR", "USD", "GBP", …
  locale: "de-DE", // number format: "de-DE" → 29,99 €  ·  "en-US" → €29.99
};

// ─── Password protection ────────────────────────────────────
// Visitors type one shared password, which signs them in to this guest
// account. Create it in Firebase under Authentication → Users (with the
// shared password) and list it in firestore.rules. It doesn't need to be
// a real mailbox — it's only used as the account's name.
// (Also set as GUEST_EMAIL in wrangler.toml — only this account may reserve gifts.)
export const guestEmail = "gast@example.com";

// ─── Environments ───────────────────────────────────────────
// The real list and the test copy use separate Firebase projects, so trying
// things out never touches Hannah's wishes. Addresses listed here get the real
// list; every other address (test copy, your own computer) gets the test project.
const PRODUCTION_HOSTS = ["hannahswunschliste.com", "www.hannahswunschliste.com", "wunschliste.d0v3y.workers.dev"];
export const environment = PRODUCTION_HOSTS.includes(location.hostname) ? "production" : "staging";

// ─── Firebase ───────────────────────────────────────────────
// Paste the values from Firebase console → Project settings → Your apps.
// While apiKey still starts with "PASTE", that environment runs in preview mode
// (sample data, saved only in your own browser). See README.md.
//
// These values are not secret — they only identify your project.
// What protects the list is the access rules in firestore.rules.
const firebaseConfigs = {
  production: {
    apiKey: "AIzaSyAXMzhzgDo8eJa08ZoERz-u4SAotVjkcP4",
    authDomain: "hannahs-wishlist.firebaseapp.com",
    projectId: "hannahs-wishlist",
    storageBucket: "hannahs-wishlist.firebasestorage.app",
    messagingSenderId: "219101156897",
    appId: "1:219101156897:web:6caaa7b4e8ee5587bdf560",
  },
  staging: {
    apiKey: "AIzaSyCTI28i0q6gvssDKhnLLg9BoAIntLxnN4c",
    authDomain: "hannahs-wishlist-staging.firebaseapp.com",
    projectId: "hannahs-wishlist-staging",
    storageBucket: "hannahs-wishlist-staging.firebasestorage.app",
    messagingSenderId: "1005825010039",
    appId: "1:1005825010039:web:0dae85037391c77232d972",
  },
};
export const firebaseConfig = firebaseConfigs[environment];
