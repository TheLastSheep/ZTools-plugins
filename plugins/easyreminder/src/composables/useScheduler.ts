import { ref } from 'vue'

export interface SchedulerState {
  ready: boolean
  nextTriggerText: string
}

// 模块级状态：多处调用 useScheduler() 时共享同一份状态
const schedulerState = ref<SchedulerState | null>(null)

function refresh(): void {
  try {
    // 旧版 preload 没有该接口，置 null 让 UI 隐藏状态行
    if (typeof window.services?.getSchedulerState !== 'function') {
      schedulerState.value = null
      return
    }
    schedulerState.value = window.services.getSchedulerState()
  } catch {
    schedulerState.value = null
  }
}

export function useScheduler() {
  refresh()

  return {
    schedulerState,
    refresh
  }
}
