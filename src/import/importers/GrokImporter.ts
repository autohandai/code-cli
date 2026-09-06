import { BaseImporter } from './BaseImporter.js';
import type { ImportCategory, ImportCategoryResult, ImportError, ImportResult, ImportScanResult, ProgressCallback } from '../types.js';

export class GrokImporter extends BaseImporter {
  readonly name = 'grok';
  readonly displayName = 'Grok CLI';
  readonly homePath = '~/.grok';

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    await this.scanHooks(available);
    return { source: this.name, available };
  }

  async import(categories: ImportCategory[], onProgress?: ProgressCallback): Promise<ImportResult> {
    const start = Date.now();
    const imported = new Map<ImportCategory, ImportCategoryResult>();
    const errors: ImportError[] = [];
    if (categories.includes('hooks')) await this.importCommandHooks(imported, errors, onProgress);
    return { source: this.name, imported, errors, duration: Date.now() - start };
  }
}
