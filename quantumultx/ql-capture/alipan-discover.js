/* QX Aliyun Drive Mini Program: endpoint discovery only.
 * Request/response HEADER hooks only; do not read or transmit body, Cookie,
 * Authorization values, tokens, IDs or query values.
 * Sends only allowlisted host/path and field names to user's private gateway.
 */
'use strict';
const PREF='qlcap_v1_',GATEWAY='https://qlcap.781751.xyz:58443';
const WINDOW_MS=45*60*1000, BUILD='20261118-104';
function get(k){return $prefs.valueForKey(PREF+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),PREF+k);}
function done(){$done({});}
function hostAllowed(host){
  // Observed in Stream from the user's Aliyun Drive miniapp.
  // Storage CDN and aliapp.org are exact hosts, not broad domain wildcards.
  return /^(?:[a-z0-9-]+\.)*(?:alipan|aliyundrive)\.com$/.test(host) ||
    host==='cn-beijing-data.aliyundrive.net' ||
    host==='ynuf.aliapp.org';
}
function parsed(raw){
  const m=/^https:\/\/([a-z0-9.-]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(String(raw||''));
  if(!m)return null;
  const host=m[1].toLowerCase();
  if(!hostAllowed(host))return null;
  const parts=String(m[2]||'/').split('/').map(x=>{
    if(!x)return '';
    if(x.length>30||!/^[a-zA-Z0-9_.-]+$/.test(x)
       ||/[0-9a-f]{16,}/i.test(x)||/\d{6,}/.test(x))return '_id_';
    return x;
  });
  const path=parts.join('/').slice(0,180)||'/';
  const query=[],seen=new Set();
  for(const item of String(m[3]||'').split('&')){
    const key=item.split('=')[0];
    if(/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(key)&&!seen.has(key)&&query.length<40){
      seen.add(key);query.push(key);
    }
  }
  return {host,path,query};
}
function headerNames(headers){
  return Object.keys(headers||{}).filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)).slice(0,40);
}
function header(headers,name){
  const k=Object.keys(headers||{}).find(x=>x.toLowerCase()===name);
  return k?String(headers[k]).slice(0,500):'';
}
function appID(headers){
  const referer=header(headers,'referer');
  let match=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(referer);
  if(match)return {id:match[1].toLowerCase(),source:'referer'};
  match=/(?:miniProgram|wxapp)[^\w]{0,30}(wx[0-9a-f]{16})/i.exec(header(headers,'user-agent'));
  return match?{id:match[1].toLowerCase(),source:'user_agent'}:{id:null,source:null};
}
function hash(s){
 let h=2166136261;
 for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(16);
}
function main(){
 if(get('armed')==='0'||get('alipan_probe_armed')==='0')return done();
 const req=(typeof $request!=='undefined'&&$request)||{};
 const res=(typeof $response!=='undefined'&&$response)||null;
 const url=parsed(req.url);
 if(!url)return done();
 const now=Date.now();
 put('alipan_probe_hit_at',new Date(now).toISOString());
 put('alipan_probe_last_host',url.host);
 const day=new Date(now).toISOString().slice(0,10);
 let start=Number(get('alipan_probe_started_ms'))||0;
 if(get('alipan_probe_day')!==day || get('alipan_probe_build')!==BUILD){
   put('alipan_probe_build',BUILD);
   put('alipan_probe_day',day);
   start=now;
   put('alipan_probe_started_ms',start);
   put('alipan_probe_seen','');
 }
 if(now-start>WINDOW_MS)return done();
 const method=String(req.method||'GET').toUpperCase();
 if(method!=='GET'&&method!=='POST')return done();
 const stage=res?'response_headers':'request_headers';
 const rawStatus=res&&res.statusCode!=null?Number(res.statusCode):null;
 const status=rawStatus!=null&&Number.isInteger(rawStatus)&&rawStatus>=0&&rawStatus<=599
   ?rawStatus:null;
 const fp=hash([url.host,url.path,method,stage,status,Math.floor(now/600000)].join('|'));
 const seen=get('alipan_probe_seen').split(',').filter(Boolean);
 if(seen.includes(fp))return done();
 const host=get('url').replace(/\/+$/,''),token=get('token');
 if(host!==GATEWAY||token.length<32){
   put('alipan_probe_last_result','gateway_not_configured');
   return done();
 }
 const app=appID(req.headers);
 const payload={v:1,type:'qx_structure_v1',host:url.host,path:url.path,method,stage,
  query_keys:url.query,header_keys:headerNames(stage==='request_headers'?req.headers:res.headers),
  body_keys:[],body_length:null,status,wx_appid:app.id,wx_appid_source:app.source};
 let ended=false;
 function exit(ok,reason){
  if(ended)return;ended=true;
  put('alipan_probe_last_result',ok?'uploaded':reason||'failed');
  if(ok){
    put('alipan_probe_seen',seen.concat(fp).slice(-80).join(','));
    put('alipan_probe_last_at',new Date().toISOString());
    if(get('alipan_probe_first_success')!==day){
      put('alipan_probe_first_success',day);
      if(typeof $notify==='function')
        $notify('阿里云盘小程序诊断','已收到接口结构',
          '仅上传域名、脱敏路径、字段名和公开 AppID，不含 Token。');
    }
  }
  done();
 }
 const timer=setTimeout(()=>exit(false,'timeout'),2300);
 try{
  $task.fetch({url:GATEWAY+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)}).then(response=>{
     clearTimeout(timer);
     const ok=Number(response.statusCode||response.status||0)===200;
     exit(ok,ok?'uploaded':'upload_http_error');
   }).catch(()=>{clearTimeout(timer);exit(false,'network_error');});
 }catch(_){clearTimeout(timer);exit(false,'fetch_exception');}
}
try{main();}catch(_){done();}
