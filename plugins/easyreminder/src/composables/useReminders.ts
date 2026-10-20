import { computed, ref } from 'vue'
import type { Reminder, ReminderFormData } from '../types/reminder'
import { migrateReminder } from '../types/reminder'

// 模块级单例状态，确保所有调用 useReminders() 共享同一份数据
const reminders = ref<Reminder[]>([])

function refreshFromServices(): void {
  try {
    const list = window.services.getReminders()
    reminders.value = Array.isArray(list) ? list.map(r => migrateReminder(r as any)) : []
  } catch {
    reminders.value = []
  }
}

export function useReminders() {
  function loadReminders(): void {
    refreshFromServices()
  }

  // 日志统一由 preload 调度器记录，渲染层只负责数据读写
  function addReminder(formData: ReminderFormData): Reminder {
    const r = window.services.addReminder(formData) as Reminder
    refreshFromServices()
    return r
  }

  function updateReminder(id: string, formData: ReminderFormData): boolean {
    const ok = window.services.updateReminder(id, formData)
    refreshFromServices()
    return ok
  }

  function deleteReminder(id: string): boolean {
    const ok = window.services.deleteReminder(id)
    refreshFromServices()
    return ok
  }

  function toggleReminder(id: string): boolean {
    const ok = window.services.toggleReminder(id)
    refreshFromServices()
    return ok
  }

  const sortedReminders = computed(() => {
    return [...reminders.value].sort((a, b) => b.createdAt - a.createdAt)
  })

  const enabledReminders = computed(() => {
    return reminders.value.filter(r => r.enabled)
  })

  return {
    reminders,
    sortedReminders,
    enabledReminders,
    loadReminders,
    addReminder,
    updateReminder,
    deleteReminder,
    toggleReminder
  }
}
