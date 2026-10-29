/* Quantumult X: continuous Quark cloud-drive mobile sign-in parameter capture.
 * Only extracts kps/sign/vcode from allowlisted user-owned Quark requests.
 * Never logs, echoes, or stores raw URLs/credential values in notifications.
 * Global capture is ENABLED by default; QL Disarm explicitly pauses it.
 */
'use strict';
const VERSION='2.0.0',P='qlcap_v1_';
const GATEWAY='https://qlcap.781751.xyz:58443';
const HOST='drive-m.quark.cn';
function read(k){return $prefs.valueForKey(P+k)||'';}
function save(k,v){return $prefs.setValueForKey(String(v),P+k);}
function notify(t,m){if(typeof $notify==='function')$notify('QL Cookie Capture v'+VERSION,t,m);}
let finished=false;
function end(){
  if(finished)return;
  finished=true;
  if(typeof $done==='function')$done({});
}
function fp(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function parseQuery(query){
  const out={};
  for(const part of query.split('&')){
    const i=part.indexOf('=');
    if(i<=0)continue;
    let name,val;
    try{name=decodeURIComponent(part.slice(0,i));val=decodeURIComponent(part.slice(i+1));}
    catch(e){continue;}
    if(name==='kps'||name==='sign'||name==='vcode'){
      if(out[name]!==undefined&&out[name]!==val)return null;
      out[name]=val;
    }
  }
  return out;
}
function valid(s){
  return typeof s==='string'&&s.length>=3&&s.length<=1200&&!/[;\r\n\x00]/.test(s);
}
function main(){
  if(read('armed')==='0'||read('quark_armed')==='0')return end();
  const req=typeof $request!=='undefined'?$request:null;
  if(!req||!req.url)return end();
  const method=String(req.method||'GET').toUpperCase();
  if(method!=='GET'&&method!=='POST')return end();
  const match=/^https:\/\/drive-m\.quark\.cn(\/1\/clouddrive\/(?:act\/growth\/reward|capacity\/growth\/(?:info|sign)))(?:\?([^#]*))?/i.exec(req.url);
  if(!match)return end();
  const params=parseQuery(match[2]||'');
  if(!params||!['kps','sign','vcode'].every(k=>valid(params[k]))){
    save('quark_last_result','参数缺失');return end();
  }
  save('quark_seen_at',new Date().toISOString());
  const server=read('url').replace(/\/+$/,'');
  const token=read('token');
  if(server!==GATEWAY||token.length<32){
    save('quark_last_result','网关未初始化');return end();
  }
  const fingerprint=fp('quark\0'+params.kps+'\0'+params.sign+'\0'+params.vcode);
  const last=Number(read('quark_sent_at'))||0;
  if(read('quark_fp')===fingerprint&&Date.now()-last<12*3600*1000)return end();
  const event={service:'quark',url:'https://'+HOST+match[1],
      captured_at:Date.now(),
      cookies:{kps:params.kps,sign:params.sign,vcode:params.vcode}};
  let timer=null;
  timer=setTimeout(()=>{save('quark_last_result','超时');end();},3200);
  try{
    $task.fetch({url:server+'/api/v1/capture',method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(event),opts:{policy:'direct'}}).then(response=>{
        if(finished)return;
        clearTimeout(timer);
        const code=Number(response.statusCode||response.status||0);
        let data={};
        try{data=JSON.parse(response.body||'{}');}catch(e){}
        if(code===200&&['synced','unchanged','dry_run'].includes(data.status)){
          save('quark_fp',fingerprint);
          save('quark_sent_at',Date.now());
          save('quark_synced_at',new Date().toISOString());
          save('quark_last_result',data.status+(data.rerun==='queued'?'/任务已补跑':''));
          if(data.status==='synced')notify('夸克凭据已更新',data.rerun==='queued'?'青龙任务已自动补跑一次':'已写入 COOKIE_QUARK');
          else if(data.status==='dry_run')notify('夸克测试抓取成功','服务端测试模式，没有写入青龙');
        }else{
          save('quark_last_result','HTTP '+code);
          if(code===409)notify('夸克账号映射待配置','检测到多个夸克账号，未覆盖任何凭据');
          else if(code===422)notify('夸克凭据未通过校验','保持青龙原凭据不变');
        }
        end();
      }).catch(()=>{if(finished)return;clearTimeout(timer);save('quark_last_result','网络不可达');end();});
  }catch(e){if(timer)clearTimeout(timer);save('quark_last_result','提交异常');end();}
}
try{main();}catch(e){end();}
