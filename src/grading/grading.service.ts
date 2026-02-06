import { Injectable, Logger } from '@nestjs/common';
import { BrowserManagerService } from '../browser/browser-manager.service';
import { ScriptParserService } from '../script/script-parser.service';
import { ScriptRunnerService } from '../script/script-runner.service';
import { EvidenceCollectorService } from '../evidence/evidence-collector.service';
import { FeedbackGeneratorService } from '../feedback/feedback-generator.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import {
  GradingResponseDto,
  GradingResultItem,
} from './dto/grading-response.dto';
import { expect } from '@playwright/test';
import { Browser, BrowserContext, Page } from 'playwright';

@Injectable()
export class GradingService {
  private readonly logger = new Logger(GradingService.name);

  constructor(
    private readonly browserManager: BrowserManagerService,
    private readonly scriptParser: ScriptParserService,
    private readonly scriptRunner: ScriptRunnerService,
    private readonly evidenceCollector: EvidenceCollectorService,
    private readonly feedbackGenerator: FeedbackGeneratorService,
  ) {}

  async runGrading(request: GradingRequestDto): Promise<GradingResponseDto> {
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

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;

    try {
      // 2. 브라우저 실행
      browser = await this.browserManager.launchBrowser();
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
            feedback: '테스트 통과',
          });
        } else {
          hasErrors = true;

          // 실패 시 스크린샷 저장
          const taskId = script.taskName.replace(/\s+/g, '_');
          const screenshotUrl = await this.evidenceCollector.captureScreenshot(
            page,
            submissionId,
            taskId,
          );

          // AI 피드백 생성
          const feedback = await this.feedbackGenerator.generateFeedback(
            {
              taskName: script.taskName,
              code: script.code,
              message: result.error || 'Unknown error',
            },
            screenshotUrl,
          );

          results.push({
            taskName: script.taskName,
            isPassed: false,
            feedback: `${feedback.summary} ${feedback.suggestion}`,
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
      if (browser) {
        await browser.close();
      }
    }
  }
}
