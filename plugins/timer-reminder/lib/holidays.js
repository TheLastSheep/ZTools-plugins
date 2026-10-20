/**
 * holidays.js —— 中国法定节假日与调休数据（UMD：preload / 渲染进程共用）
 *
 * 数据来源：国务院办公厅历年《关于部分节假日安排的通知》。
 *   - off：放假日（含周末调休连休）
 *   - work：调休上班日（周末但需上班）
 *
 * 「工作日」判断优先级：调休上班日 > 放假日 > 普通周一~周五。
 * 数据未覆盖的年份自动退化为普通周末判断（不影响其它功能）。
 *
 * 维护提示：每年 11~12 月国务院公布次年安排后，在 DATA 中追加对应年份即可。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZRHolidays = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DATA = {
    // 国办发明电〔2024〕7号
    2025: {
      off: [
        '01-01',
        '01-28', '01-29', '01-30', '01-31', '02-01', '02-02', '02-03', '02-04',
        '04-04', '04-05', '04-06',
        '05-01', '05-02', '05-03', '05-04', '05-05',
        '05-31', '06-01', '06-02',
        '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07', '10-08'
      ],
      work: ['01-26', '02-08', '04-27', '09-28', '10-11']
    },
    // 国办发明电〔2025〕7号
    2026: {
      off: [
        '01-01', '01-02', '01-03',
        '02-15', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22', '02-23',
        '04-04', '04-05', '04-06',
        '05-01', '05-02', '05-03', '05-04', '05-05',
        '06-19', '06-20', '06-21',
        '09-25', '09-26', '09-27',
        '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'
      ],
      work: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10']
    }
  };

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 'MM-DD' */
  function key(date) {
    return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /** 是否法定放假日（含调休连休日） */
  function isHolidayOff(date) {
    var y = DATA[date.getFullYear()];
    return !!(y && y.off.indexOf(key(date)) !== -1);
  }

  /** 是否调休上班日（周末但需上班） */
  function isHolidayWork(date) {
    var y = DATA[date.getFullYear()];
    return !!(y && y.work.indexOf(key(date)) !== -1);
  }

  /**
   * 是否工作日：调休上班日算工作日，放假日不算，其余按周一~周五。
   * 数据未覆盖的年份退化为普通周末判断。
   */
  function isWorkday(date) {
    if (isHolidayWork(date)) return true;
    if (isHolidayOff(date)) return false;
    var wd = date.getDay();
    return wd >= 1 && wd <= 5;
  }

  /** 数据覆盖的年份（升序），供 UI 提示 */
  function coveredYears() {
    return Object.keys(DATA)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
  }

  return {
    isWorkday: isWorkday,
    isHolidayOff: isHolidayOff,
    isHolidayWork: isHolidayWork,
    coveredYears: coveredYears
  };
});
