/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { FeedbackSurveyAnswer, FeedbackTrigger } from '../../feedback/FeedbackManager.js';
import { t } from '../../i18n/index.js';
import type { FeedbackSurveyState } from '../../ui/ink/FeedbackSurveyLine.js';

export const FEEDBACK_SURVEY_ACKNOWLEDGEMENT_MS = 4_000;

const DISMISS_KEY = '0';
const LOW_SCORE = 1;

const SCORED_OPTIONS = [
  { key: '1', labelKey: 'feedback.survey.bad', npsScore: LOW_SCORE },
  { key: '2', labelKey: 'feedback.survey.poor', npsScore: 2 },
  { key: '3', labelKey: 'feedback.survey.fine', npsScore: 3 },
  { key: '4', labelKey: 'feedback.survey.good', npsScore: 4 },
  { key: '5', labelKey: 'feedback.survey.great', npsScore: 5 },
] as const;

export interface FeedbackSurveySink {
  isRunning(): boolean;
  getQueueCount?(): number;
  setFeedbackSurvey(survey: FeedbackSurveyState | undefined): void;
}

export interface FeedbackSurveyRecorder {
  markPrompted(): void;
  recordSurveyAnswer(answer: FeedbackSurveyAnswer): Promise<void>;
  recordDismissal(): void;
}

export interface FeedbackSurveyControllerOptions {
  /** Resolved on every call: the renderer is created after the controller and can be torn down. */
  getSink: () => FeedbackSurveySink | undefined | null;
  recorder: FeedbackSurveyRecorder;
}

interface ActiveSurvey {
  survey: FeedbackSurveyState;
  trigger: FeedbackTrigger;
  sessionId?: string;
  answered: boolean;
}

/**
 * Owns the lifetime of the session survey line above the composer. The survey
 * is an offer, not a prompt: nothing here waits on the user, and typing past it
 * is a valid answer.
 */
export class FeedbackSurveyController {
  private active: ActiveSurvey | null = null;
  private acknowledgementTimer: NodeJS.Timeout | null = null;
  private sequence = 0;

  constructor(private readonly options: FeedbackSurveyControllerOptions) {}

  /** Puts the survey on screen. Returns false when it could not be seen or would vanish at once. */
  show(trigger: FeedbackTrigger, sessionId?: string): boolean {
    const sink = this.options.getSink();
    if (!sink?.isRunning() || (sink.getQueueCount?.() ?? 0) > 0) {
      return false;
    }

    this.release();
    const survey: FeedbackSurveyState = {
      id: `feedback-survey-${++this.sequence}`,
      question: t('feedback.survey.question'),
      options: [
        ...SCORED_OPTIONS.map(({ key, labelKey }) => ({ key, label: t(labelKey) })),
        { key: DISMISS_KEY, label: t('feedback.survey.dismiss') },
      ],
    };
    this.active = { survey, trigger, sessionId, answered: false };
    sink.setFeedbackSurvey(survey);
    this.options.recorder.markPrompted();
    return true;
  }

  answer(id: string, key: string): void {
    const active = this.active;
    if (!active || active.answered || active.survey.id !== id) {
      return;
    }

    if (key === DISMISS_KEY) {
      this.options.recorder.recordDismissal();
      this.release();
      return;
    }

    const option = SCORED_OPTIONS.find((candidate) => candidate.key === key);
    if (!option) {
      return;
    }

    active.answered = true;
    void this.options.recorder
      .recordSurveyAnswer({ npsScore: option.npsScore, trigger: active.trigger, sessionId: active.sessionId })
      .catch(() => {});
    this.options.getSink()?.setFeedbackSurvey({
      ...active.survey,
      acknowledgement: t(option.npsScore === LOW_SCORE ? 'feedback.survey.thanksLow' : 'feedback.survey.thanks'),
    });
    this.acknowledgementTimer = setTimeout(() => this.release(), FEEDBACK_SURVEY_ACKNOWLEDGEMENT_MS);
    this.acknowledgementTimer.unref?.();
  }

  /** The user moved on to their next prompt: an unanswered survey counts as dismissed. */
  clear(): void {
    if (!this.active) {
      return;
    }
    if (!this.active.answered) {
      this.options.recorder.recordDismissal();
    }
    this.release();
  }

  dispose(): void {
    this.release();
  }

  private release(): void {
    if (this.acknowledgementTimer) {
      clearTimeout(this.acknowledgementTimer);
      this.acknowledgementTimer = null;
    }
    if (this.active) {
      this.active = null;
      this.options.getSink()?.setFeedbackSurvey(undefined);
    }
  }
}
