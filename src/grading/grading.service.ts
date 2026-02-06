import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserManagerService } from '../browser/browser-manager.service';
import { ScriptParserService } from '../script/script-parser.service';
import { ScriptRunnerService } from '../script/script-runner.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import {
  GradingResponseDto,
  GradingResultItem,
} from './dto/grading-response.dto';
import { ParsedTestScript } from '../script/interfaces/script.interface';
import { expect } from '@playwright/test';
import { BrowserContext, Page } from 'playwright';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly browserManager: BrowserManagerService,
    private readonly scriptParser: ScriptParserService,
    private readonly scriptRunner: ScriptRunnerService,
    private readonly configService: ConfigService,
  ) {}

  async runGrading(request: GradingRequestDto): Promise<GradingResponseDto> {
    const enableParallel = this.configService.get<boolean>(
      'grading.enableParallelExecution',
      true,
    );

    if (enableParallel) {
      return this.runGradingParallel(request);
    } else {
      return this.runGradingSequential(request);
    }
  }

  private async runGradingSequential(
    request: GradingRequestDto,
  ): Promise<GradingResponseDto> {
    const { submissionId, targetUrl, playwrightScript } = request;
    const results: GradingResultItem[] = [];
    let hasErrors = false;

    this.logger.log(`Starting grading for submission: ${submissionId}`);

    // 1. 스크립트 파싱
    const testScripts =
      this.scriptParser.parsePlaywrightScript(playwrightScript);

    if (testScripts.length === 0) {
      this.logger.warn('No test cases found in script');
      return {
        submissionId,
        success: false,
        results: [],
        errorMessage: 'No test cases found in playwrightScript',
      };
    }

    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      // 2. 브라우저 실행
      await this.browserManager.launchBrowser();
      context = await this.browserManager.createContext();
      page = await context.newPage();

      // 3. 타겟 URL 접속
      this.logger.log(`Navigating to: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // 4. 각 테스트 실행
      for (const script of testScripts) {
        this.logger.log(`Running test: ${script.taskName}`);

        const result = await this.scriptRunner.execute(script.code, {
          page,
          expect,
        });

        if (result.success) {
          results.push({
            taskName: script.taskName,
            isPassed: true,
          });
        } else {
          hasErrors = true;
          results.push({
            taskName: script.taskName,
            isPassed: false,
          });
        }
      }

      this.logger.log(
        `Grading completed: ${results.filter((r) => r.isPassed).length}/${results.length} passed`,
      );

      return {
        submissionId,
        success: !hasErrors,
        results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Grading failed: ${errorMessage}`);

      return {
        submissionId,
        success: false,
        results: [],
        errorMessage,
      };
    } finally {
      if (context) {
        await context.close();
      }
      // Browser lifecycle is managed by BrowserManagerService
    }
  }

  private async runGradingParallel(
    request: GradingRequestDto,
  ): Promise<GradingResponseDto> {
    const { submissionId, targetUrl, playwrightScript } = request;

    this.logger.log(
      `Starting parallel grading for submission: ${submissionId}`,
    );

    // 1. 스크립트 파싱
    const testScripts =
      this.scriptParser.parsePlaywrightScript(playwrightScript);

    if (testScripts.length === 0) {
      this.logger.warn('No test cases found in script');
      return {
        submissionId,
        success: false,
        results: [],
        errorMessage: 'No test cases found in playwrightScript',
      };
    }

    let context: BrowserContext | undefined;

    try {
      // 2. 브라우저 & 컨텍스트 생성
      await this.browserManager.launchBrowser();
      context = await this.browserManager.createContext();

      // 3. 초기 네비게이션 (컨텍스트 상태 설정용)
      const initialPage = await context.newPage();
      this.logger.log(`Navigating to: ${targetUrl}`);
      await initialPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await initialPage.close();

      // 4. 전체 타임아웃과 함께 병렬 실행
      const timeoutMs = this.configService.get<number>(
        'grading.timeoutMs',
        300000,
      );
      const results = await Promise.race([
        this.executeTestsParallel(testScripts, context, targetUrl),
        this.createTimeoutPromise(timeoutMs),
      ]);

      this.logger.log(
        `Grading completed: ${results.filter((r) => r.isPassed).length}/${results.length} passed`,
      );

      return {
        submissionId,
        success: results.every((r) => r.isPassed),
        results,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Grading failed: ${errorMessage}`);

      return {
        submissionId,
        success: false,
        results: [],
        errorMessage,
      };
    } finally {
      if (context) {
        await context.close();
      }
    }
  }

  private async executeTestsParallel(
    testScripts: ParsedTestScript[],
    context: BrowserContext,
    targetUrl: string,
  ): Promise<GradingResultItem[]> {
    const maxConcurrent = this.configService.get<number>(
      'grading.maxConcurrentTests',
      5,
    );
    const results: GradingResultItem[] = new Array<GradingResultItem>(
      testScripts.length,
    );
    const executing: Set<Promise<void>> = new Set();

    this.logger.log(
      `Executing ${testScripts.length} tests (max ${maxConcurrent} concurrent)`,
    );

    for (let i = 0; i < testScripts.length; i++) {
      const script = testScripts[i];

      // 테스트 실행 Promise 생성
      const promise = this.executeOneTest(script, context, targetUrl).then(
        (result) => {
          results[i] = result; // 순서 보존
          executing.delete(promise);
        },
      );

      executing.add(promise);

      // 동시성 제한: maxConcurrent 도달 시 하나 완료될 때까지 대기
      if (executing.size >= maxConcurrent) {
        await Promise.race(executing);
      }
    }

    // 남은 테스트 완료 대기
    await Promise.all(Array.from(executing));

    return results;
  }

  private async executeOneTest(
    script: ParsedTestScript,
    context: BrowserContext,
    targetUrl: string,
  ): Promise<GradingResultItem> {
    const page = await context.newPage();
    const testTimeoutMs = this.configService.get<number>(
      'grading.testTimeoutMs',
      30000,
    );

    // Playwright 기본 타임아웃 설정 (빠른 실패를 위해 5초)
    page.setDefaultTimeout(5000);

    try {
      // 페이지 네비게이션 (각 테스트마다 새 페이지)
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // 테스트 실행
      this.logger.debug(`Running test: ${script.taskName}`);
      const result = await this.scriptRunner.execute(
        script.code,
        { page, expect },
        { timeout: testTimeoutMs },
      );

      if (result.success) {
        return { taskName: script.taskName, isPassed: true };
      } else {
        return { taskName: script.taskName, isPassed: false };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Test ${script.taskName} failed: ${errorMessage}`);
      return { taskName: script.taskName, isPassed: false };
    } finally {
      await page.close();
    }
  }

  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Grading timeout: exceeded ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
}
