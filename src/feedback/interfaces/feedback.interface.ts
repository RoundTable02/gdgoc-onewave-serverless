export interface ScriptError {
  taskName: string;
  code: string;
  message: string;
}

export interface Feedback {
  summary: string;
  suggestion: string;
  severity?: 'low' | 'medium' | 'high';
}
