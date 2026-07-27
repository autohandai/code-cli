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
  // Deliberately not an enum. The CLI renders text and ignores media entirely, so
  // a step type it has never heard of is still perfectly renderable — and pinning
  // this to image|video would make one future server-side type blank the feed.
  type: z.string(),
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
  announcements: z.array(z.unknown()),
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
  // C0/C1 controls first, then the invisible formatting characters. Bidi overrides
  // and isolates (U+202A-202E, U+2066-2069) let server text render a URL differently
  // from what it actually says - Trojan Source - and the zero-width characters hide
  // word boundaries. Announcements cannot be turned off, so what the terminal draws
  // has to be what the text says.
  //
  // This also strips U+200D, so a ZWJ emoji sequence degrades into its component
  // glyphs. That is a deliberate trade: a cosmetic loss on rare compound emoji in
  // exchange for no invisible character ever reaching stdout.
  const withoutControls = withoutAnsi
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '');

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

/**
 * Returns null only when the envelope itself is unusable. Individual malformed
 * announcements are dropped rather than failing the batch — an all-or-nothing
 * parse would let one bad row silently blank a feed that fails quietly by design.
 */
export function parseAnnouncementResponse(value: unknown): ApiAnnouncement[] | null {
  const parsed = ApiAnnouncementResponseSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const announcements: ApiAnnouncement[] = [];
  for (const candidate of parsed.data.announcements) {
    const announcement = ApiAnnouncementSchema.safeParse(candidate);
    if (announcement.success) {
      announcements.push(announcement.data);
    }
  }
  return announcements;
}
