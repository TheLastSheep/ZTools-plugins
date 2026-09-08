const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const iconCache = new Map();
let bundleIndex = null;

function buildBundleIndex() {
  if (bundleIndex) return bundleIndex;
  bundleIndex = new Map();
  if (process.platform !== 'darwin') return bundleIndex;

  const appDirs = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
  for (const appDir of appDirs) {
    if (!fs.existsSync(appDir)) continue;
    try {
      const entries = fs.readdirSync(appDir);
      for (const entry of entries) {
        if (!entry.endsWith('.app')) continue;
        const fullAppPath = path.join(appDir, entry);
        const nameWithoutExt = entry.replace(/\.app$/i, '');
        bundleIndex.set(nameWithoutExt.toLowerCase(), fullAppPath);
        bundleIndex.set(entry.toLowerCase(), fullAppPath);

        const plistPath = path.join(fullAppPath, 'Contents/Info.plist');
        if (fs.existsSync(plistPath)) {
          try {
            const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 1000
            });
            const plist = JSON.parse(out);
            if (plist.CFBundleIdentifier) {
              bundleIndex.set(plist.CFBundleIdentifier.toLowerCase(), fullAppPath);
            }
            if (plist.CFBundleName) {
              bundleIndex.set(plist.CFBundleName.toLowerCase(), fullAppPath);
            }
          } catch {}
        }
      }
    } catch {}
  }
  return bundleIndex;
}

function resolveAppPath(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/') && fs.existsSync(trimmed)) {
    let curr = trimmed;
    while (curr && curr !== '/' && curr !== '.') {
      if (curr.endsWith('.app')) return curr;
      curr = path.dirname(curr);
    }
  }

  const idx = buildBundleIndex();
  const lower = trimmed.toLowerCase();
  if (idx.has(lower)) return idx.get(lower);

  const cleanQuery = lower.replace(/^(com|org|net|io)\.[^.]+\./, '').replace(/[^a-z0-9]/g, '');
  if (cleanQuery.length >= 3) {
    for (const [key, appPath] of idx.entries()) {
      const cleanKey = key.replace(/^(com|org|net|io)\.[^.]+\./, '').replace(/[^a-z0-9]/g, '');
      if (cleanKey.includes(cleanQuery) || cleanQuery.includes(cleanKey)) {
        return appPath;
      }
    }
  }

  return null;
}

function extractDarwinIcon(appPath) {
  if (!appPath || typeof appPath !== 'string') return null;
  if (iconCache.has(appPath)) return iconCache.get(appPath);

  try {
    const resourcesDir = path.join(appPath, 'Contents/Resources');
    if (!fs.existsSync(resourcesDir)) {
      iconCache.set(appPath, null);
      return null;
    }

    let iconFileName = null;
    const plistPath = path.join(appPath, 'Contents/Info.plist');
    if (fs.existsSync(plistPath)) {
      try {
        const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1000
        });
        const plist = JSON.parse(out);
        if (plist.CFBundleIconFile) {
          iconFileName = plist.CFBundleIconFile.endsWith('.icns') ? plist.CFBundleIconFile : plist.CFBundleIconFile + '.icns';
        }
      } catch {}
    }

    if (!iconFileName || !fs.existsSync(path.join(resourcesDir, iconFileName))) {
      const resFiles = fs.readdirSync(resourcesDir);
      const foundIcns = resFiles.find(f => f.endsWith('.icns'));
      if (foundIcns) iconFileName = foundIcns;
    }

    if (!iconFileName) {
      iconCache.set(appPath, null);
      return null;
    }

    const icnsFullPath = path.join(resourcesDir, iconFileName);
    if (!fs.existsSync(icnsFullPath)) {
      iconCache.set(appPath, null);
      return null;
    }

    const tmpPng = path.join(os.tmpdir(), 'ztools-icon-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.png');
    execFileSync('sips', ['-s', 'format', 'png', icnsFullPath, '--out', tmpPng, '-z', '48', '48'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 2000
    });

    if (fs.existsSync(tmpPng)) {
      const buffer = fs.readFileSync(tmpPng);
      try { fs.unlinkSync(tmpPng); } catch {}
      const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
      iconCache.set(appPath, dataUrl);
      return dataUrl;
    }
  } catch {}

  iconCache.set(appPath, null);
  return null;
}

function getAppIconDataUrl(appPathOrName) {
  if (!appPathOrName || typeof appPathOrName !== 'string') return '';
  const resolved = resolveAppPath(appPathOrName);
  if (resolved) {
    const icon = extractDarwinIcon(resolved);
    if (icon) return icon;
  }
  return '';
}

function getLetterSvgIcon(name) {
  const clean = (name || 'App').trim().replace(/^(com|org|net|io)\.[^.]+\./i, '');
  const letter = (clean[0] || 'A').toUpperCase();
  const colors = [
    ['#3B82F6', '#1D4ED8'],
    ['#10B981', '#047857'],
    ['#8B5CF6', '#6D28D9'],
    ['#F59E0B', '#B45309'],
    ['#EC4899', '#BE185D'],
    ['#06B6D4', '#0E7490']
  ];
  const colorIndex = (letter.charCodeAt(0) || 0) % colors.length;
  const [c1, c2] = colors[colorIndex];
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="10" fill="url(#g)" />
  <text x="24" y="31" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="600" fill="#FFFFFF" text-anchor="middle">${letter}</text>
</svg>`);
}

module.exports = {
  buildBundleIndex,
  resolveAppPath,
  extractDarwinIcon,
  getAppIconDataUrl,
  getLetterSvgIcon
};
