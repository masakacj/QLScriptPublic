#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""YYB -> IKEA business idToken; scoped single-account renewal.

This module does NOT sign in to activities. It obtains one wx.login code from
the user's private YYB, exchanges once for IKEA idToken, verifies membership
against an explicitly pinned fingerprint, and updates ONLY IKEA_AUTHORIZATION
in the user's private QingLong. No raw credentials in logs, exceptions or repo.
"""
from __future__ import annotations
import base64, hashlib, json, os, re, sqlite3, time, urllib.error, urllib.parse, urllib.request

APP_ID = "wxd47892129d2fa9e9"
YYB_ENDPOINT = "http://yyb-go:8000/wxapp/getCode"
IKEA_EXCHANGE = "https://bff.app.ikea.cn/customer-bff/v1.0/customer/auth/wechat"
IKEA_PROFILE = "https://ciam.family.ikea.cn/ciam/crbff/profile/auth/customer/profile/get"
QL_ROOT = "http://127.0.0.1:5600/open/"  # verified direct QL API; no Nginx dependency
QL_DB = "/ql/data/db/database.sqlite"
QL_APP = "yyb-go-enhanced-service"
TOKEN_ENV = "IKEA_AUTHORIZATION"
PIN_ENV = "IKEA_MEMBER_PIN_SHA256"
SOURCE = "SHOPPABLE_MINI_P"
RENEW_THRESHOLD_SECONDS = 24 * 3600
UA = "Mozilla/5.0 MicroMessenger/8.0"

class RenewalError(Exception):
    """Constant, safe error code; never include remote raw response."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def info(status, **fields):
    safe_fields = {k:v for k,v in fields.items()
                   if k in ("ttl_hours","source","identity_verified","persisted","reason")}
    print(json.dumps({"service":"ikea_yyb_auth","status":status,**safe_fields},
                     ensure_ascii=False),flush=True)

def member_fingerprint(party_uid):
    if not isinstance(party_uid,str) or not 4<=len(party_uid)<=200:
        raise RenewalError("member_identity_invalid")
    return hashlib.sha256(("IKEA_MEMBER_V1:"+party_uid).encode("utf-8")).hexdigest()

def jwt_ttl_seconds(bearer):
    try:
        token = bearer.split(" ",1)[1] if bearer.startswith("Bearer ") else bearer
        if token.count(".")!=2:return None
        raw = token.split(".")[1]
        claims=json.loads(base64.urlsafe_b64decode(raw+"="*(-len(raw)%4)))
        exp=claims.get("exp")
        if not isinstance(exp,(int,float)):return None
        return float(exp)-time.time()
    except (ValueError,IndexError,TypeError,UnicodeDecodeError):
        return None

def _json(req,timeout):
    try:
        with urllib.request.urlopen(req,timeout=timeout) as res:
            if res.status!=200:raise RenewalError("upstream_unexpected_http")
            raw=res.read(170000)
        ans=json.loads(raw)
        if not isinstance(ans,dict):raise RenewalError("upstream_not_object")
        return ans
    except urllib.error.HTTPError as e:
        raise RenewalError("upstream_http_"+str(e.code)) from None
    except (urllib.error.URLError,TimeoutError,OSError):
        raise RenewalError("upstream_network_error") from None
    except ValueError:
        raise RenewalError("upstream_invalid_json") from None

def _get_env(name):
    # QingLong exports enabled environment variables to scheduled tasks.
    val=os.environ.get(name,"")
    if val:return val.strip()
    try:
        db=sqlite3.connect("file:"+QL_DB+"?mode=ro",uri=True)
        try:
            rows=db.execute("SELECT value FROM Envs WHERE name=? AND status=0",(name,)).fetchall()
        finally:db.close()
        if len(rows)!=1:raise RenewalError("required_env_missing_"+name.lower())
        return str(rows[0][0] or "").strip()
    except sqlite3.Error:
        raise RenewalError("ql_env_read_unavailable") from None

def _headers(token=None):
    h={"Source":SOURCE,"X-Client-Platform":"WechatMiniprogram",
       "Content-Type":"application/json","Accept":"application/json",
       "User-Agent":UA}
    if token:h["Authorization"]=token
    return h

def profile_party_uid(bearer):
    if not bearer or not bearer.startswith("Bearer "):return None
    try:
        req=urllib.request.Request(IKEA_PROFILE,method="GET",headers=_headers(bearer))
        ans=_json(req,16)
    except RenewalError:
        return None
    if ans.get("code") not in ("P20000","0"):return None
    cust=ans.get("customer")
    if not isinstance(cust,dict):
        data=ans.get("data")
        cust=data.get("customer") if isinstance(data,dict) else None
    if not isinstance(cust,dict):return None
    party=cust.get("partyUid")
    if not isinstance(party,str) or not 4<=len(party)<=200:return None
    return party

def _yyb_code():
    server_rows=[line.strip() for line in _get_env("YYB_SERVER").splitlines() if line.strip()]
    if len(server_rows)!=1 or "@" not in server_rows[0]:
        raise RenewalError("yyb_account_ref_ambiguous")
    ref=server_rows[0].rsplit("@",1)[1]
    if not ref or len(ref)>200:raise RenewalError("yyb_ref_invalid")
    key=_get_env("YYB_API_KEY")
    if len(key)<32 or len(key)>500:raise RenewalError("yyb_key_invalid")
    req=urllib.request.Request(YYB_ENDPOINT,method="POST",
      data=json.dumps({"ref":ref,"app_id":APP_ID},separators=(",",":")).encode(),
      headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    result=_json(req,29)
    if result.get("code") not in (0,"0"):
        raise RenewalError("yyb_code_request_rejected")
    data=result.get("data")
    inner=(data.get("result") if isinstance(data,dict) else None)
    code=inner.get("code") if isinstance(inner,dict) else None
    if not isinstance(code,str) or not 15<=len(code)<=250:
        raise RenewalError("yyb_code_missing")
    return code

def _exchange(code):
    req=urllib.request.Request(IKEA_EXCHANGE,method="POST",
       data=json.dumps({"code":code},separators=(",",":")).encode(),
       headers=_headers())
    doc=_json(req,22)
    if str(doc.get("code"))!="0":
        raise RenewalError("ikea_exchange_rejected")
    result=doc.get("data")
    if not isinstance(result,dict):raise RenewalError("ikea_exchange_no_data")
    tok=result.get("idToken")
    if not isinstance(tok,str) or not 64<=len(tok)<=1200:
        raise RenewalError("ikea_id_token_missing")
    party_uid=result.get("partyUid")
    if not isinstance(party_uid,str) or len(party_uid)<4:
        raise RenewalError("ikea_exchange_identity_missing")
    return "Bearer "+tok, party_uid

def _ql_app_token():
    try:
        db=sqlite3.connect("file:"+QL_DB+"?mode=ro",uri=True)
        try:
            rows=db.execute("SELECT client_id,client_secret FROM Apps WHERE name=?",(QL_APP,)).fetchall()
        finally:db.close()
    except sqlite3.Error:raise RenewalError("ql_app_db_unavailable") from None
    if len(rows)!=1:raise RenewalError("ql_app_missing")
    cid,secret=rows[0]
    params=urllib.parse.urlencode({"client_id":cid,"client_secret":secret})
    out=_json(urllib.request.Request(QL_ROOT+"auth/token?"+params),14)
    data=out.get("data")
    if str(out.get("code")) not in ("0","200") or not isinstance(data,dict):
        raise RenewalError("ql_app_auth_rejected")
    token=data.get("token")
    if not isinstance(token,str) or len(token)<16:raise RenewalError("ql_app_no_token")
    return token

def _ql_request(method,path,token,body=None):
    if not path.startswith(("envs","auth/")):raise RenewalError("ql_path_not_allowed")
    payload=json.dumps(body,ensure_ascii=False,separators=(",",":")).encode() if body is not None else None
    req=urllib.request.Request(QL_ROOT+path,method=method,data=payload,
       headers={"Authorization":"Bearer "+token,
                "Content-Type":"application/json"})
    response=_json(req,15)
    if str(response.get("code")) not in ("0","200"):
        raise RenewalError("ql_api_rejected")
    return response.get("data")

def _persist_token(bearer):
    token=_ql_app_token()
    rows=_ql_request("GET","envs?searchValue="+TOKEN_ENV,token)
    if isinstance(rows,dict):rows=rows.get("data",[])
    if not isinstance(rows,list):raise RenewalError("ql_env_list_bad")
    items=[x for x in rows if isinstance(x,dict) and x.get("name")==TOKEN_ENV]
    if len(items)!=1 or items[0].get("status") not in (0,"0"):
        raise RenewalError("ql_token_env_missing")
    row=items[0]
    if row.get("value")!=bearer:
        _ql_request("PUT","envs",token,{"id":row["id"],"name":TOKEN_ENV,
            "value":bearer,"remarks":row.get("remarks") or "IKEA YYB auth"})
    check=_ql_request("GET","envs?searchValue="+TOKEN_ENV,token)
    if isinstance(check,dict):check=check.get("data",[])
    if not isinstance(check,list) or len([r for r in check if isinstance(r,dict)
            and r.get("name")==TOKEN_ENV and r.get("value")==bearer])!=1:
        raise RenewalError("ql_token_env_write_unverified")

def ensure_business_token(current=None,dry_run=False):
    """Return one verified bearer, rotate only if invalid/near-expiry.

    No YYB or QL POST in dry_run mode.
    An explicit pinned identity fingerprint is mandatory for any rotation.
    """
    pin=_get_env(PIN_ENV).lower()
    if not re.fullmatch(r"[0-9a-f]{64}",pin):
        raise RenewalError("member_pin_missing_or_invalid")
    if current is None:
        current=_get_env(TOKEN_ENV)
    current=current.strip() if isinstance(current,str) else ""
    current_party=profile_party_uid(current)
    if current_party and member_fingerprint(current_party)!=pin:
        raise RenewalError("existing_account_mismatch")
    ttl=jwt_ttl_seconds(current)
    if current_party and ttl is not None and ttl>RENEW_THRESHOLD_SECONDS:
        info("reused",ttl_hours=round(ttl/3600,1),identity_verified=True)
        return current
    if dry_run:raise RenewalError("needs_renewal_dry_run")
    # Exactly one YYB Code request and one IKEA exchange per renewal attempt.
    code=_yyb_code()
    new_token,claimed_party=_exchange(code)
    new_party=profile_party_uid(new_token)
    if not new_party or new_party!=claimed_party:
        raise RenewalError("new_token_profile_unverified")
    if member_fingerprint(new_party)!=pin:
        raise RenewalError("new_account_mismatch")
    ttl=jwt_ttl_seconds(new_token)
    if ttl is None or not 24*3600 < ttl < 15*24*3600:
        raise RenewalError("new_token_expiry_unexpected")
    _persist_token(new_token)
    info("renewed",ttl_hours=round(ttl/3600,1),identity_verified=True,persisted=True)
    return new_token
