#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云盘签到 · 认证闭环（新凭据优先、旧凭据备用）

青龙任务：2226；不依赖第三方签到 API；不输出 Token、用户 UID、账号凭据。
YYB wx.login Code 的获取已实测，但该 Code 并不是阿里云盘业务 Token：
尚未识别阿里云盘的 Code->Token 兑换接口，绝不伪称自动兑换成功。
QX 可经私有网关安全导入新的 Refresh Token，之后由此脚本自动续期。
"""
from __future__ import annotations
import argparse,fcntl,hashlib,json,os,re,sqlite3,sys,tempfile,time
from datetime import datetime
from pathlib import Path
from urllib import request,error,parse
from zoneinfo import ZoneInfo

APPID="wxf86f0a56fa23241f"
ALI_APP="pJZInNHN2dZWk8qg"
ROOT=Path("/ql/data")
CONF=ROOT/"config"
STATE=CONF/"alipan_daily_state.json"
LOCK=CONF/"alipan_daily.lock"
DB=ROOT/"db/database.sqlite"
QL_APP="yyb-go-enhanced-service"
QL_OPEN="http://127.0.0.1:5600/open/"
AUTH_URL="https://auth.aliyundrive.com/v2/account/token"
PROFILE_URL="https://user.aliyundrive.com/v2/user/get"
MEMBER_URL="https://member.aliyundrive.com/v1/activity/sign_in_list?_rx-s=mobile"
REWARD_URL="https://member.aliyundrive.com/v1/activity/sign_in_reward?_rx-s=mobile"
TZ=ZoneInfo("Asia/Shanghai")
REFRESH_ENV="ALIPAN_REFRESH_TOKEN"
PIN_ENV="ALIPAN_UID_PIN_SHA256"
ALLOWED_LENGTH=re.compile(r"^[A-Za-z0-9_-]{32,256}$")
HEX64=re.compile(r"^[0-9a-f]{64}$")

class Failure(Exception):
    def __init__(self,code):
        self.code=code
        super().__init__(code)

def today():return datetime.now(TZ).strftime("%Y-%m-%d")

def report(stage,**kw):
    safe={k:kw[k] for k in ("status","day","days","auth","reward","notify","error")
          if k in kw and isinstance(kw[k],(str,bool,int,type(None)))}
    print(json.dumps({"service":"alipan_daily","stage":stage,**safe},
      ensure_ascii=False),flush=True)

def ql_env(name):
    value=os.environ.get(name)
    if value is not None and value.strip():return value.strip()
    try:
        con=sqlite3.connect("file:"+str(DB)+"?mode=ro",uri=True)
        try:rows=con.execute("SELECT value FROM Envs WHERE name=? AND status=0",(name,)).fetchall()
        finally:con.close()
        return str(rows[0][0] or "").strip() if len(rows)==1 else ""
    except sqlite3.Error:return ""

def fetch_json(url,body=None,headers=None,timeout=16):
    raw=json.dumps(body,separators=(",",":"),ensure_ascii=False).encode() if body is not None else None
    req=request.Request(url,method="POST" if raw is not None else "GET",data=raw,
       headers={"Content-Type":"application/json","Accept":"application/json",
                "User-Agent":"Mozilla/5.0 AliDrive/3.0.0",**(headers or {})})
    try:
        with request.urlopen(req,timeout=timeout) as resp:
            status=resp.status
            data=json.loads(resp.read(70000))
    except error.HTTPError as exc:
        raise Failure("upstream_http_"+str(exc.code)) from None
    except (error.URLError,OSError,TimeoutError):
        raise Failure("upstream_network_error") from None
    except (ValueError,TypeError):
        raise Failure("upstream_non_json") from None
    if status!=200 or not isinstance(data,dict):
        raise Failure("upstream_unexpected_response")
    return data

def ql_api_token():
    try:
        con=sqlite3.connect("file:"+str(DB)+"?mode=ro",uri=True)
        try:rows=con.execute("SELECT client_id,client_secret FROM Apps WHERE name=?",(QL_APP,)).fetchall()
        finally:con.close()
    except sqlite3.Error:raise Failure("ql_app_database_unavailable") from None
    if len(rows)!=1:raise Failure("ql_app_unavailable")
    cid,secret=rows[0]
    if not cid or not secret:raise Failure("ql_app_invalid")
    data=fetch_json(QL_OPEN+"auth/token?"+parse.urlencode({
       "client_id":cid,"client_secret":secret}))
    token=(data.get("data") or {}).get("token")
    if not token or str(data.get("code")) not in ("0","200"):
        raise Failure("ql_app_auth_rejected")
    return token

def ql_api(method,path,token,body=None):
    if not (path.startswith("envs") and not path.startswith("envs/../")):
        raise Failure("ql_path_disallowed")
    raw=json.dumps(body,separators=(",",":"),ensure_ascii=False).encode() if body is not None else None
    req=request.Request(QL_OPEN+path,method=method,data=raw,
        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with request.urlopen(req,timeout=15) as resp:
            ans=json.loads(resp.read(60000))
    except (error.URLError,error.HTTPError,ValueError,TimeoutError,OSError):
        raise Failure("ql_api_unavailable") from None
    if not isinstance(ans,dict) or str(ans.get("code")) not in ("0","200"):
        raise Failure("ql_api_rejected")
    return ans.get("data")

def persist_refresh(token):
    if not ALLOWED_LENGTH.fullmatch(token):raise Failure("refresh_format_invalid")
    bearer=ql_api_token()
    rows=ql_api("GET","envs?searchValue="+REFRESH_ENV,bearer)
    if isinstance(rows,dict):rows=rows.get("data",[])
    if not isinstance(rows,list):raise Failure("ql_env_list_invalid")
    found=[r for r in rows if isinstance(r,dict) and r.get("name")==REFRESH_ENV]
    if len(found)!=1 or str(found[0].get("status")) not in ("0","None"):
        raise Failure("alipan_refresh_env_missing")
    row=found[0]
    if row.get("value")!=token:
        ql_api("PUT","envs",bearer,{"id":row["id"],"name":REFRESH_ENV,"value":token,
            "remarks":row.get("remarks") or "Aliyun Drive refresh (verified QX / YYB) auto-rotation"})
    check=ql_api("GET","envs?searchValue="+REFRESH_ENV,bearer)
    if isinstance(check,dict):check=check.get("data",[])
    if not isinstance(check,list) or len([r for r in check
       if isinstance(r,dict) and r.get("name")==REFRESH_ENV and r.get("value")==token])!=1:
        raise Failure("ql_refresh_persist_unverified")

def fingerprint(uid):
    if not isinstance(uid,str) or not 8<=len(uid)<=180:
        raise Failure("uid_invalid")
    return hashlib.sha256(("ALIPAN_UID_V1:"+uid).encode()).hexdigest()

def get_credential():
    fresh=ql_env(REFRESH_ENV)
    if ALLOWED_LENGTH.fullmatch(fresh):return fresh,"ql_refresh"
    legacy=ql_env("ALIYUN_ACCOUNTS").split("&",1)[0].split("#",1)[0].strip()
    if ALLOWED_LENGTH.fullmatch(legacy):return legacy,"legacy"
    raise Failure("refresh_token_missing")

def renew(refresh):
    data=fetch_json(AUTH_URL,{"grant_type":"refresh_token","app_id":ALI_APP,
                             "refresh_token":refresh},timeout=17)
    if "access_token" not in data:
        raise Failure("refresh_rejected")
    access=data.get("access_token")
    new_refresh=data.get("refresh_token")
    uid=data.get("user_id")
    if (not isinstance(access,str) or not 40<=len(access)<=5000 or
       not isinstance(new_refresh,str) or not ALLOWED_LENGTH.fullmatch(new_refresh)):
        raise Failure("refresh_response_invalid")
    pin=ql_env(PIN_ENV).lower()
    if not HEX64.fullmatch(pin):
        raise Failure("identity_pin_not_enrolled")
    if fingerprint(uid)!=pin:
        raise Failure("account_identity_mismatch")
    # Validate business identity as well as token response, before any activity submission.
    profile=fetch_json(PROFILE_URL,{},headers={"Authorization":"Bearer "+access})
    if (not profile.get("user_id") or profile.get("user_id")!=uid):
        raise Failure("refreshed_profile_mismatch")
    persist_refresh(new_refresh)
    return access,new_refresh

def sign(access):
    ans=fetch_json(MEMBER_URL,{"isReward":False},
      headers={"Authorization":"Bearer "+access},timeout=20)
    data=ans.get("result")
    if ans.get("success") is not True or not isinstance(data,dict):
        raise Failure("sign_business_rejected")
    count=data.get("signInCount")
    if type(count) is not int or not 0<=count<=31:
        raise Failure("sign_count_invalid")
    return count

def claim(access,day):
    if not isinstance(day,int) or day<1 or day>31:return "skipped"
    try:
        out=fetch_json(REWARD_URL,{"signInDay":day},
           headers={"Authorization":"Bearer "+access})
    except Failure:return "failed"
    return "claimed" if out.get("success") is True else "unconfirmed"

def load_state():
    try:
        doc=json.loads(STATE.read_text(encoding="utf-8"))
        return doc if isinstance(doc,dict) else {}
    except (FileNotFoundError,ValueError,OSError):return {}

def save_state(doc):
    CONF.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=".alipan-state-",dir=str(CONF))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump(doc,f,ensure_ascii=False,separators=(",",":"))
            f.flush();os.fsync(f.fileno())
        os.replace(temp,STATE)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def notify(message,success,once=True):
    """Use QingLong's existing notification system, not a new Bark endpoint."""
    try:
        from notify import send
        send("阿里云盘签到"+("成功" if success else "失败"),message)
        return "sent"
    except Exception:
        # Never dump exception bodies from notification plugins.
        return "unavailable"

def run(*,dry_run=False):
    now=today()
    CONF.mkdir(parents=True,exist_ok=True)
    with LOCK.open("a+") as fh:
        os.fchmod(fh.fileno(),0o600)
        fcntl.flock(fh.fileno(),fcntl.LOCK_EX)
        state=load_state()
        if state.get("day")==now and state.get("attempted") is True:
            if state.get("success"):
                report("skip",status="今日已签到",day=now,days=state.get("days"))
                return 0
            report("skip",status="签到失败",day=now,error="already_attempted_no_auto_retry")
            return 1
        if dry_run:
            report("dry_run",day=now,status="ready" if ALLOWED_LENGTH.fullmatch(ql_env(REFRESH_ENV)) else "missing_refresh",
                   auth="code_to_business_token_not_yet_verified")
            return 0
        try:
            refresh,source=get_credential()
            access,_=renew(refresh)
        except Failure as err:
            reason=err.code
            if reason in ("refresh_token_missing","refresh_rejected"):
                reason+=";yyb_wx_code_available_but_exchange_unverified"
            report("authentication",status="签到失败",day=now,error=reason)
            marker=state.get("error_notified_day")
            if marker!=now:
                result=notify("日期："+now+"\n阿里云盘授权失败："+reason+"\nYYB 取码已通过，业务兑换未验证；请检查 QX 自动授权采集。",False)
                save_state({"day":now,"error_notified_day":now,"last_error":reason})
                report("notification",status="failure",notify=result)
            return 1
        # Mark BEFORE mutating request; prevent duplicate sign-in on uncertain timeout.
        save_state({"day":now,"attempted":True,"success":False,"result":"unknown",
            "error_notified_day":state.get("error_notified_day")})
        try:
            days=sign(access)
        except Failure as err:
            result=notify("日期："+now+"\n签到接口未确认："+err.code+"\n为防重复，本日不自动重试。",False)
            save_state({"day":now,"attempted":True,"success":False,"result":"unconfirmed",
                "error_notified_day":now})
            report("sign",status="签到失败",day=now,error=err.code,notify=result)
            return 1
        reward="skipped"
        if os.environ.get("ALIPAN_AUTO_REWARD","1").strip()!="0":
            reward=claim(access,days)
        save_state({"day":now,"attempted":True,"success":True,"days":days,
                    "reward":reward,"source":source})
        result=notify("日期："+now+"\n✅ 签到成功，本月累计："+str(days)+" 天\n奖励："+reward+
                      "\n凭据："+source+"（已安全续期，不展示 Token）",True)
        report("sign",status="签到成功",day=now,days=days,auth=source,
               reward=reward,notify=result)
        return 0

def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--dry-run",action="store_true")
    opts=ap.parse_args(argv)
    try:return run(dry_run=opts.dry_run)
    except Exception:
        report("internal",status="签到失败",error="unexpected_internal_error")
        return 2

if __name__=="__main__":
    sys.exit(main())
