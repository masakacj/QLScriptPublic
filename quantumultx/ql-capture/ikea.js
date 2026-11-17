/* IKEA Mini Program API discovery for Quantumult X.
 * Request/response HEADER hooks only. No Cookie, Authorization, query values,
 * request body, response body, shopping data, or private identifiers uploaded.
 * Stops after a single 30-minute capture window (from the first IKEA request).
 * Existing QL credential gateway and BYD/SF/Quark hooks are untouched.
 */
'use strict';
const VERSION='1.0.0', PREFIX='qlcap_v1_';
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
  let started=Number(pref('ikea_capture_started_ms'))||0;
  if(!started){
    started=now;save('ikea_capture_started_ms',now);
  }
  if(now-started>HALF_HOUR_MS)return finish();
  const stage=res?'response_headers':'request_headers';
  const method=String(req.method||'GET').toUpperCase();
  if(method!=='GET'&&method!=='POST')return finish();
  const rawStatus=res&&res.statusCode!==undefined?Number(res.statusCode):null;
  const status=rawStatus!==null&&Number.isFinite(rawStatus)&&rawStatus>=0&&rawStatus<=599?rawStatus:null;
  const fp=hash([target.host,target.path,stage,method,status].join('|'));
  const seen=pref('ikea_sent_fingerprints').split(',').filter(Boolean);
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
      save('ikea_sent_fingerprints',seen.concat(fp).slice(-80).join(','));
      save('ikea_last_event_at',new Date().toISOString());
      if(pref('ikea_first_success')!=='1'){
        save('ikea_first_success','1');
        if(typeof $notify==='function')
          $notify('宜家小程序采集','已收到请求结构','仅包含域名、脱敏路径、请求方法和字段名；30 分钟后自动停止。');
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
