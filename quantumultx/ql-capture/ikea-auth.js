/* IKEA: strictly scoped mobile bearer capture, no response bodies or PII.
 * Uploads solely an authenticated Authorization header to OWN qlcap gateway.
 * No token is written to QX preferences, messages, console or GitHub.
 */
'use strict';
const PREF='qlcap_v1_',HOST='https://qlcap.781751.xyz:58443';
function get(k){return $prefs.valueForKey(PREF+k)||'';}
function set(k,v){return $prefs.setValueForKey(String(v),PREF+k);}
function finish(){if(typeof $done==='function')$done({});}
function tokenFrom(h){
 const name=Object.keys(h||{}).find(x=>x.toLowerCase()==='authorization');
 const v=name?String(h[name]).trim():'';
 return /^Bearer [A-Za-z0-9._~+/-]{32,1100}={0,2}$/.test(v)?v:'';
}
function hash(s){
 let h=2166136261;
 for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(16);
}
function main(){
 if(get('armed')==='0'||get('ikea_auth_armed')==='0')return finish();
 const req=(typeof $request!=='undefined'&&$request)||{};
 const url=String(req.url||'');
 if(!/^https:\/\/bff\.app\.ikea\.cn\/customer-bff\/v3\.0\/activity(?:[/?]|$)/i.test(url))return finish();
 if(String(req.method||'').toUpperCase()!=='GET')return finish();
 const auth=tokenFrom(req.headers);
 if(!auth)return finish();
 const fingerprint=hash(auth);
 if(get('ikea_auth_last_hash')===fingerprint)return finish();
 if(get('url').replace(/\/+$/,'')!==HOST||get('token').length<32)return finish();
 let ended=false;
 function done(ok){
  if(ended)return;ended=true;
  if(ok){
   set('ikea_auth_last_hash',fingerprint);
   set('ikea_auth_last_sync',new Date().toISOString());
   if(typeof $notify==='function')$notify('宜家登录凭据已同步','已保存至青龙','签到任务可以在次日自动使用，具体令牌内容不会显示。');
  }
  finish();
 }
 const tid=setTimeout(()=>done(false),2400);
 try{
  $task.fetch({url:HOST+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
   headers:{Authorization:'Bearer '+get('token'),'Content-Type':'application/json'},
   body:JSON.stringify({v:1,type:'ikea_auth_v1',service:'ikea',url:'https://bff.app.ikea.cn/customer-bff/v3.0/activity',
    captured_at:Date.now(),cookies:{Authorization:auth}})
  }).then(r=>{
   clearTimeout(tid);
   const status=Number(r.statusCode||r.status||0);
   let body={};try{body=JSON.parse(r.body||'{}');}catch(_){}
   done(status===200&&['synced','unchanged'].includes(body.status)&&body.service==='ikea');
  }).catch(()=>{clearTimeout(tid);done(false);});
 }catch(_){clearTimeout(tid);done(false);}
}
try{main();}catch(_){finish();}
