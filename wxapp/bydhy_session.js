/*
 * 比亚迪海洋（微信小程序）青龙 Session 凭据版
 * 来源逻辑：smallfawn/QLScriptPublic wxapp/bydhy.js（独立改造，不依赖 wx_server）
 *
 * 青龙环境变量：bydhy
 *   方式一：session_id 原值，或 session_id=<值>
 *   方式二：enc:<mina.decryptCode 登录响应的 AES/Base64 原文>
 *   多账号：& 或换行分隔；每个账号可添加 #备注
 * cron: 51 8 * * *
 *
 * 注意：这里的 session_id 是加密请求体中的会话字段，不是 HTTP Cookie。
 * 不要将真实 session_id、加密响应、青龙变量提交到 GitHub。
 * 该版本不能自动续期；凭据失效时会提示重新抓取，不会重放微信登录。
 */

"use strict";

const crypto = require("crypto");

const AES_KEY = "3993014457161851";
const AES_IV = "PDVcDRWMrBlLHTqh";
const APPKEY = "hyMinaApi";
const APPSECRET = "Kfl%BOk6C5PwARw8";
const SIGN_URL = "https://mina.bydoceanauto.com/?s=ForCommonUcSrv.forward&serviceDir=activity/sign/signIn";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 " +
  "MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF";

function encrypt(text) {
  const cipher = crypto.createCipheriv("aes-128-cbc", AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

function decrypt(value) {
  const cipherText = String(value || "").trim();
  if (!cipherText || !/^[\w+/=-]+$/.test(cipherText)) {
    throw new Error("加密响应格式错误，请确认抓取的是 mina.decryptCode 响应体");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", AES_KEY, AES_IV);
    return Buffer.concat([
      decipher.update(Buffer.from(cipherText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (_err) {
    throw new Error("无法解密登录响应，请确认抓包内容完整");
  }
}

function extractSession(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return "";
  return extractSession(value.session_id)
    || extractSession(value.sessionId)
    || extractSession(value.data)
    || extractSession(value.result);
}

function parseAccount(raw) {
  const full = String(raw || "").trim();
  const pos = full.indexOf("#");
  let value = (pos < 0 ? full : full.slice(0, pos)).trim();
  const remark = (pos < 0 ? "" : full.slice(pos + 1)).trim();
  let sessionId = "";

  if (value.startsWith("enc:")) {
    value = value.slice(4).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    let decoded;
    try { decoded = JSON.parse(decrypt(value)); }
    catch (err) {
      if (err instanceof SyntaxError) throw new Error("加密响应解密后不是有效 JSON");
      throw err;
    }
    sessionId = extractSession(decoded);
  } else if (value.startsWith("{")) {
    let obj;
    try { obj = JSON.parse(value); }
    catch (_err) { throw new Error("JSON 凭据格式无效"); }
    sessionId = extractSession(obj);
  } else {
    const match = value.match(/(?:^|;\s*)session_id\s*=\s*([^;]+)/i);
    sessionId = match ? match[1].trim() : value;
  }

  if (!sessionId || /[\s\r\n]/.test(sessionId) || sessionId.length > 4096) {
    throw new Error("未取得有效 session_id（支持原值、session_id=... 或 enc:...）");
  }
  return { sessionId, remark };
}

function headers() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const nonce = Array.from({ length: 16 }, () => chars[crypto.randomInt(chars.length)]).join("");
  const curtime = String(Math.floor(Date.now() / 1000));
  return {
    "Content-Type": "application/json",
    "X-Clienttraceid": "mina-" + crypto.randomUUID(),
    Nonce: nonce,
    Curtime: curtime,
    Checksum: crypto.createHash("sha256").update(APPSECRET + nonce + curtime).digest("hex"),
    Appkey: APPKEY,
    "User-Agent": USER_AGENT,
    Xweb_xhr: "1",
    Accept: "*/*",
    Referer: "https://servicewechat.com/wxf62054ec313d6f53/115/page-frame.html",
  };
}

function signPayload(sessionId) {
  return {
    date: "",
    belong_brand: "hy",
    session_id: sessionId,
    app_version: "460",
    app_client: "mina",
  };
}

function decodeResponse(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("服务器返回空响应");
  try { return JSON.parse(decrypt(raw)); }
  catch (_err) {
    try { return JSON.parse(raw); }
    catch (_error) { throw new Error("服务器响应无法解码"); }
  }
}

function classifyResponse(response) {
  const ret = Number(response?.ret);
  const msg = String(response?.msg || response?.message || "");
  if (ret === 0) {
    const data = response.data || {};
    const details = [
      data.integral !== undefined ? "积分 " + data.integral : "",
      data.continuous !== undefined ? "连续 " + data.continuous + " 天" : "",
    ].filter(Boolean).join("，");
    return { status: "success", text: "✅ 签到成功" + (details ? "，" + details : "") };
  }
  if (/已签|签到过|重复|已完成/.test(msg)) return { status: "already", text: "✅ 今日已签到" };
  if (ret === 50010) return { status: "upgrade", text: "⚠️ 账号需在比亚迪 App 完成升级或注册" };
  if ([401, 403].includes(ret) || /session|登录|未授权|失效|过期|token/i.test(msg)) {
    return { status: "expired", text: "⚠️ session_id 已失效或未授权，需重新抓取" };
  }
  return { status: "failed", text: "❌ 签到失败（ret=" + (Number.isFinite(ret) ? ret : "未知") + "）：" + msg.slice(0, 80) };
}

async function sign(sessionId, request) {
  const send = request || require("axios").request;
  const response = await send({
    method: "POST",
    url: SIGN_URL,
    data: encrypt(JSON.stringify(signPayload(sessionId))),
    headers: headers(),
    timeout: 20000,
    validateStatus: () => true,
    transformRequest: [(data) => data],
  });
  if ([401, 403].includes(response.status)) {
    return { status: "expired", text: "⚠️ session_id 已失效或未授权，需重新抓取" };
  }
  if (response.status >= 400) {
    try {
      const detail = classifyResponse(decodeResponse(response.data));
      if (detail.status === "expired" || detail.status === "upgrade") return detail;
    } catch (_err) {}
    return { status: "failed", text: "❌ 签到接口 HTTP " + response.status };
  }
  return classifyResponse(decodeResponse(response.data));
}

async function main() {
  const { Env } = require("../tools/env.js");
  const $ = new Env("比亚迪海洋签到（Session 版）");
  try {
    $.checkEnv("bydhy");
    if (!$.userCount) {
      $.log("未找到环境变量 bydhy");
      return;
    }
    for (let i = 0; i < $.userList.length; i++) {
      const prefix = "账号[" + (i + 1) + "]";
      try {
        const account = parseAccount($.userList[i]);
        const result = await sign(account.sessionId);
        $.log(prefix + (account.remark ? "[" + account.remark + "] " : " ") + result.text);
      } catch (err) {
        // 不能在日志/通知中输出响应原文或凭据。
        const safe = /^(加密响应格式错误|无法解密登录响应|加密响应解密后不是有效 JSON|JSON 凭据格式无效|未取得有效 session_id)/.test(String(err.message || ""))
          ? err.message : (err.code || "网络请求或响应解析失败");
        $.log(prefix + " 执行失败：" + safe);
      }
      if (i < $.userList.length - 1) await $.wait(1500, 3000);
    }
  } finally {
    await $.done();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("执行失败：" + (err.code || "未知错误"));
    process.exitCode = 1;
  });
}

module.exports = { encrypt, decrypt, parseAccount, headers, signPayload, decodeResponse, classifyResponse, sign };
