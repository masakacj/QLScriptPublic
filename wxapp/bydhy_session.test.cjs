"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  encrypt, decrypt, parseAccount, headers, signPayload,
  decodeResponse, classifyResponse, sign,
} = require("./bydhy_session.js");

test("accepts plaintext session, key=value, JSON and remarks", () => {
  assert.deepEqual(parseAccount("abc-0123#车主"), { sessionId: "abc-0123", remark: "车主" });
  assert.equal(parseAccount("session_id=abc-0123").sessionId, "abc-0123");
  assert.equal(parseAccount("session_id=abc-0123; Path=/").sessionId, "abc-0123");
  assert.equal(parseAccount('{"data":{"session_id":"abc-0123"}}').sessionId, "abc-0123");
});

test("decrypts an encrypted login response without wx_server", () => {
  const encryptedResponse = encrypt(JSON.stringify({ session_id: "demo-session-123" }));
  assert.equal(parseAccount("enc:" + encryptedResponse).sessionId, "demo-session-123");
  assert.equal(parseAccount("enc:" + JSON.stringify(encryptedResponse) + "#主账号").remark, "主账号");
});

test("can also extract session from encrypted sign-request JSON", () => {
  const payload = encrypt(JSON.stringify({ date: "", session_id: "demo-session-456" }));
  assert.equal(parseAccount("enc:" + payload).sessionId, "demo-session-456");
});

test("does not accept empty, broken or irrelevant encrypted credentials", () => {
  assert.throws(() => parseAccount(""), /session_id/);
  assert.throws(() => parseAccount("enc:foobar"), /解密/);
  assert.throws(() => parseAccount("enc:" + encrypt(JSON.stringify({ other: "x" }))), /session_id/);
});

test("AES codec roundtrip with Unicode", () => {
  const message = '{"text":"比亚迪","value":"abc"}';
  assert.equal(decrypt(encrypt(message)), message);
});

test("sign payload retains upstream request contract", () => {
  assert.deepEqual(signPayload("demo-id"), {
    date: "", belong_brand: "hy", session_id: "demo-id", app_version: "460", app_client: "mina",
  });
  const h = headers();
  assert.match(h.Nonce, /^[a-zA-Z0-9]{16}$/);
  assert.match(h.Checksum, /^[a-f0-9]{64}$/);
  assert.equal(h.Checksum, crypto.createHash("sha256")
    .update("Kfl%BOk6C5PwARw8" + h.Nonce + h.Curtime).digest("hex"));
});

test("decodes encrypted and plaintext server responses", () => {
  assert.deepEqual(decodeResponse(encrypt('{"ret":0}')), { ret: 0 });
  assert.deepEqual(decodeResponse('{"ret":0}'), { ret: 0 });
});

test("sign request posts encrypted body and classifies success", async () => {
  const outcome = await sign("abc-0123", async (options) => {
    assert.equal(options.url, "https://mina.bydoceanauto.com/?s=ForCommonUcSrv.forward&serviceDir=activity/sign/signIn");
    const payload = JSON.parse(decrypt(options.data));
    assert.equal(payload.session_id, "abc-0123");
    assert.equal(options.headers.Appkey, "hyMinaApi");
    return { status: 200, data: encrypt(JSON.stringify({ ret: 0, data: { integral: 5, continuous: 2 } })) };
  });
  assert.equal(outcome.status, "success");
  assert.match(outcome.text, /积分 5/);
});

test("distinguishes already signed, upgrade, expired and failures", async () => {
  assert.equal(classifyResponse({ ret: 1, msg: "今日已签到" }).status, "already");
  assert.equal(classifyResponse({ ret: 50010 }).status, "upgrade");
  assert.equal(classifyResponse({ ret: 1, msg: "登录过期" }).status, "expired");
  assert.equal(classifyResponse({ ret: 100, msg: "系统异常" }).status, "failed");
  assert.equal((await sign("id", async () => ({ status: 403, data: "" }))).status, "expired");
  assert.equal((await sign("id", async () => ({ status: 500, data: "" }))).status, "failed");
});
