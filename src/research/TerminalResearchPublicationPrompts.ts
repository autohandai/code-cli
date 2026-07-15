/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { showConfirm, showModal } from '../ui/ink/components/Modal.js';
import type {
  ResearchPublicationDraft,
  ResearchPublicationVisibility,
} from './ResearchManifestBuilder.js';
import type { ResearchPublicationPrompts } from './ResearchPublicationService.js';

export class TerminalResearchPublicationPrompts implements ResearchPublicationPrompts {
  confirmPublish(): Promise<boolean> {
    return showConfirm({
      title: 'Would you like to publish this research?',
      confirmText: 'Continue',
      cancelText: 'No, keep it local',
      defaultValue: false,
    });
  }

  async selectVisibility(): Promise<ResearchPublicationVisibility | null> {
    const selected = await showModal({
      title: 'Choose publication visibility',
      options: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Private - code required; shown once', value: 'private' },
        { label: 'Public - listed and readable by anyone', value: 'public' },
      ],
      initialIndex: 0,
    });
    return selected?.value === 'public' || selected?.value === 'private'
      ? selected.value
      : null;
  }

  confirmFinal(draft: ResearchPublicationDraft): Promise<boolean> {
    const lines = [
      'Review publication',
      `Title: ${draft.title}`,
      `File: ${draft.markdownAbsolutePath}`,
      `Visibility: ${draft.visibility === 'public' ? 'Public' : 'Private'}`,
      `Images: ${draft.assets.length}`,
      `Upload: ${formatBytes(draft.totalUploadBytes)}`,
      `Host: ${draft.apiOrigin}`,
    ];
    if (draft.visibility === 'private') {
      lines.push('The private access code is shown once and cannot be recovered.');
    }
    return showConfirm({
      title: lines.join('\n'),
      confirmText: 'Publish',
      cancelText: 'Cancel',
      defaultValue: false,
    });
  }

  async showPrivateResult(result: { url: string; accessCode: string }): Promise<void> {
    await showModal({
      title: [
        'Private research published',
        `URL: ${result.url}`,
        `Access code: ${result.accessCode}`,
        'This code is shown once. If it is lost, rotate it through the authenticated owner workflow.',
      ].join('\n'),
      options: [
        { label: 'Close and clear access code', value: 'close' },
      ],
      initialIndex: 0,
    });
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
