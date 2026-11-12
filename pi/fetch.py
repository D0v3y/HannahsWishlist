#!/usr/bin/env python3
"""Home helper for the wishlist's "Ausfüllen" button — runs on the Raspberry Pi.

Some shops (e.g. Vinted) turn Cloudflare's servers away but answer a normal home
connection. When that happens, the Worker sends the link here through a Cloudflare
Tunnel; this fetches the page from home and hands back the raw HTML, which the Worker
then reads with its usual rules. Standard library only.

  GET /fetch?url=<shop page>      header  X-Fetch-Key: <shared key>
    200  the page (header X-Final-Url: address after redirects)
    400  not a public web page · 403 wrong key · 502 shop refused or unreachable

Safety: only public internet addresses are fetched. The check happens for the address
actually connected to — on every redirect too — so nobody can use this to reach the
router or anything else in the home network. Only listens on 127.0.0.1 (the tunnel).

Settings (environment): FETCH_KEY (required), FETCH_PORT (default 8790).
"""

import hmac
import http.client
import http.server
import ipaddress
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib

KEY = os.environ.get("FETCH_KEY", "")
PORT = int(os.environ.get("FETCH_PORT", "8790"))
MAX_BYTES = 10_000_000  # Amazon pages are ~3 MB
TIMEOUT = 15
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
    "Accept-Encoding": "gzip",
}


class NotPublic(Exception):
    pass


def public_connection(address, timeout=None, source_address=None, *args, **kwargs):
    """Like socket.create_connection, but only to public internet addresses."""
    host, port = address
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for *_, sockaddr in infos:
        ip = ipaddress.ip_address(sockaddr[0].split("%")[0])
        if not ip.is_global or (ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global):
            raise NotPublic(f"{host} is not a public internet address")
    error = OSError(f"{host}: no address")
    for family, kind, proto, _, sockaddr in infos:
        sock = socket.socket(family, kind, proto)
        try:
            if isinstance(timeout, (int, float)):
                sock.settimeout(timeout)
            sock.connect(sockaddr)  # connects to exactly the address that was checked
            return sock
        except OSError as err:
            error = err
            sock.close()
    raise error


class PublicHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = public_connection


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = public_connection


class PublicHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(PublicHTTPConnection, req)


class PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PublicHTTPSConnection, req, context=self._context)


# no proxies; every request — including each redirect — goes through the checks above
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), PublicHTTPHandler, PublicHTTPSHandler)


def fetch(url):
    """Returns (final_url, content_type, body). Raises NotPublic, HTTPError or OSError."""
    with opener.open(urllib.request.Request(url, headers=HEADERS), timeout=TIMEOUT) as res:
        body = res.read(MAX_BYTES + 1)[:MAX_BYTES]
        if res.headers.get("Content-Encoding", "").lower() == "gzip":
            body = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(body, MAX_BYTES)
        return res.geturl(), res.headers.get("Content-Type", "text/html"), body


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "wunschliste-fetch"
    sys_version = ""

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path != "/fetch":
            return self.reply(404, b"not found")
        if not KEY or not hmac.compare_digest(self.headers.get("X-Fetch-Key", "").encode(), KEY.encode()):
            return self.reply(403, b"forbidden")
        url = urllib.parse.parse_qs(parts.query).get("url", [""])[0]
        if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
            return self.reply(400, b"not a web address")
        self.shop = urllib.parse.urlsplit(url).hostname  # for the log: which shop, not which item
        try:
            final_url, content_type, body = fetch(url)
        except NotPublic as err:
            return self.reply(400, str(err).encode())
        except urllib.error.HTTPError as err:
            return self.reply(502, f"shop answered {err.code}".encode())
        except (OSError, ValueError, http.client.HTTPException) as err:
            return self.reply(502, f"shop not reachable: {err}".encode())
        self.reply(200, body, {"Content-Type": content_type, "X-Final-Url": final_url})

    def reply(self, status, body, headers=None):
        self.send_response(status)
        for name, value in (headers or {"Content-Type": "text/plain; charset=utf-8"}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_request(self, code="-", size="-"):
        sys.stderr.write(f"{code} {getattr(self, 'shop', '-')}\n")


if __name__ == "__main__":
    if not KEY:
        sys.exit("FETCH_KEY is not set")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"wunschliste-fetch listening on 127.0.0.1:{PORT}\n")
    server.serve_forever()
