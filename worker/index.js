// Hannahs Wunschliste on Cloudflare Workers: serves the site (./site) and its API.
//   GET      /api/lookup?url=…           "Ausfüllen" — read a shop page (signed-in users)
//   POST     /api/reservations           reserve a gift (guests), result by e-mail
//   GET|POST /reservierung/bestaetigen   confirm link from the e-mail
//   GET|POST /reservierung/aufheben      cancel link from the e-mail
// Everything else is a file from ./site.
import { json } from "./http.js";
import { handleLookup } from "./lookup.js";
import { handleCancel, handleConfirm, handleReserve } from "./reservations.js";

const routes = {
  "/api/lookup": handleLookup,
  "/api/reservations": handleReserve,
  "/reservierung/bestaetigen": handleConfirm,
  "/reservierung/aufheben": handleCancel,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = routes[pathname.replace(/\/$/, "")];
    if (handler) {
      try {
        return await handler(request, env, ctx);
      } catch (err) {
        console.error(pathname, err);
        return json({ error: "server error" }, 500);
      }
    }
    if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
