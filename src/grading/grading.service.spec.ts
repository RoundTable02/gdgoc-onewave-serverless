/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { GradingService } from './grading.service';
import { BrowserManagerService } from '../browser/browser-manager.service';
import { ScriptParserService } from '../script/script-parser.service';
import { ScriptRunnerService } from '../script/script-runner.service';
import { EvidenceCollectorService } from '../evidence/evidence-collector.service';
import { FeedbackGeneratorService } from '../feedback/feedback-generator.service';
import { GradingRequestDto } from './dto/grading-request.dto';

describe('GradingService', () => {
  let service: GradingService;
  let browserManager: BrowserManagerService;
  let scriptParser: ScriptParserService;
  let scriptRunner: ScriptRunnerService;
  let evidenceCollector: EvidenceCollectorService;
  let feedbackGenerator: FeedbackGeneratorService;

  const mockPage = {
    goto: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    close: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingService,
        {
          provide: BrowserManagerService,
          useValue: {
            launchBrowser: jest.fn().mockResolvedValue(mockBrowser),
            createContext: jest.fn().mockResolvedValue(mockContext),
          },
        },
        {
          provide: ScriptParserService,
          useValue: {
            parsePlaywrightScript: jest.fn().mockReturnValue([
              {
                taskName: 'Test 1',
                code: 'await page.click("button");',
              },
            ]),
          },
        },
        {
          provide: ScriptRunnerService,
          useValue: {
            execute: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: EvidenceCollectorService,
          useValue: {
            captureScreenshot: jest
              .fn()
              .mockResolvedValue('https://screenshot.png'),
          },
        },
        {
          provide: FeedbackGeneratorService,
          useValue: {
            generateFeedback: jest.fn().mockResolvedValue({
              summary: 'Test failed',
              suggestion: 'Fix the code',
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GradingService>(GradingService);
    browserManager = module.get<BrowserManagerService>(BrowserManagerService);
    scriptParser = module.get<ScriptParserService>(ScriptParserService);
    scriptRunner = module.get<ScriptRunnerService>(ScriptRunnerService);
    evidenceCollector = module.get<EvidenceCollectorService>(
      EvidenceCollectorService,
    );
    feedbackGenerator = module.get<FeedbackGeneratorService>(
      FeedbackGeneratorService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('runGrading', () => {
    const request: GradingRequestDto = {
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
      targetUrl: 'https://example.com',
      playwrightScript:
        'test("Test 1", async ({ page }) => { await page.click("button"); });',
    };

    it('should successfully grade a submission with passing tests', async () => {
      const result = await service.runGrading(request);

      expect(result.submissionId).toBe(request.submissionId);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].isPassed).toBe(true);
      expect(result.results[0].taskName).toBe('Test 1');
    });

    it('should parse playwright script', async () => {
      await service.runGrading(request);

      expect(scriptParser.parsePlaywrightScript).toHaveBeenCalledWith(
        request.playwrightScript,
      );
    });

    it('should launch browser and create context', async () => {
      await service.runGrading(request);

      expect(browserManager.launchBrowser).toHaveBeenCalled();
      expect(browserManager.createContext).toHaveBeenCalled();
    });

    it('should navigate to target URL', async () => {
      await service.runGrading(request);

      expect(mockPage.goto).toHaveBeenCalledWith(request.targetUrl, {
        waitUntil: 'domcontentloaded',
      });
    });

    it('should execute each test script', async () => {
      await service.runGrading(request);

      expect(scriptRunner.execute).toHaveBeenCalledWith(
        'await page.click("button");',
        expect.objectContaining({ page: mockPage }),
      );
    });

    it('should close browser and context after grading', async () => {
      await service.runGrading(request);

      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle test failures', async () => {
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Element not found',
      });

      const result = await service.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.results[0].isPassed).toBe(false);
    });

    it('should capture screenshot on test failure', async () => {
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Test error',
      });

      await service.runGrading(request);

      expect(evidenceCollector.captureScreenshot).toHaveBeenCalledWith(
        mockPage,
        request.submissionId,
        expect.any(String),
      );
    });

    it('should generate feedback on test failure', async () => {
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Test error',
      });

      await service.runGrading(request);

      expect(feedbackGenerator.generateFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          taskName: 'Test 1',
          message: 'Test error',
        }),
        expect.any(String),
      );
    });

    it('should include feedback in failed test result', async () => {
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Test error',
      });

      const result = await service.runGrading(request);

      expect(result.results[0].feedback).toContain('Test failed');
      expect(result.results[0].feedback).toContain('Fix the code');
    });

    it('should handle multiple test cases', async () => {
      (scriptParser.parsePlaywrightScript as jest.Mock).mockReturnValueOnce([
        { taskName: 'Test 1', code: 'code1' },
        { taskName: 'Test 2', code: 'code2' },
        { taskName: 'Test 3', code: 'code3' },
      ]);

      const result = await service.runGrading(request);

      expect(result.results).toHaveLength(3);
      expect(scriptRunner.execute).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed test results', async () => {
      (scriptParser.parsePlaywrightScript as jest.Mock).mockReturnValueOnce([
        { taskName: 'Test 1', code: 'code1' },
        { taskName: 'Test 2', code: 'code2' },
      ]);

      (scriptRunner.execute as jest.Mock)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });

      const result = await service.runGrading(request);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].isPassed).toBe(true);
      expect(result.results[1].isPassed).toBe(false);
      expect(result.success).toBe(false);
    });

    it('should return error when no tests found', async () => {
      (scriptParser.parsePlaywrightScript as jest.Mock).mockReturnValueOnce([]);

      const result = await service.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.errorMessage).toContain('No test cases found');
    });

    it('should handle browser launch errors', async () => {
      (browserManager.launchBrowser as jest.Mock).mockRejectedValueOnce(
        new Error('Browser launch failed'),
      );

      const result = await service.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Browser launch failed');
    });

    it('should handle navigation errors', async () => {
      mockPage.goto.mockRejectedValueOnce(new Error('Navigation failed'));

      const result = await service.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Navigation failed');
    });

    it('should clean up resources on error', async () => {
      mockPage.goto.mockRejectedValueOnce(new Error('Test error'));

      await service.runGrading(request);

      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should sanitize task IDs for file paths', async () => {
      (scriptParser.parsePlaywrightScript as jest.Mock).mockReturnValueOnce([
        { taskName: 'Test with spaces', code: 'code' },
      ]);
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Error',
      });

      await service.runGrading(request);

      expect(evidenceCollector.captureScreenshot).toHaveBeenCalledWith(
        mockPage,
        request.submissionId,
        'Test_with_spaces',
      );
    });

    it('should set success to false if any test fails', async () => {
      (scriptParser.parsePlaywrightScript as jest.Mock).mockReturnValueOnce([
        { taskName: 'Test 1', code: 'code1' },
        { taskName: 'Test 2', code: 'code2' },
        { taskName: 'Test 3', code: 'code3' },
      ]);

      (scriptRunner.execute as jest.Mock)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });

      const result = await service.runGrading(request);

      expect(result.success).toBe(false);
    });

    it('should handle unknown errors gracefully', async () => {
      (scriptRunner.execute as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: undefined,
      });

      const result = await service.runGrading(request);

      expect(result.results[0].isPassed).toBe(false);
      expect(feedbackGenerator.generateFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unknown error',
        }),
        expect.any(String),
      );
    });
  });
});
