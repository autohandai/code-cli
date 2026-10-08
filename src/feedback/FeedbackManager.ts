/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligent Feedback Collection System
 * Decides when a session survey is worth offering and records the answers.
 * It never takes over the terminal: showing the survey is the UI's job.
 */
import fs from 'fs-extra';
import path from 'node:path';
import { FeedbackApiClient, getFeedbackApiClient } from './FeedbackApiClient.js';
import { AUTOHAND_PATHS } from '../constants.js';

// ============ Types ============

export interface FeedbackState {
  lastPromptedAt: string | null;
  lastFeedbackAt: string | null;
  totalSessions: number;
  totalInteractions: number;
  feedbackCount: number;
  dismissed: number;
  npsScores: number[];
  averageNps: number | null;
}

export interface FeedbackResponse {
  npsScore: number;
  recommend?: boolean;
  reason?: string;
  improvement?: string;
  timestamp: string;
  sessionId?: string;
  triggerType: FeedbackTrigger;
}

export type FeedbackTrigger =
  | 'interaction_count'
  | 'gratitude'
  | 'task_complete'
  | 'session_end'
  | 'long_session'
  | 'manual';

export interface FeedbackSurveyAnswer {
  npsScore: number;
  trigger: FeedbackTrigger;
  sessionId?: string;
}

export interface FeedbackConfig {
  /** Minimum interactions before first prompt (default: 7) */
  minInteractions: number;
  /** Hours between feedback prompts (default: 48) */
  cooldownHours: number;
  /** Minimum sessions before prompting (default: 2) */
  minSessions: number;
  /** Session duration in minutes before prompting (default: 15) */
  longSessionMinutes: number;
  /** Probability of prompting when conditions are met (0-1, default: 0.3) */
  promptProbability: number;
  /** Enable/disable feedback system */
  enabled: boolean;
  /** API base URL (default: https://api.autohand.ai) */
  apiBaseUrl: string;
  /** Send feedback to API (default: true) */
  sendToApi: boolean;
  /** CLI version for API tracking */
  cliVersion: string;
}

// ============ Default Config ============

const DEFAULT_CONFIG: FeedbackConfig = {
  minInteractions: 7,
  cooldownHours: 48,
  minSessions: 2,
  longSessionMinutes: 15,
  promptProbability: 0.3,
  enabled: true,
  apiBaseUrl: 'https://api.autohand.ai',
  sendToApi: true,
  cliVersion: '0.1.0'
};

// ============ Gratitude Detection ============

const GRATITUDE_PATTERNS = [
  /\bthank(?:s| you)\b/i,
  /\bperfect\b/i,
  /\bgreat job\b/i,
  /\bawesome\b/i,
  /\bexcellent\b/i,
  /\bamazing\b/i,
  /\blove it\b/i,
  /\bwell done\b/i,
  /\bappreciate\b/i,
  /\bhelpful\b/i,
  /\bexactly what i (?:needed|wanted)\b/i
];

// ============ FeedbackManager Class ============

export class FeedbackManager {
  private readonly stateDir: string;
  private readonly statePath: string;
  private readonly responsesPath: string;
  private state: FeedbackState;
  private config: FeedbackConfig;
  private apiClient: FeedbackApiClient;
  private sessionStartTime: number;
  private sessionInteractions: number = 0;
  private hasPromptedThisSession: boolean = false;

  constructor(configOverrides?: Partial<FeedbackConfig>) {
    this.stateDir = AUTOHAND_PATHS.feedback;
    this.statePath = path.join(this.stateDir, 'state.json');
    this.responsesPath = path.join(this.stateDir, 'responses.json');
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.state = this.loadState();
    this.sessionStartTime = Date.now();
    this.apiClient = getFeedbackApiClient({
      baseUrl: this.config.apiBaseUrl,
      cliVersion: this.config.cliVersion
    });
  }

  // ============ State Management ============

  private loadState(): FeedbackState {
    try {
      if (fs.existsSync(this.statePath)) {
        return fs.readJsonSync(this.statePath);
      }
    } catch {
      // Corrupted state, start fresh
    }

    return {
      lastPromptedAt: null,
      lastFeedbackAt: null,
      totalSessions: 0,
      totalInteractions: 0,
      feedbackCount: 0,
      dismissed: 0,
      npsScores: [],
      averageNps: null
    };
  }

  private saveState(): void {
    // Non-blocking async write to avoid delaying prompt
    // Use setImmediate to defer the I/O operation
    setImmediate(() => {
      try {
        fs.ensureDirSync(this.stateDir);
        fs.writeJsonSync(this.statePath, this.state, { spaces: 2 });
      } catch {
        // Silent fail - feedback is non-critical
      }
    });
  }

  private async saveFeedbackResponse(response: FeedbackResponse): Promise<void> {
    // Save locally first (always works offline)
    try {
      fs.ensureDirSync(this.stateDir);
      let responses: FeedbackResponse[] = [];

      if (fs.existsSync(this.responsesPath)) {
        responses = fs.readJsonSync(this.responsesPath);
      }

      responses.push(response);
      fs.writeJsonSync(this.responsesPath, responses, { spaces: 2 });
    } catch {
      // Silent fail for local storage
    }

    // Send to API (queues automatically if offline)
    if (this.config.sendToApi) {
      try {
        await this.apiClient.submit(response);
      } catch {
        // Silent fail - already queued for retry
      }
    }
  }

  // ============ Session Tracking ============

  /** Call when starting a new session */
  startSession(): void {
    this.state.totalSessions++;
    this.sessionStartTime = Date.now();
    this.sessionInteractions = 0;
    this.hasPromptedThisSession = false;
    this.saveState();
  }

  /** Call after each user interaction */
  recordInteraction(): void {
    this.state.totalInteractions++;
    this.sessionInteractions++;
    this.saveState();
  }

  // ============ Trigger Detection ============

  /** Check if user message contains gratitude */
  detectsGratitude(message: string): boolean {
    return GRATITUDE_PATTERNS.some(pattern => pattern.test(message));
  }

  /** Check if we're in a long session */
  isLongSession(): boolean {
    const sessionMinutes = (Date.now() - this.sessionStartTime) / 1000 / 60;
    return sessionMinutes >= this.config.longSessionMinutes;
  }

  /** Check if cooldown period has passed */
  private isCooldownComplete(): boolean {
    if (!this.state.lastPromptedAt) return true;

    const lastPrompt = new Date(this.state.lastPromptedAt).getTime();
    const hoursSince = (Date.now() - lastPrompt) / 1000 / 60 / 60;
    return hoursSince >= this.config.cooldownHours;
  }

  /** Check if minimum requirements are met */
  private meetsMinimumRequirements(): boolean {
    return (
      this.state.totalSessions >= this.config.minSessions &&
      this.state.totalInteractions >= this.config.minInteractions
    );
  }

  /** Probabilistic check to avoid predictable prompts */
  private passesRandomCheck(): boolean {
    return Math.random() < this.config.promptProbability;
  }

  // ============ Should Prompt Logic ============

  /**
   * Determine if we should prompt for feedback
   * Returns the trigger type if we should prompt, null otherwise
   */
  shouldPrompt(context: {
    userMessage?: string;
    taskCompleted?: boolean;
  }): FeedbackTrigger | null {
    // Disabled or already prompted this session
    if (!this.config.enabled || this.hasPromptedThisSession) {
      return null;
    }

    // Check cooldown
    if (!this.isCooldownComplete()) {
      return null;
    }

    // Check minimum requirements
    if (!this.meetsMinimumRequirements()) {
      return null;
    }

    // Priority 1: Gratitude detected (high intent signal)
    if (context.userMessage && this.detectsGratitude(context.userMessage)) {
      // Higher probability for gratitude
      if (Math.random() < 0.5) {
        return 'gratitude';
      }
    }

    // Priority 2: Task completed
    if (context.taskCompleted && this.passesRandomCheck()) {
      return 'task_complete';
    }

    // Priority 3: Long session
    if (this.isLongSession() && this.passesRandomCheck()) {
      return 'long_session';
    }

    // Priority 4: Interaction count threshold
    if (this.sessionInteractions >= this.config.minInteractions && this.passesRandomCheck()) {
      return 'interaction_count';
    }

    return null;
  }

  // ============ Survey Recording ============

  /** Starts the per-session and cooldown clocks for a survey that was put on screen. */
  markPrompted(): void {
    this.hasPromptedThisSession = true;
    this.state.lastPromptedAt = new Date().toISOString();
    this.saveState();
  }

  /**
   * Records an answered survey. The answer is kept locally before delivery is
   * attempted, and a failed delivery never rejects: callers fire this and move on.
   */
  async recordSurveyAnswer(answer: FeedbackSurveyAnswer): Promise<void> {
    const response: FeedbackResponse = {
      npsScore: answer.npsScore,
      timestamp: new Date().toISOString(),
      sessionId: answer.sessionId,
      triggerType: answer.trigger,
    };

    this.state.feedbackCount++;
    this.state.lastFeedbackAt = response.timestamp;
    this.state.npsScores.push(answer.npsScore);
    this.state.averageNps =
      this.state.npsScores.reduce((a, b) => a + b, 0) / this.state.npsScores.length;
    this.saveState();

    await this.saveFeedbackResponse(response);
  }

  /** Records a survey that was dismissed or typed past. */
  recordDismissal(): void {
    this.state.dismissed++;
    this.saveState();
  }

  // ============ Analytics ============

  /** Get feedback statistics */
  getStats(): FeedbackState & { sessionDuration: number } {
    return {
      ...this.state,
      sessionDuration: Math.round((Date.now() - this.sessionStartTime) / 1000 / 60)
    };
  }

  /** Export all feedback responses */
  async exportResponses(): Promise<FeedbackResponse[]> {
    try {
      if (fs.existsSync(this.responsesPath)) {
        return fs.readJsonSync(this.responsesPath);
      }
    } catch {
      // Return empty if error
    }
    return [];
  }
}
