// Sends a plain-text e-mail through an SMTP server — Gmail with an app password.
// Settings (Cloudflare → Worker → Settings → Variables and Secrets):
//   SMTP_USER  your Gmail address          (secret)
//   SMTP_PASS  the 16-letter app password  (secret)
//   MAIL_FROM  optional sender address, e.g. support@your-domain.de set up as a Gmail alias
import { connect } from "cloudflare:sockets";

export async function sendMail(env, { to, subject, text }) {
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;
  if (!user || !pass) throw new Error("SMTP_USER / SMTP_PASS are not set");
  const from = env.MAIL_FROM || user;

  const socket = connect(
    { hostname: env.SMTP_HOST || "smtp.gmail.com", port: Number(env.SMTP_PORT || 465) },
    { secureTransport: env.SMTP_TLS === "off" ? "off" : "on" }, // "off" only for local tests
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  // Waits for the server's reply (multi-line replies end with "250 …") and checks its code.
  async function expect(...codes) {
    for (;;) {
      const lines = buffer.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const code = Number(lines[i].slice(0, 3));
          buffer = lines.slice(i + 1).join("\r\n");
          if (!codes.includes(code)) throw new Error(`SMTP ${code}: ${lines[i].slice(4, 160)}`);
          return code;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed");
      buffer += decoder.decode(value, { stream: true });
    }
  }
  const send = (line) => writer.write(encoder.encode(`${line}\r\n`));

  try {
    await expect(220);
    await send(`EHLO ${env.SMTP_HELO || "wunschliste"}`);
    await expect(250);
    await send(`AUTH PLAIN ${base64(`\0${user}\0${pass}`)}`);
    await expect(235);
    await send(`MAIL FROM:<${from}>`);
    await expect(250);
    await send(`RCPT TO:<${to}>`);
    await expect(250, 251);
    await send("DATA");
    await expect(354);
    await writer.write(encoder.encode(`${message({ from, fromName: env.MAIL_FROM_NAME, to, replyTo: env.SUPPORT_EMAIL, subject, text })}\r\n.\r\n`));
    await expect(250);
    await send("QUIT");
    await expect(221).catch(() => {}); // the server says goodbye; not important if it doesn't
  } finally {
    try { await writer.close(); } catch { /* already closed */ }
    try { socket.close(); } catch { /* already closed */ }
  }
}

function message({ from, fromName, to, replyTo, subject, text }) {
  const domain = from.split("@")[1] || "localhost";
  const headers = [
    `From: ${fromName ? `${word(fromName)} ` : ""}<${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${replyTo}>` : "",
    `Subject: ${word(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  // base64 keeps umlauts intact and can't produce a line that starts with "."
  const body = base64(text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

// Header text with umlauts (RFC 2047 encoded word)
const word = (text) => `=?UTF-8?B?${base64(text)}?=`;

function base64(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
