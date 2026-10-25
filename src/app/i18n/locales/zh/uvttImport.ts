import type { Translation } from '../../types';

export const uvttImport: Translation = {
  'uvttImport.notMapsOne': '{name} 不是 Atlas 可以导入的地图。请拖入 .dd2vtt、.uvtt 或 .df2vtt 文件。',
  'uvttImport.notMapsMany': '{names} 和 {last} 都不是 Atlas 可以导入的地图。请拖入 .dd2vtt、.uvtt 或 .df2vtt 文件。',
  'uvttImport.notOpened': '无法打开「{name}」。它位于「场景」标签页中。',
  'uvttImport.importing': '正在导入 {name}…',
  'uvttImport.failed': '无法导入 {name}。{problem}',
  'uvttImport.summary': '已导入「{name}」：{walls}，{doors}，{lights}。',
  'uvttImport.walls': { other: '{count} 面墙' },
  'uvttImport.doors': { other: '{count} 扇门' },
  'uvttImport.lights': { other: '{count} 个光源' },
  'uvttImport.lightsOff': '光源已关闭，因为图片本身已经画出了它们的光晕。',
  'uvttImport.scaledDown': '图片已缩小到 {width} × {height} 像素。',
};
