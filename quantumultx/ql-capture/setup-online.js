/* Quantumult X event-interaction: online, self-hosted cookie capture setup.
 * Private token is supplied ONCE as #token=... in the task script URL.
 * Remove the fragment from the QX config after success; never commit credentials.
 * The URL fragment is not transmitted in the GitHub HTTP request.
 */
'use strict';
const VERSION='1.1.0';
const P='qlcap_v1_';
const SERVER='https://qlcap.781751.xyz:58443';
function value(k){return $prefs.valueForKey(P+k)||'';}
function store(k,v){return $prefs.setValueForKey(String(v),P+k);}
function notify(title,body){if(typeof $notify==='function')$notify('青龙采集中心 v'+VERSION,title,body);}
function finish(){$done({});}
function parameter(name) {
  const source=typeof $environment!=='undefined'&&$environment&&$environment.sourcePath||'';
  const index=source.indexOf('#');
  if(index<0)return '';
  const pairs=source.slice(index+1).split('&');
  for(const pair of pairs){
    const split=pair.indexOf('=');
    if(split<0)continue;
    let key='',val='';
    try{key=decodeURIComponent(pair.slice(0,split));val=decodeURIComponent(pair.slice(split+1));}catch(e){continue;}
    if(key===name)return val;
  }
  return '';
}
function check(url,token,whenOK){
  $task.fetch({url:url+'/api/v1/status',method:'GET',
    headers:{'Authorization':'Bearer '+token,'Accept':'application/json'},
    opts:{policy:'direct'}
  }).then(r=>{
    let data={};
    try{data=JSON.parse(r.body||'{}');}catch(e){}
    const code=Number(r.statusCode||r.status||0);
    if(code!==200||!Array.isArray(data.services)||typeof data.dry_run!=='boolean'){
      notify('连接验证失败',code===401?'密钥错误或已更换（HTTP 401）':'网关未接受请求（HTTP '+code+'）');
      return finish();
    }
    whenOK(data);
    finish();
  }).catch(()=>{
    notify('连接失败','无法连接 HTTPS 网关，请检查网络和端口 58443');
    finish();
  });
}
try{
  const candidate=parameter('token').trim();
  if(candidate) {
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(candidate)) {
      notify('密钥格式错误','检查 CAPTURE_TOKEN，至少 32 位，仅包含字母、数字、_、-');
      finish();
    } else {
      check(SERVER,candidate,(data)=>{
        store('url',SERVER);
        store('token',candidate);
        store('armed','0');
        notify('初始化成功',data.dry_run?'连接已验证 · 测试模式。请立即从任务 URL 删除 #token=...':'连接已验证 · 正式模式。请立即从任务 URL 删除 #token=...');
      });
    }
  } else if(value('token')&&value('url')) {
    check(value('url'),value('token'),data=>{
      notify('配置正常',data.dry_run?'服务端测试模式 · 采集'+(value('armed')==='1'?'开启':'关闭'):'服务端正式模式 · 采集'+(value('armed')==='1'?'开启':'关闭'));
    });
  } else {
    notify('需要初始化','任务 URL 后临时加 #token=你的CAPTURE_TOKEN，执行成功后删除这段参数');
    finish();
  }
} catch(e){notify('初始化失败','脚本执行异常；原有配置未改变');finish();}
