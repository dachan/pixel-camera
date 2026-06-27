#!/usr/bin/env python3
"""Bisect touch-scroll: inject a synthetic TOUCH scroll gesture into the running
Chromium via the DevTools protocol and report whether the page actually scrolled.

Run ON THE PI after Chromium is started with --remote-debugging-port=9222.
Pure stdlib (no websocket dep) so it runs on a stock Pi.
"""
import json, os, socket, struct, base64, urllib.request, sys, time


def http_json(path):
    with urllib.request.urlopen(f"http://127.0.0.1:9222{path}", timeout=5) as r:
        return json.load(r)


class WS:
    def __init__(self, url):
        # ws://127.0.0.1:9222/devtools/page/<id>
        host = "127.0.0.1"; port = 9222
        path = url.split(f"{host}:{port}", 1)[1]
        self.s = socket.create_connection((host, port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(1024)
        self._id = 0

    def send(self, method, params=None):
        self._id += 1
        payload = json.dumps({"id": self._id, "method": method,
                              "params": params or {}}).encode()
        mask = os.urandom(4)
        n = len(payload)
        hdr = b"\x81"
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        hdr += mask
        self.s.sendall(hdr + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        return self._id

    def recv_result(self, want_id):
        while True:
            b1 = self.s.recv(2)
            if len(b1) < 2:
                return None
            n = b1[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", self.s.recv(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self.s.recv(8))[0]
            data = b""
            while len(data) < n:
                data += self.s.recv(n - len(data))
            msg = json.loads(data.decode("utf-8", "replace"))
            if msg.get("id") == want_id:
                return msg

    def eval(self, expr):
        i = self.send("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True})
        r = self.recv_result(i)
        return r["result"]["result"].get("value")


def main():
    pages = [t for t in http_json("/json") if t.get("type") == "page"]
    if not pages:
        print("NO PAGE in chromium debug list"); return 2
    ws = WS(pages[0]["webSocketDebuggerUrl"])
    ws.send("Runtime.enable"); ws.recv_result(ws._id)
    ws.send("Input.enable") if False else None

    # Ensure the Meta tab (the scrollable one) is active.
    ws.eval("(()=>{const b=[...document.querySelectorAll('button')]"
            ".find(b=>b.textContent.trim()==='Meta'); if(b)b.click(); return !!b;})()")
    time.sleep(0.8)

    find = ("(()=>{const e=[...document.querySelectorAll('*')]"
            ".find(e=>e.scrollHeight>e.clientHeight+4 &&"
            " ['auto','scroll'].includes(getComputedStyle(e).overflowY));"
            " if(!e)return null; const r=e.getBoundingClientRect();"
            " let ta=[],n=e; while(n){ta.push(getComputedStyle(n).touchAction);n=n.parentElement;}"
            " return {top:e.scrollTop,sh:e.scrollHeight,ch:e.clientHeight,"
            " x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),"
            " touchActions:ta};})()")
    print("navigator.maxTouchPoints:", ws.eval("navigator.maxTouchPoints"))
    print("'ontouchstart' in window:", ws.eval("'ontouchstart' in window"))
    print("matchMedia(pointer:coarse):",
          ws.eval("matchMedia('(pointer: coarse)').matches"))
    print("matchMedia(any-pointer:coarse):",
          ws.eval("matchMedia('(any-pointer: coarse)').matches"))

    before = ws.eval(find)
    print("scroll container BEFORE:", before)
    if not before:
        print("RESULT: no scrollable element found on page (wrong tab/layout?)")
        return 1
    print("touch-action chain (container -> ancestors):", before.get("touchActions"))

    def gesture(ydist, label):
        i = ws.send("Input.synthesizeScrollGesture", {
            "x": before["x"], "y": before["y"],
            "xDistance": 0, "yDistance": ydist,
            "gestureSourceType": "touch", "speed": 800,
        })
        ws.recv_result(i)
        time.sleep(0.8)
        top = ws.eval("(()=>{const e=[...document.querySelectorAll('*')]"
                      ".find(e=>e.scrollHeight>e.clientHeight+4 &&"
                      " ['auto','scroll'].includes(getComputedStyle(e).overflowY));"
                      " return e?e.scrollTop:null;})()")
        print(f"  after TOUCH gesture yDistance={ydist} ({label}): scrollTop={top}")
        return top

    t_down = gesture(-300, "drag up = scroll down")
    t_up = gesture(300, "drag down = scroll up")

    # Faithful finger drag via dispatchTouchEvent (touchStart/Move*/End).
    ws.eval("(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+4 && ['auto','scroll'].includes(getComputedStyle(e).overflowY)); if(e)e.scrollTop=0;})()")
    x, y0 = before["x"], before["y"] + 150
    def touch(kind, y):
        pts = [] if kind == "touchEnd" else [{"x": x, "y": y}]
        i = ws.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
        ws.recv_result(i)
    touch("touchStart", y0)
    for k in range(1, 13):
        touch("touchMove", y0 - k * 22)   # finger moves up -> content scrolls down
        time.sleep(0.02)
    touch("touchEnd", 0)
    time.sleep(0.8)
    drag = ws.eval("(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+4 && ['auto','scroll'].includes(getComputedStyle(e).overflowY)); return e?e.scrollTop:null;})()")
    print(f"  after dispatchTouchEvent finger-drag: scrollTop={drag}")

    # Compare with a WHEEL scroll (proves the element CAN scroll programmatically).
    i = ws.send("Input.synthesizeScrollGesture", {
        "x": before["x"], "y": before["y"], "xDistance": 0, "yDistance": -300,
        "gestureSourceType": "mouse", "speed": 800,
    })
    ws.recv_result(i)
    time.sleep(0.8)
    wheel = ws.eval("(()=>{const e=[...document.querySelectorAll('*')]"
                    ".find(e=>e.scrollHeight>e.clientHeight+4 &&"
                    " ['auto','scroll'].includes(getComputedStyle(e).overflowY));"
                    " return e?e.scrollTop:null;})()")
    print(f"  after WHEEL/mouse gesture: scrollTop={wheel}")

    touch_works = (t_down not in (0, None)) or (t_up not in (0, None))
    print("RESULT: TOUCH-SCROLL", "WORKS" if touch_works else "DOES NOT WORK",
          "| wheel scroll", "works" if wheel not in (0, None) else "also fails")
    return 0


if __name__ == "__main__":
    sys.exit(main())
