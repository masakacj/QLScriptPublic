#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IKEA China miniapp daily member check-in, first scheduled run 2026-11-18 09:12.

Environment provided by QingLong:
  IKEA_AUTHORIZATION: a scoped Bearer token captured from user's own miniapp
  IKEA_SIGNIN_DRY_RUN: 1 for strictly read-only preflight (optional)
The script NEVER tries to manufacture an IKEA business token from WeChat wx.login.
Credentials, partyUid, response bodies, identity fields and raw URLs are not logged.
"""
from __future__ import annotations
import base64,datetime,json,os,re,sys,time,urllib.parse
import urllib.error,urllib.request
from zoneinfo import ZoneInfo

BASE="https://bff.app.ikea.cn"
CIAM="https://ciam.family.ikea.cn"
ACTIVITY_NAME="FAMILY_MEMBER_DAILY_SIGN_IN"
EVENT_NAME="DAILY_SIGN_IN"
TZ=ZoneInfo("Asia/Shanghai")
TOKEN_VAR="IKEA_AUTHORIZATION"
UA="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 MicroMessenger/8.0.0"
DRY_RUN=os.environ.get("IKEA_SIGNIN_DRY_RUN","0")=="1"

class SigninError(Exception):
    def __init__(self,reason):
        super().__init__(reason)
        self.reason=reason

def log(event,**data):
    clean={k:v for k,v in data.items() if k in ("status","http_status","confirmed","already_today","dry_run","reason","job","date")}
    print(json.dumps({"service":"ikea_daily","event":event,**clean},ensure_ascii=False),flush=True)

def notify_fail(reason):
    try:
        # QingLong runs task scripts from nested repository directories; its
        # own notification module lives at the scripts root, not sys.path.
        from pathlib import Path
        import sys
        ql_scripts="/ql/data/scripts"
        if Path(ql_scripts,"sendNotify.py").is_file() and ql_scripts not in sys.path:
            sys.path.insert(0,ql_scripts)
        from sendNotify import send
        send("宜家签到失败", "IKEA 宜家家居 · "+str(reason)+"；未确认签到成功，请检查 YYB/青龙运行日志。")
        log("notified",status="sent")
    except Exception:
        log("notified",status="unavailable")

def authorization():
    s=os.environ.get(TOKEN_VAR,"").strip()
    if not s or s in ("__PENDING_QX_CAPTURE__","pending","1"):
        raise SigninError("待采集宜家登录凭据（请使用微信小程序触发 QX 采集）")
    if not s.startswith("Bearer "):
        if len(s)>30 and re.fullmatch(r"[A-Za-z0-9._~+/-]+={0,2}",s):s="Bearer "+s
        else:raise SigninError("宜家凭据格式不符合预期")
    if not 35<=len(s)<=1200 or not re.fullmatch(r"Bearer [A-Za-z0-9._~+/-]+={0,2}",s):
        raise SigninError("宜家凭据格式不符合预期")
    return s

def request_json(method,host,path,token,params=None,payload=None):
    if host not in (BASE,CIAM) or not path.startswith("/") or any(q in path for q in ("http:","https:","@","\\","\n")):
        raise SigninError("请求目标不在宜家接口白名单")
    url=host+path
    if params:url+="?"+urllib.parse.urlencode(params)
    body=json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode("utf-8") if payload is not None else None
    headers={
      "Authorization":token,
      "Content-Type":"application/json",
      "Accept":"application/json, text/plain, */*",
      "User-Agent":UA,
      "X-Client-Platform":"WechatMiniprogram",
      "X-Client-Render":"jssdk",
      "Source":"SHOPPABLE_MINI_P",
    }
    req=urllib.request.Request(url,method=method,headers=headers,data=body)
    try:
        with urllib.request.urlopen(req,timeout=18) as res:
            if res.status>=400:raise SigninError("宜家接口 HTTP "+str(res.status))
            raw=res.read(300000)
    except urllib.error.HTTPError as e:
        if e.code in (401,403):raise SigninError("宜家登录凭据已失效（HTTP "+str(e.code)+"）") from None
        raise SigninError("宜家接口 HTTP "+str(e.code)) from None
    except (urllib.error.URLError,TimeoutError,OSError):
        raise SigninError("宜家接口网络连接失败") from None
    try:
        ans=json.loads(raw)
    except (ValueError,TypeError):
        raise SigninError("宜家响应不是 JSON") from None
    if not isinstance(ans,dict):
        raise SigninError("宜家响应格式异常")
    return ans

def ensure_code_zero(answer,label):
    v=answer.get("code")
    if str(v) not in ("0","P20000"):
        if str(v) in ("401","403","P40001","P40100"):
            raise SigninError(label+"：会话过期")
        raise SigninError(label+"：业务返回码 "+str(v)[:20])
    return answer.get("data")

def get_party_uid(token):
    ans=request_json("GET",CIAM,"/ciam/crbff/profile/auth/customer/profile/get",token)
    data=ensure_code_zero(ans,"会员资料")
    # CIAM profile/get returns {code:"P20000", customer:{...}} at top level,
    # unlike customer-bff endpoints that put results under data.
    if not isinstance(data,dict):data=ans
    customer=data.get("customer")
    key=customer.get("partyUid") if isinstance(customer,dict) else None
    if not isinstance(key,str) or not 3<=len(key)<=160:
        raise SigninError("会员资料未返回 partyUid")
    return key

def get_activity(token):
    d=ensure_code_zero(request_json("GET",BASE,"/customer-bff/v3.0/activity",token,
        {"name":ACTIVITY_NAME}),"获取签到活动")
    if not isinstance(d,dict):raise SigninError("签到活动信息异常")
    activity_id=d.get("id")
    gameplays=d.get("gameplayList")
    if not isinstance(activity_id,(str,int)) or not activity_id:
        raise SigninError("签到活动 ID 缺失")
    if not isinstance(gameplays,list):raise SigninError("签到玩法列表缺失")
    matches=[g for g in gameplays if isinstance(g,dict) and g.get("gameplayType")==EVENT_NAME]
    if len(matches)!=1 or not matches[0].get("id"):
        raise SigninError("DAILY_SIGN_IN 玩法尚未找到")
    return activity_id,matches[0]["id"]

def get_participant(token,activity_id):
    data=ensure_code_zero(request_json("GET",BASE,"/customer-bff/v3.0/activity/participants",
        token,{"activityId":activity_id}),"获取签到状态")
    if not isinstance(data,dict):raise SigninError("参与记录结构异常")
    properties=data.get("properties")
    if not isinstance(properties,dict):
        raise SigninError("参与记录缺少 properties，停止以避免重复签到")
    return properties

def is_today(value,today):
    if not value:return False
    if not isinstance(value,str):return False
    return value[:10]==today

def encrypted(data,key):
    src=json.dumps(data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    k=key.encode("utf-8")
    return base64.b64encode(bytes(src[i]^k[i%len(k)] for i in range(len(src)))).decode("ascii")

def sign(token,party_uid,activity_id,gameplay_id):
    req={"activityId":activity_id,"eventType":EVENT_NAME,"gameplayId":gameplay_id}
    d=ensure_code_zero(request_json("POST",BASE,"/customer-bff/v3.0/activity/events",
        token,payload={"encryptData":encrypted(req,party_uid)}),"提交每日签到")
    return d

def run():
    date=datetime.datetime.now(TZ).date().isoformat()
    log("start",date=date,dry_run=DRY_RUN)
    token=authorization()
    activity_id,gameplay_id=get_activity(token)
    before=get_participant(token,activity_id)
    if is_today(before.get("lastSignInDate"),date):
        log("complete",status="already_signed",already_today=True,confirmed=True,date=date)
        return
    if DRY_RUN:
        # Auth and business read endpoints were validated. NEVER send an event.
        log("preflight",status="ready",dry_run=True,confirmed=False,date=date)
        return
    party_uid=get_party_uid(token)
    sign(token,party_uid,activity_id,gameplay_id)
    # Event HTTP 200 or code 0 alone is insufficient; verify the persisted date.
    for attempt in range(3):
        if attempt:time.sleep(2)
        current=get_participant(token,activity_id)
        if is_today(current.get("lastSignInDate"),date):
            log("complete",status="signed",confirmed=True,date=date)
            return
    raise SigninError("签到接口返回成功，但未确认 lastSignInDate 更新")

if __name__=="__main__":
    try:
        run()
    except SigninError as e:
        log("failed",status="failure",reason=e.reason)
        notify_fail(e.reason)
        sys.exit(1)
    except Exception as e:
        log("failed",status="failure",reason="程序异常："+type(e).__name__)
        notify_fail("程序异常："+type(e).__name__)
        sys.exit(1)
