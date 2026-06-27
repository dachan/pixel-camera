#!/usr/bin/env python3
"""Install a real-input event logger into the running Chromium page, or read it
back. Proves whether a physical finger drag arrives as TOUCH (good) or MOUSE
(labwc still emulating) events, and whether it scrolled.

Usage (on the Pi, Chromium started with --remote-debugging-port=9222):
  python3 cdp_log.py install   # arms the logger, switches to Meta tab
  python3 cdp_log.py read      # dumps what was captured
"""
import json, os, socket, struct, base64, urllib.request, sys


def http_json(path):
    with urllib.request.urlopen(f"http://127.0.0.1:9222{path}", timeout=5) as r:
        return json.load(r)


class WS:
    def __init__(self, url):
        host, port = "127.0.0.1", 9222
        path = url.split(f"{host}:{port}", 1)[1]
        self.s = socket.create_connection((host, port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\n"
                        "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(1024)
        self._id = 0

    def eval(self, expr):
        self._id += 1
        payload = json.dumps({"id": self._id, "method": "Runtime.evaluate",
                              "params": {"expression": expr,
                                         "returnByValue": True}}).encode()
        mask = os.urandom(4)
        n = len(payload)
        hdr = b"\x81"
        hdr += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
        hdr += mask
        self.s.sendall(hdr + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        while True:
            h = self.s.recv(2)
            ln = h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self.s.recv(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self.s.recv(8))[0]
            data = b""
            while len(data) < ln:
                data += self.s.recv(ln - len(data))
            msg = json.loads(data.decode("utf-8", "replace"))
            if msg.get("id") == self._id:
                return msg["result"]["result"].get("value")


INSTALL = r"""
(() => {
  const mb = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Meta');
  if (mb) mb.click();
  window.__evlog = {counts:{}, scrollStart:null, scrollEnd:null, order:[]};
  const sc = [...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+4 &&
      ['auto','scroll'].includes(getComputedStyle(e).overflowY));
  const L = window.__evlog;
  if (sc) L.scrollStart = sc.scrollTop;
  const bump = t => { L.counts[t]=(L.counts[t]||0)+1;
    if (L.order.length<12) L.order.push(t);
    if (sc) L.scrollEnd = sc.scrollTop; };
  ['touchstart','touchmove','touchend','pointerdown','pointermove','pointerup',
   'mousedown','mousemove','mouseup','wheel','scroll'].forEach(t =>
     window.addEventListener(t, ()=>bump(t), {passive:true, capture:true}));
  return 'armed; scrollStart='+(sc?L.scrollStart:'no-scroll-el');
})()
"""

READ = r"""
JSON.stringify(window.__evlog || {error:'logger not installed (page reloaded?)'})
"""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "read"
    pages = [t for t in http_json("/json") if t.get("type") == "page"]
    if not pages:
        print("NO PAGE"); return 2
    ws = WS(pages[0]["webSocketDebuggerUrl"])
    print(ws.eval(INSTALL if mode == "install" else READ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
