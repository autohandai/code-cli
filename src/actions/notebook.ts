/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface NotebookCell {
  id?: string;
  cell_type: 'code' | 'markdown' | string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface NotebookContent {
  nbformat: number;
  nbformat_minor?: number;
  metadata?: Record<string, unknown>;
  cells: NotebookCell[];
}

export interface NotebookEditInput {
  path: string;
  cell_index?: number;
  cell_id?: string;
  new_source?: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: 'replace' | 'insert' | 'delete';
}

export interface NotebookEditResult {
  updated: string;
  summary: string;
}

function createNotebookCell(cellType: 'code' | 'markdown', source: string): NotebookCell {
  if (cellType === 'code') {
    return {
      cell_type: 'code',
      source,
      metadata: {},
      outputs: [],
      execution_count: null,
    };
  }

  return {
    cell_type: 'markdown',
    source,
    metadata: {},
  };
}

function resolveCellIndex(notebook: NotebookContent, input: NotebookEditInput): number {
  if (typeof input.cell_index === 'number') {
    return input.cell_index;
  }

  if (input.cell_id) {
    const index = notebook.cells.findIndex((cell) => cell.id === input.cell_id);
    if (index === -1) {
      throw new Error(`Notebook cell "${input.cell_id}" not found.`);
    }
    return index;
  }

  return -1;
}

export function applyNotebookEdit(rawContent: string, input: NotebookEditInput): NotebookEditResult {
  if (!input.path.endsWith('.ipynb')) {
    throw new Error('notebook_edit only supports .ipynb files.');
  }

  let notebook: NotebookContent;
  try {
    notebook = JSON.parse(rawContent) as NotebookContent;
  } catch {
    throw new Error(`Notebook ${input.path} is not valid JSON.`);
  }

  if (!Array.isArray(notebook.cells)) {
    throw new Error(`Notebook ${input.path} does not contain a valid cells array.`);
  }

  const editMode = input.edit_mode ?? 'replace';
  const index = resolveCellIndex(notebook, input);

  if (editMode === 'insert') {
    if (!input.cell_type) {
      throw new Error('notebook_edit insert requires "cell_type".');
    }
    if (typeof input.new_source !== 'string') {
      throw new Error('notebook_edit insert requires "new_source".');
    }

    const insertAt = index >= 0 ? index + 1 : notebook.cells.length;
    notebook.cells.splice(insertAt, 0, createNotebookCell(input.cell_type, input.new_source));
    return {
      updated: `${JSON.stringify(notebook, null, 2)}\n`,
      summary: `Inserted notebook cell at index ${insertAt} in ${input.path}.`,
    };
  }

  if (index < 0 || index >= notebook.cells.length) {
    throw new Error('notebook_edit requires a valid "cell_index" or "cell_id".');
  }

  if (editMode === 'delete') {
    notebook.cells.splice(index, 1);
    return {
      updated: `${JSON.stringify(notebook, null, 2)}\n`,
      summary: `Deleted notebook cell ${index} in ${input.path}.`,
    };
  }

  if (typeof input.new_source !== 'string') {
    throw new Error('notebook_edit replace requires "new_source".');
  }

  const target = notebook.cells[index]!;
  target.source = input.new_source;
  if (input.cell_type) {
    target.cell_type = input.cell_type;
  }

  return {
    updated: `${JSON.stringify(notebook, null, 2)}\n`,
    summary: `Updated notebook cell ${index} in ${input.path}.`,
  };
}
