/* Quantumult X online status / diagnostics. Read-only, never uploads cookies. */
'use strict';
const VERSION='1.1.0';
const P='qlcap_v1_';
function read(k){return $prefs.valueForKey(P+k)||'';}
function done(){$done({});}
function alert(title,msg){if(typeof $notify==='function')$notify('青龙采集中心 v'+VERSION,title,msg);}
try{
  const server=read('url').replace(/\/+$/,'');
  const token=read('token');
  if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32) {
    alert('尚未配置','先运行 setup-online.js 初始化网关，勿把密钥上传到 GitHub');
    done();
  } else {
    const start=Date.now();
    $task.fetch({url:server+'/api/v1/status',method:'GET',
      headers:{'Authorization':'Bearer '+token,'Accept':'application/json'},
      opts:{policy:'direct'}
    }).then(response=>{
      const code=Number(response.statusCode||response.status||0);
      let data={};
      try{data=JSON.parse(response.body||'{}');}catch(e){}
      if(code===200&&typeof data.dry_run==='boolean'){
        const mode=data.dry_run?'DRY_RUN 测试':'正式写入';
        const enabled=read('armed')==='1'?'已开启':'已关闭';
        const names=Array.isArray(data.services)?data.services.join(', '):'未知';
        alert('网关可用 · '+(Date.now()-start)+'ms','模式：'+mode+' · 采集：'+enabled+' · 平台：'+names);
      } else if(code===401)alert('网关鉴权失败','CAPTURE_TOKEN 失效或配置不一致（401）');
      else alert('网关异常','接口 HTTP '+code+'，请检查 Portainer 日志');
      done();
    }).catch(()=>{alert('网络异常','HTTPS 接口无法访问，检查 58443 和 QX 网络策略');done();});
  }
} catch(e){alert('诊断失败','脚本发生异常；未修改任何配置');done();}
