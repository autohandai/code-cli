import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface DiscoveryProgressEvent {
  stage: string;
  detail: string;
}
export interface DiscoveryProgressProps {
  events: DiscoveryProgressEvent[];
  onCancel: () => void;
  analyze?: boolean;
}
const stages = [
  ['repositories', 'Repositories'],
  ['skills', 'Skills'],
  ['behavior', 'User requests'],
  ['activity', 'Engineering activity'],
  ['recommendations', 'Recommendations'],
  ['saving', 'Local drafts'],
] as const;

export function DiscoveryProgress({
  events,
  onCancel,
  analyze = false,
}: DiscoveryProgressProps) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') onCancel();
  });
  const current = events.at(-1);
  const steps: ReadonlyArray<readonly [string, string]> =
    current?.stage === 'upload'
      ? [['upload', 'Upload workflows']]
      : [
          ...stages.slice(0, 5),
          ...(analyze ? [['analysis', 'Discovery analysis'] as const] : []),
          ...stages.slice(5),
        ];
  const index = steps.findIndex(([stage]) => stage === current?.stage);
  return (
    <Box flexDirection="column" paddingY={1} paddingX={2}>
      <Text bold color="cyan">
        Discover useful workflows
      </Text>
      <Text dimColor>Your repositories, skills and recurring work</Text>
      <Box flexDirection="column" marginTop={1}>
        {steps.map(([stage, label], step) => (
          <Box key={stage} flexDirection="column">
            <Text
              color={
                step < index ? 'green' : step === index ? 'cyan' : undefined
              }
              dimColor={step > index}
            >
              {step < index ? '✓' : step === index ? '›' : '·'}{'  '}
              <Text bold={step === index}>{label}</Text>
            </Text>
            {step === index ? (
              <Text dimColor>
                {'   '}
                {current?.detail
                  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
                  .slice(0, 180)}
              </Text>
            ) : null}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Ctrl+C to cancel</Text>
      </Box>
    </Box>
  );
}
