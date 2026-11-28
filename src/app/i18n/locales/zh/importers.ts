import type { Translation } from '../../types';

/** Importing character files: the command, its dialogs and the summary. */
export const importers: Translation = {
  'importers.command': '导入角色文件…',
  'importers.chooseCollection': '导入到哪个合集？',
  'importers.alreadyTitle': '已导入过',
  'importers.alreadyMessage': '“{name}”之前已从此文件导入。要重新导入吗？',
  'importers.reimport': '重新导入',
  'importers.failed': '导入角色文件失败。',
  'importers.noImporter': '没有可读取此类文件的导入器。',
  'importers.count.imported': '已导入 {count} 个',
  'importers.count.updated': '已更新 {count} 个',
  'importers.count.skipped': '已跳过 {count} 个',
  'importers.count.failed': '失败 {count} 个',
  'importers.line.failed': '{name}：{reason}',
  'importers.line.noPortrait': '{name}：头像不是 PNG、JPG 或 WebP，已导入但未创建棋子。',
};
