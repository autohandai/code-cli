/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

interface ErrorLogEntry {
    timestamp: string;
    error: {
        name: string;
        message: string;
        stack?: string;
    };
    context?: Record<string, any>;
    system: {
        platform: string;
        arch: string;
        release: string;
        nodeVersion: string;
        bunVersion?: string;
        memory: {
            total: number;
            free: number;
            used: number;
        };
        cpu: {
            model: string;
            cores: number;
        };
        hostname: string;
        username: string;
    };
    cli: {
        version: string;
        cwd: string;
        command?: string;
    };
}

export class ErrorLogger {
    private logPath: string;
    private cliVersion: string;

    constructor(cliVersion: string, logDir?: string) {
        this.cliVersion = cliVersion;
        const baseDir = logDir || path.join(os.homedir(), '.autohand-cli');
        this.logPath = path.join(baseDir, 'error.log');
    }

    async log(error: Error, context?: Record<string, any>): Promise<void> {
        try {
            await fs.ensureDir(path.dirname(this.logPath));

            const entry: ErrorLogEntry = {
                timestamp: new Date().toISOString(),
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                },
                context,
                system: this.getSystemInfo(),
                cli: {
                    version: this.cliVersion,
                    cwd: process.cwd(),
                    command: process.argv.slice(2).join(' ')
                }
            };

            // Append to log file
            const logLine = JSON.stringify(entry, null, 2) + '\n---\n';
            await fs.appendFile(this.logPath, logLine, 'utf-8');
        } catch (logError) {
            // Don't throw if logging fails - just console.error
            console.error('[ErrorLogger] Failed to write to error log:', logError);
        }
    }

    private getSystemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();

        return {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            nodeVersion: process.version,
            bunVersion: (process.versions as any).bun,
            memory: {
                total: totalMem,
                free: freeMem,
                used: totalMem - freeMem
            },
            cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length
            },
            hostname: os.hostname(),
            username: os.userInfo().username
        };
    }

    async getRecentErrors(count: number = 10): Promise<ErrorLogEntry[]> {
        try {
            if (!(await fs.pathExists(this.logPath))) {
                return [];
            }

            const content = await fs.readFile(this.logPath, 'utf-8');
            const entries = content
                .split('\n---\n')
                .filter(entry => entry.trim())
                .map(entry => {
                    try {
                        return JSON.parse(entry) as ErrorLogEntry;
                    } catch {
                        return null;
                    }
                })
                .filter((entry): entry is ErrorLogEntry => entry !== null);

            return entries.slice(-count);
        } catch {
            return [];
        }
    }

    getLogPath(): string {
        return this.logPath;
    }
}
