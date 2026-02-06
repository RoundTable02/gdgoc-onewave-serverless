import { Page } from 'playwright';

export interface ParsedTestScript {
  taskName: string;
  code: string;
}

export interface ScriptContext {
  page: Page;
  expect: any;
}

export interface ExecutionResult {
  success: boolean;
  error?: string;
  screenshot?: Buffer;
  html?: string;
}

export interface ExecutionOptions {
  timeout?: number;
  captureOnError?: boolean;
}
