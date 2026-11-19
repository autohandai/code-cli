/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import { scriptToolCall } from './codeModeScenario.js';

export const LANE_NAME = 'tidy-readme';
export const LANE_DESCRIPTION = 'Tidy the README headings';
export const LANE_PROMPT = 'open a new lane and tidy the README headings';
export const LANE_WORK_REPLY = 'LANE_WORK_REPLY';
export const LANE_REPORT_REPLY = 'LANE_REPORT_SUMMARIZED';
export const OPEN_LANE_CALL_ID = 'open-lane';

/**
 * Scripted model turns for one lane. The lead's follow-up and the lane's own request
 * race for the second and third replies, so both are the same slow, tool-free answer:
 * slow enough that the running lane is on screen before either one lands.
 */
export function laneTurns(workDelayMs = 2_500) {
  return [
    {
      content: 'Opening a lane.',
      toolCall: scriptToolCall(OPEN_LANE_CALL_ID, 'delegate_task', {
        agent_name: 'implementer', task: 'Tidy the headings in README.md.',
        lane_name: LANE_NAME, lane_description: LANE_DESCRIPTION,
      }),
    },
    { content: LANE_WORK_REPLY, delayMs: workDelayMs },
    { content: LANE_WORK_REPLY, delayMs: workDelayMs },
    { content: LANE_REPORT_REPLY },
  ];
}

export async function submitLanePrompt(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type(LANE_PROMPT);
  await session.press('enter');
}

/** Screen rows from the `● main` row down, without the full-screen left gutter. */
export async function lanesListRows(session: Session): Promise<string[]> {
  const rows = (await session.text({ immediate: true, trimEnd: true })).split('\n');
  const main = rows.findIndex(row => row.trim() === '● main');
  return main < 0 ? [] : rows.slice(main).map(row => row.trim()).filter(row => row !== '');
}
