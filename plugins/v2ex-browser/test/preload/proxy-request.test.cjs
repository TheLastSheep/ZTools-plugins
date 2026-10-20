const assert = require('node:assert/strict')
const test = require('node:test')
const { isAllowedAvatarUrl, readMacHttpsProxy, readWindowsHttpsProxy } = require('../../src-ztools/preload/proxy-request.cjs')

test('从 macOS 系统代理配置读取 HTTPS 代理地址', () => {
  const proxy = readMacHttpsProxy(() => `
    <dictionary> {
      HTTPSEnable : 1
      HTTPSPort : 10808
      HTTPSProxy : 127.0.0.1
    }
  `)

  assert.deepEqual(proxy, { host: '127.0.0.1', port: 10808 })
})

test('macOS 关闭 HTTPS 系统代理时直连', () => {
  assert.equal(readMacHttpsProxy(() => 'HTTPSEnable : 0'), null)
})

test('macOS 启用自动代理时给出明确错误', () => {
  assert.throws(() => readMacHttpsProxy(() => 'ProxyAutoConfigEnable : 1'), /暂不支持 PAC\/WPAD/)
})

test('从 Windows 代理配置读取 HTTPS 代理地址', () => {
  const proxy = readWindowsHttpsProxy(() => 'ProxyEnable    REG_DWORD    0x1\r\nProxyServer    REG_SZ    http=127.0.0.1:10809;https=127.0.0.1:10808')
  assert.deepEqual(proxy, { host: '127.0.0.1', port: 10808 })
})

test('Windows 关闭系统代理时忽略保存的旧地址', () => {
  assert.equal(readWindowsHttpsProxy(() => 'ProxyEnable    REG_DWORD    0x0\r\nProxyServer    REG_SZ    127.0.0.1:10808'), null)
})

test('Windows 只配置 HTTP 代理时对 HTTPS 请求直连', () => {
  assert.equal(readWindowsHttpsProxy(() => 'ProxyEnable    REG_DWORD    0x1\r\nProxyServer    REG_SZ    http=127.0.0.1:10808'), null)
})

test('Windows 启用自动代理时给出明确错误', () => {
  assert.throws(() => readWindowsHttpsProxy(() => 'AutoConfigURL    REG_SZ    http://proxy.example/proxy.pac'), /暂不支持 PAC\/WPAD/)
})

test('每次读取都会使用最新的系统代理开关', () => {
  let macConfig = 'HTTPSEnable : 0'
  let windowsConfig = 'ProxyEnable    REG_DWORD    0x0\r\nProxyServer    REG_SZ    127.0.0.1:10808'
  assert.equal(readMacHttpsProxy(() => macConfig), null)
  assert.equal(readWindowsHttpsProxy(() => windowsConfig), null)

  macConfig = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 10808'
  windowsConfig = 'ProxyEnable    REG_DWORD    0x1\r\nProxyServer    REG_SZ    127.0.0.1:10808'
  assert.deepEqual(readMacHttpsProxy(() => macConfig), { host: '127.0.0.1', port: 10808 })
  assert.deepEqual(readWindowsHttpsProxy(() => windowsConfig), { host: '127.0.0.1', port: 10808 })
})

test('只允许 V2EX CDN 和 Gravatar 的 HTTPS 头像地址', () => {
  assert.equal(isAllowedAvatarUrl('https://cdn.v2ex.com/avatar/example.png'), true)
  assert.equal(isAllowedAvatarUrl('https://www.gravatar.com/avatar/example'), true)
  assert.equal(isAllowedAvatarUrl('https://example.com/avatar.png'), false)
  assert.equal(isAllowedAvatarUrl('http://cdn.v2ex.com/avatar/example.png'), false)
})
