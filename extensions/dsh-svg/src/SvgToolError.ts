import { HarnessError } from '@deepseek-ai/dsh-llm';

/** Stable error identity retained by DSH's official tool execution pipeline. */
export class SvgToolError extends HarnessError {
  constructor(message: string, code = 'SVG_EDIT_FAILED') {
    super(message, code);
    this.name = 'SvgToolError';
  }
}
