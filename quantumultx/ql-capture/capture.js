/* QL Capture / Quantumult X. Public code; never insert tokens here. */
'use strict';
const BASE='qlcap_v1_';
const sf={id:'sf',host:'mcs-mimp-web.sf-express.com',paths:['/mcs-mimp/','/home','/superWelfare'],names:['sessionId','_login_mobile_','_login_user_id_']};
const get=k=>$prefs.valueForKey(BASE+k)||'';
const set=(k,v)=>$prefs.setValueForKey(String(v),BASE+k);
function finish(){ $done({}); }
function header(h,k){const x=Object.keys(h||{}).find(s=>s.toLowerCase()===k.toLowerCase());return x?String(h[x]):'';}
function extract(raw){const out={};for(const name of sf.names){const key=name.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g,'\\$&');const found=new RegExp('(?:^|[;,]\\s*)'+key+'=([^;\\r\\n,]+)','i').exec(raw||'');if(found&&found[1])out[name]=found[1].trim();}return out;}
function valid(x){return sf.names.every(k=>typeof x[k]==='string'&&x[k].length>0);}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function notify(t,m){if(typeof $notify==='function')$notify('青龙凭证采集',t,m);}
function main(){
 if(get('armed')!=='1')return finish();
 const url=get('url').replace(/\/+$/,'');const token=get('token');
 if(!/^https:\/\/[^/]+$/i.test(url)||token.length<32)return finish();
 const m=/^https:\/\/([^/?#]+)(\/[^?#]*)/i.exec(($request||{}).url||'');
 if(!m||m[1].toLowerCase()!==sf.host||!sf.paths.some(p=>m[2].startsWith(p)))return finish();
 const a=extract(header(($request||{}).headers,'cookie'));
 const b=typeof $response==='undefined'?{}:extract(header($response.headers,'set-cookie'));
 const cookies=valid(a)?a:b;if(!valid(cookies))return finish();
 const fp=hash(sf.names.map(k=>k+'='+cookies[k]).join('\0'));
 const last=get('sent_sf').split('|');if(last[0]===fp&&Date.now()-Number(last[1]||0)<1800000)return finish();
 const payload={service:'sf',url:'https://'+sf.host+m[2],captured_at:Date.now(),cookies};
 $task.fetch({url:url+'/api/v1/capture',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),opts:{policy:'direct'}}).then(r=>{
 let body={};try{body=JSON.parse(r.body||'{}');}catch(e){}
 if(r.statusCode===200&&['synced','unchanged','dry_run'].includes(body.status)){if(body.status!=='dry_run')set('sent_sf',fp+'|'+Date.now());set('armed','0');notify('顺丰',body.status==='dry_run'?'测试捕获成功；未修改青龙':'青龙更新已确认；采集已关闭');}
 else notify('顺丰','接收端未确认成功；旧值保持不变');
 finish();
 }).catch(()=>{notify('顺丰','接收端连接失败，请检查 HTTPS');finish();});
}
try{main();}catch(e){finish();}
