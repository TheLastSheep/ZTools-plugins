/**
 * notifier.js —— 到点提醒的呈现（preload 专用，CommonJS）
 *
 * 呈现手段（按可用性降级）：
 *   1. ztools.showNotification  系统通知（ZTools 官方 API）
 *   2. Electron Notification    官方 API 不可用时的兜底
 *   3. ztools.shellBeep         系统提示音
 *   4. createBrowserWindow      置顶弹窗强提醒（可选）
 */
'use strict';

const TimeFormat = require('./time-format.js');

let alarmWindows = []; // { win, rid, openedAt }；同一提醒只保留一个弹窗，避免堆积
const ALARM_MAX = 10; // 最多同时存在的弹窗引用

function ztools() {
  return window.ztools;
}

/** 尽力关闭一个弹窗：优先窗口对象自身 close()，其次 ZTools 的 removeBrowserWindow */
function tryCloseWindow(win) {
  if (!win) return;
  try {
    if (typeof win.close === 'function') {
      win.close();
      return;
    }
  } catch (e) {
    /* 继续尝试下一方式 */
  }
  try {
    if (typeof ztools().removeBrowserWindow === 'function') {
      ztools().removeBrowserWindow(win);
    }
  } catch (e) {
    /* 忽略 */
  }
}

function beep(times) {
  const n = Math.max(1, Math.min(10, times | 0));
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      try {
        ztools().shellBeep();
      } catch (e) {
        /* 忽略 */
      }
    }, i * 700);
  }
}

function systemNotify(title, body) {
  // 1) ZTools 官方通知
  try {
    ztools().showNotification(body);
    return true;
  } catch (e) {
    /* 继续兜底 */
  }
  // 2) Electron 原生通知
  try {
    const { Notification } = require('electron');
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      const n = new Notification({ title: title, body: body, silent: true });
      n.on('click', () => {
        try {
          ztools().showMainWindow();
        } catch (e) {
          /* 忽略 */
        }
      });
      n.show();
      return true;
    }
  } catch (e) {
    /* 忽略 */
  }
  return false;
}

/**
 * 打开置顶强提醒弹窗。
 */
function openAlarmWindow(reminder) {
  try {
    // 同一提醒已开过弹窗时先关闭旧的，防止用户不处理时窗口堆积
    for (let i = alarmWindows.length - 1; i >= 0; i--) {
      if (alarmWindows[i].rid === reminder._id) {
        tryCloseWindow(alarmWindows[i].win);
        alarmWindows.splice(i, 1);
      }
    }
    const win = ztools().createBrowserWindow(
      'alarm.html?id=' + encodeURIComponent(reminder._id),
      {
        width: 420,
        height: 250,
        frame: false,
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        center: true,
        skipTaskbar: false,
        title: '定时提醒'
      },
      () => {
        /* 加载完成 */
      }
    );
    if (win) {
      alarmWindows.push({ win: win, rid: reminder._id, openedAt: Date.now() });
      // 超出上限时关闭最早的弹窗
      if (alarmWindows.length > ALARM_MAX) {
        const old = alarmWindows.shift();
        tryCloseWindow(old && old.win);
      }
    }
    // 兜底回收，避免窗口引用堆积
    setTimeout(() => {
      alarmWindows = alarmWindows.filter((w) => Date.now() - w.openedAt < 60 * 60 * 1000);
    }, 60 * 60 * 1000);
    return win;
  } catch (e) {
    return null;
  }
}

/**
 * 触发一次提醒。
 * @param {object} reminder 提醒文档
 * @param {{late?:number, beepTimes?:number, escalate?:boolean}} [options]
 */
function notify(reminder, options) {
  const opts = options || {};
  const late = opts.late || 0;
  const when = reminder.nextRunAt || Date.now();
  const timeText = TimeFormat.formatHuman(when, Date.now());
  const prefix = opts.escalate ? '【未处理，再次提醒】' : late > 5 * 60 * 1000 ? '【已错过】' : '';
  const body = prefix + reminder.title + '\n' + timeText + (reminder.note ? '\n' + reminder.note : '');

  systemNotify('⏰ 定时提醒', body);

  if (reminder.sound !== false) {
    beep(opts.beepTimes != null ? opts.beepTimes : 3);
  }
  if (reminder.popup) {
    openAlarmWindow(reminder);
  }
}

/**
 * 停机/休眠补发时的聚合通知：多条错过的提醒合并为一条，避免连环轰炸。
 */
function notifyMissedSummary(items, settings) {
  const list = items || [];
  if (!list.length) return;
  const shown = list.slice(0, 5);
  const titles = shown
    .map((i) => i.title)
    .filter(Boolean)
    .join('、');
  const more = list.length > shown.length ? ' 等' + list.length + '条' : '';
  const body = '停机期间错过了 ' + list.length + ' 条提醒：' + titles + more;

  systemNotify('⏰ 定时提醒', body);
  // 任一条开了响铃就提示一次
  if (settings && settings.sound !== false && list.some((i) => i.sound !== false)) {
    beep(settings.beepTimes != null ? settings.beepTimes : 3);
  }
}

/**
 * 测试通知（设置页使用）。
 */
function testNotify() {
  systemNotify('⏰ 定时提醒', '这是一条测试通知，说明通知通道工作正常。');
  beep(1);
}

module.exports = { notify, notifyMissedSummary, testNotify, openAlarmWindow, systemNotify, beep };
