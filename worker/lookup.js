// GET  /api/lookup?url=<product link>   →  { title, description, image, price, priceNote, sold }
// POST /api/lookup { url, html, preview } — the same, for a page the site fetched itself
// Browsers may not read other websites, so the Worker fetches the shop page and
// reads name, picture and price from it. Only for people signed in to the wishlist.
//
// Some shops (e.g. Vinted) turn Cloudflare's servers away. Then, in this order:
//  1. the home helper on the Raspberry Pi (pi/fetch.py, via a Cloudflare Tunnel) fetches
//     the page from a home connection — HOME_FETCH_URL + secret HOME_FETCH_KEY, no limits;
//  2. microlink with our key (secret MICROLINK_KEY — free account, 25 lookups a day);
//  3. without a key, the site tries microlink's keyless service from the visitor's
//     browser and POSTs the page here.
import { verifyUser } from "./auth.js";
import { json } from "./http.js";
import { isVestiaire, vestiaireDetails } from "./vestiaire.js";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
};

// Amazon shows its price in several boxes, depending on the page layout.
const AMAZON_PRICE_BOXES = ["#corePriceDisplay_desktop_feature_div", "#corePrice_feature_div", "#corePrice_mobile_feature_div", "#apex_desktop"];

const JUNK_TITLE = /^(page not found|not found|seite nicht gefunden|404|403|access denied|zugriff verweigert|robot check|just a moment|attention required|amazon(\.[a-z]+)+)\b/i;

export async function handleLookup(request, env) {
  if (!(await verifyUser(request, env))) return json({ error: "not signed in" }, 401);

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    const target = shopUrl(body?.url, env);
    const html = typeof body?.html === "string" ? body.html : null;
    if (!target || html === null || html.length > 10_000_000) return json({ error: "invalid input" }, 400); // Amazon pages are ~3 MB
    return reply(await readHtml(target, html, body.preview), "browser");
  }

  const target = shopUrl(new URL(request.url).searchParams.get("url"), env);
  if (!target) return json({ error: "invalid url" }, 400);

  const direct = await readDirectly(target);
  if (direct.result) return reply(direct, "shop");
  // The shop turned us away (or showed nothing readable): the Pi at home, then microlink.
  if (env.HOME_FETCH_URL && env.HOME_FETCH_KEY) {
    const home = await readViaHome(target, env);
    if (home.result) return reply(home, "pi");
  }
  if (!env.MICROLINK_KEY) return reply(direct);
  return reply({ ...(await readViaMicrolink(target, env)), microlinkTried: true }, "microlink");
}

// The home helper fetches the page from a normal home connection, which shops like
// Vinted let in. If the Pi is off, this simply fails and the next fallback takes over.
async function readViaHome(target, env) {
  let response;
  try {
    response = await fetch(`${env.HOME_FETCH_URL.replace(/\/$/, "")}/fetch?url=${encodeURIComponent(target)}`, {
      headers: { "X-Fetch-Key": env.HOME_FETCH_KEY },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { error: "home helper not reachable", status: 502 };
  }
  if (!response.ok) return { error: `home helper: ${response.status}`, status: 502 };
  const finalUrl = shopUrl(response.headers.get("X-Final-Url"), env) || target; // after redirects
  return readHtml(finalUrl, await response.text());
}

// { result } on success, otherwise { error, status } — the site tells the visitor what happened.
// `via` says how the page was read: shop (directly), pi, microlink, browser (keyless microlink).
function reply({ result, error, status, microlinkTried }, via) {
  if (result) return json({ ...result, via });
  return json(microlinkTried ? { error, microlinkTried } : { error }, status);
}

async function readDirectly(target) {
  let response;
  try {
    response = await fetch(target, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(12000) });
  } catch {
    return { error: "shop not reachable", status: 502 };
  }
  if (!response.ok || !(response.headers.get("content-type") || "").includes("html")) {
    return { error: `shop answered ${response.status}`, status: 502 };
  }
  const found = await readPage(response, response.url);
  if (found.blocked) return { error: "blocked by shop", status: 502 };
  const result = summarize(found, response.url);
  return result.title ? { result } : { error: "nothing found", status: 422 };
}

// microlink only hands over the raw page; it's read with the same rules as any other.
async function readViaMicrolink(target, env) {
  const query = new URLSearchParams({ url: target, "data.page.selector": "html", "data.page.attr": "outerHTML" });
  let response;
  try {
    response = await fetch(`${env.MICROLINK_URL || "https://pro.microlink.io"}/?${query}`, { // overridable only for local tests
      headers: { "x-api-key": env.MICROLINK_KEY },
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return { error: "microlink not reachable", status: 502 };
  }
  if (response.status === 429) return { error: "limit", status: 429 };
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "success") return { error: `microlink: ${body?.message || response.status}`, status: 502 };
  const d = body.data || {};
  return readHtml(target, typeof d.page === "string" ? d.page : "", { title: d.title, description: d.description, image: d.image?.url });
}

// Reads a page we didn't fetch ourselves. `preview` is microlink's own summary, used only
// if the page itself yields nothing.
async function readHtml(target, html, preview = {}) {
  const found = await readPage(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }), target);
  if (found.blocked) return { error: "blocked by shop", status: 502 };
  const result = summarize(found, target);
  if (!result.title && typeof preview?.title === "string") {
    result.title = cleanTitle(preview.title);
    if (JUNK_TITLE.test(result.title)) result.title = "";
    result.description ||= cleanDescription(String(preview.description || ""), preview.title);
    result.image ||= absoluteUrl(typeof preview.image === "string" ? preview.image : null, target);
  }
  return result.title ? { result } : { error: "nothing found", status: 422 };
}

// Only public http(s) pages. ALLOW_LOCAL is only set when testing on your own computer.
function shopUrl(raw, env) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname;
  const local = host === "localhost" || host.endsWith(".local") || /^[\d.]+$/.test(host) || host.includes(":");
  if (local && !env.ALLOW_LOCAL) return null;
  return url.href;
}

// ─── Reading the page ───────────────────────────────────────
async function readPage(response, pageUrl) {
  const f = {
    meta: {}, title: null, productTitle: null, ld: [],
    amzValue: null, amzWhole: null, amzFraction: null, landingImage: null, nextData: null, vintedTotal: null, blocked: false,
  };
  // collects the text of the first element that matches (later matches are ignored)
  const firstText = (key) => {
    let active = false;
    return {
      element(el) {
        if (f[key] !== null) return;
        f[key] = "";
        active = true;
        el.onEndTag(() => { active = false; });
      },
      text(chunk) { if (active) f[key] += chunk.text; },
    };
  };

  let rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") || el.getAttribute("name") || el.getAttribute("itemprop") || "").toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !(key in f.meta)) f.meta[key] = content;
      },
    })
    .on("[itemprop='price'][content]", { element(el) { f.meta.price ??= el.getAttribute("content"); } })
    .on("title", firstText("title"))
    .on("#productTitle", firstText("productTitle")) // Amazon
    .on("#twister-plus-price-data-price", { element(el) { f.amzValue ??= el.getAttribute("value"); } }) // Amazon: "369.99"
    .on("#landingImage", { element(el) { f.landingImage ??= el.getAttribute("data-old-hires") || el.getAttribute("src"); } })
    .on("script[type='application/ld+json']", {
      element() { f.ld.push(""); },
      text(chunk) { f.ld[f.ld.length - 1] += chunk.text; },
    })
    .on("form[action*='validateCaptcha']", { element() { f.blocked = true; } }); // Amazon's robot check
  const whole = firstText("amzWhole");
  const fraction = firstText("amzFraction");
  for (const box of AMAZON_PRICE_BOXES) {
    rewriter = rewriter.on(`${box} .a-price-whole`, whole).on(`${box} .a-price-fraction`, fraction);
  }
  if (isVestiaire(pageUrl)) rewriter = rewriter.on("script#__NEXT_DATA__", firstText("nextData"));
  // Vinted: the price incl. its buyer protection fee, as shown under the item price ("9,00 € inkl. Vinted-Gebühr")
  if (isVinted(pageUrl)) rewriter = rewriter.on('[data-testid="total-combined-price"]', firstText("vintedTotal"));
  await rewriter.transform(response).arrayBuffer();
  return f;
}

function summarize(f, pageUrl) {
  const m = f.meta;
  const rawTitle = decode(f.productTitle || m["og:title"] || m["twitter:title"] || f.title || "");
  const title = cleanTitle(rawTitle);
  const image = absoluteUrl(m["og:image"] || m["og:image:secure_url"] || m["og:image:url"] || m["twitter:image"] || f.landingImage, pageUrl);
  const result = {
    title: JUNK_TITLE.test(title) ? "" : title,
    description: cleanDescription(decode(m["og:description"] || m.description || m["twitter:description"] || ""), rawTitle),
    image,
    price: findPrice(f),
    priceNote: "",
    sold: false,
  };
  const vc = f.nextData && vestiaireDetails(f.nextData);
  if (vc) {
    result.title = result.title.replace(/\s+-\s+\d{5,}$/, ""); // "… - Grau - 72518642"
    result.description = clip(vc.description, 280); // the seller's text instead of the shop's SEO text
    if (vc.price) Object.assign(result, { price: vc.price, priceNote: vc.priceNote });
    result.sold = vc.sold;
  }
  const vintedTotal = f.vintedTotal && parsePrice(decode(f.vintedTotal));
  if (vintedTotal > 0) {
    const item = result.price; // the item price on its own, from the product data
    result.priceNote = item > 0 && item < vintedTotal
      ? `${euro.format(item)} + ${euro.format(Math.round((vintedTotal - item) * 100) / 100)} Vinted-Gebühr`
      : "inkl. Vinted-Gebühr";
    result.price = Math.round(vintedTotal * 100) / 100;
  }
  return result;
}

const isVinted = (url) => /(^|\.)vinted\.[a-z.]+$/i.test(new URL(url).hostname);
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// ─── Price ──────────────────────────────────────────────────
function findPrice(f) {
  const m = f.meta;
  const split = f.amzWhole && `${f.amzWhole.replace(/\D/g, "")}.${(f.amzFraction || "").replace(/\D/g, "") || "0"}`;
  const candidates = [f.amzValue, m["product:price:amount"], m["og:price:amount"], m.price, priceFromStructuredData(f.ld), split];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const text = decode(String(candidate)).trim();
    const value = /^\d+(\.\d+)?$/.test(text) ? Number(text) : parsePrice(text); // "369.99" from machines, "369,99 €" from people
    if (Number.isFinite(value) && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
}

// Finds offers.price in JSON-LD blocks, also when nested in @graph or lists.
function priceFromStructuredData(blocks) {
  const find = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return null;
    if (Array.isArray(node)) {
      for (const item of node) { const p = find(item, depth + 1); if (p != null) return p; }
      return null;
    }
    for (const offer of [].concat(node.offers ?? [])) {
      const p = offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price;
      if (p != null && p !== "") return p;
    }
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
      const p = find(node[key], depth + 1);
      if (p != null) return p;
    }
    return null;
  };
  for (const block of blocks) {
    try {
      const p = find(JSON.parse(block), 0);
      if (p != null) return p;
    } catch { /* not valid JSON — skip */ }
  }
  return null;
}

// Accepts "29,99", "29.99", "1.299,00", "1,299.00", "€ 30" … (same rules as app.js)
function parsePrice(raw) {
  const s = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return NaN;
  const decimal = s.match(/^(.*?)[.,](\d{1,2})$/);
  const value = decimal ? Number(`${decimal[1].replace(/[.,]/g, "") || "0"}.${decimal[2]}`) : Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(value) ? value : NaN;
}

// ─── Text clean-up ──────────────────────────────────────────
function cleanTitle(title) {
  let t = title.replace(/\s+/g, " ").trim();
  if (/^amazon(\.[a-z]+)+\s*:/i.test(t)) {
    t = t.replace(/^amazon(\.[a-z]+)+\s*:\s*/i, "").replace(/\s+:\s+[^:]{1,40}$/, ""); // "Amazon.de: Product : Category"
  }
  return t
    .replace(/\s*:\s*Amazon(\.[a-z]+)+\s*:.*$/i, "") // "Product : Amazon.de: Category"
    .split(/\s+[|•·]\s+/)[0] // "Product name | Shop name"
    .trim()
    .slice(0, 200);
}

// Amazon's description is just the product name again plus ": Amazon.de: Category".
function cleanDescription(description, rawTitle) {
  const text = description.replace(/\s+/g, " ").replace(/\s*:\s*Amazon(\.[a-z]+)+\s*:.*$/i, "").trim();
  const simple = (s) => s.toLowerCase().replace(/^amazon(\.[a-z]+)+\s*:\s*/, "").replace(/[^\p{L}\p{N}]+/gu, "");
  const d = simple(text);
  const t = simple(rawTitle);
  if (d.length >= 20 && t.length >= 20 && (t.startsWith(d.slice(0, 40)) || d.startsWith(t.slice(0, 40)))) return "";
  return clip(text, 280);
}

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

function absoluteUrl(src, base) {
  if (!src) return null;
  try {
    const url = new URL(decode(src).trim(), base);
    if (url.protocol === "http:") url.protocol = "https:"; // the wishlist is https-only
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// The page is read as raw HTML, so entities like &amp; or &#252; are still encoded.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è", ndash: "–", mdash: "—", hellip: "…", reg: "®", trade: "™", copy: "©" };
function decode(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code] ?? match;
  });
}
