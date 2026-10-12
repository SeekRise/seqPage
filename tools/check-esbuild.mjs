// 环境自检脚本：验证 esbuild 服务能否在受限沙箱中启动
// 用法：node tools/check-esbuild.mjs
import { transform } from 'esbuild';

try {
  const result = await transform('const a: number = 1;', { loader: 'ts' });
  console.log('esbuild transform OK:', result.code.trim());
} catch (error) {
  console.log('esbuild ERROR:', error instanceof Error ? error.message : String(error));
}
