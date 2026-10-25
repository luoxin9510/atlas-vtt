import type { Translation } from '../../types';

export const diceRoll: Translation = {
  'diceRoll.roll': '投掷',
  'diceRoll.label': '投掷',
  'diceRoll.clear': '清除',
  'diceRoll.modifier': '修正值',
  'diceRoll.decreaseModifier': '减少修正值',
  'diceRoll.increaseModifier': '增加修正值',
  'diceRoll.addDie': '添加 d{sides}',
  'diceRoll.addDieHeld': '添加 d{sides}，托盘中有 {held} 颗',
  'diceRoll.takeBack': '取回一颗 d{sides}',
  'diceRoll.trayEmpty': '托盘是空的。',
  'diceRoll.hide': '隐藏投掷',
  'diceRoll.rolling': '正在投掷 {formula}',
  'diceRoll.rolled': '{label}：掷出 {total}',
  'diceRoll.tensUnits': '十位 {tens}，个位 {units}',
  'diceRoll.manyDice': '{number} 颗骰子，共 {total}',
  'diceRoll.folded': 'd{sides} 上的 {faces} 计为 {values}',
};
