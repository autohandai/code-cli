/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text, render, useInput, type Instance } from 'ink';
import { I18nProvider } from '../ui/i18n/index.js';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { inkRenderOptions } from '../ui/inkRenderOptions.js';
import {
  cleanupModalRender,
  isModalCancelInput,
  prepareModalRender,
  resumeModalInput,
} from '../ui/ink/components/Modal.js';
import type { ExtensionRuntimeView } from './ExtensionRuntimeHost.js';

interface ExtensionViewShellProps {
  view: ExtensionRuntimeView;
  workspaceRoot: string;
  args: string[];
  props?: Record<string, unknown>;
  close(value?: string): void;
}

function ExtensionViewShell({ view, workspaceRoot, args, props, close }: ExtensionViewShellProps) {
  useInput((input, key) => {
    if (isModalCancelInput(input, key)) {
      close();
    }
  });
  const Component = view.component;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{view.title}</Text>
      <Component
        {...props}
        close={close}
        workspaceRoot={workspaceRoot}
        args={args}
      />
    </Box>
  );
}

export async function showExtensionView(
  view: ExtensionRuntimeView,
  options: {
    workspaceRoot: string;
    args: string[];
    props?: Record<string, unknown>;
  },
): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return `Extension view "${view.id}" requires an interactive terminal.`;
  }

  prepareModalRender(process.stdout);
  resumeModalInput(process.stdin);
  await new Promise<void>((resolve) => setImmediate(resolve));

  return new Promise((resolve, reject) => {
    let instance: Instance | null = null;
    let completed = false;
    let hasPendingValue = false;
    let pendingValue: string | null = null;

    const finish = (value: string | null): void => {
      if (completed) return;
      if (!instance) {
        hasPendingValue = true;
        pendingValue = value;
        return;
      }
      completed = true;
      const current = instance;
      void (async () => {
        current.unmount();
        try {
          await current.waitUntilExit();
        } finally {
          cleanupModalRender(process.stdout);
          resolve(value);
        }
      })();
    };

    try {
      instance = render(
        <ThemeProvider>
          <I18nProvider>
            <ExtensionViewShell
              view={view}
              workspaceRoot={options.workspaceRoot}
              args={options.args}
              props={options.props}
              close={(value) => finish(value ?? null)}
            />
          </I18nProvider>
        </ThemeProvider>,
        inkRenderOptions({
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
          exitOnCtrlC: false,
        }),
      );
      if (hasPendingValue) {
        hasPendingValue = false;
        finish(pendingValue);
      }
    } catch (error) {
      cleanupModalRender(process.stdout);
      reject(error);
    }
  });
}
