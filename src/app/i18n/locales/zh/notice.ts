import type { Translation } from '../../types';

export const notice: Translation = {
  'notice.dashboardOpenFailed': '打开仪表盘时出错',
  'notice.openImageFirst': '请先打开一个图片文件',
  'notice.sceneNotSaved': 'Atlas VTT 未能完成保存 {name}。其文件中可能缺少最新的修改。',
  'notice.notAnAtlasScene': '「{name}」不是 Atlas 场景。要在地图图片上进行游戏，请在素材库中用它创建一个场景。',
  'notice.noSceneOpen': '没有打开的场景。请先打开一个场景，再向其中添加棋子。',
  'notice.sceneStillLoading': '场景仍在加载。请在场景打开后再添加棋子。',
  'notice.softwareRendering': 'Atlas 无法使用你的显卡，因此地图将不借助显卡绘制：速度可能较慢，轮廓、光晕和部分效果也会缺失。请在 Obsidian 的通用设置中开启硬件加速，或检查显卡驱动。',
};
