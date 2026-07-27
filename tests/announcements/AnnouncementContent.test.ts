/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  mapApiAnnouncement,
  parseAnnouncementResponse,
  sanitizeAnnouncementText,
  type ApiAnnouncement,
} from '../../src/announcements/AnnouncementContent.js';

function announcement(overrides: Partial<ApiAnnouncement> = {}): ApiAnnouncement {
  return {
    id: 'announcement-1',
    title: 'Voice dictation is here',
    description: null,
    priority: 100,
    steps: [],
    ...overrides,
  };
}

describe('AnnouncementContent', () => {
  it('drops media-only announcements with no renderable text', () => {
    expect(mapApiAnnouncement(announcement({
      title: '',
      steps: [{
        id: 'step-1',
        order: 0,
        type: 'image',
        mediaUrl: 'https://cdn.example/image.png',
        posterUrl: null,
        title: null,
        description: null,
        ctaLabel: null,
        ctaUrl: null,
      }],
    }))).toBeNull();
  });

  it('keeps an announcement-level title when its steps are text-less', () => {
    expect(mapApiAnnouncement(announcement())?.headline).toBe('Voice dictation is here');
  });

  it('orders step text by order and uses the first CTA URL', () => {
    const mapped = mapApiAnnouncement(announcement({
      steps: [
        {
          id: 'step-2',
          order: 2,
          type: 'image',
          mediaUrl: 'ignored',
          posterUrl: null,
          title: 'Second title',
          description: 'Second description',
          ctaLabel: 'Later',
          ctaUrl: 'https://example.com/later',
        },
        {
          id: 'step-1',
          order: 1,
          type: 'video',
          mediaUrl: 'ignored',
          posterUrl: null,
          title: 'First title',
          description: 'First description',
          ctaLabel: 'Read more',
          ctaUrl: 'https://example.com/first',
        },
      ],
    }));

    expect(mapped?.bodyLines).toEqual([
      'First title',
      'First description',
      'Second title',
      'Second description',
    ]);
    expect(mapped?.cta).toBe('→ Read more · https://example.com/first');
    expect(mapped?.lineLastStep).toBe(1);
    expect(mapped?.lastStep).toBe(2);
  });

  it('ignores a CTA label without a URL and renders a URL without a label', () => {
    const mapped = mapApiAnnouncement(announcement({
      steps: [
        {
          id: 'label-only',
          order: 0,
          type: 'image',
          mediaUrl: 'ignored',
          posterUrl: null,
          title: null,
          description: null,
          ctaLabel: 'Ignored',
          ctaUrl: null,
        },
        {
          id: 'url-only',
          order: 1,
          type: 'image',
          mediaUrl: 'ignored',
          posterUrl: null,
          title: null,
          description: null,
          ctaLabel: null,
          ctaUrl: 'https://example.com/docs',
        },
      ],
    }));

    expect(mapped?.cta).toBe('→ https://example.com/docs');
  });

  it('clamps headline, body, CTA URL, and body-line count with ellipses', () => {
    const mapped = mapApiAnnouncement(announcement({
      title: 'h'.repeat(150),
      steps: Array.from({ length: 10 }, (_, order) => ({
        id: `step-${order}`,
        order,
        type: 'image' as const,
        mediaUrl: 'ignored',
        posterUrl: null,
        title: null,
        description: order === 0 ? 'b'.repeat(240) : `line ${order}`,
        ctaLabel: null,
        ctaUrl: order === 0 ? `https://example.com/${'u'.repeat(350)}` : null,
      })),
    }));

    expect(Array.from(mapped?.headline ?? '')).toHaveLength(120);
    expect(mapped?.headline.endsWith('…')).toBe(true);
    expect(mapped?.bodyLines).toHaveLength(8);
    expect(Array.from(mapped?.bodyLines[0] ?? '')).toHaveLength(200);
    expect(mapped?.bodyLines[0]?.endsWith('…')).toBe(true);
    expect(Array.from((mapped?.cta ?? '').replace(/^→ /, ''))).toHaveLength(300);
    expect(mapped?.cta?.endsWith('…')).toBe(true);
  });

  it('preserves paragraph breaks for block rendering while line mode collapses them', () => {
    expect(sanitizeAnnouncementText('first\n\nsecond', {
      maxCharacters: 200,
      preserveParagraphs: true,
    })).toBe('first\n\nsecond');
    expect(sanitizeAnnouncementText('first\n\nsecond', {
      maxCharacters: 200,
      preserveParagraphs: false,
    })).toBe('first second');
  });

  it.each([
    '\u001b[2Jcounterfeit',
    '\u001b[Hcounterfeit',
    '\u001bcounterfeit',
    'hello\rprompt',
    'hello\u0007bell',
    'hello\u0085next',
  ])('strips terminal control payload %j', (payload) => {
    const mapped = mapApiAnnouncement(announcement({
      title: payload,
      steps: [{
        id: 'step-1',
        order: 0,
        type: 'image',
        mediaUrl: 'ignored',
        posterUrl: null,
        title: payload,
        description: payload,
        ctaLabel: payload,
        ctaUrl: `https://example.com/${payload}`,
      }],
    }));
    const output = [
      mapped?.headline,
      ...(mapped?.bodyLines ?? []),
      mapped?.cta,
    ].filter((value): value is string => typeof value === 'string').join('\n');

    expect(output).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
    expect(output).not.toContain('[2J');
    expect(output).not.toContain('[H');
  });

  it.each([
    ['right-to-left override', '‮'],
    ['left-to-right override', '‭'],
    ['right-to-left embedding', '‫'],
    ['pop directional formatting', '‬'],
    ['first-strong isolate', '⁨'],
    ['pop directional isolate', '⁩'],
    ['zero-width space', '​'],
    ['zero-width joiner', '‍'],
    ['byte order mark', '﻿'],
  ])('strips the %s bidirectional payload', (_name, control) => {
    // Trojan Source: a bidi override inside a CTA makes the visible URL read
    // differently from the real one, in a channel the user cannot switch off.
    const payload = `autohand.ai${control}moc.live`;
    const mapped = mapApiAnnouncement(announcement({
      title: payload,
      steps: [{
        id: 'step-1',
        order: 0,
        type: 'image',
        mediaUrl: 'ignored',
        posterUrl: null,
        title: payload,
        description: payload,
        ctaLabel: payload,
        ctaUrl: `https://${payload}`,
      }],
    }));
    const output = [
      mapped?.headline,
      ...(mapped?.bodyLines ?? []),
      mapped?.cta,
    ].filter((value): value is string => typeof value === 'string').join('\n');

    expect(output).not.toContain(control);
  });
});

describe('parseAnnouncementResponse resilience', () => {
  const valid = {
    id: 'valid',
    title: 'Valid',
    description: null,
    priority: 1,
    steps: [],
  };

  it('keeps a step type the CLI does not recognize', () => {
    // The CLI ignores media entirely, so an unknown step type must not discard
    // text the server intends us to render.
    const parsed = parseAnnouncementResponse({
      announcements: [{
        ...valid,
        steps: [{
          id: 'step-1',
          order: 0,
          type: 'text',
          mediaUrl: null,
          posterUrl: null,
          title: 'Future step type',
          description: 'Still renderable',
          ctaLabel: null,
          ctaUrl: null,
        }],
      }],
    });

    expect(parsed).toHaveLength(1);
    expect(mapApiAnnouncement(parsed![0])?.bodyLines).toEqual([
      'Future step type',
      'Still renderable',
    ]);
  });

  it('drops only the unusable announcements instead of the whole payload', () => {
    const parsed = parseAnnouncementResponse({
      announcements: [
        valid,
        { id: 'broken', title: 42, description: null, priority: 1, steps: [] },
        { ...valid, id: 'second' },
      ],
    });

    expect(parsed?.map((item) => item.id)).toEqual(['valid', 'second']);
  });

  it('still rejects a payload whose announcements field is not an array', () => {
    expect(parseAnnouncementResponse({ announcements: 'nope' })).toBeNull();
    expect(parseAnnouncementResponse({})).toBeNull();
  });
});
