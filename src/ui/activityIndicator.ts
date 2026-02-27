/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { TipsBag } from './tips.js';

const DEFAULT_VERBS: string[] = [
  // 70s computer geek
  'Computing',
  'Hacking',
  'Compiling',
  'Parsing',
  'Grokking',
  'Crunching',
  'Paging',
  'Buffering',
  'Bootstrapping',
  'Multiplexing',
  'Kerneling',
  'Piping',
  'Demonizing',
  'Forking',
  'Spooling',
  // Gandalf-inspired
  'Conjuring',
  'Summoning',
  'Delving',
  'Pondering',
  'Wandering',
];

const DEFAULT_SYMBOL = '✳';

export interface ActivityConfig {
  activityVerbs?: string | string[];
  activitySymbol?: string;
}

/**
 * Produces styled activity indicator lines with rotating verbs and tips.
 */
export class ActivityIndicator {
  private verbs: string[];
  private shuffledVerbs: string[] = [];
  private symbol: string;
  private tips: TipsBag;
  private currentVerb = '';
  private currentTip = '';

  constructor(config?: ActivityConfig) {
    const rawVerbs = config?.activityVerbs;
    if (typeof rawVerbs === 'string') {
      this.verbs = [rawVerbs];
    } else if (Array.isArray(rawVerbs) && rawVerbs.length > 0) {
      this.verbs = rawVerbs;
    } else {
      this.verbs = DEFAULT_VERBS;
    }
    this.symbol = config?.activitySymbol ?? DEFAULT_SYMBOL;
    this.tips = new TipsBag();
  }

  /**
   * Pick the next verb and tip, return the formatted multi-line string.
   */
  next(): string {
    this.currentVerb = this.pickVerb();
    this.currentTip = this.tips.next();
    return this.format();
  }

  /**
   * Get the current verb (or pick one if not yet called).
   */
  getVerb(): string {
    if (!this.currentVerb) {
      this.currentVerb = this.pickVerb();
    }
    return this.currentVerb;
  }

  /**
   * Get the current tip (or pick one if not yet called).
   */
  getTip(): string {
    if (!this.currentTip) {
      this.currentTip = this.tips.next();
    }
    return this.currentTip;
  }

  private pickVerb(): string {
    if (this.verbs.length === 1) {
      return this.verbs[0];
    }
    if (this.shuffledVerbs.length === 0) {
      this.shuffledVerbs = [...this.verbs];
      // Fisher-Yates shuffle
      for (let i = this.shuffledVerbs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.shuffledVerbs[i], this.shuffledVerbs[j]] = [this.shuffledVerbs[j], this.shuffledVerbs[i]];
      }
    }
    return this.shuffledVerbs.pop()!;
  }

  private format(): string {
    const verbLine = `${chalk.yellow(this.symbol)} ${chalk.yellow(this.currentVerb + '...')}`;
    const tipLine = `${chalk.gray('⎿  Tip:')} ${chalk.gray(this.currentTip)}`;
    return `${verbLine}\n${tipLine}`;
  }
}
