// Data layer: Firebase when configured, otherwise a local preview store.
// Both expose the same small interface used by app.js.
import { firebaseConfig, guestEmail } from "./config.js";

const SDK = "https://www.gstatic.com/firebasejs/13.2.0";

export const isPreview = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE");

export function connect() {
  return isPreview ? previewStore() : firebaseStore();
}

async function firebaseStore() {
  const [{ initializeApp }, fa, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = fa.getAuth(app);
  const wishes = fs.collection(fs.getFirestore(app), "wishes");

  return {
    onUser: (cb) => fa.onAuthStateChanged(auth, (u) => cb(u && { email: u.email })),
    onWishes: (cb, onError) =>
      fs.onSnapshot(
        wishes,
        (snap) =>
          cb(snap.docs.map((d) => {
            const { createdAt, updatedAt, ...wish } = d.data({ serverTimestamps: "estimate" });
            return { ...wish, id: d.id, created: createdAt?.toMillis?.() ?? 0 };
          })),
        onError,
      ),
    signIn: (email, password) => fa.signInWithEmailAndPassword(auth, email, password),
    signInGuest: (password) => fa.signInWithEmailAndPassword(auth, guestEmail, password),
    signOut: () => fa.signOut(auth),
    addWish: (wish) =>
      fs.addDoc(wishes, { ...wish, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() }),
    updateWish: (id, wish) => fs.updateDoc(fs.doc(wishes, id), { ...wish, updatedAt: fs.serverTimestamp() }),
    deleteWish: (id) => fs.deleteDoc(fs.doc(wishes, id)),
  };
}

// ─── Preview mode ───────────────────────────────────────────
async function previewStore() {
  const WISHES_KEY = "wishlist-preview";
  const USER_KEY = "wishlist-preview-user";
  let wishes = load(WISHES_KEY) ?? sampleWishes();
  let user = load(USER_KEY);
  const wishSubs = new Set();
  const userSubs = new Set();
  const copy = () => wishes.map((w) => ({ ...w }));
  const emitWishes = () => { save(WISHES_KEY, wishes); wishSubs.forEach((cb) => cb(copy())); };
  const emitUser = () => { save(USER_KEY, user); userSubs.forEach((cb) => cb(user)); };
  const pause = () => new Promise((r) => setTimeout(r, 300));
  const signIn = async (email, password) => {
    await pause();
    if (!email || !password) throw Object.assign(new Error("Missing credentials"), { code: "auth/invalid-credential" });
    user = { email };
    emitUser();
  };

  return {
    onUser(cb) { userSubs.add(cb); cb(user); return () => userSubs.delete(cb); },
    onWishes(cb) { wishSubs.add(cb); cb(copy()); return () => wishSubs.delete(cb); },
    signIn,
    signInGuest: (password) => signIn(guestEmail, password),
    async signOut() { user = null; emitUser(); },
    async addWish(wish) {
      await pause();
      wishes = [...wishes, { ...wish, id: `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, created: Date.now() }];
      emitWishes();
    },
    async updateWish(id, wish) {
      await pause();
      wishes = wishes.map((w) => (w.id === id ? { ...w, ...wish } : w));
      emitWishes();
    },
    async deleteWish(id) {
      await pause();
      wishes = wishes.filter((w) => w.id !== id);
      emitWishes();
    },
  };
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked — preview keeps working in memory */ }
}

const art = (body) =>
  "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`);

const MUG = `<ellipse cx="200" cy="262" rx="104" ry="11" fill="#000" opacity=".08"/>
<path d="M268 122h14a38 38 0 0 1 0 76h-14" fill="none" stroke="#7a9886" stroke-width="18"/>
<rect x="124" y="94" width="150" height="166" rx="22" fill="#86a392"/>
<ellipse cx="199" cy="97" rx="75" ry="11" fill="#6c8a78"/>
<path d="M152 124v104" stroke="#fff" stroke-opacity=".28" stroke-width="10" stroke-linecap="round"/>
<path d="M182 72c-12-14 12-22 0-38M214 72c-12-14 12-22 0-38" fill="none" stroke="#cbbba7" stroke-width="6" stroke-linecap="round"/>`;

const CANDLE = `<ellipse cx="200" cy="264" rx="90" ry="11" fill="#000" opacity=".08"/>
<rect x="130" y="112" width="140" height="150" rx="18" fill="#c9b2c0"/>
<rect x="150" y="160" width="100" height="56" rx="6" fill="#fffaf4"/>
<path d="M170 182h60M180 196h40" stroke="#b5868c" stroke-width="5" stroke-linecap="round"/>
<ellipse cx="200" cy="114" rx="70" ry="10" fill="#efe3d3"/>
<path d="M200 113V95" stroke="#3a2c26" stroke-width="4" stroke-linecap="round"/>
<path d="M200 50c14 16 16 30 0 44-16-14-14-28 0-44z" fill="#e8a73a"/>
<path d="M200 70c6 8 6 15 0 22-6-7-6-14 0-22z" fill="#fbe2a0"/>`;

const BOOKS = `<ellipse cx="200" cy="262" rx="130" ry="11" fill="#000" opacity=".08"/>
<rect x="88" y="214" width="224" height="44" rx="6" fill="#a3303b"/>
<rect x="110" y="170" width="190" height="44" rx="6" fill="#2e5a47"/>
<rect x="98" y="132" width="200" height="38" rx="6" fill="#c49a4a"/>
<path d="M118 236h150M134 192h130M118 151h150" stroke="#fff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>`;

function sampleWishes() {
  const now = Date.now();
  return [
    {
      id: "sample-1", created: now - 4000, top: true, price: 24.9, link: "https://example.com/",
      name: "Steingut-Tasse, salbeigrün",
      description: "Handglasiert, ca. 350 ml – perfekt für gemütliche Sonntagmorgen.",
      image: art(MUG),
    },
    {
      id: "sample-2", created: now - 3000, top: false, price: 18.5, link: "https://example.com/",
      name: "Duftkerze „Winterwald“",
      description: "Sojawachs mit Noten von Kiefer, Zeder und etwas Orange. Rund 40 Stunden Brenndauer.",
      image: art(CANDLE),
    },
    {
      id: "sample-3", created: now - 2000, top: false, price: null, link: "",
      name: "Ein gemütlicher Roman für die Feiertage",
      description: "Etwas Herzerwärmendes zum Lesen unter der Decke. Überrasch mich!",
      image: art(BOOKS),
    },
    {
      id: "sample-4", created: now - 1000, top: false, price: null, link: "",
      name: "Ein Tag auf dem Weihnachtsmarkt",
      description: "Glühwein, gebrannte Mandeln und eine Runde Karussell – nur wir zwei.",
      image: "",
    },
  ];
}
