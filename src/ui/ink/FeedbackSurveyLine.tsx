/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from '../theme/ThemeContext.js';
import { truncateAnnouncementLine } from './AnnouncementLine.js';

export interface FeedbackSurveyOption {
  /** Single key that selects the option while the composer is empty. */
  key: string;
  label: string;
}

export interface FeedbackSurveyState {
  id: string;
  question: string;
  options: FeedbackSurveyOption[];
  /** Replaces the question once answered; the options stop claiming keys. */
  acknowledgement?: string;
}

export interface FeedbackSurveyLineProps {
  survey: FeedbackSurveyState;
  columns: number;
}

const QUESTION_PREFIX = '● ';
const OPTION_GAP = '  ';

function FeedbackSurveyLineComponent({ survey, columns }: FeedbackSurveyLineProps): React.ReactNode {
  const { theme } = useTheme();
  const width = Math.max(1, columns);

  if (survey.acknowledgement) {
    return (
      <Box width={width}>
        <Text>{theme.fg('success', truncateAnnouncementLine(`✓ ${survey.acknowledgement}`, width))}</Text>
      </Box>
    );
  }

  const optionLayouts = [
    survey.options.map(({ key, label }) => `${key}: ${label}`).join(OPTION_GAP),
    survey.options.map(({ key, label }) => key === '0' ? `${key}: ${label}` : key).join(OPTION_GAP),
    survey.options.map(({ key }) => key).join(' '),
  ];
  const options = truncateAnnouncementLine(optionLayouts.find((layout) => stringWidth(layout) <= width) ?? optionLayouts[2], width);
  const question = truncateAnnouncementLine(`${QUESTION_PREFIX}${survey.question}`, width);

  return (
    <Box width={width} flexDirection="column">
      <Text>{theme.fg('accent', question)}</Text>
      <Text>{theme.fg('muted', options)}</Text>
    </Box>
  );
}

export const FeedbackSurveyLine = memo(FeedbackSurveyLineComponent);
