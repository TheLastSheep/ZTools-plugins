const http = require('node:http')
const https = require('node:https')
const tls = require('node:tls')
const { execFileSync } = require('node:child_process')

function readMacHttpsProxy(readProxyConfig = () => execFileSync('scutil', ['--proxy'], { encoding: 'utf8' })) {
  const config = readProxyConfig()
  if (/ProxyAutoConfigEnable\s*:\s*1/.test(config) || /ProxyAutoDiscoveryEnable\s*:\s*1/.test(config)) {
    throw new Error('当前 macOS 使用自动代理配置，本插件暂不支持 PAC/WPAD。')
  }
  const enabled = /HTTPSEnable\s*:\s*1/.test(config)
  if (!enabled) return null
  const host = /HTTPSProxy\s*:\s*([^\s}]+)/.exec(config)?.[1]
  const port = Number(/HTTPSPort\s*:\s*(\d+)/.exec(config)?.[1])
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('macOS HTTPS 系统代理已启用，但地址或端口无效。')
  }
  return { host, port }
}

function readWindowsHttpsProxy(readProxyConfig = () => execFileSync('reg', [
  'query',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
], { encoding: 'utf8' })) {
  let config
  try {
    config = readProxyConfig()
  } catch {
    return null
  }
  if (/AutoConfigURL\s+REG_\w+\s+\S+/i.test(config)) {
    throw new Error('当前 Windows 使用自动代理配置，本插件暂不支持 PAC/WPAD。')
  }
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x0*1(?:\s|$)/i.test(config)
  if (!enabled) return null
  const value = /ProxyServer\s+REG_\w+\s+([^\r\n]+)/i.exec(config)?.[1]?.trim()
  if (!value) throw new Error('Windows HTTPS 系统代理已启用，但没有配置代理地址。')
  const address = /(?:^|;)https=([^;]+)/i.exec(value)?.[1] ||
    (value.includes('=') ? null : value)
  if (!address) return null
  const match = /^([^:\s]+):(\d+)$/.exec(address)
  const port = Number(match?.[2])
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Windows HTTPS 系统代理已启用，但地址或端口无效。')
  }
  return { host: match[1], port }
}

function readSystemHttpsProxy() {
  if (process.platform === 'win32') return readWindowsHttpsProxy()
  if (process.platform === 'darwin') return readMacHttpsProxy()
  return null
}

function isAllowedAvatarUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'cdn.v2ex.com' || url.hostname === 'www.gravatar.com')
  } catch {
    return false
  }
}

class HttpsProxyAgent extends https.Agent {
  constructor(proxy) {
    super()
    this.proxy = proxy
  }

  createConnection(options, callback) {
    const connectRequest = http.request({
      host: this.proxy.host,
      port: this.proxy.port,
      method: 'CONNECT',
      path: `${options.host}:${options.port || 443}`,
      headers: { Host: `${options.host}:${options.port || 443}` }
    })
    connectRequest.setTimeout(12_000, () => connectRequest.destroy(new Error('连接系统代理超时。')))
    connectRequest.once('error', callback)
    connectRequest.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        callback(new Error(`系统代理拒绝连接 V2EX（HTTP ${response.statusCode}）。`))
        return
      }
      if (head.length) socket.unshift(head)
      const secureSocket = tls.connect({
        socket,
        servername: options.host,
        ALPNProtocols: ['http/1.1']
      })
      secureSocket.setTimeout(12_000, () => secureSocket.destroy(new Error('V2EX TLS 连接超时。')))
      secureSocket.once('error', callback)
      secureSocket.once('secureConnect', () => callback(null, secureSocket))
    })
    connectRequest.end()
  }
}

function requestViaHttpsProxy(url, proxy, headers = {}) {
  const target = new URL(url)
  if (target.protocol !== 'https:') throw new Error('仅支持 HTTPS 的 V2EX 请求。')
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined

  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      headers,
      agent,
      timeout: 20_000
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.once('error', reject)
      response.once('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`V2EX 服务暂时不可用（HTTP ${response.statusCode}）。`))
          return
        }
        resolve({ body: Buffer.concat(chunks), contentType: response.headers['content-type'] || '' })
      })
    })
    request.once('timeout', () => request.destroy(new Error('V2EX 请求超时。')))
    request.once('error', reject)
  })
}

async function requestJsonViaHttpsProxy(url, proxy) {
  const result = await requestViaHttpsProxy(url, proxy, { Accept: 'application/json' })
  try {
    return JSON.parse(result.body.toString('utf8'))
  } catch {
    throw new Error('V2EX 返回了无法识别的数据。')
  }
}

function createSystemProxyRequest(readProxyConfig) {
  return (url) => requestJsonViaHttpsProxy(url, readProxyConfig ? readMacHttpsProxy(readProxyConfig) : readSystemHttpsProxy())
}

async function requestAvatarDataUrl(url, readProxyConfig) {
  if (!isAllowedAvatarUrl(url)) throw new Error('不支持的头像地址。')
  const proxy = readProxyConfig ? readMacHttpsProxy(readProxyConfig) : readSystemHttpsProxy()
  let result
  try {
    result = await requestViaHttpsProxy(url, proxy, { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' })
  } catch {
    result = await requestViaHttpsProxy(url, proxy, { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*' })
  }
  const mimeType = result.contentType.split(';')[0].toLowerCase()
  if (!/^image\/(avif|gif|jpe?g|png|webp)$/.test(mimeType)) throw new Error('头像服务未返回有效图片。')
  if (result.body.length > 512 * 1024) throw new Error('头像图片过大。')
  return `data:${mimeType};base64,${result.body.toString('base64')}`
}

module.exports = { createSystemProxyRequest, HttpsProxyAgent, isAllowedAvatarUrl, readMacHttpsProxy, readSystemHttpsProxy, readWindowsHttpsProxy, requestAvatarDataUrl, requestJsonViaHttpsProxy }
