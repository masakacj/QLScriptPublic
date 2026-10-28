/* 中国移动 APP QWHD_SESSION_TOKEN: exact-domain, exact-path QX request-header.
 * Only runs in the explicit server-authorized 10-minute capture window.
 * Never logs or locally persists the cookie value.
 */
'use strict';
const P='qlcap_v1_',HOST='wx.10086.cn',GATEWAY='https://qlcap.781751.xyz:58443';
function read(k){return $prefs.valueForKey(P+k)||'';}
function end(){$done({});}
try{
 const req=typeof $request!=='undefined'?$request:null;
 if(!req||!/^https:\/\/wx\.10086\.cn\/qwhdhub\/api\//i.test(req.url||'')||
    read('armed')!=='1'||Number(read('trace_until'))<=Date.now()||read('trace_host')!==HOST)return end();
 const hs=req.headers||{};
 const key=Object.keys(hs).find(k=>k.toLowerCase()==='cookie');
 const raw=key?String(hs[key]):'';
 const m=/(?:^|;\s*)QWHD_SESSION_TOKEN=([^;\s]+)/.exec(raw);
 if(!m||m[1].length<12||m[1].length>4096)return end();
 const server=read('url').replace(/\/+$/,''),token=read('token');
 if(server!==GATEWAY||token.length<32)return end();
 const event={v:1,stage:'request_headers',origin:'qx-china-mobile',
    url:req.url,
    method:'POST',at:Date.now(),session_index:'mobile-'+Date.now(),
    headers:{Cookie:'QWHD_SESSION_TOKEN='+m[1]}};
 $task.fetch({url:server+'/trace/v1/ingest',method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(event),opts:{policy:'direct'}}).then(r=>{
      const code=Number(r.statusCode||r.status||0);
      $prefs.setValueForKey(code===200?'success':'HTTP '+code,P+'chinaMobile_last_result');
      end();
    }).catch(()=>{$prefs.setValueForKey('network-error',P+'chinaMobile_last_result');end();});
}catch(e){end();}
