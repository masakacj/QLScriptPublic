#!/usr/bin/env python3
"""No live traffic, credentials or external network required."""
import importlib.util
import json
import pathlib
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

p=pathlib.Path(__file__).with_name("qlcap-trace-collector.py")
spec=importlib.util.spec_from_file_location("tracecollector",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

URL="https://mina.bydoceanauto.com/?s=ForCommonUcSrv.forward&serviceDir=activity/list"
EVENT={
    "v":1,"stage":"request_headers","session_index":"1001",
    "method":"POST","url":URL,"headers":{"Cookie":"PrivateSessionCookieForTest","Content-Type":"application/json"},
    "body":None, "at":123456
}
class StateTests(unittest.TestCase):
    def setUp(self):
        self.s=m.TraceState()
        self.s.arm("mina.bydoceanauto.com",1)
    def test_happy_path_and_redaction(self):
        self.assertTrue(self.s.ingest(dict(EVENT))["accepted"])
        s=self.s.summary()
        self.assertEqual(s["transactions"][0]["session_index"],"1001")
        self.assertIn("Cookie",s["transactions"][0]["request"]["header_names"])
        self.assertNotIn("PrivateSessionCookieForTest",json.dumps(s))
        self.assertNotIn("activity/list",json.dumps(self.s.status()))
    def test_correlation_across_four_phases(self):
        for phase in m.STAGES:
            x=dict(EVENT,stage=phase)
            x["body"]='{"secret_token":"hidden"}' if phase.endswith("body") else None
            x["status"]=200 if phase=="response_headers" else None
            self.s.ingest(x)
        summaries=self.s.summary()["transactions"]
        self.assertEqual(len(summaries),1)
        self.assertEqual(len(summaries[0]["stages"]),4)
        self.assertEqual(summaries[0]["response"]["status"],200)
        self.assertEqual(summaries[0]["request"]["body"]["fields"],["secret_token"])
        self.assertNotIn("hidden",json.dumps(summaries))
    def test_wrong_origin_blocked(self):
        for u in ["https://evil.example/?x=1","http://mina.bydoceanauto.com/","https://mina.bydoceanauto.com.evil.test/","https://user:pw@mina.bydoceanauto.com/"]:
            with self.assertRaises(ValueError):
                self.s.ingest(dict(EVENT,url=u))
    def test_unarmed_rejects(self):
        self.s.stop()
        with self.assertRaises(PermissionError): self.s.ingest(EVENT)
    def test_expiry_purges_raw(self):
        self.s.ingest(EVENT)
        self.s.until=time.time()-1
        self.assertFalse(self.s.active())
        # Capture ends, but events remain briefly available for analysis.
        self.assertEqual(len(self.s.raw()),1)
        with self.assertRaises(PermissionError):self.s.ingest(EVENT)
        self.s.purge_at=time.time()-1
        self.assertEqual(self.s.raw(),[])
        info=self.s.status()
        self.assertEqual(info["events"],0)
        self.assertEqual(info["last_completed"]["stages"],{"request_headers":1})
        self.assertEqual(info["last_completed"]["events"],1)
        self.assertNotIn("PrivateSessionCookieForTest",json.dumps(info))
    def test_bounds(self):
        with self.assertRaises(ValueError):self.s.ingest(dict(EVENT,stage="crazy"))
        with self.assertRaises(ValueError):self.s.ingest(dict(EVENT,body="x"*(m.MAX_BODY_CHARS+1)))
        with self.assertRaises(ValueError):self.s.arm("evil.example",1)
        with self.assertRaises(ValueError):self.s.arm("mina.bydoceanauto.com",60)
    def test_raw_retained_only_in_memory(self):
        self.s.ingest(EVENT)
        self.assertEqual(self.s.raw()[0]["headers"]["Cookie"],"PrivateSessionCookieForTest")
        self.s.stop()
        self.assertEqual(self.s.raw(),[])
        self.assertEqual(self.s.status()["last_completed"]["stages"],{"request_headers":1})

class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        m.state=m.TraceState()
        m.CAPTURE_TOKEN="T"*48
        m.ADMIN_TOKEN="A"*48
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),m.Handler)
        cls.url=f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
    def request(self,path,method="GET",token=None,doc=None):
        data=json.dumps(doc).encode() if doc is not None else None
        headers={"Content-Type":"application/json"}
        if token:headers["Authorization"]="Bearer "+token
        req=urllib.request.Request(self.url+path,data=data,method=method,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def test_auth_and_arming(self):
        self.assertEqual(self.request("/trace/v1/ingest","POST",doc=EVENT)[0],401)
        self.assertEqual(self.request("/trace/v1/ingest","POST","T"*48,EVENT)[0],403)
        self.assertEqual(self.request("/_admin/arm","POST","T"*48,{"host":"mina.bydoceanauto.com","minutes":1})[0],401)
        self.assertEqual(self.request("/_admin/arm","POST","A"*48,{"host":"mina.bydoceanauto.com","minutes":1})[0],200)
        self.assertEqual(self.request("/trace/v1/ingest","POST","T"*48,EVENT)[0],200)
        self.assertEqual(self.request("/_admin/raw")[0],401)
        code,res=self.request("/_admin/summary",token="A"*48)
        self.assertEqual(code,200)
        self.assertEqual(res["status"]["events"],1)
        self.assertNotIn("PrivateSessionCookieForTest",json.dumps(res))
        self.assertEqual(self.request("/_admin/stop","POST","A"*48,{})[0],200)
        self.assertEqual(self.request("/_admin/raw",token="A"*48)[1]["events"],[])
    def test_cross_domain_bad_request(self):
        self.request("/_admin/arm","POST","A"*48,{"host":"mina.bydoceanauto.com","minutes":1})
        code,_=self.request("/trace/v1/ingest","POST","T"*48,dict(EVENT,url="https://example.com"))
        self.assertEqual(code,400)
        self.request("/_admin/stop","POST","A"*48,{})

if __name__=="__main__":unittest.main(verbosity=2)
