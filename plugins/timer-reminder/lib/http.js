/**
 * http.js —— 极简 HTTP/HTTPS 请求封装（preload 专用，CommonJS）
 *
 * 不依赖 global fetch（preload 的 Node 版本不保证提供），统一走 node:http / node:https。
 * 供大模型客户端、短信宝、自定义 Webhook 使用。
 *
 * 代理：node:http 默认不读系统代理，这里遵循 Node 生态惯例读取环境变量
 * HTTPS_PROXY / HTTP_PROXY（含小写），命中 NO_PROXY 时直连，否则经代理转发。
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');
const { URL } = require('node:url');

/* ------------------------------------------------------------------ *
 * 环境代理
 * ------------------------------------------------------------------ */

function proxyFor(parsed) {
  let env;
  try {
    env = process.env;
  } catch (e) {
    return null;
  }
  const noProxy = String(env.NO_PROXY || env.no_proxy || '');
  const host = parsed.hostname;
  const targets = noProxy.split(',').map((s) => s.trim()).filter(Boolean);
  for (const t of targets) {
    if (t === '*') return null;
    if (t.charAt(0) === '.') {
      if (host === t.slice(1) || host.endsWith(t)) return null;
    } else if (host === t || host.endsWith('.' + t)) {
      return null;
    }
  }
  const raw =
    parsed.protocol === 'https:'
      ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
      : env.HTTP_PROXY || env.http_proxy;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch (e) {
    return null;
  }
}

/**
 * 连接代理：http 目标返回代理明文连接；https 目标先 CONNECT 建隧道再返回 TLS 连接。
 */
function connectViaProxy(proxy, target, callback) {
  const isHttps = target.protocol === 'https:';
  const port = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
  const raw = net.connect({ host: proxy.hostname, port: port });
  raw.once('error', (e) => callback(e));
  raw.once('connect', () => {
    if (!isHttps) {
      callback(null, raw);
      return;
    }
    let authLine = '';
    if (proxy.username) {
      authLine =
        'Proxy-Authorization: Basic ' +
        Buffer.from(proxy.username + ':' + (proxy.password || ''), 'utf8').toString('base64') +
        '\r\n';
    }
    raw.write(
      'CONNECT ' + target.hostname + ':' + (target.port || 443) + ' HTTP/1.1\r\n' +
      'Host: ' + target.hostname + ':' + (target.port || 443) + '\r\n' + authLine + '\r\n'
    );
    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      raw.removeListener('data', onData);
      const status = parseInt(buf.slice(9, 12), 10) || 0;
      if (status !== 200) {
        raw.destroy();
        callback(new Error('代理 CONNECT 失败: ' + status));
        return;
      }
      const tlsSock = tls.connect({ socket: raw, servername: target.hostname });
      tlsSock.once('secureConnect', () => callback(null, tlsSock));
      tlsSock.once('error', (e) => callback(e));
    };
    raw.on('data', onData);
  });
}

/**
 * 发起请求。
 * @param {string} url 完整地址
 * @param {{method?:string, headers?:object, body?:string|Buffer, timeout?:number}} [options]
 * @returns {Promise<{status:number, body:string, headers:object}>}
 */
function request(url, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error('URL 不合法: ' + url));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const proxy = proxyFor(parsed);

    const issue = (socket) => {
      const reqOpts = {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        timeout: opts.timeout != null ? opts.timeout : 15000
      };
      if (socket) {
        reqOpts.createConnection = () => socket;
        if (proxy && !isHttps) {
          // 经代理的 http 请求需用绝对 URI 作为请求行
          reqOpts.path = parsed.href;
          reqOpts.headers = Object.assign({ Host: parsed.host }, opts.headers || {});
          if (proxy.username) {
            reqOpts.headers['Proxy-Authorization'] =
              'Basic ' + Buffer.from(proxy.username + ':' + (proxy.password || ''), 'utf8').toString('base64');
          }
        }
      }
      const req = lib.request(
        parsed,
        reqOpts,
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers || {},
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy(new Error('请求超时: ' + url));
      });
      req.on('error', (e) => reject(e));
      if (opts.body != null) req.write(opts.body);
      req.end();
    };

    if (proxy) {
      connectViaProxy(proxy, parsed, (err, socket) => {
        if (err) return reject(err);
        issue(socket);
      });
    } else {
      issue(null);
    }
  });
}

function postJson(url, payload, headers) {
  const body = JSON.stringify(payload);
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
    body
  });
}

function postForm(url, params, headers) {
  const body = Object.keys(params)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  return request(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, headers || {}),
    body
  });
}

function get(url, headers) {
  return request(url, { method: 'GET', headers: headers || {} });
}

module.exports = { request, postJson, postForm, get };
