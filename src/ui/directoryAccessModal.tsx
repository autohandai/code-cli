/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Directory Access Modal - Prompts user to grant access to a directory outside the workspace
 */
import chalk from 'chalk';
import { showModal, type ModalOption } from './ink/components/Modal.js';

export interface DirectoryAccessModalOptions {
  path: string;
  reason?: string;
}

/**
 * Show a modal asking the user to grant access to a directory
 * Returns true if granted, false if denied
 */
export async function showDirectoryAccessModal(options: DirectoryAccessModalOptions): Promise<boolean> {
  const { path, reason } = options;

  // Build the title with path and optional reason
  let title = `Grant access to directory?`;
  if (reason) {
    title = `${reason}\n\nDirectory: ${chalk.cyan(path)}`;
  } else {
    title = `Grant access to directory?\n\n${chalk.cyan(path)}`;
  }

  const modalOptions: ModalOption[] = [
    {
      label: 'Grant Access',
      value: 'grant',
      description: 'Allow access to this directory for the current session',
    },
    {
      label: 'Deny',
      value: 'deny',
      description: 'Do not allow access to this directory',
    },
  ];

  const result = await showModal({
    title,
    options: modalOptions,
  });

  return result?.value === 'grant';
}