const CATEGORY_LABELS = {
  cache: '应用与系统缓存',
  temporary: '临时工作文件',
  logs: '诊断与运行日志'
}

const elements = {
  scanButton: document.getElementById('scan-button'),
  cleanButton: document.getElementById('clean-button'),
  resultPanel: document.getElementById('result-panel'),
  statusPanel: document.getElementById('status-panel'),
  candidateList: document.getElementById('candidate-list'),
  totalSize: document.getElementById('total-size'),
  selectedSize: document.getElementById('selected-size'),
  selectedCount: document.getElementById('selected-count'),
  scanMeta: document.getElementById('scan-meta'),
  warnings: document.getElementById('scan-warnings'),
  template: document.getElementById('candidate-template')
}

const state = {
  snapshotId: null,
  candidates: [],
  busy: false,
  expandedGroups: new Set()
}

const api = window.systemCleaner || null

function selectedCandidates() {
  const selected = new Set([...document.querySelectorAll('.candidate-check:checked')].map((input) => input.dataset.id))
  return state.candidates.filter((item) => selected.has(item.id))
}

function updateSelection() {
  const selected = selectedCandidates()
  const bytes = selected.reduce((sum, item) => sum + item.sizeBytes, 0)
  elements.selectedSize.textContent = formatBytes(bytes)
  elements.selectedCount.textContent = `已选 ${selected.length} 项`
  elements.cleanButton.disabled = state.busy || selected.length === 0

  document.querySelectorAll('.group-card').forEach((card) => {
    const groupCheck = card.querySelector('.group-check')
    if (!groupCheck) return
    const childChecks = [...card.querySelectorAll('.child-item .candidate-check')]
    if (!childChecks.length) return
    const checkedCount = childChecks.filter(c => c.checked).length
    if (checkedCount === 0) {
      groupCheck.checked = false
      groupCheck.indeterminate = false
    } else if (checkedCount === childChecks.length) {
      groupCheck.checked = true
      groupCheck.indeterminate = false
    } else {
      groupCheck.checked = false
      groupCheck.indeterminate = true
    }
  })
}

function setBusy(busy) {
  state.busy = busy
  elements.scanButton.disabled = busy
  elements.cleanButton.disabled = busy || selectedCandidates().length === 0
  document.querySelectorAll('.candidate-check, .group-check').forEach((input) => { input.disabled = busy })
  document.querySelectorAll('input[name=category]').forEach((input) => { input.disabled = busy })
}

function render(result) {
  state.snapshotId = result.snapshotId
  state.candidates = result.candidates || []
  elements.candidateList.replaceChildren()
  elements.totalSize.textContent = formatBytes(result.totalBytes)
  elements.scanMeta.textContent = `${state.candidates.length} 项 · ${new Date(result.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  elements.warnings.hidden = !result.warnings?.length
  elements.warnings.textContent = (result.warnings || []).map((warning) => warning.message || warning.code).join('；')

  if (!state.candidates.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = '所选分类中没有可安全清理的项目。'
    elements.candidateList.append(empty)
    elements.statusPanel.hidden = true
    elements.resultPanel.hidden = false
    updateSelection()
    return
  }

  // 按应用/宿主归并同一 App 的子项
  const groupsMap = new Map()
  for (const c of state.candidates) {
    const key = c.appName || c.label || '系统通用缓存'
    if (!groupsMap.has(key)) {
      groupsMap.set(key, { name: key, icon: c.icon, items: [] })
    }
    const g = groupsMap.get(key)
    if (!g.icon && c.icon) g.icon = c.icon
    g.items.push(c)
  }

  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    const sizeA = a.items.reduce((sum, it) => sum + it.sizeBytes, 0)
    const sizeB = b.items.reduce((sum, it) => sum + it.sizeBytes, 0)
    return sizeB - sizeA
  })

  for (const group of groups) {
    const groupCard = document.createElement('section')
    groupCard.className = 'group-card'

    const totalBytes = group.items.reduce((sum, it) => sum + it.sizeBytes, 0)
    const hasMultiple = group.items.length > 1
    const isExpanded = state.expandedGroups.has(group.name)

    const header = document.createElement('div')
    header.className = 'candidate group-header'

    const selectLabel = document.createElement('label')
    selectLabel.className = 'candidate-select'
    const groupCheck = document.createElement('input')
    groupCheck.type = 'checkbox'
    groupCheck.className = 'group-check candidate-check-hidden'
    groupCheck.setAttribute('aria-label', `选择 ${group.name}`)
    const checkSpan = document.createElement('span')
    checkSpan.setAttribute('aria-hidden', 'true')
    selectLabel.append(groupCheck, checkSpan)

    const iconImg = document.createElement('img')
    iconImg.className = 'candidate-icon'
    iconImg.alt = ''
    iconImg.setAttribute('aria-hidden', 'true')
    if (group.icon) iconImg.src = group.icon

    const mainDiv = document.createElement('div')
    mainDiv.className = 'candidate-main'
    const titleRow = document.createElement('div')
    const strongName = document.createElement('strong')
    strongName.className = 'candidate-label'
    strongName.textContent = group.name
    titleRow.append(strongName)

    if (hasMultiple) {
      const countBadge = document.createElement('span')
      countBadge.className = 'candidate-badge group-badge'
      countBadge.textContent = `${group.items.length} 处项目 (默认折叠)`
      titleRow.append(countBadge)
    } else {
      const badge = document.createElement('span')
      badge.className = 'candidate-badge'
      badge.textContent = CATEGORY_LABELS[group.items[0].category] || group.items[0].category
      titleRow.append(badge)
    }

    const subP = document.createElement('p')
    subP.className = 'candidate-location'
    subP.textContent = hasMultiple ? `聚合该应用的 ${group.items.length} 处缓存与日志目录` : group.items[0].location
    mainDiv.append(titleRow, subP)

    const infoDiv = document.createElement('div')
    infoDiv.className = 'candidate-info'
    const sizeStrong = document.createElement('strong')
    sizeStrong.className = 'candidate-size'
    sizeStrong.textContent = formatBytes(totalBytes)
    const ageSpan = document.createElement('span')
    ageSpan.className = 'candidate-age'
    ageSpan.textContent = hasMultiple ? '应用级聚合' : (group.items[0].ageDays ? `${group.items[0].ageDays} 天未更新` : '近期项目')
    infoDiv.append(sizeStrong, ageSpan)

    let actionBtn = null
    if (hasMultiple) {
      actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.className = 'quiet toggle-expand-btn'
      actionBtn.textContent = isExpanded ? '收起' : '展开'
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (state.expandedGroups.has(group.name)) {
          state.expandedGroups.delete(group.name)
        } else {
          state.expandedGroups.add(group.name)
        }
        render({ snapshotId: state.snapshotId, candidates: state.candidates, totalBytes: result.totalBytes, generatedAt: result.generatedAt, warnings: result.warnings })
      })
    } else {
      actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.className = 'reveal-button quiet'
      actionBtn.textContent = '定位'
      actionBtn.addEventListener('click', () => api.reveal({ snapshotId: state.snapshotId, candidateId: group.items[0].id }))
    }

    header.append(selectLabel, iconImg, mainDiv, infoDiv, actionBtn)
    groupCard.append(header)

    if (hasMultiple) {
      const childContainer = document.createElement('div')
      childContainer.className = 'group-children'
      childContainer.hidden = !isExpanded

      for (const item of group.items) {
        const itemRow = document.createElement('div')
        itemRow.className = 'candidate child-item'

        const childLabel = document.createElement('label')
        childLabel.className = 'candidate-select'
        const childCheck = document.createElement('input')
        childCheck.type = 'checkbox'
        childCheck.className = 'candidate-check candidate-check-hidden'
        childCheck.dataset.id = item.id
        childCheck.checked = item.selectedByDefault
        childCheck.setAttribute('aria-label', `选择 ${item.label}`)
        childCheck.addEventListener('change', updateSelection)

        const childSpan = document.createElement('span')
        childSpan.setAttribute('aria-hidden', 'true')
        childLabel.append(childCheck, childSpan)

        const childIcon = document.createElement('img')
        childIcon.className = 'candidate-icon child-icon'
        childIcon.alt = ''
        childIcon.setAttribute('aria-hidden', 'true')
        if (item.icon) childIcon.src = item.icon

        const childMain = document.createElement('div')
        childMain.className = 'candidate-main'
        const childTitle = document.createElement('div')
        const cStrong = document.createElement('strong')
        cStrong.className = 'candidate-label'
        cStrong.textContent = item.label
        const cBadge = document.createElement('span')
        cBadge.className = 'candidate-badge'
        cBadge.textContent = CATEGORY_LABELS[item.category] || item.category
        childTitle.append(cStrong, cBadge)

        const cLoc = document.createElement('p')
        cLoc.className = 'candidate-location'
        cLoc.textContent = item.location
        childMain.append(childTitle, cLoc)

        const cInfo = document.createElement('div')
        cInfo.className = 'candidate-info'
        const cSize = document.createElement('strong')
        cSize.className = 'candidate-size'
        cSize.textContent = formatBytes(item.sizeBytes)
        const cAge = document.createElement('span')
        cAge.className = 'candidate-age'
        cAge.textContent = item.ageDays ? `${item.ageDays} 天未更新` : '近期项目'
        cInfo.append(cSize, cAge)

        const cReveal = document.createElement('button')
        cReveal.type = 'button'
        cReveal.className = 'reveal-button quiet'
        cReveal.textContent = '定位'
        cReveal.addEventListener('click', () => api.reveal({ snapshotId: state.snapshotId, candidateId: item.id }))

        itemRow.append(childLabel, childIcon, childMain, cInfo, cReveal)
        childContainer.append(itemRow)
      }

      groupCheck.addEventListener('change', () => {
        const checked = groupCheck.checked
        childContainer.querySelectorAll('.candidate-check').forEach(c => {
          c.checked = checked
        })
        updateSelection()
      })

      groupCard.append(childContainer)
    } else {
      groupCheck.dataset.id = group.items[0].id
      groupCheck.classList.add('candidate-check')
      groupCheck.checked = group.items[0].selectedByDefault
      groupCheck.addEventListener('change', updateSelection)
    }

    elements.candidateList.append(groupCard)
  }

  elements.statusPanel.hidden = true
  elements.resultPanel.hidden = false
  updateSelection()
}

async function scan() {
  setBusy(true)
  elements.resultPanel.hidden = true
  elements.statusPanel.hidden = false
  elements.statusPanel.classList.remove('is-error')
  elements.statusPanel.querySelector('strong').textContent = '正在读取安全清理范围'
  elements.statusPanel.querySelector('p').textContent = '不会扫描文档、照片或其他个人内容目录。'
  try {
    if (!api || typeof api.scan !== 'function') throw new Error('本地清理能力未加载，请在 ZTools 中重新打开插件。')
    const categories = [...document.querySelectorAll('input[name=category]:checked')].map((input) => input.value)
    render(await api.scan({ categories }))
  } catch (error) {
    elements.statusPanel.classList.add('is-error')
    elements.statusPanel.querySelector('strong').textContent = '扫描未完成'
    elements.statusPanel.querySelector('p').textContent = error?.message || '请稍后重试。'
  } finally {
    setBusy(false)
  }
}

async function clean() {
  const candidates = selectedCandidates()
  if (!candidates.length) return
  setBusy(true)
  elements.statusPanel.hidden = false
  elements.statusPanel.classList.remove('is-error')
  elements.statusPanel.querySelector('strong').textContent = '正在移入系统废纸篓'
  elements.statusPanel.querySelector('p').textContent = `正在处理 ${candidates.length} 个项目，可在废纸篓中安全恢复。`
  try {
    if (!api || typeof api.clean !== 'function') throw new Error('本地清理能力未加载，请在 ZTools 中重新打开插件。')
    const result = await api.clean({
      snapshotId: state.snapshotId,
      candidateIds: candidates.map((item) => item.id)
    })
    render(result)
  } catch (error) {
    elements.statusPanel.classList.add('is-error')
    elements.statusPanel.querySelector('strong').textContent = '清理未完成'
    elements.statusPanel.querySelector('p').textContent = error?.message || '部分项目未被移入废纸篓。'
  } finally {
    setBusy(false)
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, index)
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

elements.scanButton.addEventListener('click', scan)
elements.cleanButton.addEventListener('click', clean)

scan()
