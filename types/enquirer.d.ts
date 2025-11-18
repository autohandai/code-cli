declare module 'enquirer' {
  export interface PromptOptions<TValue = unknown> {
    type: string;
    name: string;
    message: string;
    initial?: TValue;
    choices?: Array<string | { name: string; message?: string; value?: string }>;
    validate?: (value: TValue) => boolean | string;
    prefix?: string;
    suggest?: (input: string, choices: Array<string | { name: string; message?: string; value?: string }>) => Promise<string[]>;
  }

  export function prompt<TAnswers = Record<string, unknown>>(
    questions: PromptOptions | PromptOptions[]
  ): Promise<TAnswers>;

  const enquirer: {
    prompt: typeof prompt;
  };

  export default enquirer;
}
