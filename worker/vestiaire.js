// Vestiaire Collective: the page's app data (__NEXT_DATA__) holds the price for the
// buyer's country (buyer fee already included), the seller's country and Vestiaire's
// own duties & taxes figure. We add shipping from Vestiaire's fee table for buyers in
// Germany, so the wish shows what relatives would actually pay.

const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
const REST_OF_EUROPE = new Set(["GB", "CH", "NO", "IS", "LI", "MC", "AD", "SM", "VA", "AL", "BA", "ME", "MK", "RS", "XK", "MD", "UA"]);
const LOCAL = new Set(["FR", "IT", "DE"]); // Vestiaire's "local" shipping for buyers in Germany

// Shipping for buyers in Germany ("from" prices of Vestiaire's table), by seller location.
function shippingFee(sellerCountry, itemPrice) {
  const high = itemPrice > 1000;
  if (LOCAL.has(sellerCountry)) return high ? 20 : 4.9;
  if (EU.has(sellerCountry) || REST_OF_EUROPE.has(sellerCountry)) return high ? 30 : 9.9;
  return 45;
}

export const isVestiaire = (url) => /(^|\.)vestiairecollective\.[a-z.]+$/i.test(new URL(url).hostname);

// Returns { price, priceNote, description, sold } or null when the data isn't usable.
export function vestiaireDetails(nextDataJson) {
  let data;
  try {
    data = JSON.parse(nextDataJson);
  } catch {
    return null;
  }
  const props = data?.props?.pageProps;
  const product = (props?.dehydratedState?.queries || [])
    .map((q) => q?.state?.data)
    .find((d) => d?.price?.cents > 0 && d?.seller?.countryISO);
  if (!product) return null;

  const description = String(product.localizedDescription || product.description || "").trim();
  // Prices are only right for us when Vestiaire calculated them for a buyer in Germany, in euros.
  if (props?.preferences?.country !== "DE" || (product.price.currency && product.price.currency !== "EUR")) {
    return { price: null, priceNote: "", description, sold: Boolean(product.sold) };
  }

  const item = product.price.cents / 100;
  const country = String(product.seller.countryISO).toUpperCase();
  const shipping = shippingFee(country, item);

  // Taxes: Vestiaire's own figure if it has one. Otherwise sellers in the EU cost nothing
  // extra; from outside the EU, 19% import VAT is certain, customs duty depends on the
  // product category, so it is only mentioned.
  let taxes = Math.max(0, (product.dutyAndTax?.cents || 0) / 100);
  let taxLabel = taxes ? "Zoll & Steuern" : "";
  if (!taxes && !EU.has(country)) {
    taxes = round((item + shipping) * 0.19);
    taxLabel = "geschätzte Einfuhrumsatzsteuer, ggf. zzgl. Zoll";
  }

  const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const from = countryName(country);
  const parts = [euro.format(item), `${euro.format(shipping)} Versand${from ? ` aus ${from}` : ""}`];
  if (taxes) parts.push(`${euro.format(taxes)} ${taxLabel}`);
  return {
    price: round(item + shipping + taxes),
    priceNote: parts.join(" + "),
    description,
    sold: Boolean(product.sold),
  };
}

function countryName(code) {
  try {
    return new Intl.DisplayNames(["de"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

const round = (n) => Math.round(n * 100) / 100;
