/**
 * The edits a Table's menus, handles and add buttons make, as Obsidian's table
 * editor names them, each with what the live region says of it. Pure.
 */

import {
  alignColumns, canAddColumn, canAddRow, deleteColumn, deleteRow, duplicateColumn, duplicateRow, insertColumn, insertRow, moveColumn,
  moveRow, sortRows,
} from '../../model/tableEdits';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, type TableGrid } from '../../model/tableGrid';
import type { TableAlign } from '../../model/templateTypes';
import { t } from '../../../i18n';

export type TableCommand =
  | { kind: 'insert-row'; at: number }
  | { kind: 'duplicate-row'; row: number }
  | { kind: 'delete-row'; row: number }
  | { kind: 'move-row'; from: number; to: number }
  | { kind: 'insert-column'; at: number; align: TableAlign | null }
  | { kind: 'duplicate-column'; col: number }
  | { kind: 'delete-column'; col: number }
  | { kind: 'move-column'; from: number; to: number }
  | { kind: 'align'; col: number; align: TableAlign }
  | { kind: 'sort'; col: number; direction: 1 | -1 };

export interface CommandOutcome {
  grid: TableGrid;
  /** What the live region says of a change. */
  said: string;
  /** Why the table took no change it was asked for (it holds as many rows or columns as it takes). */
  refused?: string | undefined;
}

/** The name of the column `col`, or its number where it has none ("column Str", "column 3"). */
function columnName(grid: TableGrid, col: number): string {
  return grid.columns[col]?.name.trim() || String(col + 1);
}

const ALIGNED: Readonly<Record<TableAlign, 'alignedLeft' | 'alignedCenter' | 'alignedRight'>> = {
  start: 'alignedLeft', center: 'alignedCenter', end: 'alignedRight',
};

/** The table after `command`, and what to say; the very grid where the command changes nothing. */
export function runTableCommand(grid: TableGrid, command: TableCommand): CommandOutcome {
  switch (command.kind) {
    case 'insert-row': {
      if (!canAddRow(grid)) return { grid, said: '', refused: t('sbTemplateTable.maxRows', { max: MAX_TABLE_ROWS }) };
      return { grid: insertRow(grid, command.at), said: t('sbTemplateTable.rowAdded', { row: command.at + 1 }) };
    }
    case 'duplicate-row': return { grid: duplicateRow(grid, command.row), said: t('sbTemplateTable.rowDuplicated', { row: command.row + 1 }) };
    case 'delete-row': return { grid: deleteRow(grid, command.row), said: t('sbTemplateTable.rowDeleted', { row: command.row + 1 }) };
    case 'move-row': return { grid: moveRow(grid, command.from, command.to), said: t('sbTemplateTable.rowMoved', { from: command.from + 1, to: command.to + 1 }) };
    case 'insert-column': {
      if (!canAddColumn(grid)) return { grid, said: '', refused: t('sbTemplateTable.maxColumns', { max: MAX_TABLE_COLUMNS }) };
      return { grid: insertColumn(grid, command.at, command.align), said: t('sbTemplateTable.columnAdded', { column: command.at + 1 }) };
    }
    case 'duplicate-column': return { grid: duplicateColumn(grid, command.col), said: t('sbTemplateTable.columnDuplicated', { column: columnName(grid, command.col) }) };
    case 'delete-column': return { grid: deleteColumn(grid, command.col), said: t('sbTemplateTable.columnDeleted', { column: columnName(grid, command.col) }) };
    case 'move-column': return { grid: moveColumn(grid, command.from, command.to), said: t('sbTemplateTable.columnMoved', { column: columnName(grid, command.from) }) };
    case 'align': return { grid: alignColumns(grid, [command.col], command.align), said: t(`sbTemplateTable.${ALIGNED[command.align]}`, { column: columnName(grid, command.col) }) };
    case 'sort': {
      const sorted = sortRows(grid, command.col, command.direction);
      return { grid: sorted, said: t(command.direction > 0 ? 'sbTemplateTable.sortedAsc' : 'sbTemplateTable.sortedDesc', { column: columnName(grid, command.col) }) };
    }
  }
}
