<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Reminder from './Reminder/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
    // 进入插件时立刻对齐一次调度：睡眠唤醒或长时间后台后不必等看门狗巡检
    try {
      window.services?.refreshScheduler?.()
    } catch {}
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Reminder v-if="route === 'easyreminder'" :enter-action="enterAction" />
</template>
