/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { showModal, type ModalOption } from './ink/components/Modal.js';

export interface QuestionModalOptions {
  question: string;
  suggestedAnswers?: string[];
}

/**
 * Show a question modal and return the user's answer
 * Returns null if user cancels (ESC)
 */
export async function showQuestionModal(options: QuestionModalOptions): Promise<string | null> {
  const { question, suggestedAnswers } = options;

  // Convert suggestedAnswers to ModalOption[]
  const modalOptions: ModalOption[] = suggestedAnswers?.map((answer) => ({
    label: answer,
    value: answer,
  })) ?? [];

  // Use the Modal component with custom input enabled for "Other" option
  const result = await showModal({
    title: question,
    options: modalOptions,
    allowCustomInput: true,
  });

  // Return the selected value or null on cancel
  return result?.value ?? null;
}
