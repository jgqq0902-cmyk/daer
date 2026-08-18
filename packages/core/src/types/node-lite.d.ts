declare const console: {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

declare class URL {
  constructor(url: string, base?: string | URL);
}

interface ImportMeta {
  readonly url: string;
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module 'node:path' {
  export function dirname(path: string): string;
}

declare module 'node:worker_threads' {
  export interface MessagePort {
    on(event: 'message', listener: (message: any) => void): void;
    postMessage(message: unknown): void;
  }

  export const parentPort: MessagePort | null;

  export interface WorkerOptions {
    execArgv?: string[];
  }

  export class Worker {
    constructor(filename: string | URL, options?: WorkerOptions);
    on(event: 'message', listener: (message: any) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (code: number) => void): this;
    postMessage(message: unknown): void;
    terminate(): Promise<number>;
  }
}
