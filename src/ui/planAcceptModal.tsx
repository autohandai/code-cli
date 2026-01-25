/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import React from 'react';
import { Box, Text, render } from 'ink';
import { Modal, type ModalOption } from './ink/components/Modal.js';
import { I18nProvider, useTranslation } from './i18n/index.js';

export interface PlanAcceptOption {
  id: string;
  label: string;
  shortcut?: string;
}

export interface PlanAcceptModalOptions {
  planFilePath: string;
  options: PlanAcceptOption[];
}

export interface PlanAcceptResult {
  type: 'option' | 'custom' | 'cancel';
  optionId?: string;
  customText?: string;
}

/** Internal value used to identify the "No, revise" option */
const REVISE_VALUE = '__revise__';

interface PlanAcceptModalWrapperProps {
  planFilePath: string;
  options: PlanAcceptOption[];
  onSubmit: (result: PlanAcceptResult) => void;
}

/**
 * Wrapper component that uses the base Modal and displays
 * the plan file path footer.
 */
function PlanAcceptModalWrapper({
  planFilePath,
  options,
  onSubmit,
}: PlanAcceptModalWrapperProps) {
  const { t } = useTranslation();

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
      <Text color="gray">
        {t('ui.planEditHint')} · {displayPath}
      </Text>
    </Box>
  );
}

/**
 * Show the plan acceptance modal and return the user's choice
 */
export async function showPlanAcceptModal(
  options: PlanAcceptModalOptions
): Promise<PlanAcceptResult> {
  const { planFilePath, options: acceptOptions } = options;

  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return { type: 'cancel' };
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <PlanAcceptModalWrapper
          planFilePath={planFilePath}
          options={acceptOptions}
          onSubmit={(result) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(result);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}
