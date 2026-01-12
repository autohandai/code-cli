/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligent Feedback Collection System
 * Prompts users at optimal moments without being intrusive
 */
import fs from 'fs-extra';
import path from 'node:path';
import chalk from 'chalk';
import Enquirer from 'enquirer';
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
    sessionEnding?: boolean;
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

    // Priority 1: Session ending (always prompt if conditions met)
    if (context.sessionEnding) {
      return 'session_end';
    }

    // Priority 2: Gratitude detected (high intent signal)
    if (context.userMessage && this.detectsGratitude(context.userMessage)) {
      // Higher probability for gratitude
      if (Math.random() < 0.5) {
        return 'gratitude';
      }
    }

    // Priority 3: Task completed
    if (context.taskCompleted && this.passesRandomCheck()) {
      return 'task_complete';
    }

    // Priority 4: Long session
    if (this.isLongSession() && this.passesRandomCheck()) {
      return 'long_session';
    }

    // Priority 5: Interaction count threshold
    if (this.sessionInteractions >= this.config.minInteractions && this.passesRandomCheck()) {
      return 'interaction_count';
    }

    return null;
  }

  // ============ Prompt UI ============

  /**
   * Display the feedback prompt and collect response
   * Returns true if feedback was collected, false if dismissed
   */
  async promptForFeedback(
    trigger: FeedbackTrigger,
    sessionId?: string
  ): Promise<boolean> {
    this.hasPromptedThisSession = true;
    this.state.lastPromptedAt = new Date().toISOString();
    this.saveState();

    console.log();
    console.log(chalk.cyan('━'.repeat(50)));
    console.log(chalk.cyan.bold('  Quick Feedback'));
    console.log(chalk.gray('  Help us improve Autohand (takes 10 seconds)'));
    console.log(chalk.cyan('━'.repeat(50)));
    console.log();

    // Helper to safely prompt with enquirer (handles readline close errors)
    const safePrompt = async <T>(config: any): Promise<T | null> => {
      try {
        return await (Enquirer as any).prompt(config);
      } catch (error: any) {
        // Ignore readline close errors during exit
        if (error?.code === 'ERR_USE_AFTER_CLOSE') {
          return null;
        }
        throw error;
      }
    };

    try {
      // Step 1: NPS Score (1-5)
      const npsResult = await safePrompt<{ score: string }>({
        type: 'select',
        name: 'score',
        message: 'How would you rate your experience?',
        choices: [
          { name: '5', message: `${chalk.green('5')} - Excellent` },
          { name: '4', message: `${chalk.green('4')} - Good` },
          { name: '3', message: `${chalk.yellow('3')} - Okay` },
          { name: '2', message: `${chalk.red('2')} - Poor` },
          { name: '1', message: `${chalk.red('1')} - Very Poor` },
          { name: 'skip', message: `${chalk.gray('Skip')}` }
        ]
      });

      // User cancelled or readline closed
      if (!npsResult) {
        this.state.dismissed++;
        this.saveState();
        return false;
      }

      if (npsResult.score === 'skip') {
        this.state.dismissed++;
        this.saveState();
        console.log(chalk.gray('\nNo problem! You can always use /feedback later.\n'));
        return false;
      }

      const npsScore = parseInt(npsResult.score, 10);
      let reason: string | undefined;
      let improvement: string | undefined;
      let recommend: boolean | undefined;

      // Step 2: Follow-up based on score
      if (npsScore >= 4) {
        // Happy user - ask for recommendation reason
        const followUp = await safePrompt<{ reason: string }>({
          type: 'input',
          name: 'reason',
          message: 'What do you like most about Autohand? (optional, press Enter to skip)',
        });
        reason = followUp?.reason || undefined;

        // Ask about recommendation (only if still connected)
        if (followUp) {
          const recResult = await safePrompt<{ recommend: boolean }>({
            type: 'confirm',
            name: 'recommend',
            message: 'Would you recommend Autohand to a colleague?',
            initial: true
          });
          recommend = recResult?.recommend;
        }
      } else {
        // Unhappy user - ask for improvement
        const followUp = await safePrompt<{ improvement: string }>({
          type: 'input',
          name: 'improvement',
          message: 'What could we do better? (optional, press Enter to skip)',
        });
        improvement = followUp?.improvement || undefined;
      }

      // Save response
      const response: FeedbackResponse = {
        npsScore,
        recommend,
        reason,
        improvement,
        timestamp: new Date().toISOString(),
        sessionId,
        triggerType: trigger
      };

      await this.saveFeedbackResponse(response);

      // Update state
      this.state.feedbackCount++;
      this.state.lastFeedbackAt = response.timestamp;
      this.state.npsScores.push(npsScore);
      this.state.averageNps =
        this.state.npsScores.reduce((a, b) => a + b, 0) / this.state.npsScores.length;
      this.saveState();

      // Thank the user
      console.log();
      console.log(chalk.green('Thank you for your feedback!'));
      if (npsScore >= 4) {
        console.log(chalk.gray('Your support helps us build a better tool.'));
      } else {
        console.log(chalk.gray("We'll work hard to improve your experience."));
      }
      console.log();

      return true;
    } catch (error: any) {
      // User cancelled (Ctrl+C or ESC) or readline closed
      if (error?.code === 'ERR_USE_AFTER_CLOSE') {
        // Silent exit - readline already closed
        return false;
      }
      this.state.dismissed++;
      this.saveState();
      console.log(chalk.gray('\nFeedback skipped.\n'));
      return false;
    }
  }

  // ============ Quick Rating (Minimal Interrupt) ============

  /**
   * Ultra-quick 1-5 rating with single keypress
   * Use this for minimal interruption
   */
  async quickRating(): Promise<number | null> {
    console.log();
    console.log(
      chalk.cyan('Quick rating: ') +
      chalk.gray('Press ') +
      chalk.bold('1-5') +
      chalk.gray(' to rate your experience (or ') +
      chalk.bold('Enter') +
      chalk.gray(' to skip)')
    );
    console.log(
      chalk.gray('  1=Poor  2=Fair  3=Good  4=Great  5=Excellent')
    );

    return new Promise((resolve) => {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 10000); // 10 second timeout

      const cleanup = () => {
        clearTimeout(timeout);
        stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener('data', onData);
      };

      const onData = (key: string) => {
        // Ctrl+C
        if (key === '\u0003') {
          cleanup();
          resolve(null);
          return;
        }

        // Enter or Escape
        if (key === '\r' || key === '\n' || key === '\u001b') {
          cleanup();
          console.log();
          resolve(null);
          return;
        }

        // Check for 1-5
        const num = parseInt(key, 10);
        if (num >= 1 && num <= 5) {
          cleanup();
          console.log(chalk.green(` ${num}`));

          // Record quick rating
          this.state.npsScores.push(num);
          this.state.feedbackCount++;
          this.state.lastFeedbackAt = new Date().toISOString();
          this.state.averageNps =
            this.state.npsScores.reduce((a, b) => a + b, 0) / this.state.npsScores.length;
          this.hasPromptedThisSession = true;
          this.state.lastPromptedAt = new Date().toISOString();
          this.saveState();

          console.log(chalk.green('Thanks!'));
          console.log();
          resolve(num);
        }
      };

      stdin.on('data', onData);
    });
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

// ============ Singleton Export ============

let instance: FeedbackManager | null = null;

export function getFeedbackManager(config?: Partial<FeedbackConfig>): FeedbackManager {
  if (!instance) {
    instance = new FeedbackManager(config);
  }
  return instance;
}

export function resetFeedbackManager(): void {
  instance = null;
}
