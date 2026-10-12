/**
 * SeqPage 入口
 *
 * 职责：
 * 1. 在挂载前完成 store 初始化（读取本地配置 / 首次写入演示数据）。
 * 2. 应用外观设置（主题、密度、背景）后再渲染，避免浅色闪一下再变深色。
 * 3. 注册全局错误处理，保证任何渲染异常都有可见提示而不是白屏。
 */
import { createApp } from 'vue';
import App from '@/App.vue';
import { getBootTrace, initializeStore, store } from '@/services/store';
import { applyAppearance } from '@/composables/useTheme';
import { toast } from '@/composables/useToast';
import '@/styles/variables.css';
import '@/styles/base.css';
import '@/styles/global.css';

/**
 * 诊断与自检入口：在扩展页面的控制台里可以直接使用
 *   __MYNAVI__.bootTrace()        查看本次启动是否读取到了本地配置
 *   __MYNAVI__.backend            当前使用的存储后端
 *   __MYNAVI__.writeProtected     是否处于只读保护（读取失败时为 true，防止覆盖数据）
 *   __MYNAVI__.flush()            立即把待写入的数据落盘
 *   __MYNAVI__.attemptWrites()    尝试执行各类写入，返回每个操作的结果（用于验证保护是否生效）
 *   __MYNAVI__.forceClear()       显式清空本地数据（等价于设置面板里的操作，会解除保护）
 *
 * 这些接口只调用 store 已有的公开方法，不提供任何绕过持久化与回滚机制的旁路。
 */
function exposeDiagnostics(): void {
  Object.defineProperty(globalThis, '__MYNAVI__', {
    value: {
      backend: store.info.backend,
      extensionContext: store.info.extensionContext,
      get writeProtected() {
        return store.state.writeProtected;
      },
      bootTrace: getBootTrace,
      flush: () => store.flush(),
      attemptWrites: async () => {
        const results: Array<{ name: string; ok: boolean; message: string }> = [];

        const push = async (name: string, run: () => Promise<{ ok: boolean; message: string }>) => {
          try {
            results.push({ name, ...(await run()) });
          } catch (error) {
            results.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) });
          }
        };

        await push('updateSettings', () => store.updateSettings({ showDescription: false }));
        await push('addPage', () => store.addPage({ name: '__probe__', icon: 'grid' }));
        // 不带 force 的整体覆盖：用于验证只读保护默认拒绝写入
        await push('replaceStateNotForced', () => store.replaceState(store.snapshot()));
        return results;
      },
      forceClear: () => store.clearNavigationData(),
    },
    writable: false,
    configurable: true,
  });
}

async function bootstrap(): Promise<void> {
  const app = createApp(App);

  app.config.errorHandler = (error, _instance, info) => {
    console.error('[SeqPage] 渲染异常：', error, info);
    toast.error(
      '界面渲染出现异常，部分内容可能未正确显示。',
      error instanceof Error ? `${error.message}（${info}）` : String(error),
    );
  };

  // 先初始化数据，再挂载：避免首屏出现空状态闪烁
  await initializeStore();

  // 应用主题，避免浅色/深色切换时的闪烁
  applyAppearance(store.state.data.settings);

  exposeDiagnostics();
  app.mount('#app');
}

void bootstrap().catch((error: unknown) => {
  console.error('[SeqPage] 启动失败：', error);
  const container = document.getElementById('app');
  if (container) {
    container.textContent =
      'SeqPage 启动失败。请在 chrome://extensions 中重新加载扩展；若问题持续，请检查浏览器控制台的错误信息。';
  }
});
