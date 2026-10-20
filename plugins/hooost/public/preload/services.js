const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { exec, execFile, execFileSync, execSync } = require('node:child_process')
const { promisify } = require('node:util')

const APP_DIR_NAME = 'hooost'
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

function escapePowerShellArg(value) {
  return String(value).replace(/'/g, "''")
}

function runCommand(command, options = {}) {
  execSync(command, { stdio: 'ignore', ...options })
}

async function runCommandAsync(command, options = {}) {
  await execAsync(command, { windowsHide: true, ...options })
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getDataDir() {
  const platform = os.platform()

  if (platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      APP_DIR_NAME
    )
  }

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME)
  }

  // Linux 遵循 XDG 规范存放数据，避免沿用 macOS 的 Library 目录
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    APP_DIR_NAME
  )
}

function getHostsPath() {
  return os.platform() === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts'
}

function getBackupsDir() {
  const dir = path.join(getDataDir(), 'backups')
  ensureDir(dir)
  return dir
}

function getTmpDir() {
  const dir = path.join(getDataDir(), 'tmp')
  ensureDir(dir)
  return dir
}

function createTimestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').substring(0, 15)
}

function createBackupFileName(name) {
  const safeName = name ? String(name).replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown'
  return `${createTimestamp()}_${safeName}.hosts`
}

function backupCurrentHosts(name) {
  const hostsPath = getHostsPath()
  const backupPath = path.join(getBackupsDir(), createBackupFileName(name))
  fs.copyFileSync(hostsPath, backupPath)
  return backupPath
}

function createTempHostsFile(content) {
  const tmpFile = path.join(getTmpDir(), `hosts_${Date.now()}`)
  fs.writeFileSync(tmpFile, content, { encoding: 'utf-8' })
  return tmpFile
}

function removeTempFile(filePath) {
  if (!filePath) return

  try {
    fs.unlinkSync(filePath)
  } catch {
    // ignore
  }
}

function copyFileElevatedOnWindows(sourcePath, targetPath) {
  const source = escapePowerShellArg(sourcePath)
  const target = escapePowerShellArg(targetPath)
  const innerCommand = `$ErrorActionPreference = 'Stop'; Copy-Item -LiteralPath '${source}' -Destination '${target}' -Force`
  const encodedCommand = Buffer.from(innerCommand, 'utf16le').toString('base64')

  runCommand(
    `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}'"`
  )
}

// 查找命令的绝对路径，找不到时返回空字符串；pkexec 出于安全考虑要求被调用程序使用绝对路径
function findExecutablePath(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf-8', windowsHide: true }).trim()
  } catch {
    return ''
  }
}

// Linux 提权复制：先用 sudo -n 静默尝试（root 或 NOPASSWD 用户无感通过），
// 失败后回退到 pkexec 弹出 polkit 图形授权窗口；两者都不可用或用户取消授权时抛出带指引的错误
async function copyFileElevatedOnLinux(sourcePath, targetPath) {
  const cpPath = findExecutablePath('cp') || '/usr/bin/cp'

  try {
    await execFileAsync('sudo', ['-n', cpPath, sourcePath, targetPath], { windowsHide: true })
    return
  } catch {
    // sudo 需要密码或不可用，继续尝试 pkexec
  }

  try {
    await execFileAsync('pkexec', [cpPath, sourcePath, targetPath], { windowsHide: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Linux 提权写入失败（需 polkit 图形授权，请确认桌面环境已安装 polkit 认证代理）: ${detail}`
    )
  }
}

function copyFileWithPrivilege(sourcePath, targetPath) {
  try {
    fs.copyFileSync(sourcePath, targetPath)
    return
  } catch {
    copyFileElevatedOnWindows(sourcePath, targetPath)
  }
}

function isWritable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function ensureMacHostsWritable(hostsPath) {
  if (isWritable(hostsPath)) return

  const chmodCommand = `chmod go+w ${JSON.stringify(hostsPath)}`

  try {
    await runCommandAsync(chmodCommand)
    return
  } catch {
    const appleScript = `do shell script ${JSON.stringify(chmodCommand)} with administrator privileges`
    await runCommandAsync(`osascript -e ${JSON.stringify(appleScript)}`)
  }
}

async function writeHostsContent(content, hostsPath, platform) {
  if (platform === 'win32') {
    const tmpFile = createTempHostsFile(content)

    try {
      copyFileWithPrivilege(tmpFile, hostsPath)
    } finally {
      removeTempFile(tmpFile)
    }
    return
  }

  // Linux 下 /etc/hosts 属于 root，普通用户直接写入会 EACCES：
  // 先直接复制（root 运行时可用），失败后走 sudo/pkexec 提权；经 cp 截断写入可保留原文件的属主与权限
  if (platform === 'linux') {
    const tmpFile = createTempHostsFile(content)

    try {
      try {
        fs.copyFileSync(tmpFile, hostsPath)
      } catch {
        await copyFileElevatedOnLinux(tmpFile, hostsPath)
      }
    } finally {
      removeTempFile(tmpFile)
    }
    return
  }

  if (platform === 'darwin') {
    await ensureMacHostsWritable(hostsPath)
  }

  fs.writeFileSync(hostsPath, content, { encoding: 'utf-8' })
}

function flushDns(platform) {
  try {
    if (platform === 'win32') {
      runCommand('ipconfig /flushdns')
      return
    }

    if (platform === 'darwin') {
      runCommand('dscacheutil -flushcache')
      runCommand('killall -HUP mDNSResponder')
      return
    }

    // Linux 兼容新版 resolvectl 与旧版 systemd-resolve，失败时由外层 try/catch 忽略
    if (platform === 'linux') {
      runCommand('resolvectl flush-caches || systemd-resolve --flush-caches')
      return
    }
  } catch {
    // ignore
  }
}

function getBackupEntries() {
  return fs
    .readdirSync(getBackupsDir())
    .filter((file) => file.endsWith('.hosts'))
    .sort()
    .reverse()
    .map((file) => {
      const fullPath = path.join(getBackupsDir(), file)
      let stat = null

      try {
        stat = fs.statSync(fullPath)
      } catch {
        stat = null
      }

      return {
        filename: file,
        path: fullPath,
        createdAt: stat ? stat.mtime.toISOString() : '',
      }
    })
}

window.services = {
  getSystemInfo() {
    const platform = os.platform()
    return {
      platform: platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux',
      hostsPath: getHostsPath(),
      dataDir: getDataDir(),
    }
  },

  getThemeInfo() {
    return window.ztools.getThemeInfo()
  },

  onThemeChange(callback) {
    window.ztools.onThemeChange(callback)
  },

  readHosts() {
    return fs.readFileSync(getHostsPath(), { encoding: 'utf-8' })
  },

  listBackups() {
    return getBackupEntries()
  },

  async applyHosts(content, envName) {
    const hostsPath = getHostsPath()
    const platform = os.platform()
    const normalizedContent = platform === 'win32' ? content : content.replace(/\r\n/g, '\n')
    const backupPath = backupCurrentHosts(envName)

    try {
      await writeHostsContent(normalizedContent, hostsPath, platform)
      flushDns(platform)
      return { success: true, backupPath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        backupPath,
      }
    }
  },

  async restoreBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' }
    }

    const hostsPath = getHostsPath()
    const platform = os.platform()
    const content = fs.readFileSync(backupPath, { encoding: 'utf-8' })

    try {
      backupCurrentHosts('pre-restore')
    } catch {
      // ignore
    }

    try {
      await writeHostsContent(content, hostsPath, platform)
      flushDns(platform)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
}
