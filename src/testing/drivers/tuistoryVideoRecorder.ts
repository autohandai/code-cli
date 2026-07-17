/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { PersistentTerminal } from 'ghostty-opentui';
import type { Key, Session } from 'tuistory';

export interface TuistoryVideoOutput {
  castPath: string;
  gifPath: string;
  mp4Path: string;
}

export interface TuistoryVideoRecorderOptions extends TuistoryVideoOutput {
  width?: number;
  frameRate?: number;
}

type CastEvent = readonly [number, 'o', string];

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 2 * 1024 * 1024 }, (error) => {
      if (error) {
        reject(new Error(`ffmpeg failed: ${error.message}`, { cause: error }));
        return;
      }
      resolve();
    });
  });
}

export class TuistoryVideoRecorder {
  private readonly startedAt = Date.now();
  private readonly castEvents: CastEvent[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly session: Session,
    private readonly options: TuistoryVideoRecorderOptions,
  ) {
    const initialOutput = session.getRawOutput();
    if (initialOutput) {
      this.castEvents.push([0, 'o', initialOutput]);
    }
    this.unsubscribe = session.subscribe((data) => {
      this.castEvents.push([
        Number(((Date.now() - this.startedAt) / 1000).toFixed(6)),
        'o',
        data,
      ]);
    });
  }

  async hold(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async type(text: string): Promise<void> {
    await this.session.type(text);
  }

  async press(keys: Key | Key[]): Promise<void> {
    await this.session.press(keys);
  }

  async waitForText(pattern: string | RegExp, timeout: number): Promise<string> {
    return this.session.waitForText(pattern, { timeout });
  }

  async finish(): Promise<TuistoryVideoOutput> {
    this.unsubscribe();
    await Promise.all([
      fs.ensureDir(path.dirname(this.options.castPath)),
      fs.ensureDir(path.dirname(this.options.gifPath)),
      fs.ensureDir(path.dirname(this.options.mp4Path)),
    ]);
    await this.writeCast();
    await this.renderVideo();
    return {
      castPath: this.options.castPath,
      gifPath: this.options.gifPath,
      mp4Path: this.options.mp4Path,
    };
  }

  private async writeCast(): Promise<void> {
    const header = {
      version: 2,
      width: this.session.currentCols,
      height: this.session.currentRows,
      timestamp: Math.floor(this.startedAt / 1000),
      env: {
        SHELL: 'zsh',
        TERM: 'xterm-truecolor',
      },
    };
    const lines = [
      JSON.stringify(header),
      ...this.castEvents.map((event) => JSON.stringify(event)),
    ];
    await fs.writeFile(this.options.castPath, `${lines.join('\n')}\n`);
  }

  private async renderVideo(): Promise<void> {
    if (this.castEvents.length === 0) {
      throw new Error('Cannot render a terminal video without captured output.');
    }

    const framesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-video-'));
    const terminal = new PersistentTerminal({
      cols: this.session.currentCols,
      rows: this.session.currentRows,
    });
    try {
      const { renderTerminalToImage } = await import('ghostty-opentui/image');
      const fontSize = 15;
      const lineHeight = 1.35;
      const paddingX = 24;
      const paddingY = 24;
      const terminalHeight = this.session.currentRows * Math.round(fontSize * lineHeight)
        + paddingY * 2;
      const frameRate = this.options.frameRate ?? 12;
      const frameIntervalMilliseconds = 1_000 / frameRate;
      const lastEvent = this.castEvents.at(-1);
      const endMilliseconds = (lastEvent?.[0] ?? 0) * 1_000 + 1_500;
      let eventIndex = 0;
      let frameIndex = 0;

      for (
        let atMilliseconds = 0;
        atMilliseconds <= endMilliseconds;
        atMilliseconds += frameIntervalMilliseconds
      ) {
        while (
          eventIndex < this.castEvents.length
          && this.castEvents[eventIndex]![0] * 1_000 <= atMilliseconds
        ) {
          terminal.feed(this.castEvents[eventIndex]![2]);
          eventIndex += 1;
        }

        const framePath = path.join(
          framesRoot,
          `frame-${String(frameIndex).padStart(5, '0')}.png`,
        );
        const terminalData = terminal.getJson();
        const viewport = {
          ...terminalData,
          lines: terminalData.lines.slice(-this.session.currentRows),
        };
        const image = await renderTerminalToImage(viewport, {
          height: terminalHeight,
          fontSize,
          lineHeight,
          paddingX,
          paddingY,
          theme: { background: '#0b1020', text: '#d8dee9' },
          frameColor: '#0b1020',
        });
        await fs.writeFile(framePath, image);
        frameIndex += 1;
      }

      const width = this.options.width ?? 1200;
      await runFfmpeg([
        '-y',
        '-loglevel', 'error',
        '-framerate', String(frameRate),
        '-i', path.join(framesRoot, 'frame-%05d.png'),
        '-vf', `fps=${frameRate},scale=${width}:-2:flags=lanczos`,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        this.options.mp4Path,
      ]);
      await runFfmpeg([
        '-y',
        '-loglevel', 'error',
        '-i', this.options.mp4Path,
        '-vf', `fps=10,scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`,
        '-loop', '0',
        this.options.gifPath,
      ]);
    } finally {
      terminal.destroy();
      await fs.remove(framesRoot);
    }
  }
}
