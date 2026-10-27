/* QX: explicit SF request/response header capture. Do not log headers or secrets. */
'use strict';
const V='1.2.0',P='qlcap_v1_';
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
function main(){
 log('hook triggered');
 if(get('armed')!=='1'){log('skipped: not armed');return done();}
 const server=get('url').replace(/\/+$/,''),token=get('token');
 if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){log('skipped: setup absent');return done();}
 const source=(typeof $request!=='undefined'&&$request&&$request.url)||'';
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
 if(last[0]===fp&&Date.now()-Number(last[1]||0)<1800000){log('skipped: recently sent');return done();}
 const payload={service:'sf',url:'https://'+sf.host+m[2],captured_at:Date.now(),cookies};
 log('submitting allowlisted fields to gateway');
 $task.fetch({url:server+'/api/v1/capture',method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(payload),opts:{policy:'direct'}}).then(r=>{
   const code=Number(r.statusCode||r.status||0);log('gateway HTTP '+code);
   let body={};try{body=JSON.parse(r.body||'{}');}catch(e){log('response JSON invalid');}
   if(code===200&&['synced','unchanged','dry_run'].includes(body.status)){
    if(body.status!=='dry_run')put('sent_sf',fp+'|'+Date.now());
    put('armed','0');
    note('顺丰 '+body.status,body.status==='dry_run'?'测试捕获成功，青龙未修改':'接收确认，已关闭采集');
   }else note('网关拒绝','HTTP '+code+'；旧青龙值保持不变');
   done();
 }).catch(()=>{note('上传失败','HTTPS 连接失败；未修改青龙');done();});
}
try{main();}catch(e){log('script exception; details withheld');done();}
