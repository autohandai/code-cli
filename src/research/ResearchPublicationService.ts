/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionValidationResponse } from '../auth/types.js';
import {
  ResearchPublicationError,
  type PublicationCommitResponse,
} from './OpenResearchClient.js';
import {
  ResearchPublicationValidationError,
  type BuildResearchPublicationDraftOptions,
  type ResearchPublicationDraft,
  type ResearchPublicationVisibility,
} from './ResearchManifestBuilder.js';

export interface ResearchPublicationPrompts {
  confirmPublish(): Promise<boolean>;
  selectVisibility(): Promise<ResearchPublicationVisibility | null>;
  confirmFinal(draft: ResearchPublicationDraft): Promise<boolean>;
  showPrivateResult(result: { url: string; accessCode: string }): Promise<void>;
}

export type ResearchPublicationOutcome =
  | { status: 'skipped'; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'failed'; message: string }
  | {
      status: 'published';
      visibility: ResearchPublicationVisibility;
      url: string;
      accessCodeWasAvailable: boolean;
    };

export interface ResearchPublicationOffer {
  workspaceRoot: string;
  reportPath: string;
  token?: string;
  interactive: boolean;
  yesMode?: boolean;
  apiBaseUrl?: string;
}

export interface ResearchPublicationServiceDependencies {
  validateReport?: (workspaceRoot: string, reportPath: string) => Promise<unknown>;
  buildDraft: (options: BuildResearchPublicationDraftOptions) => Promise<ResearchPublicationDraft>;
  verifyUnchanged: (draft: ResearchPublicationDraft) => Promise<void>;
  validateSession: (token: string) => Promise<SessionValidationResponse>;
  publish: (
    draft: ResearchPublicationDraft,
    token: string,
  ) => Promise<PublicationCommitResponse>;
  prompts: ResearchPublicationPrompts;
}

export class ResearchPublicationService {
  constructor(private readonly dependencies: ResearchPublicationServiceDependencies) {}

  async offer(offer: ResearchPublicationOffer): Promise<ResearchPublicationOutcome> {
    if (!offer.interactive) {
      return {
        status: 'skipped',
        message: `Publication was skipped. Research remains local at ${offer.reportPath}.`,
      };
    }

    try {
      await this.dependencies.validateReport?.(offer.workspaceRoot, offer.reportPath);
      if (!(await this.dependencies.prompts.confirmPublish())) {
        return localCancellation(offer.reportPath);
      }
      const visibility = await this.dependencies.prompts.selectVisibility();
      if (!visibility) {
        return localCancellation(offer.reportPath);
      }
      const draft = await this.dependencies.buildDraft({
        workspaceRoot: offer.workspaceRoot,
        markdownPath: offer.reportPath,
        visibility,
        apiBaseUrl: offer.apiBaseUrl ?? defaultOpenResearchOrigin(),
      });
      if (!(await this.dependencies.prompts.confirmFinal(draft))) {
        return localCancellation(offer.reportPath);
      }
      if (!offer.token) {
        return loginFailure(offer.reportPath);
      }
      const auth = await this.dependencies.validateSession(offer.token);
      if (!auth.authenticated) {
        return loginFailure(offer.reportPath);
      }
      await this.dependencies.verifyUnchanged(draft);
      const committed = await this.dependencies.publish(draft, offer.token);

      let accessCode = committed.accessCode;
      const accessCodeWasAvailable = typeof accessCode === 'string';
      try {
        if (committed.visibility === 'private' && accessCode) {
          await this.dependencies.prompts.showPrivateResult({
            url: committed.url,
            accessCode,
          });
        }
      } finally {
        committed.accessCode = null;
        accessCode = null;
      }

      return {
        status: 'published',
        visibility: committed.visibility,
        url: committed.url,
        accessCodeWasAvailable,
      };
    } catch (error) {
      return {
        status: 'failed',
        message: formatFailure(error, offer.reportPath),
      };
    }
  }
}

export function formatResearchPublicationOutcome(
  outcome: ResearchPublicationOutcome,
  reportPath: string,
): string {
  if (outcome.status !== 'published') {
    return outcome.message;
  }
  const lines = [
    `Research published: ${outcome.url}`,
    `Local report: ${reportPath}`,
  ];
  if (outcome.visibility === 'private') {
    lines.push(
      outcome.accessCodeWasAvailable
        ? 'The private access code was shown once and cleared when the result view closed.'
        : 'The private access code is unavailable from this retry. Rotate it through the authenticated owner workflow.',
    );
  }
  return lines.join('\n');
}

export function defaultOpenResearchOrigin(): string {
  return process.env.AUTOHAND_OPEN_RESEARCH_URL ?? 'https://openresearch.autohand.ai';
}

function localCancellation(reportPath: string): ResearchPublicationOutcome {
  return {
    status: 'cancelled',
    message: `Publication cancelled. Research remains local at ${reportPath}.`,
  };
}

function loginFailure(reportPath: string): ResearchPublicationOutcome {
  return {
    status: 'failed',
    message: [
      'Open Research needs a valid Autohand login. Run /login and retry.',
      `Local report: ${reportPath}`,
      `Recovery: /publish-research ${reportPath}`,
    ].join('\n'),
  };
}

function formatFailure(error: unknown, reportPath: string): string {
  const recovery = `Recovery: /publish-research ${reportPath}`;
  const local = `Local report: ${reportPath}`;
  if (error instanceof ResearchPublicationValidationError) {
    return [error.message, local, recovery].join('\n');
  }
  if (error instanceof ResearchPublicationError) {
    const prefix: Record<ResearchPublicationError['kind'], string> = {
      authentication: 'Authentication failed.',
      validation: 'Open Research rejected the publication.',
      size: 'The publication exceeds an Open Research size limit.',
      rate_limit: 'Open Research rate-limited this publication.',
      network: 'Open Research could not be reached.',
      server: 'Open Research could not complete the publication.',
      conflict: 'Open Research found a conflicting publication attempt.',
    };
    return [`${prefix[error.kind]} ${error.message}`, local, recovery].join('\n');
  }
  return [
    'Open Research publication failed before completion.',
    local,
    recovery,
  ].join('\n');
}
