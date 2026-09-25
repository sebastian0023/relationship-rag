import type { Reporter, FullResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export default class SafeReporter implements Reporter {
  constructor(private readonly options: { outputFile?: string } = {}) {}
  onEnd(result: FullResult) {
    // Even without traces, ordinary reporters can expose headers, locators or page content.
    process.stdout.write(`Deployed suite: ${result.status}\n`);
    if (this.options.outputFile) {
      mkdirSync(dirname(this.options.outputFile), { recursive: true });
      writeFileSync(this.options.outputFile, JSON.stringify({ status: result.status }));
    }
  }
}
