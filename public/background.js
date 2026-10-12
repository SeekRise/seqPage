/**
 * My Navi - MV3 Service Worker
 *
 * 职责（刻意保持极简，避免常驻开销）：
 * 1. 点击扩展图标时聚焦/打开导航工作台。
 * 2. 首次安装时打开一次导航页，让用户立刻看到效果。
 *
 * 不在这里做任何数据同步、网络请求或标签页监控。
 */

const NEWTAB_URL = 'chrome://newtab/';

/** 点击工具栏图标：打开（或聚焦）导航工作台 */
chrome.action.onClicked.addListener(async () => {
  try {
    await chrome.tabs.create({ url: NEWTAB_URL });
  } catch (error) {
    console.error('[My Navi] 打开导航工作台失败：', error);
  }
});

/** 首次安装时自动打开一次，便于用户立即上手 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: NEWTAB_URL }).catch((error) => {
      console.warn('[My Navi] 安装后打开导航页失败（不影响使用）：', error);
    });
  }
});
