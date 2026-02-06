import { Injectable, Logger } from '@nestjs/common';
import { ScriptContext, ExecutionResult, ExecutionOptions } from './interfaces/script.interface';

@Injectable()
export class ScriptRunnerService {
  private readonly logger = new Logger(ScriptRunnerService.name);

  async execute(
    code: string,
    context: ScriptContext,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    const { timeout = 30000, captureOnError = true } = options;

    try {
      // AsyncFunction 생성자를 사용하여 동적 코드 실행
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('page', 'expect', code);

      // 타임아웃과 함께 실행
      await Promise.race([
        fn(context.page, context.expect),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Script execution timeout')), timeout)
        ),
      ]);

      this.logger.debug('Script executed successfully');
      return { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Script execution failed: ${errorMessage}`);

      let screenshot: Buffer | undefined;
      let html: string | undefined;

      if (captureOnError) {
        try {
          screenshot = await context.page.screenshot({ type: 'png' });
          html = await context.page.content();
        } catch (captureError) {
          this.logger.warn('Failed to capture error evidence');
        }
      }

      return {
        success: false,
        error: errorMessage,
        screenshot,
        html,
      };
    }
  }
}
