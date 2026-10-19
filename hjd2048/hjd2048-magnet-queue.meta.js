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
