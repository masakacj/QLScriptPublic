/* QX IKEA WeChat login schema diagnosis; values remain on iPhone.
 * ONLY POST /customer-bff/v1.0/customer/auth/wechat.
 * Uploads request/response key NAMES, public AppID, approved Source channel, status.
 * Does NOT upload login code, tokens, cookies, body content, URLs with queries.
 */
'use strict';
const P='qlcap_v1_';
const API='https://qlcap.781751.xyz:58443/trace/v1/ingest';
const ALLOWED='https://qlcap.781751.xyz:58443';
const ROUTE='/customer-bff/v1.0/customer/auth/wechat';
function get(k){return $prefs.valueForKey(P+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),P+k);}
function finish(stage){
 const x=stage==='req'?($request||{}):((typeof $response!=='undefined'&&$response)||{});
 if(typeof x.body==='string')return $done({body:x.body});
 if(x.bodyBytes)return $done({bodyBytes:x.bodyBytes});
 $done({});
}
function header(headers,name){
 const k=Object.keys(headers||{}).find(x=>x.toLowerCase()===name);
 return k?String(headers[k]).slice(0,450):'';
}
function keyNames(body){
 if(typeof body!=='string'||body.length>250000)return [];
 let obj;try{obj=JSON.parse(body);}catch(e){return [];}
 if(!obj||Array.isArray(obj)||typeof obj!=='object')return [];
 let all=Object.keys(obj);
 if(obj.data&&typeof obj.data==='object'&&!Array.isArray(obj.data)){
  all=all.concat(Object.keys(obj.data).map(x=>'data.'+x));
 }
 return all.filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)).slice(0,40);
}
function appId(headers){
 const ref=header(headers,'referer');
 let m=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(ref);
 if(m)return {id:m[1].toLowerCase(),source:'referer'};
 const ua=header(headers,'user-agent');
 m=/(?:miniProgram|wxapp)[^\w]{0,30}(wx[0-9a-f]{16})/i.exec(ua);
 if(m)return {id:m[1].toLowerCase(),source:'user_agent'};
 return {id:null,source:null};
}
function sourceName(headers){
 const s=header(headers,'source');
 return ['SHOPPABLE_MINI_P','IKEA_FAMILY_MINI_P','SHOPPABLE_APP','NEW_WEB'].includes(s)?s:null;
}
function hash(s){
 let h=2166136261;
 for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(16);
}
function main(){
 const ep=(typeof $environment!=='undefined'&&$environment&&$environment.sourcePath)||'';
 const phase=/#ikeaLogin=(req|res)(?:&|$)/.exec(ep);
 const stage=phase?phase[1]:null;
 if(!stage)return $done({});
 if(get('armed')==='0'||get('ikea_login_schema_disabled')==='1')return finish(stage);
 const request=(typeof $request!=='undefined'&&$request)||{};
 const response=(typeof $response!=='undefined'&&$response)||{};
 const url=String(request.url||'');
 if(!/^https:\/\/bff\.app\.ikea\.cn\/customer-bff\/v1\.0\/customer\/auth\/wechat(?:\?|$)/i.test(url)
    ||String(request.method||'POST').toUpperCase()!=='POST')return finish(stage);
 const body=stage==='req'?request.body:response.body;
 const headers=stage==='req'?request.headers:response.headers;
 const status=stage==='res'&&Number.isInteger(Number(response.statusCode))?Number(response.statusCode):null;
 const app=appId(request.headers);
 const fieldNames=keyNames(body);
 const src=sourceName(request.headers);
 const payload={v:1,type:'qx_structure_v1',host:'bff.app.ikea.cn',
  path:ROUTE,method:'POST',stage:stage==='req'?'request_body':'response_body',
  query_keys:[],header_keys:Object.keys(headers||{}).filter(s=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(s)).slice(0,40),
  body_keys:fieldNames,body_length:null,status,
  wx_appid:app.id,wx_appid_source:app.source,source_channel:src};
 const server=get('url').replace(/\/+$/,'');
 const token=get('token');
 if(server!==ALLOWED||token.length<32)return finish(stage);
 // Record one matching structure per stage for one hour, and allow retries.
 const fingerprint=hash([stage,src,app.id,status,fieldNames.join(','),Math.floor(Date.now()/3600000)].join('|'));
 if(get('ikea_login_schema_last_'+stage)===fingerprint)return finish(stage);
 let finished=false;
 function end(ok){
  if(finished)return;finished=true;
  if(ok){
    put('ikea_login_schema_last_'+stage,fingerprint);
    put('ikea_login_schema_seen_at',new Date().toISOString());
    if(stage==='res'&&get('ikea_login_schema_notified')!=='1'){
      put('ikea_login_schema_notified','1');
      if(typeof $notify==='function')
       $notify('宜家登录结构已采集','接口已命中','只上传字段名称和渠道，不含微信 Code 或业务 Token。');
    }
  }
  finish(stage);
 }
 const timer=setTimeout(()=>end(false),2400);
 try{
  $task.fetch({url:API,method:'POST',opts:{policy:'direct'},
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)}).then(r=>{
    clearTimeout(timer);
    const status=Number(r.statusCode||r.status||0);
    end(status===200);
   }).catch(()=>{clearTimeout(timer);end(false);});
 }catch(e){clearTimeout(timer);end(false);}
}
try{main();}catch(e){
 const ep=(typeof $environment!=='undefined'&&$environment&&$environment.sourcePath)||'';
 finish(/#ikeaLogin=res/.test(ep)?'res':'req');
}
