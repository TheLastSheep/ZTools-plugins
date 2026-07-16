<script setup lang="ts">
import { computed } from "vue";

const dock = computed(() => {
  const value = new URLSearchParams(window.location.search).get("dock");
  return value === "bottom" || value === "left" || value === "right"
    ? value
    : "floating";
});
</script>

<template>
  <main class="stage">
    <section class="shelf" :class="`shelf--${dock}`" aria-label="PasteboardPro">
      <header class="toolbar">
        <div class="brand-mark" aria-hidden="true"></div>
        <label class="search">
          <span class="search__label">搜索</span>
          <input
            type="search"
            placeholder="内容、来源 App、日期或 Pinboard"
            autocomplete="off"
          />
        </label>
        <button type="button" class="control">暂停捕获</button>
      </header>

      <div class="timeline" aria-live="polite">
        <div class="empty-state">
          <span class="empty-state__eyebrow">本地剪贴板</span>
          <strong>等待第一条剪贴板记录</strong>
          <span>历史镜像接入后会在这里显示。</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style>
:root {
  color: #17151f;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  font-synthesis: none;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  min-width: 0;
  height: 100%;
  margin: 0;
  background: transparent;
}

button,
input {
  font: inherit;
}

.stage {
  display: grid;
  min-height: 100%;
  padding: 12px;
  place-items: end center;
}

.shelf {
  width: min(1120px, 100%);
  min-height: 244px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.74), rgba(239, 236, 255, 0.56)),
    rgba(246, 244, 255, 0.58);
  box-shadow:
    0 24px 80px rgba(31, 23, 68, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(26px) saturate(148%);
  -webkit-backdrop-filter: blur(26px) saturate(148%);
}

.shelf--bottom {
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.shelf--left {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.shelf--right {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.toolbar {
  display: grid;
  grid-template-columns: auto minmax(220px, 520px) auto;
  gap: 12px;
  align-items: center;
  min-height: 64px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(76, 65, 122, 0.12);
}

.brand-mark {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #7567ee;
  box-shadow: 0 0 0 5px rgba(117, 103, 238, 0.13);
}

.search {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 9px;
  align-items: center;
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid rgba(72, 62, 115, 0.14);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.54);
}

.search__label {
  color: #716b82;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
}

.search input {
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
}

.control {
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid rgba(72, 62, 115, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.48);
  color: #4f4960;
  cursor: pointer;
}

.search:focus-within,
.control:focus-visible {
  outline: 2px solid rgba(100, 83, 232, 0.72);
  outline-offset: 2px;
}

.timeline {
  display: grid;
  min-height: 178px;
  padding: 24px;
  place-items: center;
}

.empty-state {
  display: grid;
  gap: 6px;
  justify-items: center;
  color: #777083;
  text-align: center;
}

.empty-state strong {
  color: #25212e;
  font-size: 17px;
  font-weight: 650;
}

.empty-state__eyebrow {
  color: #685bd5;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

@media (max-width: 680px) {
  .toolbar {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .control {
    display: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .shelf {
    transition: border-radius 160ms ease, transform 160ms ease;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f5f2ff;
  }

  .shelf {
    border-color: rgba(255, 255, 255, 0.14);
    background:
      linear-gradient(135deg, rgba(58, 52, 75, 0.82), rgba(30, 27, 41, 0.72)),
      rgba(26, 23, 35, 0.78);
    box-shadow: 0 24px 90px rgba(0, 0, 0, 0.46);
  }

  .search,
  .control {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.08);
    color: #dcd7e8;
  }

  .empty-state strong {
    color: #f7f3ff;
  }
}
</style>
