// ─── Site settings ──────────────────────────────────────────
export const site = {
  title: "Hannahs Wunschliste",
  subtitle: "Weihnachten 2026",
  currency: "EUR", // ISO code: "EUR", "USD", "GBP", …
  locale: "de-DE", // number format: "de-DE" → 29,99 €  ·  "en-US" → €29.99
};

// ─── Password protection ────────────────────────────────────
// Visitors type one shared password, which signs them in to this guest
// account. Create it in Firebase under Authentication → Users (with the
// shared password) and list it in firestore.rules. It doesn't need to be
// a real mailbox — it's only used as the account's name.
export const guestEmail = "gast@example.com";

// ─── Firebase ───────────────────────────────────────────────
// Paste the values from Firebase console → Project settings → Your apps.
// While apiKey still starts with "PASTE", the site runs in preview mode
// (sample data, saved only in your own browser). See README.md.
//
// These values are not secret — they only identify your project.
// What protects the list is the access rules in firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyAXMzhzgDo8eJa08ZoERz-u4SAotVjkcP4",
  authDomain: "hannahs-wishlist.firebaseapp.com",
  projectId: "hannahs-wishlist",
  storageBucket: "hannahs-wishlist.firebasestorage.app",
  messagingSenderId: "219101156897",
  appId: "1:219101156897:web:6caaa7b4e8ee5587bdf560",
};
