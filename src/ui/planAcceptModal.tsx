/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { Modal, type ModalOption } from './ink/components/Modal.js';
import { I18nProvider, useTranslation } from './i18n/index.js';
import { inkRenderOptions } from './inkRenderOptions.js';
import { ThemeProvider, useTheme } from './theme/ThemeContext.js';

export interface PlanAcceptOption {
  id: string;
  label: string;
  shortcut?: string;
}

export interface PlanAcceptModalOptions {
  planFilePath: string;
  options: PlanAcceptOption[];
  /** Opens the saved plan outside the terminal; resolves with the program started, or null. */
  onOpenPlan?: () => Promise<string | null>;
}

export interface PlanAcceptResult {
  type: 'option' | 'custom' | 'cancel';
  optionId?: string;
  customText?: string;
}

/** Internal value used to identify the "No, revise" option */
const REVISE_VALUE = '__revise__';

export interface PlanAcceptPromptProps extends PlanAcceptModalOptions {
  onSubmit: (result: PlanAcceptResult) => void;
}

type OpenStatus = { opened: string } | { failed: true } | null;

/**
 * The plan review prompt: the acceptance options, where the plan is saved,
 * and the keys that open it for editing or accept it in one stroke.
 */
export function PlanAcceptPrompt({
  planFilePath,
  options,
  onSubmit,
  onOpenPlan,
}: PlanAcceptPromptProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [openStatus, setOpenStatus] = useState<OpenStatus>(null);

  useInput((char, key) => {
    if (key.ctrl && char === 'g' && onOpenPlan) {
      void onOpenPlan()
        .then((command) => setOpenStatus(command ? { opened: command } : { failed: true }))
        .catch(() => setOpenStatus({ failed: true }));
      return;
    }
    if (key.shift && key.tab) {
      const shortcutOption = options.find((option) => option.shortcut === 'shift+tab');
      if (shortcutOption) {
        onSubmit({ type: 'option', optionId: shortcutOption.id });
      }
    }
  });

  // Convert PlanAcceptOptions to ModalOptions
  const modalOptions: ModalOption[] = [
    ...options.map((opt) => ({
      label: opt.shortcut ? `${opt.label} (${opt.shortcut})` : opt.label,
      value: opt.id,
    })),
    {
      label: t('ui.planRevise'),
      value: REVISE_VALUE,
    },
  ];

  const handleSelect = (option: ModalOption) => {
    if (option.value === REVISE_VALUE) {
      // "No, revise" maps to cancel
      onSubmit({ type: 'cancel' });
    } else if (
      option.value !== '__other__' &&
      options.some((o) => o.id === option.value)
    ) {
      // User selected one of the original options
      onSubmit({ type: 'option', optionId: option.value });
    } else {
      // Custom text was entered (value is the custom text itself)
      onSubmit({ type: 'custom', customText: option.value });
    }
  };

  const handleCancel = () => {
    onSubmit({ type: 'cancel' });
  };

  // Format the plan file path for display (shorten home dir)
  const displayPath = planFilePath.replace(os.homedir(), '~');

  return (
    <Box flexDirection="column">
      <Modal
        title="Would you like to proceed?"
        options={modalOptions}
        onSelect={handleSelect}
        onCancel={handleCancel}
        allowCustomInput={true}
      />
      <Text color={colors.muted}>
        {onOpenPlan ? `${t('ui.planEditHint')} · ` : ''}{displayPath}
      </Text>
      {openStatus ? (
        <Text color={colors.muted}>
          {'opened' in openStatus ? t('ui.planOpened', { command: openStatus.opened }) : t('ui.planOpenFailed')}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Show the plan acceptance modal and return the user's choice
 */
export async function showPlanAcceptModal(
  options: PlanAcceptModalOptions
): Promise<PlanAcceptResult> {
  const { planFilePath, options: acceptOptions, onOpenPlan } = options;

  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return { type: 'cancel' };
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <ThemeProvider>
          <PlanAcceptPrompt
            planFilePath={planFilePath}
            options={acceptOptions}
            onOpenPlan={onOpenPlan}
            onSubmit={(result) => {
              if (completed) return;
              completed = true;
              instance.unmount();
              resolve(result);
            }}
          />
        </ThemeProvider>
      </I18nProvider>,
      inkRenderOptions({
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        exitOnCtrlC: false
      })
    );
  });
}
