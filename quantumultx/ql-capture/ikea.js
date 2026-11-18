/* IKEA Mini Program API discovery for Quantumult X.
 * Request/response HEADER hooks only. No Cookie, Authorization, query values,
 * request body, response body, shopping data, or private identifiers uploaded.
 * General discovery stops after 30 minutes; login metadata remains bounded.
 * On the one opted-in CIAM member GET route, a separate authenticated
 * Token-only sync may send Authorization to the user's private gateway.
 * Existing QL credential gateway and BYD/SF/Quark hooks are untouched.
 */
'use strict';
const VERSION='1.2.0', PREFIX='qlcap_v1_';
const SERVER='https://qlcap.781751.xyz:58443';
const HALF_HOUR_MS=30*60*1000;
function pref(name){return $prefs.valueForKey(PREFIX+name)||'';}
function save(name,val){return $prefs.setValueForKey(String(val),PREFIX+name);}
function finish(){if(typeof $done==='function')$done({});}
function parse(input){
  const match=/^https:\/\/([a-z0-9.-]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(String(input||''));
  if(!match)return null;
  const host=match[1].toLowerCase();
  if(host!=='ikea.cn'&&!/^[a-z0-9.-]+\.ikea\.cn$/.test(host))return null;
  const segments=String(match[2]||'/').split('/');
  const cleaned=segments.map(s=>{
    if(!s)return '';
    if(s.length>32||!/^[a-zA-Z0-9_.-]+$/.test(s)||/\d{6,}|[a-f0-9]{16,}/i.test(s))return '_id_';
    return s;
  });
  const path=cleaned.join('/').slice(0,180)||'/';
  const keys=[],seen={};
  for(const pair of String(match[3]||'').split('&')){
    const name=pair.split('=')[0];
    if(/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(name)&&!seen[name]&&keys.length<40){
      keys.push(name);seen[name]=true;
    }
  }
  return {host,path,keys};
}
function headerKeys(obj){
  return Object.keys(obj||{}).filter(s=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(s)).slice(0,40);
}
function getHeader(obj,name){
  const key=Object.keys(obj||{}).find(x=>x.toLowerCase()===name);
  return key?String(obj[key]).slice(0,512):'';
}
function wxAppId(obj){
  const headers=obj||{};
  const referer=getHeader(headers,'referer');
  const a=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(referer);
  if(a)return {id:a[1].toLowerCase(),source:'referer'};
  const ua=getHeader(headers,'user-agent');
  const b=/(?:miniProgram|wxapp)[^\w]{0,30}(wx[0-9a-f]{16})/i.exec(ua);
  if(b)return {id:b[1].toLowerCase(),source:'user_agent'};
  return {id:null,source:null};
}
function hash(s){
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}
function main(){
  if(pref('armed')==='0'||pref('ikea_armed')==='0')return finish();
  const req=(typeof $request!=='undefined'&&$request)||{};
  const res=(typeof $response!=='undefined'&&$response)||null;
  const target=parse(req.url);
  if(!target)return finish();
  const now=Date.now();
  // Login and auth metadata remain observable even when the general
  // 30-minute discovery expires. No header/body/query values are uploaded.
  const loginMeta=/(?:^|\/)(?:login|logout|auth|oauth|token|session|wechat|ciam)(?:\/|$|[-_])/i.test(target.path);
  let started=Number(pref('ikea_capture_started_ms'))||0;
  if(!started){
    started=now;save('ikea_capture_started_ms',now);
  }
  if(!loginMeta&&now-started>HALF_HOUR_MS)return finish();
  const stage=res?'response_headers':'request_headers';
  const method=String(req.method||'GET').toUpperCase();
  if(method!=='GET'&&method!=='POST')return finish();
  const rawStatus=res&&res.statusCode!==undefined?Number(res.statusCode):null;
  const status=rawStatus!==null&&Number.isFinite(rawStatus)&&rawStatus>=0&&rawStatus<=599?rawStatus:null;
  // Backup: the generic hook is known to run on this exact CIAM member GET.
  // It sends only the selected Authorization value to the private collector.
  if(target.host==='ciam.family.ikea.cn' &&
     target.path==='/ciam/crbff/profile/auth/customer/profile/get' &&
     stage==='request_headers' && method==='GET' && pref('ikea_auth_armed')!=='0'){
    const h=req.headers||{};
    const k=Object.keys(h).find(k=>k.toLowerCase()==='authorization');
    const auth=k?String(h[k]).trim():'';
    if(!/^Bearer [A-Za-z0-9._~+/-]{32,1100}={0,2}$/.test(auth)){
      save('ikea_auth_last_diagnostic',k?'unrecognized_authorization_format':'authorization_absent');
    }else if(pref('ikea_auth_last_hash')!==hash(auth)){
      const gtoken=pref('token'),gurl=pref('url').replace(/\/+$/,'');
      if(gurl===SERVER && gtoken.length>=32){
        let completed=false;
        function doneAuth(ok){
          if(completed)return;completed=true;
          save('ikea_auth_last_diagnostic',ok?'synced':'upload_failed');
          if(ok){
            save('ikea_auth_last_hash',hash(auth));
            save('ikea_auth_last_sync',new Date().toISOString());
            if(typeof $notify==='function')
              $notify('宜家授权已同步','会员资料接口','已写入青龙专用变量，不显示凭据内容。');
          }
          finish();
        }
        const timer=setTimeout(()=>doneAuth(false),2300);
        try{
          $task.fetch({url:SERVER+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
            headers:{Authorization:'Bearer '+gtoken,'Content-Type':'application/json'},
            body:JSON.stringify({v:1,type:'ikea_auth_v1',service:'ikea',
              url:'https://ciam.family.ikea.cn/ciam/crbff/profile/auth/customer/profile/get',
              captured_at:Date.now(),cookies:{Authorization:auth}})
          }).then(resp=>{
            clearTimeout(timer);
            let data={};try{data=JSON.parse(resp.body||'{}');}catch(_){}
            doneAuth(Number(resp.statusCode||resp.status||0)===200 &&
              data.service==='ikea' && ['synced','unchanged'].includes(data.status));
          }).catch(()=>{clearTimeout(timer);doneAuth(false);});
        }catch(_){clearTimeout(timer);doneAuth(false);}
        return;
      }
    }
  }
  const key=loginMeta?'ikea_login_meta_fingerprints':'ikea_sent_fingerprints';
  // For login paths capture once per 10-minute window. Do not collect values.
  const bucket=loginMeta?Math.floor(now/600000):0;
  const fp=hash([target.host,target.path,stage,method,status,bucket].join('|'));
  const seen=pref(key).split(',').filter(Boolean);
  if(seen.includes(fp))return finish();
  const wx=wxAppId(req.headers);
  const payload={
    v:1,type:'qx_structure_v1',
    host:target.host,path:target.path,method,stage,
    query_keys:target.keys,header_keys:headerKeys(stage==='request_headers'?req.headers:res.headers),
    body_keys:[],body_length:null,status,
    wx_appid:wx.id,wx_appid_source:wx.source
  };
  const token=pref('token'),server=pref('url').replace(/\/+$/,'');
  if(server!==SERVER||token.length<32)return finish();
  let done=false;
  function end(ok){
    if(done)return;done=true;
    if(ok){
      save(key,seen.concat(fp).slice(-80).join(','));
      save('ikea_last_event_at',new Date().toISOString());
      if(loginMeta){
        save('ikea_login_meta_at',new Date().toISOString());
        if(pref('ikea_login_meta_first_success')!=='1'){
          save('ikea_login_meta_first_success','1');
          if(typeof $notify==='function')
            $notify('宜家登录诊断','已记录登录接口结构','仅脱敏路径、请求方法和字段名，不含 Token。');
        }
      }else if(pref('ikea_first_success')!=='1'){
        save('ikea_first_success','1');
        if(typeof $notify==='function')
          $notify('宜家小程序采集','已收到请求结构','仅域名、脱敏路径、方法和字段名；普通采集 30 分钟后停止。');
      }
    }
    finish();
  }
  const timer=setTimeout(()=>end(false),1800);
  try{
    $task.fetch({
      url:SERVER+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(reply=>{
      clearTimeout(timer);
      const code=Number(reply.statusCode||reply.status||0);
      end(code===200);
    }).catch(()=>{clearTimeout(timer);end(false);});
  }catch(_){clearTimeout(timer);end(false);}
}
try{main();}catch(_){finish();}
