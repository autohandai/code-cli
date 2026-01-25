/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, render } from 'ink';
import { I18nProvider, useTranslation } from './i18n/index.js';

export interface QuestionModalOptions {
  question: string;
  suggestedAnswers?: string[];
}

interface QuestionModalProps {
  question: string;
  suggestedAnswers?: string[];
  onSubmit: (answer: string | null) => void;
}

function QuestionModal({ question, suggestedAnswers, onSubmit }: QuestionModalProps) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Build choices: suggested answers + "Other" option
  const choices = useMemo(() => {
    const items = suggestedAnswers?.map((answer) => ({
      label: answer,
      value: answer
    })) ?? [];
    items.push({ label: t('ui.questionOther'), value: '__other__' });
    return items;
  }, [suggestedAnswers, t]);

  useInput((char, key) => {
    // ESC cancels
    if (key.escape) {
      if (isCustomMode) {
        setIsCustomMode(false);
        setCustomInput('');
      } else {
        onSubmit(null);
      }
      return;
    }

    // Custom input mode
    if (isCustomMode) {
      if (key.return) {
        onSubmit(customInput || null);
        return;
      }
      if (key.backspace || key.delete) {
        setCustomInput(prev => prev.slice(0, -1));
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setCustomInput(prev => prev + char);
      }
      return;
    }

    // Selection mode
    if (key.return) {
      const selected = choices[cursor];
      if (selected.value === '__other__') {
        setIsCustomMode(true);
      } else {
        onSubmit(selected.value);
      }
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      setCursor(prev => (prev - 1 + choices.length) % choices.length);
      return;
    }
    if (key.downArrow) {
      setCursor(prev => (prev + 1) % choices.length);
      return;
    }

    // Number shortcuts (1-9)
    if (char && char >= '1' && char <= '9') {
      const index = parseInt(char, 10) - 1;
      if (index < choices.length) {
        const selected = choices[index];
        if (selected.value === '__other__') {
          setIsCustomMode(true);
        } else {
          onSubmit(selected.value);
        }
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">{t('ui.questionPrompt')} {question}</Text>
      <Text> </Text>

      {isCustomMode ? (
        <Box>
          <Text color="yellow">{t('ui.questionYourAnswer')}: </Text>
          <Text>{customInput}</Text>
          <Text color="gray">█</Text>
        </Box>
      ) : (
        choices.map((choice, i) => (
          <Box key={i}>
            <Text color={i === cursor ? 'green' : undefined}>
              {i === cursor ? '▸ ' : '  '}
              {i + 1}. {choice.label}
            </Text>
          </Box>
        ))
      )}

      <Text> </Text>
      <Text color="gray">
        {isCustomMode
          ? t('ui.questionCustomHint')
          : t('ui.questionSelectHint')}
      </Text>
    </Box>
  );
}

/**
 * Show a question modal and return the user's answer
 * Returns null if user cancels (ESC)
 */
export async function showQuestionModal(options: QuestionModalOptions): Promise<string | null> {
  const { question, suggestedAnswers } = options;

  // Non-interactive fallback
  if (!process.stdout.isTTY) {
    return null;
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <I18nProvider>
        <QuestionModal
          question={question}
          suggestedAnswers={suggestedAnswers}
          onSubmit={(answer) => {
            if (completed) return;
            completed = true;
            instance.unmount();
            resolve(answer);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}
