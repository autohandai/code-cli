/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { stripAnsiCodes } from '../ui/displayUtils.js';

const HEADLINE_MAX_CHARACTERS = 120;
const BODY_LINE_MAX_CHARACTERS = 200;
const CTA_URL_MAX_CHARACTERS = 300;
const MAX_BODY_LINES = 8;

const NullableStringSchema = z.string().nullable();

export const ApiAnnouncementStepSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  type: z.enum(['image', 'video']),
  mediaUrl: NullableStringSchema,
  posterUrl: NullableStringSchema,
  title: NullableStringSchema,
  description: NullableStringSchema,
  ctaLabel: NullableStringSchema,
  ctaUrl: NullableStringSchema,
});

export const ApiAnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: NullableStringSchema,
  priority: z.number(),
  steps: z.array(ApiAnnouncementStepSchema),
});

const ApiAnnouncementResponseSchema = z.object({
  announcements: z.array(ApiAnnouncementSchema),
});

export type ApiAnnouncementStep = z.infer<typeof ApiAnnouncementStepSchema>;
export type ApiAnnouncement = z.infer<typeof ApiAnnouncementSchema>;

export interface CliAnnouncement {
  id: string;
  headline: string;
  bodyLines: string[];
  cta?: string;
  priority: number;
  lineLastStep: number | null;
  lastStep: number | null;
}

export interface SanitizeAnnouncementTextOptions {
  maxCharacters: number;
  preserveParagraphs: boolean;
}

function truncateWithEllipsis(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) {
    return value;
  }
  if (maxCharacters <= 0) {
    return '';
  }
  if (maxCharacters === 1) {
    return '…';
  }
  return `${characters.slice(0, maxCharacters - 1).join('')}…`;
}

export function sanitizeAnnouncementText(
  value: string,
  options: SanitizeAnnouncementTextOptions,
): string {
  const withoutAnsi = stripAnsiCodes(value);
  const withoutControls = withoutAnsi
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu, '');

  const normalized = options.preserveParagraphs
    ? withoutControls
      .split(/\n\s*\n+/u)
      .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .join('\n\n')
    : withoutControls.replace(/\s+/gu, ' ').trim();

  return truncateWithEllipsis(normalized, options.maxCharacters);
}

function sanitizeBodyValue(value: string | null): string[] {
  if (!value) {
    return [];
  }
  const sanitized = sanitizeAnnouncementText(value, {
    maxCharacters: Number.MAX_SAFE_INTEGER,
    preserveParagraphs: true,
  });
  return sanitized
    .split(/\n{2,}/u)
    .map((paragraph) => truncateWithEllipsis(paragraph, BODY_LINE_MAX_CHARACTERS))
    .filter(Boolean);
}

function sanitizeCta(step: ApiAnnouncementStep): string | null {
  if (!step.ctaUrl) {
    return null;
  }
  const url = sanitizeAnnouncementText(step.ctaUrl, {
    maxCharacters: CTA_URL_MAX_CHARACTERS,
    preserveParagraphs: false,
  });
  if (!url) {
    return null;
  }
  const label = step.ctaLabel
    ? sanitizeAnnouncementText(step.ctaLabel, {
      maxCharacters: BODY_LINE_MAX_CHARACTERS,
      preserveParagraphs: false,
    })
    : '';
  return label ? `→ ${label} · ${url}` : `→ ${url}`;
}

export function mapApiAnnouncement(announcement: ApiAnnouncement): CliAnnouncement | null {
  const headline = sanitizeAnnouncementText(announcement.title, {
    maxCharacters: HEADLINE_MAX_CHARACTERS,
    preserveParagraphs: false,
  });
  const orderedSteps = [...announcement.steps].sort((left, right) => left.order - right.order);
  const bodyEntries: Array<{ text: string; step: number }> = [];
  let cta: string | undefined;
  let ctaStep: number | null = null;

  for (const step of orderedSteps) {
    for (const text of [...sanitizeBodyValue(step.title), ...sanitizeBodyValue(step.description)]) {
      if (bodyEntries.length < MAX_BODY_LINES) {
        bodyEntries.push({ text, step: step.order });
      }
    }
    if (!cta) {
      const candidate = sanitizeCta(step);
      if (candidate) {
        cta = candidate;
        ctaStep = step.order;
      }
    }
  }

  if (!headline && bodyEntries.length === 0 && !cta) {
    return null;
  }

  const displayedSteps = [
    ...bodyEntries.map((entry) => entry.step),
    ...(ctaStep === null ? [] : [ctaStep]),
  ];

  return {
    id: announcement.id,
    headline,
    bodyLines: bodyEntries.map((entry) => entry.text),
    ...(cta ? { cta } : {}),
    priority: announcement.priority,
    lineLastStep: bodyEntries[0]?.step ?? null,
    lastStep: displayedSteps.length > 0 ? Math.max(...displayedSteps) : null,
  };
}

export function parseAnnouncementResponse(value: unknown): ApiAnnouncement[] | null {
  const parsed = ApiAnnouncementResponseSchema.safeParse(value);
  return parsed.success ? parsed.data.announcements : null;
}
