#!/usr/bin/env python3
"""Ephemeral, allowlisted QX HTTP transaction collector.

Only /trace/v1/ingest is public via the QL Nginx proxy, with Bearer auth.
Admin API is NOT proxied to the Internet; use the container-local CLI.
No raw request/response data is written to disk, logs, or GitHub.
"""
from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qsl
import hmac
import hashlib
from pathlib import Path
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("TRACE_PORT", "18762"))
CAPTURE_TOKEN = os.environ.get("TRACE_CAPTURE_TOKEN", "")
ADMIN_TOKEN = os.environ.get("TRACE_ADMIN_TOKEN", "")
EXPORT_SHA256 = Path("/srv/trace/export_auth.sha256")
ALLOWED_HOSTS = frozenset({"mina.bydoceanauto.com", "wx.10086.cn"})
MAX_EVENT_BYTES = 1200 * 1024
MAX_BODY_CHARS = 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_EVENTS = 350
MAX_MINUTES = 15
PREPARE_MAX_MINUTES = 120
ACTIVATED_CAPTURE_MINUTES = 10
RETENTION_AFTER_CAPTURE_SECONDS = 60 * 60
STAGES = frozenset({"request_headers", "request_body", "response_headers", "response_body"})
TRACE_ID_PATTERN = re.compile(r"^[0-9a-zA-Z._:-]{1,96}$")

def redact_url(url):
    parsed = urlsplit(url)
    try: names = sorted(set(k for k, _ in parse_qsl(parsed.query, keep_blank_values=True)))
    except ValueError: names = []
    return {"host": parsed.hostname, "path": parsed.path, "query_keys": names[:50]}

def body_shape(value):
    if value is None:
        return {"present": False}
    if not isinstance(value, str):
        return {"present": True, "format": "non-text"}
    shape = {"present": True, "length": len(value)}
    if value and value[0] in "[{":
        try:
            doc = json.loads(value)
            shape["format"] = "json"
            if isinstance(doc, dict): shape["fields"] = sorted(str(k) for k in doc)[:70]
            elif isinstance(doc, list): shape["array_length"] = len(doc)
            return shape
        except (ValueError, TypeError): pass
    if re.fullmatch(r"[A-Za-z0-9+/=]+", value) and len(value) >= 20:
        shape["format"] = "base64-candidate"
    else:
        shape["format"] = "text"
    return shape

class TraceState:
    def __init__(self):
        self.lock = threading.RLock()
        self.until = 0.0
        self.purge_at = 0.0
        self.prepared_host = None
        self.prepared_until = 0.0
        self.host = None
        self.events = deque()
        self.total_bytes = 0
        self.captured = 0
        self.stage_counts = Counter()
        self.last_completed = None

    def _archive_metrics(self):
        # Retain only aggregate phase counts, never URLs, credentials or bodies.
        if self.captured:
            self.last_completed = {
                'events': self.captured,
                'stages': dict(self.stage_counts),
                'closed_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}

    def prepare(self, hostname, minutes):
        if hostname not in ALLOWED_HOSTS:
            raise ValueError("host not allowlisted")
        if not 1 <= minutes <= PREPARE_MAX_MINUTES:
            raise ValueError("invalid preparation duration")
        with self.lock:
            if self.active():
                raise PermissionError("active trace already running")
            self.prepared_host = hostname
            self.prepared_until = time.time() + minutes * 60
            return self.status()

    def activate(self, hostname):
        if hostname not in ALLOWED_HOSTS:
            raise ValueError("host not allowlisted")
        with self.lock:
            self.active()
            if self.host and time.time() < self.until:
                raise PermissionError("capture already active")
            if self.prepared_host != hostname or time.time() >= self.prepared_until:
                raise PermissionError("no valid prepared trace")
            # One preparation authorizes precisely one active 10-minute session.
            self.prepared_host = None
            self.prepared_until = 0.0
            return self.arm(hostname, ACTIVATED_CAPTURE_MINUTES)

    def arm(self, hostname, minutes):
        if hostname not in ALLOWED_HOSTS:
            raise ValueError("host not allowlisted")
        if not 1 <= minutes <= MAX_MINUTES:
            raise ValueError("invalid duration")
        with self.lock:
            self.prepared_host = None
            self.prepared_until = 0.0
            self._archive_metrics()
            self.events.clear()
            self.total_bytes = 0
            self.captured = 0
            self.stage_counts.clear()
            self.host = hostname
            self.until = time.time() + minutes * 60
            self.purge_at = self.until + RETENTION_AFTER_CAPTURE_SECONDS
            return self.status()

    def stop(self):
        with self.lock:
            self.prepared_host = None
            self.prepared_until = 0.0
            self._archive_metrics()
            self.until = 0.0
            self.purge_at = 0.0
            self.host = None
            self.events.clear()
            self.total_bytes = 0
            self.captured = 0
            self.stage_counts.clear()
            return self.status()

    def active(self):
        if self.prepared_host and time.time() >= self.prepared_until:
            self.prepared_host = None
            self.prepared_until = 0.0
        # New capture is disabled at until, but data is retained briefly for analysis.
        if self.host and time.time() >= self.purge_at:
            self._archive_metrics()
            self.events.clear()
            self.total_bytes = 0
            self.captured = 0
            self.stage_counts.clear()
            self.host = None
            self.until = 0.0
            self.purge_at = 0.0
        return bool(self.host and time.time() < self.until)

    def status(self):
        with self.lock:
            return {"active": self.active(), "host": self.host if self.active() else None,
                    "remaining_seconds": max(0, int(self.until - time.time())),
                    "prepared": bool(self.prepared_host),
                    "prepared_host": self.prepared_host,
                    "prepared_remaining_seconds": max(0, int(self.prepared_until - time.time())), 
                    "retained_seconds": max(0, int(self.purge_at - time.time())),
                    "events": len(self.events), "memory_bytes": self.total_bytes,
                    "stages": dict(self.stage_counts), "last_completed": self.last_completed,
                    "storage": "RAM_only", "raw_available_publicly": False}

    def ingest(self, event):
        if not isinstance(event, dict): raise ValueError("expected object")
        if event.get("v") != 1: raise ValueError("wrong protocol")
        stage = event.get("stage")
        if stage not in STAGES: raise ValueError("unrecognized stage")
        url = event.get("url")
        if not isinstance(url,str) or len(url)>4096: raise ValueError("invalid url")
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443):
            raise ValueError("invalid origin")
        if parts.hostname not in ALLOWED_HOSTS: raise ValueError("origin not allowlisted")
        session_index = event.get("session_index")
        if session_index is not None and not TRACE_ID_PATTERN.fullmatch(str(session_index)):
            raise ValueError("invalid session index")
        if event.get("method") is not None and str(event["method"]) not in ("GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"):
            raise ValueError("invalid method")
        if event.get("body") is not None and (not isinstance(event["body"],str) or len(event["body"])>MAX_BODY_CHARS):
            raise ValueError("invalid body")
        if event.get("headers") is not None:
            head = event["headers"]
            if not isinstance(head,dict) or len(head)>100 or any(not isinstance(k,str) or not isinstance(v,str) or len(k)>128 or len(v)>16384 for k,v in head.items()):
                raise ValueError("invalid headers")
        size = len(json.dumps(event, ensure_ascii=False).encode("utf-8"))
        if size > MAX_EVENT_BYTES: raise ValueError("oversize event")
        with self.lock:
            if not self.active(): raise PermissionError("capture not armed")
            if parts.hostname != self.host: raise ValueError("hostname mismatch")
            if parts.hostname=="wx.10086.cn":
                if event.get("origin")!="qx-china-mobile" or stage!="request_headers":
                    raise ValueError("China Mobile event must originate from scoped QX request-hook")
                if parts.path!="/qwhdhub/api/mark/mark31/domark" or parts.query:
                    raise ValueError("China Mobile URL not allowlisted")
                if event.get("method")!="POST" or event.get("body") is not None:
                    raise ValueError("China Mobile must be header-only POST")
                h=event.get("headers") or {}
                if set(h)!={"Cookie"} or not re.fullmatch(r"QWHD_SESSION_TOKEN=[^;\s]{12,4096}",h["Cookie"]):
                    raise ValueError("Unexpected China Mobile Cookie fields")
            if len(self.events)>=MAX_EVENTS or self.total_bytes+size>MAX_TOTAL_BYTES: raise OverflowError("trace memory limit")
            self.events.append(event)
            self.total_bytes += size
            self.captured += 1
            self.stage_counts[stage] += 1
            return {"accepted": True, "stage": stage, "count": self.captured}

    def raw(self):
        with self.lock:
            self.active()
            return list(self.events)

    def summary(self):
        with self.lock:
            self.active()
            groups={}
            for event in self.events:
                key = str(event.get("session_index") or "unknown:"+str(event.get("url",""))[:64])
                grp = groups.setdefault(key, {"session_index":key if not key.startswith("unknown:") else None,
                      "stages":[], "method":None,"request":{}, "response":{},"url":None})
                stage=event["stage"]
                if stage not in grp["stages"]: grp["stages"].append(stage)
                grp["url"] = redact_url(event.get("url",""))
                if event.get("method"): grp["method"]=event["method"]
                if stage in ("request_headers","response_headers"):
                    target = grp["request"] if stage=="request_headers" else grp["response"]
                    head=event.get("headers") or {}
                    target["header_names"]=sorted(head.keys())[:80]
                if stage=="response_headers" and event.get("status") is not None:
                    grp["response"]["status"]=event["status"]
                if stage in ("request_body","response_body"):
                    target = grp["request"] if stage=="request_body" else grp["response"]
                    target["body"]=body_shape(event.get("body"))
                    target["truncated"]=bool(event.get("truncated"))
            return {"status":self.status(),"transactions":list(groups.values())[:150]}

state=TraceState()

class Handler(BaseHTTPRequestHandler):
    server_version = "QLTrace/1.0"
    def log_message(self,*args):
        # Never log full URL/headers/body or credentials.
        pass
    def reply(self,status,body):
        data=json.dumps(body,ensure_ascii=False,separators=(",",":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def auth(self, key):
        field=self.headers.get("Authorization","")
        return key and hmac.compare_digest(field, "Bearer "+key)
    def is_admin(self):
        # Accessible only with separate admin token; NPM never proxies this path.
        return self.auth(ADMIN_TOKEN)
    def is_private_export(self):
        # Separate per-Debian credential. Only its SHA-256 digest is present on 127.
        value=self.headers.get("Authorization","")
        if not value.startswith("Bearer "):return False
        token=value[7:]
        if not (43<=len(token)<=128 and token.isascii()):return False
        try:
            stored=EXPORT_SHA256.read_text(encoding="ascii").strip()
            if not re.fullmatch(r"[0-9a-f]{64}",stored):return False
        except (OSError,ValueError):return False
        return hmac.compare_digest(hashlib.sha256(token.encode("ascii")).hexdigest(),stored)
    def read_json(self):
        size=int(self.headers.get("Content-Length","0"))
        if not (0<size<=MAX_EVENT_BYTES):
            raise ValueError("invalid Content-Length")
        raw=self.rfile.read(size)
        return json.loads(raw)

    def do_GET(self):
        if self.path == "/_admin/export":
            if not self.is_private_export():return self.reply(401,{"error":"unauthorized"})
            # No raw values in logs, process title, or standard diagnostics.
            return self.reply(200,{"events":state.raw()})
        if self.path == "/health":
            return self.reply(200,{"ok":True,"service":"qlcap-trace","version":"1.0"})
        if self.path == "/trace/v1/config":
            if not self.auth(CAPTURE_TOKEN):return self.reply(401,{"error":"unauthorized"})
            return self.reply(200,state.status())
        if self.path.startswith("/_admin/"):
            if not self.is_admin():return self.reply(401,{"error":"unauthorized"})
            if self.path=="/_admin/status":return self.reply(200,state.status())
            if self.path=="/_admin/summary":return self.reply(200,state.summary())
            if self.path=="/_admin/raw":return self.reply(200,{"events":state.raw()})
        return self.reply(404,{"error":"not found"})

    def do_POST(self):
        if self.path == "/trace/v1/activate":
            if not self.auth(CAPTURE_TOKEN):return self.reply(401,{"error":"unauthorized"})
            try:
                data=self.read_json()
                if not isinstance(data,dict):raise ValueError("invalid json")
                hostname=data.get("host")
                status=state.activate(hostname)
            except PermissionError:return self.reply(409,{"error":"not prepared or already active"})
            except (ValueError,TypeError):return self.reply(400,{"error":"invalid activation request"})
            return self.reply(200,status)
        if self.path == "/trace/v1/ingest":
            if not self.auth(CAPTURE_TOKEN):return self.reply(401,{"error":"unauthorized"})
            try: event=self.read_json()
            except (ValueError,TypeError):return self.reply(400,{"error":"invalid json"})
            try: outcome=state.ingest(event)
            except PermissionError:return self.reply(403,{"error":"capture not enabled"})
            except OverflowError:return self.reply(429,{"error":"trace limit"})
            except (ValueError,TypeError):return self.reply(400,{"error":"invalid event"})
            return self.reply(200,outcome)
        if self.path == "/_admin/prepare":
            if not self.is_admin():return self.reply(401,{"error":"unauthorized"})
            try:
                data=self.read_json()
                if not isinstance(data,dict):raise ValueError("invalid json")
                outcome=state.prepare(data.get("host"),int(data.get("minutes")))
            except PermissionError:return self.reply(409,{"error":"capture already active"})
            except (ValueError,TypeError):return self.reply(400,{"error":"invalid prepare request"})
            return self.reply(200,outcome)
        if self.path == "/_admin/arm":
            if not self.is_admin():return self.reply(401,{"error":"unauthorized"})
            try:
                p=self.read_json()
                outcome=state.arm(p.get("host"),int(p.get("minutes")))
            except (ValueError,TypeError,AttributeError):return self.reply(400,{"error":"invalid arm request"})
            return self.reply(200,outcome)
        if self.path == "/_admin/stop":
            if not self.is_admin():return self.reply(401,{"error":"unauthorized"})
            return self.reply(200,state.stop())
        return self.reply(404,{"error":"not found"})

def janitor():
    while True:
        time.sleep(3)
        with state.lock:
            state.active() # Purges expired raw events even when no API calls occur.

def cli(args):
    op=args[0] if args else "status"
    allowed={"status":("GET","/_admin/status",None),
             "summary":("GET","/_admin/summary",None),
             "stop":("POST","/_admin/stop",{}),
             "arm":("POST","/_admin/arm",{"host":"mina.bydoceanauto.com","minutes":10}),
             "prepare":("POST","/_admin/prepare",{"host":"mina.bydoceanauto.com","minutes":120}),
             "prepare-mobile":("POST","/_admin/prepare",{"host":"wx.10086.cn","minutes":120})}
    if op not in allowed:raise SystemExit("unsupported action")
    method,path,data=allowed[op]
    raw=json.dumps(data).encode("utf-8") if data is not None else None
    req=urllib.request.Request("http://127.0.0.1:"+str(PORT)+path,
          method=method,data=raw,headers={"Authorization":"Bearer "+ADMIN_TOKEN,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=12) as response: result=json.load(response)
    except urllib.error.HTTPError as e:raise SystemExit("admin API returned "+str(e.code))
    print(json.dumps(result,ensure_ascii=False))

if __name__=="__main__":
    if len(sys.argv)>1:
        cli(sys.argv[1:])
    else:
        if not CAPTURE_TOKEN or len(CAPTURE_TOKEN)<32 or not ADMIN_TOKEN or len(ADMIN_TOKEN)<32:
            raise SystemExit("Missing strong trace authentication token")
        threading.Thread(target=janitor,daemon=True).start()
        ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever(poll_interval=.2)
