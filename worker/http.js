// Small response helpers shared by the API handlers.

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// A small stand-alone page in the wishlist's look, used for the e-mail links.
// `body` must already be escaped HTML.
export function page(title, body, status = 200) {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎁</text></svg>">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,700&family=Fraunces:opsz,wght@9..144,600&display=swap">
<style>
  :root { --bg: #f7f1e8; --surface: #fffdf9; --ink: #2a221d; --muted: #7b6e63; --line: #e7dccf; --accent: #a3303b; --accent-ink: #fff; --gold: #b0843a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111916; --surface: #18221e; --ink: #f1ebe2; --muted: #a99f93; --line: #2c3934; --accent: #e3707a; --accent-ink: #1c0f11; --gold: #d9b46c; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 400 17px/1.55 "DM Sans", system-ui, sans-serif; }
  main { width: 100%; max-width: 440px; padding: 32px clamp(18px, 6vw, 32px); border: 1px solid var(--line); border-radius: 22px; background: var(--surface); text-align: center; }
  .icon { font-size: 44px; line-height: 1; }
  h1 { margin: 12px 0 10px; font: 600 1.6rem/1.2 "Fraunces", Georgia, serif; }
  p { margin: 0 0 14px; color: var(--muted); }
  strong { color: var(--ink); }
  button, .button { display: inline-block; width: 100%; margin-top: 8px; padding: 13px 20px; border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font: 700 16px "DM Sans", system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .small { margin-top: 18px; font-size: 14px; }
  a { color: var(--accent); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
