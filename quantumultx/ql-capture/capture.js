/* QX: explicit SF request/response header capture. Do not log headers or secrets. */
'use strict';
const V='1.4.1',P='qlcap_v1_';
const sf={host:'mcs-mimp-web.sf-express.com',paths:['/mcs-mimp/','/home','/superWelfare'],
 names:['sessionId','_login_mobile_','_login_user_id_']};
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Capture v'+V+'] '+x);}
function get(k){return $prefs.valueForKey(P+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),P+k);}
function done(){log('finish');$done({});}
function header(o,n){const k=Object.keys(o||{}).find(x=>x.toLowerCase()===n);return k?String(o[k]):'';}
function extract(s){
 const out={};for(const n of sf.names){
  const m=new RegExp('(?:^|[;,]\\s*)'+n+'=([^;\\r\\n,]+)','i').exec(s||'');
  if(m&&m[1])out[n]=m[1].trim();
 }return out;
}
function complete(c){return sf.names.every(n=>typeof c[n]==='string'&&c[n].length>0);}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function note(title,message){log(title);if(typeof $notify==='function')$notify('青龙采集 v'+V,title,message);}
function captureByd(url){
 if(get('armed')==='0' || get('bydhy_armed')==='0'){log('BYD capture paused');return done();}
 const login=/^https:\/\/mina\.bydoceanauto\.com\/\?service=mina\.decryptCode(?:&|$)/i.test(url);
 const signing=/^https:\/\/mina\.bydoceanauto\.com\/\?s=ForCommonUcSrv\.forward&serviceDir=activity\/sign\/signIn(?:&|$)/i.test(url);
 if(!login&&!signing)return done();
 const method=String(($request&&$request.method)||'').toUpperCase();
 if(method&&method!=='POST')return done();
 // Sign-in request body already contains the AES-encrypted session_id.
 // Capture the outgoing body before the server handles the daily sign; do not replay it.
 const body=String(signing?($request&&$request.body||''):(typeof $response!=='undefined'&&$response?$response.body:'')||'').trim();
 if(!body||body.length>16384||!/^[A-Za-z0-9+/=]+$/.test(body)){
  note('比亚迪加密数据格式不匹配','检查 QX 请求体及重写命中情况');return done();
 }
 if(get('bydhy_enc')===body){log('BYD response unchanged');return done();}
 const saved=put('bydhy_enc',body);
 if(saved){
  put('bydhy_at',new Date().toISOString());
  note('比亚迪凭据候选已保存',signing?'签到请求已捕获，QX 本地保存；未重放签到，也未同步青龙':'登录响应已捕获，QX 本地保存；未同步青龙');
 }else note('比亚迪保存失败','未修改青龙');
 done();
}
function main(){
 log('hook triggered');
 const source=(typeof $request!=='undefined'&&$request&&$request.url)||'';
 if(/^https:\/\/mina\.bydoceanauto\.com\//i.test(source))return captureByd(source);
 if(get('armed')==='0'){log('skipped: capture paused');return done();}
 const server=get('url').replace(/\/+$/,''),token=get('token');
 if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){log('skipped: setup absent');return done();}
 const m=/^https:\/\/([^/?#]+)(\/[^?#]*)/i.exec(source);
 if(!m||m[1].toLowerCase()!==sf.host||!sf.paths.some(p=>m[2].startsWith(p))){
  log('skipped: source not on allowlist');return done();
 }
 const req=extract(header(($request||{}).headers,'cookie'));
 const rsp=typeof $response==='undefined'?{}:extract(header($response.headers,'set-cookie'));
 const cookies=complete(req)?req:rsp;
 if(!complete(cookies)){log('matched SF; required fields missing');return done();}
 log('matched SF; required fields present');
 const fp=hash(sf.names.map(k=>k+'='+cookies[k]).join('\0'));
 const last=get('sent_sf').split('|');
 if(last[0]===fp){log('skipped: recently sent');return done();}
 const payload={service:'sf',url:'https://'+sf.host+m[2],captured_at:Date.now(),cookies};
 log('submitting allowlisted fields to gateway');
 $task.fetch({url:server+'/api/v1/capture',method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(payload),opts:{policy:'direct'}}).then(r=>{
   const code=Number(r.statusCode||r.status||0);log('gateway HTTP '+code);
   let body={};try{body=JSON.parse(r.body||'{}');}catch(e){log('response JSON invalid');}
   if(code===200&&['synced','unchanged','dry_run'].includes(body.status)){
    put('sent_sf',fp+'|'+Date.now());
    if(body.status==='dry_run')note('顺丰 Cookie 获取成功','测试模式 · 已收到凭证，未写入青龙');
    else if(body.rerun==='queued')note('顺丰 Cookie 已刷新','青龙过期任务已补跑一次，等待执行结果');
    else if(body.status==='synced')note('顺丰 Cookie 同步成功','已更新青龙对应账号');
    else note('顺丰 Cookie 已是最新','青龙无需更新');
   }else note('网关拒绝','HTTP '+code+'；旧青龙值保持不变');
   done();
 }).catch(()=>{note('上传失败','HTTPS 连接失败；未修改青龙');done();});
}
try{main();}catch(e){log('script exception; details withheld');done();}
