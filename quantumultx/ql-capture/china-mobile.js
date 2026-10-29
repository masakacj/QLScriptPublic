/* QX China Mobile: default-on local QWHD_SESSION_TOKEN capture.
 * YYB independently refreshes the QingLong mobile sign-in, so this hook
 * stores the candidate only in QX preferences. No automatic QL replacement.
 * Optional private trace upload still requires explicit debug window.
 */
'use strict';
const V='2.0.0',P='qlcap_v1_',HOST='wx.10086.cn';
const GATEWAY='https://qlcap.781751.xyz:58443';
function read(k){return $prefs.valueForKey(P+k)||'';}
function save(k,v){return $prefs.setValueForKey(String(v),P+k);}
function end(){$done({});}
function main(){
  if(read('armed')==='0')return end();
  const req=typeof $request!=='undefined'?$request:null;
  if(!req||String(req.method||'').toUpperCase()!=='POST')return end();
  const match=/^https:\/\/wx\.10086\.cn\/qwhdhub\/api\/mark\/(?:mark31\/domark|do\/mark|info\/prizeInfo)(?:\?|$)/i;
  if(!match.test(req.url||''))return end();
  const hs=req.headers||{};
  const key=Object.keys(hs).find(k=>k.toLowerCase()==='cookie');
  const raw=key?String(hs[key]):'';
  const m=/(?:^|;\s*)QWHD_SESSION_TOKEN=([^;\s]+)/.exec(raw);
  if(!m||m[1].length<12||m[1].length>4096)return end();
  save('chinaMobile_seen_at',new Date().toISOString());
  if(read('chinaMobile_cookie')!==m[1]){
    save('chinaMobile_cookie',m[1]);
    save('chinaMobile_last_result','已捕获到本地 Cookie');
    if(typeof $notify==='function')$notify('青龙采集 v'+V,'中国移动 Cookie 已获取','已保存于 QX 本地；青龙仍由 YYB 自动登录');
  }
  if(read('trace_host')!==HOST || Number(read('trace_until'))<=Date.now())return end();
  // The raw-debug collector retains its original bounded, explicitly armed mode.
  if(!/^https:\/\/wx\.10086\.cn\/qwhdhub\/api\/mark\/mark31\/domark(?:\?|$)/i.test(req.url||''))return end();
  const server=read('url').replace(/\/+$/,'');
  const token=read('token');
  if(server!==GATEWAY||token.length<32)return end();
  const event={v:1,stage:'request_headers',origin:'qx-china-mobile',
    url:req.url,method:'POST',at:Date.now(),
    session_index:'mobile-'+Date.now(),
    headers:{Cookie:'QWHD_SESSION_TOKEN='+m[1]}};
  $task.fetch({url:server+'/trace/v1/ingest',method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(event),opts:{policy:'direct'}}).then(r=>{
    const code=Number(r.statusCode||r.status||0);
    save('chinaMobile_trace_result',code===200?'success':'HTTP '+code);
    end();
  }).catch(()=>{save('chinaMobile_trace_result','网络异常');end();});
}
try{main();}catch(e){end();}
