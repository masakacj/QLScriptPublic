// ==UserScript==
// @name         HJD2048 磁链/Hash 可视队列发送
// @namespace    https://hjd2048.com/
// @version      4.1.1
// @description  快速提取磁链，持久化入列，并通过 Cloudflare Worker 严格确认写入
// @match        https://hjd2048.com/*
// @match        http://hjd2048.com/*
// @match        https://*.hjd2048.com/*
// @match        http://*.hjd2048.com/*
// @connect      hjd2048-sheets-writer.masakacj.workers.dev
// @updateURL    https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/hjd2048/hjd2048-magnet-queue.meta.js
// @downloadURL  https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/hjd2048/hjd2048-magnet-queue.user.js
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.listValues
// @grant        GM.deleteValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const ENDPOINT = "https://hjd2048-sheets-writer.masakacj.workers.dev/v1/clipboard/append";
  const HEALTH_ENDPOINT = "https://hjd2048-sheets-writer.masakacj.workers.dev/v1/clipboard/health";
  const INGEST_SHARED_SECRET = "";
  // Local private baseline provisions this secret into GM storage once.
  // Public online releases replace INGEST_SHARED_SECRET with an empty string.
  // Never publish the private baseline or a populated token.
  const STORED_INGEST_SECRET_KEY = 'hjd2048-ingest-secret-v1';
  let runtimeIngestSecret = INGEST_SHARED_SECRET;
  const PUBLIC_UPDATE_URL = 'https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/hjd2048/hjd2048-magnet-queue.user.js';
  const PROTOCOL_VERSION = 3;

  const ROOT_ID = 'hjd2048-queue-controls';
  const BUTTON_ID = 'hjd2048-magnet-send-button';
  const TOGGLE_ID = 'hjd2048-queue-toggle';
  const PANEL_ID = 'hjd2048-queue-panel';
  const TOAST_ID = 'hjd2048-magnet-send-toast';
  const LIST_ID = 'hjd2048-queue-list';
  const STATS_ID = 'hjd2048-queue-stats';
  const DIAGNOSTICS_ID = 'hjd2048-queue-diagnostics';

  const LEGACY_QUEUE_KEY = 'hjd2048-magnet-queue-v1';
  const LEGACY_V3_QUEUE_KEY = 'hjd2048-magnet-queue-v3';
  const FALLBACK_QUEUE_KEY = 'hjd2048-magnet-queue-v4';
  const META_KEY = 'hjd2048-magnet-meta-v4';
  const ITEM_KEY_PREFIX = 'hjd2048-magnet-item-v4:';
  const HISTORY_KEY_PREFIX = 'hjd2048-magnet-history-v4:';
  const ACK_KEY_PREFIX = 'hjd2048-magnet-ack-v4:';
  const WORKER_LEASE_KEY = 'hjd2048-magnet-worker-lease-v4';
  const MUTATION_LEASE_KEY = 'hjd2048-magnet-mutation-lease-v4';
  const LOCAL_KEY_PREFIX = '__userscript_';

  const BATCH_SIZE = 100;
  const DISPLAY_HISTORY_LIMIT = 50;
  const REQUEST_TIMEOUT_MS = 35000;
  const CLAIM_DURATION_MS = 45000;
  const WORKER_LEASE_MS = 50000;
  const MUTATION_LEASE_MS = 5000;
  const MUTATION_WAIT_MS = 3000;
  const WORKER_BUDGET_MS = 30000;
  const RESPONSE_PREVIEW_LIMIT = 1000;
  const RETRY_DELAYS_MS = [10000, 20000, 40000, 80000, 160000, 300000];

  const WORKER_ID = createId('worker');

  let buttonBusy = false;
  let queueCount = 0;
  let panelOpen = false;
  let workerRunning = false;
  let workerTimer = null;
  let canStartWork = true;
  let mutationSequence = 0;
  let queueMutationChain = Promise.resolve();
  let renderSequence = 0;

  function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}:${crypto.randomUUID()}`;
    }

    return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function truncate(value, limit = RESPONSE_PREVIEW_LIMIT) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  function hasGmStorage() {
    return typeof GM !== 'undefined' &&
      typeof GM.getValue === 'function' &&
      typeof GM.setValue === 'function';
  }

  function hasIndexedGmStorage() {
    return hasGmStorage() &&
      typeof GM.listValues === 'function' &&
      typeof GM.deleteValue === 'function';
  }

  function storageBackendName() {
    if (hasIndexedGmStorage()) return 'GM 独立记录存储';
    return hasGmStorage()
      ? 'GM 整体存储（兼容降级）'
      : 'localStorage（同源降级）';
  }

  async function provisionIngestSecret() {
    const existing = String(await getStoredValue(STORED_INGEST_SECRET_KEY, '') || '');
    if (INGEST_SHARED_SECRET && INGEST_SHARED_SECRET !== existing) {
      await setStoredValue(STORED_INGEST_SECRET_KEY, INGEST_SHARED_SECRET);
    }
    runtimeIngestSecret = INGEST_SHARED_SECRET || existing;
    if (runtimeIngestSecret.length < 32) {
      throw new Error('未找到本地写入授权，请先运行一次私有迁移脚本');
    }
  }

  async function getStoredValue(key, fallbackValue) {
    if (hasGmStorage()) {
      return GM.getValue(key, fallbackValue);
    }

    const raw = localStorage.getItem(`${LOCAL_KEY_PREFIX}${key}`);
    return raw === null ? fallbackValue : JSON.parse(raw);
  }

  async function setStoredValue(key, value) {
    if (hasGmStorage()) {
      await GM.setValue(key, value);
      return;
    }

    localStorage.setItem(`${LOCAL_KEY_PREFIX}${key}`, JSON.stringify(value));
  }

  async function deleteStoredValue(key) {
    if (hasIndexedGmStorage()) {
      await GM.deleteValue(key);
      return;
    }

    localStorage.removeItem(`${LOCAL_KEY_PREFIX}${key}`);
  }

  async function listStoredKeys() {
    if (hasIndexedGmStorage()) {
      return GM.listValues();
    }

    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(LOCAL_KEY_PREFIX)) {
        keys.push(key.slice(LOCAL_KEY_PREFIX.length));
      }
    }
    return keys;
  }

  function itemStorageKey(deliveryId) {
    return `${ITEM_KEY_PREFIX}${encodeURIComponent(deliveryId)}`;
  }

  function historyStorageKey(historyId) {
    return `${HISTORY_KEY_PREFIX}${encodeURIComponent(historyId)}`;
  }

  function ackStorageKey(deliveryId) {
    return `${ACK_KEY_PREFIX}${encodeURIComponent(deliveryId)}`;
  }

  function createDiagnostics() {
    return {
      storageBackend: storageBackendName(),
      workerStatus: '空闲',
      lastWorkerAt: 0,
      lastWorkerMessage: '',
      lastPingAt: 0,
      lastPingStatus: '',
      lastPingResponse: ''
    };
  }

  function createEmptyState() {
    return {
      version: 4,
      updatedAt: Date.now(),
      legacyImportedAt: 0,
      legacyItemCount: 0,
      items: [],
      history: [],
      acks: [],
      diagnostics: createDiagnostics()
    };
  }

  function normalizeActiveItem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') return null;

    const text = String(rawItem.text || '').trim();
    if (!text) return null;

    const hash = extractBtihHash(text);
    const deliveryId = String(
      rawItem.deliveryId || rawItem.id || (hash ? `btih:${hash}` : `text:${text}`)
    );
    const status = rawItem.status === 'sending' ? 'sending' : 'pending';

    return {
      deliveryId,
      text,
      source: String(rawItem.source || ''),
      createdAt: Number(rawItem.createdAt) || Date.now(),
      status,
      attempts: Math.max(0, Number(rawItem.attempts) || 0),
      nextAttemptAt: Math.max(0, Number(rawItem.nextAttemptAt) || 0),
      requestId: status === 'sending' ? String(rawItem.requestId || '') : '',
      claimedAt: status === 'sending' ? Math.max(0, Number(rawItem.claimedAt) || 0) : 0,
      claimExpiresAt: status === 'sending' ? Math.max(0, Number(rawItem.claimExpiresAt) || 0) : 0,
      lastRequestAt: Math.max(0, Number(rawItem.lastRequestAt) || 0),
      lastHttpStatus: rawItem.lastHttpStatus === null || rawItem.lastHttpStatus === undefined
        ? null
        : Number(rawItem.lastHttpStatus),
      lastResponseCode: String(rawItem.lastResponseCode || ''),
      lastResponseBody: truncate(rawItem.lastResponseBody),
      lastError: truncate(rawItem.lastError, 500)
    };
  }

  function normalizeHistoryItem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') return null;

    const text = String(rawItem.text || '').trim();
    if (!text) return null;

    const completedAt = Number(rawItem.completedAt) || Date.now();
    const deliveryId = String(rawItem.deliveryId || rawItem.id || '');
    const requestId = String(rawItem.requestId || '');

    return {
      historyId: String(rawItem.historyId || `${requestId}:${deliveryId}:${completedAt}`),
      deliveryId,
      text,
      source: String(rawItem.source || ''),
      createdAt: Number(rawItem.createdAt) || Date.now(),
      completedAt,
      requestId,
      attempts: Math.max(0, Number(rawItem.attempts) || 0),
      httpStatus: rawItem.httpStatus === null || rawItem.httpStatus === undefined
        ? null
        : Number(rawItem.httpStatus),
      responseCode: String(rawItem.responseCode || 'OK'),
      responseBody: truncate(rawItem.responseBody)
    };
  }

  function normalizeAck(rawAck) {
    if (!rawAck || typeof rawAck !== 'object') return null;

    const deliveryId = String(rawAck.deliveryId || '');
    const completedAt = Math.max(0, Number(rawAck.completedAt) || 0);
    if (!deliveryId || !completedAt) return null;

    return { deliveryId, completedAt };
  }

  function normalizeState(value) {
    const state = createEmptyState();
    const seen = new Set();
    const sourceItems = value && Array.isArray(value.items) ? value.items : [];

    for (const rawItem of sourceItems) {
      const item = normalizeActiveItem(rawItem);
      if (!item || !item.deliveryId || seen.has(item.deliveryId)) continue;
      seen.add(item.deliveryId);
      state.items.push(item);
    }

    const historySeen = new Set();
    const sourceHistory = value && Array.isArray(value.history) ? value.history : [];
    const allHistory = sourceHistory
      .map(normalizeHistoryItem)
      .filter((item) => {
        if (!item || historySeen.has(item.historyId)) return false;
        historySeen.add(item.historyId);
        return true;
      })
      .sort((a, b) => b.completedAt - a.completedAt);
    state.history = allHistory.slice(0, DISPLAY_HISTORY_LIMIT);

    // 成功确认使用独立、永久的小型 ack 记录；UI 历史裁剪不会削弱并发保护。
    const latestSuccess = new Map();
    const sourceAcks = value && Array.isArray(value.acks) ? value.acks : [];
    for (const rawAck of sourceAcks) {
      const ack = normalizeAck(rawAck);
      if (!ack) continue;
      const previous = latestSuccess.get(ack.deliveryId) || 0;
      latestSuccess.set(ack.deliveryId, Math.max(previous, ack.completedAt));
    }
    // 兼容已存在的 v3/v4 history：首次读取时自动补成 ack。
    for (const historyItem of allHistory) {
      const previous = latestSuccess.get(historyItem.deliveryId) || 0;
      latestSuccess.set(historyItem.deliveryId, Math.max(previous, historyItem.completedAt));
    }
    state.acks = [...latestSuccess.entries()].map(([deliveryId, completedAt]) => ({
      deliveryId,
      completedAt
    }));
    state.items = state.items.filter((item) => {
      const completedAt = latestSuccess.get(item.deliveryId) || 0;
      return !completedAt || item.createdAt > completedAt;
    });

    state.version = 4;
    state.updatedAt = Number(value && value.updatedAt) || Date.now();
    state.legacyImportedAt = Number(value && value.legacyImportedAt) || 0;
    state.legacyItemCount = Math.max(0, Number(value && value.legacyItemCount) || 0);
    state.diagnostics = {
      ...createDiagnostics(),
      ...(value && value.diagnostics && typeof value.diagnostics === 'object'
        ? value.diagnostics
        : {}),
      storageBackend: storageBackendName()
    };

    return state;
  }

  function migrateLegacyState(legacy) {
    const state = createEmptyState();
    const legacyItems = legacy && Array.isArray(legacy.items) ? legacy.items : [];

    state.items = legacyItems
      .map((item) => normalizeActiveItem({
        ...item,
        status: 'pending',
        requestId: '',
        claimedAt: 0,
        claimExpiresAt: 0
      }))
      .filter(Boolean);
    state.history = legacy && Array.isArray(legacy.history)
      ? legacy.history.map(normalizeHistoryItem).filter(Boolean)
      : [];
    state.legacyImportedAt = Date.now();
    state.legacyItemCount = state.items.length;
    state.diagnostics.lastWorkerMessage = state.items.length
      ? `已迁移旧队列 ${state.items.length} 条`
      : '未发现旧队列';

    return normalizeState(state);
  }

  function stateMeta(state) {
    return {
      version: 4,
      updatedAt: Date.now(),
      legacyImportedAt: state.legacyImportedAt,
      legacyItemCount: state.legacyItemCount,
      diagnostics: state.diagnostics
    };
  }

  async function readIndexedState(meta) {
    const keys = await listStoredKeys();
    const itemKeys = keys.filter((key) => key.startsWith(ITEM_KEY_PREFIX));
    const historyKeys = keys.filter((key) => key.startsWith(HISTORY_KEY_PREFIX));
    const ackKeys = keys.filter((key) => key.startsWith(ACK_KEY_PREFIX));
    const [items, history, acks] = await Promise.all([
      Promise.all(itemKeys.map((key) => getStoredValue(key, null))),
      Promise.all(historyKeys.map((key) => getStoredValue(key, null))),
      Promise.all(ackKeys.map((key) => getStoredValue(key, null)))
    ]);

    const state = normalizeState({
      ...meta,
      items: items.filter(Boolean),
      history: history.filter(Boolean),
      acks: acks.filter(Boolean)
    });
    const activeIds = new Set(state.items.map((item) => item.deliveryId));
    const keptHistoryIds = new Set(state.history.map((item) => item.historyId));
    const staleItemKeys = [];
    const staleHistoryKeys = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = normalizeActiveItem(items[index]);
      if (item && !activeIds.has(item.deliveryId)) {
        staleItemKeys.push(itemKeys[index]);
      }
    }

    for (let index = 0; index < history.length; index += 1) {
      const item = normalizeHistoryItem(history[index]);
      if (item && !keptHistoryIds.has(item.historyId)) {
        staleHistoryKeys.push(historyKeys[index]);
      }
    }

    if (staleItemKeys.length || staleHistoryKeys.length) {
      await Promise.all([
        ...staleItemKeys.map(deleteStoredValue),
        ...staleHistoryKeys.map(deleteStoredValue)
      ]);
    }

    return state;
  }

  async function initializeIndexedState() {
    const existingMeta = await getStoredValue(META_KEY, null);
    if (existingMeta && Number(existingMeta.version) === 4) {
      return readIndexedState(existingMeta);
    }

    const legacyV3 = await getStoredValue(LEGACY_V3_QUEUE_KEY, null);
    const legacyV1 = await getStoredValue(LEGACY_QUEUE_KEY, null);
    const migrated = migrateLegacyState(
      legacyV3 && Number(legacyV3.version) === 3 ? legacyV3 : legacyV1
    );

    // 迁移前最后复查，绝不覆盖另一页面已经创建的新元数据。
    const latestMeta = await getStoredValue(META_KEY, null);
    if (latestMeta && Number(latestMeta.version) === 4) {
      return readIndexedState(latestMeta);
    }

    await Promise.all([
      ...migrated.items.map((item) => setStoredValue(itemStorageKey(item.deliveryId), item)),
      ...migrated.history.map((item) => setStoredValue(historyStorageKey(item.historyId), item)),
      ...migrated.acks.map((ack) => setStoredValue(ackStorageKey(ack.deliveryId), ack))
    ]);
    await setStoredValue(META_KEY, stateMeta(migrated));

    const confirmedMeta = await getStoredValue(META_KEY, stateMeta(migrated));
    return readIndexedState(confirmedMeta);
  }

  async function loadState() {
    if (hasIndexedGmStorage()) {
      const meta = await getStoredValue(META_KEY, null);
      return meta && Number(meta.version) === 4
        ? readIndexedState(meta)
        : initializeIndexedState();
    }

    const stored = await getStoredValue(FALLBACK_QUEUE_KEY, null);
    if (stored && Number(stored.version) === 4) return normalizeState(stored);

    const legacyV3 = await getStoredValue(LEGACY_V3_QUEUE_KEY, null);
    const legacyV1 = await getStoredValue(LEGACY_QUEUE_KEY, null);
    const migrated = migrateLegacyState(
      legacyV3 && Number(legacyV3.version) === 3 ? legacyV3 : legacyV1
    );

    // localStorage 降级为同步同源存储；写入前仍复查一次。
    const latest = await getStoredValue(FALLBACK_QUEUE_KEY, null);
    if (latest && Number(latest.version) === 4) return normalizeState(latest);

    await setStoredValue(FALLBACK_QUEUE_KEY, migrated);
    return migrated;
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function saveStateDiff(beforeState, afterState) {
    const before = normalizeState(beforeState);
    const after = normalizeState(afterState);
    after.updatedAt = Date.now();
    after.diagnostics.storageBackend = storageBackendName();

    if (!hasIndexedGmStorage()) {
      await setStoredValue(FALLBACK_QUEUE_KEY, after);
      return after;
    }

    const beforeItems = new Map(before.items.map((item) => [item.deliveryId, item]));
    const afterItems = new Map(after.items.map((item) => [item.deliveryId, item]));
    const beforeHistory = new Map(before.history.map((item) => [item.historyId, item]));
    const afterHistory = new Map(after.history.map((item) => [item.historyId, item]));
    const beforeAcks = new Map(before.acks.map((ack) => [ack.deliveryId, ack]));
    const afterAcks = new Map(after.acks.map((ack) => [ack.deliveryId, ack]));
    const operations = [];

    for (const [deliveryId, item] of afterItems) {
      if (!beforeItems.has(deliveryId) || !valuesEqual(beforeItems.get(deliveryId), item)) {
        operations.push(setStoredValue(itemStorageKey(deliveryId), item));
      }
    }

    for (const deliveryId of beforeItems.keys()) {
      if (!afterItems.has(deliveryId)) {
        operations.push(deleteStoredValue(itemStorageKey(deliveryId)));
      }
    }

    for (const [historyId, item] of afterHistory) {
      if (!beforeHistory.has(historyId) || !valuesEqual(beforeHistory.get(historyId), item)) {
        operations.push(setStoredValue(historyStorageKey(historyId), item));
      }
    }

    for (const historyId of beforeHistory.keys()) {
      if (!afterHistory.has(historyId)) {
        operations.push(deleteStoredValue(historyStorageKey(historyId)));
      }
    }

    for (const [deliveryId, ack] of afterAcks) {
      if (!beforeAcks.has(deliveryId) || !valuesEqual(beforeAcks.get(deliveryId), ack)) {
        operations.push(setStoredValue(ackStorageKey(deliveryId), ack));
      }
    }

    await Promise.all(operations);
    await setStoredValue(META_KEY, stateMeta(after));
    return after;
  }

  function sleep(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  async function acquireMutationLease(owner) {
    const deadline = Date.now() + MUTATION_WAIT_MS;

    while (Date.now() < deadline) {
      const lease = await getStoredValue(MUTATION_LEASE_KEY, null);
      const now = Date.now();

      if (!lease || lease.owner === owner || Number(lease.expiresAt) <= now) {
        await sleep(15 + Math.floor(Math.random() * 35));

        const latest = await getStoredValue(MUTATION_LEASE_KEY, null);
        if (
          latest &&
          latest.owner !== owner &&
          Number(latest.expiresAt) > Date.now()
        ) {
          continue;
        }

        await setStoredValue(MUTATION_LEASE_KEY, {
          owner,
          expiresAt: Date.now() + MUTATION_LEASE_MS
        });
        await sleep(25 + Math.floor(Math.random() * 30));

        const verified = await getStoredValue(MUTATION_LEASE_KEY, null);
        if (verified && verified.owner === owner) return true;
      }

      await sleep(40 + Math.floor(Math.random() * 80));
    }

    return false;
  }

  async function renewMutationLease(owner) {
    const lease = await getStoredValue(MUTATION_LEASE_KEY, null);
    if (!lease || lease.owner !== owner || Number(lease.expiresAt) <= Date.now()) {
      return false;
    }

    await setStoredValue(MUTATION_LEASE_KEY, {
      owner,
      expiresAt: Date.now() + MUTATION_LEASE_MS
    });
    const verified = await getStoredValue(MUTATION_LEASE_KEY, null);
    return Boolean(verified && verified.owner === owner);
  }

  async function releaseMutationLease(owner) {
    const lease = await getStoredValue(MUTATION_LEASE_KEY, null);

    if (lease && lease.owner === owner) {
      await setStoredValue(MUTATION_LEASE_KEY, { owner: '', expiresAt: 0 });
    }
  }

  function mutateState(mutator) {
    // Safari can suspend a tab while it holds a Web Lock, freezing other tabs indefinitely.
    // The expiring mutation lease below provides cross-tab coordination instead.
    const operation = queueMutationChain.then(async () => {
        const owner = `${WORKER_ID}:mutation:${++mutationSequence}`;

        if (!(await acquireMutationLease(owner))) {
          throw new Error('本地队列正被其他页面更新，请稍后重试');
        }

        try {
          const before = await loadState();
          const state = normalizeState(before);
          const result = await mutator(state);

          if (!(await renewMutationLease(owner))) {
            throw new Error('本地队列写入租约已失效，本次修改未提交');
          }

          const savedState = await saveStateDiff(before, state);

          if (result && typeof result === 'object' && result.state === state) {
            result.state = savedState;
          }

          return result;
        } finally {
          await releaseMutationLease(owner);
        }
    });

    queueMutationChain = operation.catch(() => {});
    return operation;
  }

  function createUi() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: 'fixed',
      right: '14px',
      bottom: '90px',
      zIndex: '999999',
      display: 'flex',
      alignItems: 'stretch',
      filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.24))'
    });

    const mainButton = document.createElement('button');
    mainButton.id = BUTTON_ID;
    mainButton.type = 'button';
    mainButton.textContent = '读取队列...';
    mainButton.disabled = true;
    Object.assign(mainButton.style, {
      minHeight: '42px',
      padding: '10px 13px',
      border: 'none',
      borderRadius: '999px 0 0 999px',
      background: '#1677ff',
      color: '#fff',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent'
    });

    const toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.textContent = '▾';
    toggle.setAttribute('aria-label', '展开队列详情');
    toggle.setAttribute('aria-expanded', 'false');
    Object.assign(toggle.style, {
      width: '42px',
      minHeight: '42px',
      padding: '0',
      border: 'none',
      borderLeft: '1px solid rgba(255,255,255,.35)',
      borderRadius: '0 999px 999px 0',
      background: '#1677ff',
      color: '#fff',
      fontSize: '18px',
      fontWeight: '700',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent'
    });

    mainButton.addEventListener('click', handleExtractClick);
    toggle.addEventListener('click', togglePanel);
    root.append(mainButton, toggle);
    document.documentElement.appendChild(root);

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      right: '14px',
      bottom: '142px',
      zIndex: '999998',
      display: 'none',
      width: 'min(420px, 92vw)',
      maxHeight: '55vh',
      overflow: 'hidden',
      border: '1px solid rgba(0,0,0,.12)',
      borderRadius: '14px',
      background: '#fff',
      color: '#172033',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      fontSize: '12px',
      lineHeight: '1.45'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '11px 12px 9px',
      borderBottom: '1px solid #e8ebf0',
      background: '#f7f9fc'
    });

    const title = document.createElement('div');
    title.textContent = '磁链发送队列';
    Object.assign(title.style, { fontSize: '14px', fontWeight: '700' });

    const stats = document.createElement('div');
    stats.id = STATS_ID;
    Object.assign(stats.style, { marginTop: '4px', color: '#526078' });

    const diagnostics = document.createElement('div');
    diagnostics.id = DIAGNOSTICS_ID;
    Object.assign(diagnostics.style, {
      marginTop: '4px',
      color: '#7a8498',
      wordBreak: 'break-word'
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '9px' });
    actions.append(
      createActionButton('立即尝试发送', handleRetryNow),
      createActionButton('Ping 接口', handlePing),
      createActionButton('脚本更新', () => window.open(PUBLIC_UPDATE_URL, '_blank'))
    );

    header.append(title, stats, diagnostics, actions);

    const list = document.createElement('div');
    list.id = LIST_ID;
    Object.assign(list.style, {
      maxHeight: 'calc(55vh - 112px)',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: '9px'
    });

    panel.append(header, list);
    document.documentElement.appendChild(panel);
  }

  function createActionButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      padding: '6px 9px',
      border: '1px solid #cbd3df',
      borderRadius: '8px',
      background: '#fff',
      color: '#2d3a50',
      fontSize: '12px',
      cursor: 'pointer'
    });
    button.addEventListener('click', handler);
    return button;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    const panel = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);

    if (panel) panel.style.display = panelOpen ? 'block' : 'none';
    if (toggle) {
      toggle.textContent = panelOpen ? '▴' : '▾';
      toggle.setAttribute('aria-expanded', String(panelOpen));
      toggle.setAttribute('aria-label', panelOpen ? '收起队列详情' : '展开队列详情');
    }

    if (panelOpen) void renderPanel();
  }

  function renderButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    button.disabled = buttonBusy;
    button.textContent = buttonBusy ? '正在入列...' : `提取磁链（${queueCount}）`;
  }

  function setQueueCount(count) {
    queueCount = Math.max(0, Number(count) || 0);
    renderButton();
  }

  function formatTime(timestamp) {
    if (!timestamp) return '—';

    try {
      return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

    } catch {
      return String(timestamp);
    }
  }

  function activeStatus(item) {
    if (item.status === 'sending') {
      return { label: '发送中', color: '#7c3aed', background: '#f2eafe' };
    }

    if (item.attempts > 0 && item.nextAttemptAt > Date.now()) {
      return { label: '等待重试', color: '#b45309', background: '#fff3dc' };
    }

    return { label: '待发送', color: '#1d4ed8', background: '#eaf1ff' };
  }

  function createDetailCard(item, isHistory) {
    const card = document.createElement('article');
    Object.assign(card.style, {
      padding: '9px',
      marginBottom: '8px',
      border: '1px solid #e1e6ee',
      borderRadius: '10px',
      background: '#fff'
    });

    const status = isHistory
      ? { label: '已成功', color: '#15803d', background: '#eaf8ef' }
      : activeStatus(item);

    const statusRow = document.createElement('div');
    Object.assign(statusRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '8px',
      alignItems: 'center'
    });

    const badge = document.createElement('span');
    badge.textContent = status.label;
    Object.assign(badge.style, {
      padding: '2px 7px',
      borderRadius: '999px',
      color: status.color,
      background: status.background,
      fontWeight: '700'
    });

    const attempts = document.createElement('span');
    attempts.textContent = `尝试 ${item.attempts || 0} 次`;
    attempts.style.color = '#7a8498';
    statusRow.append(badge, attempts);

    const magnet = document.createElement('div');
    magnet.textContent = item.text;
    Object.assign(magnet.style, {
      marginTop: '7px',
      padding: '7px',
      borderRadius: '7px',
      background: '#f5f7fa',
      color: '#1d2738',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11px',
      wordBreak: 'break-all',
      userSelect: 'text',
      WebkitUserSelect: 'text'
    });

    const details = [];
    details.push(`入列：${formatTime(item.createdAt)}`);
    if (isHistory) details.push(`完成：${formatTime(item.completedAt)}`);
    if (!isHistory && item.status === 'sending') {
      details.push(`请求：${formatTime(item.lastRequestAt)}`);
      details.push(`超时回收：${formatTime(item.claimExpiresAt)}`);
    } else if (!isHistory && item.nextAttemptAt > Date.now()) {
      details.push(`下次重试：${formatTime(item.nextAttemptAt)}`);
    }
    details.push(`HTTP：${item.httpStatus ?? item.lastHttpStatus ?? '—'}`);
    details.push(`返回：${item.responseCode || item.lastResponseCode || '—'}`);

    const meta = document.createElement('div');
    meta.textContent = details.join(' ｜ ');
    Object.assign(meta.style, { marginTop: '7px', color: '#626e82' });

    const request = document.createElement('div');
    request.textContent = `请求 ID：${item.requestId || '—'}\n投递 ID：${item.deliveryId || '—'}`;
    Object.assign(request.style, {
      marginTop: '5px',
      color: '#7a8498',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all'
    });

    const source = document.createElement('div');
    source.textContent = `来源：${item.source || '—'}`;
    Object.assign(source.style, {
      marginTop: '5px',
      color: '#7a8498',
      wordBreak: 'break-all'
    });

    const responseText = item.responseBody || item.lastResponseBody || item.lastError || '';
    card.append(statusRow, magnet, meta, request, source);

    if (responseText) {
      const response = document.createElement('div');
      response.textContent = `${item.lastError ? '错误' : '响应'}：${responseText}`;
      Object.assign(response.style, {
        marginTop: '6px',
        padding: '6px',
        borderRadius: '7px',
        background: item.lastError ? '#fff1f1' : '#f6f8fb',
        color: item.lastError ? '#b42318' : '#526078',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      });
      card.appendChild(response);
    }

    return card;
  }

  async function renderPanel(providedState) {
    if (!panelOpen) return;

    const sequence = ++renderSequence;
    const state = providedState || await loadState();
    if (sequence !== renderSequence || !panelOpen) return;

    const stats = document.getElementById(STATS_ID);
    const diagnostics = document.getElementById(DIAGNOSTICS_ID);
    const list = document.getElementById(LIST_ID);
    if (!stats || !diagnostics || !list) return;

    const sending = state.items.filter((item) => item.status === 'sending').length;
    const retrying = state.items.filter(
      (item) => item.status !== 'sending' && item.attempts > 0 && item.nextAttemptAt > Date.now()
    ).length;
    const pending = state.items.length - sending - retrying;

    stats.textContent = `待发送 ${pending} ｜ 发送中 ${sending} ｜ 重试 ${retrying} ｜ 最近成功 ${Math.min(state.history.length, DISPLAY_HISTORY_LIMIT)}`;
    diagnostics.textContent = [
      state.diagnostics.storageBackend,
      state.diagnostics.workerStatus,
      state.diagnostics.lastWorkerMessage,
      state.diagnostics.lastPingStatus
    ].filter(Boolean).join(' ｜ ');

    list.replaceChildren();

    const activeItems = [...state.items].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'sending' ? -1 : 1;
      return b.createdAt - a.createdAt;
    });

    if (!activeItems.length && !state.history.length) {
      const empty = document.createElement('div');
      empty.textContent = '队列和最近成功记录均为空';
      Object.assign(empty.style, { padding: '18px 8px', textAlign: 'center', color: '#7a8498' });
      list.appendChild(empty);
      return;
    }

    for (const item of activeItems) {
      list.appendChild(createDetailCard(item, false));
    }

    if (state.history.length) {
      const historyTitle = document.createElement('div');
      historyTitle.textContent = `最近成功（最多显示 ${DISPLAY_HISTORY_LIMIT} 条）`;
      Object.assign(historyTitle.style, {
        padding: '5px 2px 8px',
        color: '#526078',
        fontWeight: '700'
      });
      list.appendChild(historyTitle);

      for (const item of state.history.slice(0, DISPLAY_HISTORY_LIMIT)) {
        list.appendChild(createDetailCard(item, true));
      }
    }
  }

  async function refreshUi(providedState) {
    const state = providedState || await loadState();
    setQueueCount(state.items.length);
    if (panelOpen) await renderPanel(state);
    return state;
  }

  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        left: '50%',
        bottom: '150px',
        transform: 'translateX(-50%)',
        zIndex: '1000000',
        maxWidth: '82vw',
        padding: '9px 13px',
        borderRadius: '10px',
        background: 'rgba(0,0,0,.8)',
        color: '#fff',
        fontSize: '13px',
        lineHeight: '1.4',
        textAlign: 'center',
        wordBreak: 'break-word'
      });
      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.display = 'block';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
  }

  function safeDecode(text) {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }

  function normalizeMagnet(text) {
    return text
      .replace(/&amp;/gi, '&')
      .replace(/[，。；、）)\]}>"']+$/g, '')
      .trim();
  }

  function collectVisibleText() {
    const parts = [];

    if (document.body) {
      parts.push(document.body.innerText || document.body.textContent || '');
    }

    document.querySelectorAll('input, textarea').forEach((element) => {
      parts.push(element.value || '');
    });

    return parts.join('\n');
  }

  function collectMagnetText(visibleText) {
    const parts = [visibleText];

    document.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      parts.push(href, safeDecode(href));
    });

    return parts.join('\n');
  }

  function extractBtihHash(text) {
    const match = String(text || '').match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    return match ? match[1].toUpperCase() : '';
  }

  function hashToMagnet(hash) {
    return `magnet:?xt=urn:btih:${hash.toUpperCase()}`;
  }

  function extractMagnets(rawText) {
    const text = safeDecode(rawText).replace(/&amp;/gi, '&');
    const results = [];
    const regex = /magnet:\?xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})[^\s"'<>，。；、）)\]}]*/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push(normalizeMagnet(match[0]));
    }

    return results;
  }

  function extractUrlHashes(rawText) {
    const text = safeDecode(rawText).replace(/&amp;/gi, '&');
    const results = [];
    const regex = /[?&]hash=([^&#\s"'<>，。；、）)\]}]+)/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const hash = normalizeHashParameter(match[1]);
      if (hash) results.push(hashToMagnet(hash));
    }

    return results;
  }

  function normalizeHashParameter(value) {
    const text = String(value || '').trim();
    if (/^(?:[a-fA-F0-9]{40}|[a-zA-Z2-7]{32})$/.test(text)) return text;

    const suffix = text.match(/([a-fA-F0-9]{40})$/);
    return suffix ? suffix[1] : '';
  }

  function extractHashes(rawText) {
    const text = String(rawText || '');
    const results = [];
    const regex = /(^|[\s:：,，;；（(\[【])([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})(?=$|[\s,，。.;；）)\]】])/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const hash = match[2];
      const hashStart = match.index + match[1].length;
      if (isHashInsideVisibleUrl(text, hashStart, hash.length)) continue;
      results.push(hashToMagnet(hash));
    }

    return results;
  }

  function isHashInsideVisibleUrl(text, hashStart, hashLength) {
    let tokenStart = hashStart;
    let tokenEnd = hashStart + hashLength;

    while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) tokenStart -= 1;
    while (tokenEnd < text.length && !/\s/.test(text[tokenEnd])) tokenEnd += 1;

    const token = text.slice(tokenStart, tokenEnd).replace(/^[（(\[【"']+/, '');
    return /^(?:https?:\/\/|www\.)/i.test(token);
  }

  function dedupeByHash(items) {
    const seen = new Set();
    const result = [];

    for (const rawItem of items) {
      const value = String(rawItem || '').trim();
      if (!value) continue;

      const hash = extractBtihHash(value);
      const key = hash || value;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }

    return result;
  }

  function extractAll() {
    const visibleText = collectVisibleText();
    const pageText = collectMagnetText(visibleText);
    return dedupeByHash([
      ...extractMagnets(pageText),
      ...extractUrlHashes(pageText),
      ...extractHashes(visibleText)
    ]);
  }

  function createQueueItem(text) {
    const hash = extractBtihHash(text);

    return normalizeActiveItem({
      deliveryId: hash ? `btih:${hash}` : `text:${text}`,
      text,
      source: location.href,
      createdAt: Date.now(),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0
    });
  }

  async function enqueueItems(items) {
    return mutateState((state) => {
      const activeIds = new Set(state.items.map((item) => item.deliveryId));
      let added = 0;
      let duplicates = 0;

      for (const text of items) {
        const item = createQueueItem(text);

        if (!item || activeIds.has(item.deliveryId)) {
          duplicates += 1;
          continue;
        }

        activeIds.add(item.deliveryId);
        state.items.push(item);
        added += 1;
      }

      state.diagnostics.workerStatus = '已入列';
      state.diagnostics.lastWorkerAt = Date.now();
      state.diagnostics.lastWorkerMessage = `新增 ${added} 条，活动队列 ${state.items.length} 条`;

      return { added, duplicates, count: state.items.length, state };
    });
  }

  function recoverExpiredClaims(state, now) {
    let recovered = 0;

    for (const item of state.items) {
      if (item.status !== 'sending' || item.claimExpiresAt > now) continue;

      item.status = 'pending';
      item.requestId = '';
      item.claimedAt = 0;
      item.claimExpiresAt = 0;
      item.nextAttemptAt = now;
      item.lastResponseCode = 'CLAIM_EXPIRED';
      item.lastError = '上次请求未完成本地确认，已重新加入待发送队列';
      recovered += 1;
    }

    return recovered;
  }

  async function claimNextBatch() {
    return mutateState((state) => {
      const now = Date.now();
      const recovered = recoverExpiredClaims(state, now);
      const selected = state.items
        .filter((item) => item.status === 'pending' && item.nextAttemptAt <= now)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, BATCH_SIZE);

      if (!selected.length) {
        state.diagnostics.workerStatus = state.items.length ? '等待重试' : '空闲';
        if (recovered) {
          state.diagnostics.lastWorkerMessage = `已回收 ${recovered} 条过期请求`;
        }
        return { batch: [], requestId: '', state };
      }

      const requestId = createId('request');

      for (const item of selected) {
        item.status = 'sending';
        item.requestId = requestId;
        item.claimedAt = now;
        item.claimExpiresAt = now + CLAIM_DURATION_MS;
        item.lastRequestAt = now;
        item.attempts += 1;
        item.lastError = '';
      }

      state.diagnostics.workerStatus = '发送中';
      state.diagnostics.lastWorkerAt = now;
      state.diagnostics.lastWorkerMessage = `请求 ${requestId}，共 ${selected.length} 条`;

      return {
        requestId,
        batch: selected.map((item) => ({ ...item })),
        state
      };
    });
  }

  function makeRequestError(message, details = {}) {
    const error = new Error(message);
    Object.assign(error, {
      httpStatus: details.httpStatus ?? null,
      responseBody: truncate(details.responseBody),
      responseCode: String(details.responseCode || ''),
      responseUrl: String(details.responseUrl || ''),
      durationMs: Math.max(0, Number(details.durationMs) || 0)
    });
    return error;
  }

  function validateSuccessResponse(data, requestId, batch) {
    if (!data || typeof data !== 'object') return '响应不是 JSON 对象';
    if (Number(data.protocol) !== PROTOCOL_VERSION) return '协议版本不匹配';
    if (data.ok !== true || data.code !== 'OK') return `服务端返回 ${data.code || 'UNKNOWN'}`;
    if (String(data.requestId || '') !== requestId) return 'requestId 不匹配';
    if (Number(data.receivedCount) !== batch.length) return 'receivedCount 不匹配';
    if (Number(data.writtenCount) !== batch.length) return 'writtenCount 不匹配';

    const expected = batch.map((item) => item.deliveryId).sort();
    const accepted = Array.isArray(data.acceptedDeliveryIds)
      ? data.acceptedDeliveryIds.map(String).sort()
      : [];

    if (expected.length !== accepted.length) return '确认 ID 数量不匹配';
    for (let index = 0; index < expected.length; index += 1) {
      if (expected[index] !== accepted[index]) return '确认 ID 集合不匹配';
    }

    return '';
  }

  function postBatch(requestId, batch) {
    const payload = {
      protocol: PROTOCOL_VERSION,
      requestId,
      items: batch.map((item) => ({
        deliveryId: item.deliveryId,
        text: item.text,
        source: item.source
      }))
    };
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(makeRequestError('Userscripts 未提供 GM_xmlhttpRequest'));
        return;
      }

      let settled = false;
      const finishResolve = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url: ENDPOINT,
          headers: {
            Authorization: 'Bearer ' + runtimeIngestSecret,
            'Content-Type': 'application/json;charset=utf-8'
          },
          data: JSON.stringify(payload),
          responseType: 'text',
          timeout: REQUEST_TIMEOUT_MS,
          onload: (response) => {
            const httpStatus = Number(response.status) || 0;
            const responseBody = String(response.responseText || '').trim();
            const responseUrl = String(response.responseURL || '');
            const durationMs = Date.now() - startedAt;
            let data;

            try {
              data = responseBody ? JSON.parse(responseBody) : null;
            } catch {
              finishReject(makeRequestError('响应不是有效 JSON', {
                httpStatus,
                responseBody,
                responseUrl,
                durationMs,
                responseCode: 'INVALID_JSON'
              }));
              return;
            }

            if (httpStatus < 200 || httpStatus >= 300) {
              finishReject(makeRequestError('HTTP ' + httpStatus + '：' + (data && data.code || 'ERROR'), {
                httpStatus,
                responseBody,
                responseUrl,
                durationMs,
                responseCode: String(data && data.ok === false && data.code || 'HTTP_ERROR')
              }));
              return;
            }

            const validationError = validateSuccessResponse(data, requestId, batch);
            if (validationError) {
              finishReject(makeRequestError('响应确认无效：' + validationError, {
                httpStatus,
                responseBody,
                responseUrl,
                durationMs,
                responseCode: String(data && data.ok === false && data.code || 'INVALID_ACK')
              }));
              return;
            }

            finishResolve({
              httpStatus,
              responseBody: truncate(responseBody),
              responseUrl,
              durationMs,
              responseCode: 'OK',
              data
            });
          },
          onerror: () => finishReject(makeRequestError('网络请求失败', {
            durationMs: Date.now() - startedAt,
            responseCode: 'NETWORK_ERROR'
          })),
          ontimeout: () => finishReject(makeRequestError('请求超时', {
            durationMs: Date.now() - startedAt,
            responseCode: 'TIMEOUT'
          })),
          onabort: () => finishReject(makeRequestError('请求已中止', {
            durationMs: Date.now() - startedAt,
            responseCode: 'ABORTED'
          }))
        });
      } catch (error) {
        finishReject(makeRequestError(error && error.message ? error.message : String(error), {
          durationMs: Date.now() - startedAt,
          responseCode: 'REQUEST_THROWN'
        }));
      }
    });
  }

  function getRetryDelay(attempts) {
    const index = Math.min(Math.max(0, attempts - 1), RETRY_DELAYS_MS.length - 1);
    return Math.round(RETRY_DELAYS_MS[index] * (0.8 + Math.random() * 0.4));
  }

  async function settleSuccess(requestId, batch, result) {
    const batchIds = new Set(batch.map((item) => item.deliveryId));

    return mutateState((state) => {
      const completed = [];
      const remaining = [];

      for (const item of state.items) {
        // 服务端已严格确认 deliveryId 后，成功必须胜过其他页面的迟到 claim。
        if (batchIds.has(item.deliveryId)) {
          completed.push({
            deliveryId: item.deliveryId,
            text: item.text,
            source: item.source,
            createdAt: item.createdAt,
            completedAt: Date.now(),
            requestId,
            attempts: item.attempts,
            httpStatus: result.httpStatus,
            responseCode: result.responseCode,
            responseBody: result.responseBody
          });
        } else {
          remaining.push(item);
        }
      }

      state.items = remaining;
      const ackMap = new Map(state.acks.map((ack) => [ack.deliveryId, ack]));
      for (const item of completed) {
        const previous = ackMap.get(item.deliveryId);
        if (!previous || previous.completedAt < item.completedAt) {
          ackMap.set(item.deliveryId, {
            deliveryId: item.deliveryId,
            completedAt: item.completedAt
          });
        }
      }
      state.acks = [...ackMap.values()];
      state.history = [...completed.reverse(), ...state.history]
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, DISPLAY_HISTORY_LIMIT);
      state.diagnostics.workerStatus = '发送成功';
      state.diagnostics.lastWorkerAt = Date.now();
      state.diagnostics.lastWorkerMessage = `${requestId}：写入 ${completed.length} 条，HTTP ${result.httpStatus}`;

      return { count: state.items.length, completed: completed.length, state };
    });
  }

  async function settleFailure(requestId, batch, error) {
    const batchIds = new Set(batch.map((item) => item.deliveryId));

    return mutateState((state) => {
      let failed = 0;

      for (const item of state.items) {
        if (item.requestId !== requestId || !batchIds.has(item.deliveryId)) continue;

        item.status = 'pending';
        item.requestId = '';
        item.claimedAt = 0;
        item.claimExpiresAt = 0;
        item.nextAttemptAt = Date.now() + getRetryDelay(item.attempts);
        item.lastHttpStatus = error.httpStatus;
        item.lastResponseCode = error.responseCode || 'ERROR';
        item.lastResponseBody = truncate(error.responseBody);
        item.lastError = truncate(error.message, 500);
        failed += 1;
      }

      state.diagnostics.workerStatus = '发送失败';
      state.diagnostics.lastWorkerAt = Date.now();
      state.diagnostics.lastWorkerMessage = `${requestId}：${error.message}，保留 ${failed} 条`;

      return { count: state.items.length, failed, state };
    });
  }

  async function acquireWorkerLease() {
    const lease = await getStoredValue(WORKER_LEASE_KEY, null);
    const now = Date.now();

    if (lease && lease.owner !== WORKER_ID && Number(lease.expiresAt) > now) {
      return false;
    }

    await sleep(20 + Math.floor(Math.random() * 40));
    const latest = await getStoredValue(WORKER_LEASE_KEY, null);

    if (
      latest &&
      latest.owner !== WORKER_ID &&
      Number(latest.expiresAt) > Date.now()
    ) {
      return false;
    }

    await setStoredValue(WORKER_LEASE_KEY, {
      owner: WORKER_ID,
      expiresAt: Date.now() + WORKER_LEASE_MS
    });
    await sleep(35 + Math.floor(Math.random() * 45));

    const verified = await getStoredValue(WORKER_LEASE_KEY, null);
    return Boolean(verified && verified.owner === WORKER_ID);
  }

  async function renewWorkerLease() {
    const lease = await getStoredValue(WORKER_LEASE_KEY, null);
    if (!lease || lease.owner !== WORKER_ID) return false;

    await setStoredValue(WORKER_LEASE_KEY, {
      owner: WORKER_ID,
      expiresAt: Date.now() + WORKER_LEASE_MS
    });
    return true;
  }

  async function releaseWorkerLease() {
    const lease = await getStoredValue(WORKER_LEASE_KEY, null);
    if (lease && lease.owner === WORKER_ID) {
      await setStoredValue(WORKER_LEASE_KEY, { owner: '', expiresAt: 0 });
    }
  }

  function armWorker(delayMs) {
    clearTimeout(workerTimer);
    if (!canStartWork) return;

    workerTimer = setTimeout(() => {
      void kickWorker();
    }, Math.min(Math.max(500, delayMs), 300000));
  }

  async function scheduleNextWorkerRun() {
    const state = await refreshUi();
    if (!state.items.length || !canStartWork) return;

    const now = Date.now();
    const nextTimes = state.items.map((item) => (
      item.status === 'sending' ? item.claimExpiresAt : item.nextAttemptAt
    ));
    const earliest = Math.min(...nextTimes);
    armWorker(earliest <= now ? 500 : earliest - now);
  }

  async function runWorker() {
    let ownsLease = false;

    try {
      ownsLease = await acquireWorkerLease();
      if (!ownsLease) {
        armWorker(5000);
        return;
      }

      const startedAt = Date.now();

      while (canStartWork && Date.now() - startedAt < WORKER_BUDGET_MS) {
        if (!(await renewWorkerLease())) break;

        const claimed = await claimNextBatch();
        await refreshUi(claimed.state);
        if (!claimed.batch.length) break;

        try {
          const result = await postBatch(claimed.requestId, claimed.batch);
          const settled = await settleSuccess(claimed.requestId, claimed.batch, result);
          await refreshUi(settled.state);
        } catch (error) {
          const settled = await settleFailure(claimed.requestId, claimed.batch, error);
          await refreshUi(settled.state);
          console.error('队列批次发送失败，将稍后重试:', error);
        }
      }
    } finally {
      if (ownsLease) {
        try {
          await releaseWorkerLease();
        } catch (error) {
          console.error('释放 worker 租约失败:', error);
        }

      }
    }
  }

  async function kickWorker() {
    if (workerRunning || !canStartWork) return;

    workerRunning = true;

    try {
      // The expiring worker lease plus server-side D1 deduplication protects retries.
      await runWorker();
    } catch (error) {
      console.error('队列 worker 运行失败:', error);

      try {
        await mutateState((state) => {
          state.diagnostics.workerStatus = 'Worker 错误';
          state.diagnostics.lastWorkerAt = Date.now();
          state.diagnostics.lastWorkerMessage = truncate(error.message || error, 500);
          return { state };
        });
      } catch (storageError) {
        console.error('记录 worker 错误失败:', storageError);
      }
    } finally {
      workerRunning = false;

      try {
        await scheduleNextWorkerRun();
      } catch (error) {
        console.error('安排下次发送失败:', error);
      }
    }
  }

  async function handleExtractClick() {
    if (buttonBusy) return;

    buttonBusy = true;
    renderButton();

    try {
      const items = extractAll();

      if (!items.length) {
        showToast('未发现磁链或 hash');
        return;
      }

      const result = await enqueueItems(items);
      await refreshUi(result.state);

      if (result.added) {
        const duplicateText = result.duplicates ? `，已存在 ${result.duplicates} 条` : '';
        showToast(`已入列 ${result.added} 条${duplicateText}，队列共 ${result.count} 条`);
      } else {
        showToast(`提取结果已在活动队列中，共 ${result.count} 条`);
      }

      void kickWorker();
    } catch (error) {
      showToast(`入列失败：${error && error.message ? error.message : String(error)}`);
      console.error('持久化入列失败:', error);
    } finally {
      buttonBusy = false;
      renderButton();
    }
  }

  async function handleRetryNow() {
    // An explicit click means this tab is active, even if Safari missed a visibility event.
    canStartWork = true;
    try {
      const result = await mutateState((state) => {
        const recovered = recoverExpiredClaims(state, Date.now());

        for (const item of state.items) {
          // Never reset a live request; the Worker may already have committed it.
          if (item.status === 'pending') item.nextAttemptAt = 0;
        }

        const pending = state.items.filter((item) => item.status === 'pending').length;
        const sending = state.items.length - pending;
        state.diagnostics.lastWorkerMessage = `手动立即发送${recovered ? `，回收 ${recovered} 条` : ''}，待发送 ${pending} 条`;
        return { state, pending, sending };
      });

      await refreshUi(result.state);
      showToast(result.pending
        ? `正在尝试发送 ${result.pending} 条${result.sending ? `，另有 ${result.sending} 条处理中` : ''}`
        : result.sending ? `已有 ${result.sending} 条发送中，等待确认` : '队列为空');
      void kickWorker();
    } catch (error) {
      showToast(`无法启动发送：${error.message || error}`);
    }
  }

  function pingEndpointOnce() {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(makeRequestError('Userscripts 未提供 GM_xmlhttpRequest'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url: HEALTH_ENDPOINT,
        headers: { Authorization: 'Bearer ' + runtimeIngestSecret },
        responseType: 'text',
        timeout: REQUEST_TIMEOUT_MS,
        onload: (response) => {
          const body = String(response.responseText || '').trim();
          const status = Number(response.status) || 0;
          let data;

          try {
            data = JSON.parse(body);
          } catch {
            reject(makeRequestError('Ping 响应不是 JSON', {
              httpStatus: status,
              responseBody: body,
              durationMs: Date.now() - startedAt,
              responseCode: 'INVALID_JSON'
            }));
            return;
          }

          if (status < 200 || status >= 300) {
            reject(makeRequestError('Ping HTTP ' + status + '：' + (data && data.code || 'ERROR'), {
              httpStatus: status,
              responseBody: body,
              durationMs: Date.now() - startedAt,
              responseCode: String(data && data.code || 'HTTP_ERROR')
            }));
            return;
          }

          if (
            Number(data.protocol) !== PROTOCOL_VERSION ||
            data.ok !== true ||
            data.code !== 'PONG' ||
            data.write !== false
          ) {
            reject(makeRequestError('Ping 协议不匹配：' + (data.code || 'UNKNOWN'), {
              httpStatus: status,
              responseBody: body,
              durationMs: Date.now() - startedAt,
              responseCode: String(data.code || 'BAD_PING')
            }));
            return;
          }

          resolve({ status, body: truncate(body), durationMs: Date.now() - startedAt });
        },
        onerror: () => reject(makeRequestError('Ping 网络请求失败', { responseCode: 'NETWORK_ERROR' })),
        ontimeout: () => reject(makeRequestError('Ping 请求超时', { responseCode: 'TIMEOUT' })),
        onabort: () => reject(makeRequestError('Ping 请求中止', { responseCode: 'ABORTED' }))
      });
    });
  }

  async function pingEndpoint() {
    const delays = [0, 1000, 2500];
    let lastError;

    for (const delay of delays) {
      if (delay) await sleep(delay);

      try {
        return await pingEndpointOnce();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async function handlePing(event) {
    const button = event && event.currentTarget;
    if (button) button.disabled = true;

    try {
      const result = await pingEndpoint();
      const updated = await mutateState((state) => {
        state.diagnostics.lastPingAt = Date.now();
        state.diagnostics.lastPingStatus = `Ping 成功：HTTP ${result.status}，${result.durationMs}ms`;
        state.diagnostics.lastPingResponse = result.body;
        return { state };
      });
      await refreshUi(updated.state);
      showToast('接口 Ping 成功，不写入表格');
    } catch (error) {
      const updated = await mutateState((state) => {
        state.diagnostics.lastPingAt = Date.now();
        state.diagnostics.lastPingStatus = `Ping 失败：${error.message || error}`;
        state.diagnostics.lastPingResponse = truncate(error.responseBody);
        return { state };
      });
      await refreshUi(updated.state);
      showToast(`Ping 失败：${error.message || error}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function syncAndKick() {
    try {
      await refreshUi();
      void kickWorker();
    } catch (error) {
      console.error('读取持久化队列失败:', error);
    }
  }

  function bindLifecycleEvents() {
    window.addEventListener('pagehide', () => {
      canStartWork = false;
      clearTimeout(workerTimer);
    });

    window.addEventListener('pageshow', () => {
      canStartWork = true;
      void syncAndKick();
    });

    window.addEventListener('focus', () => {
      canStartWork = true;
      void syncAndKick();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        canStartWork = true;
        void syncAndKick();
      } else {
        canStartWork = false;
        clearTimeout(workerTimer);
      }
    });

    setInterval(() => {
      if (document.visibilityState === 'visible') {
        void syncAndKick();
      }
    }, 15000);
  }

  async function init() {
    createUi();
    bindLifecycleEvents();

    try {
      // Migrate authorization into per-script GM storage before future public updates.
      await provisionIngestSecret();
      const state = await loadState();
      await refreshUi(state);
      renderButton();
      void kickWorker();
    } catch (error) {
      buttonBusy = false;
      const button = document.getElementById(BUTTON_ID);
      if (button) {
        button.disabled = true;
        button.textContent = '队列不可用（查看错误）';
      }
      showToast(`队列未启动：${error && error.message ? error.message : String(error)}`);
      console.error('初始化队列失败:', error);
    }
  }

  if (typeof globalThis !== 'undefined' && globalThis.__HJD_QUEUE_TEST_MODE__) {
    globalThis.__HJD_QUEUE_TEST_API__ = {
      provisionIngestSecret,
      createEmptyState,
      normalizeState,
      migrateLegacyState,
      loadState,
      mutateState,
      createQueueItem,
      enqueueItems,
      recoverExpiredClaims,
      claimNextBatch,
      validateSuccessResponse,
      postBatch,
      settleSuccess,
      settleFailure,
      pingEndpoint,
      collectVisibleText,
      collectMagnetText,
      extractMagnets,
      extractUrlHashes,
      extractHashes,
      extractAll,
      extractBtihHash,
      dedupeByHash
    };
  } else {
    // Show controls as soon as <body> exists, without touching an incomplete <html> tree.
    // Wait for DOMContentLoaded before accessing persistent storage or starting requests.
    const mountControls = () => {
      if (!document.body) return false;
      createUi();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
      } else {
        void init();
      }
      return true;
    };

    if (!mountControls()) {
      const bodyObserver = new MutationObserver(() => {
        if (!document.body) return;
        bodyObserver.disconnect();
        mountControls();
      });
      bodyObserver.observe(document, { childList: true, subtree: true });
    }
  }
})();
