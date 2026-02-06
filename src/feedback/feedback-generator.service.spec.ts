/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackGeneratorService } from './feedback-generator.service';
import { GeminiService } from './gemini/gemini.service';
import { ScriptError } from './interfaces/feedback.interface';

describe('FeedbackGeneratorService', () => {
  let service: FeedbackGeneratorService;
  let geminiService: GeminiService;

  beforeEach(async () => {
    const mockGeminiService = {
      generateContent: jest.fn().mockResolvedValue(
        JSON.stringify({
          summary: '테스트 실패: 요소를 찾을 수 없습니다',
          suggestion: 'CSS 선택자를 확인하고 정확한 요소를 지정해주세요',
          severity: 'medium',
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackGeneratorService,
        {
          provide: GeminiService,
          useValue: mockGeminiService,
        },
      ],
    }).compile();

    service = module.get<FeedbackGeneratorService>(FeedbackGeneratorService);
    geminiService = module.get<GeminiService>(GeminiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateFeedback', () => {
    it('should generate feedback for script error', async () => {
      const error: ScriptError = {
        taskName: 'Check title',
        code: 'await expect(page).toHaveTitle(/Example/);',
        message: 'Expected title to match /Example/ but got "Test Page"',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback).toBeDefined();
      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should include screenshot URL when provided', async () => {
      const error: ScriptError = {
        taskName: 'Click button',
        code: 'await page.click("button");',
        message: 'Element not found',
      };
      const screenshotUrl =
        'https://storage.googleapis.com/bucket/screenshot.png';

      const feedback = await service.generateFeedback(error, screenshotUrl);

      expect(feedback).toBeDefined();
      expect(geminiService.generateContent).toHaveBeenCalled();
    });

    it('should handle selector errors', async () => {
      const error: ScriptError = {
        taskName: 'Find element',
        code: 'await page.locator("#nonexistent").click();',
        message: 'Timeout 30000ms exceeded',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle assertion errors', async () => {
      const error: ScriptError = {
        taskName: 'Verify text',
        code: 'await expect(page.locator("h1")).toHaveText("Expected");',
        message: 'Expected: "Expected", Received: "Actual"',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle timeout errors', async () => {
      const error: ScriptError = {
        taskName: 'Wait for element',
        code: 'await page.waitForSelector(".loading");',
        message: 'Timeout 30000ms exceeded',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle navigation errors', async () => {
      const error: ScriptError = {
        taskName: 'Navigate to page',
        code: 'await page.goto("https://example.com");',
        message: 'net::ERR_NAME_NOT_RESOLVED',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle Korean error messages', async () => {
      const error: ScriptError = {
        taskName: '제목 확인',
        code: 'await expect(page).toHaveTitle(/테스트/);',
        message: '제목이 일치하지 않습니다',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback).toBeDefined();
    });

    it('should set severity level', async () => {
      const error: ScriptError = {
        taskName: 'Critical test',
        code: 'await page.click("button");',
        message: 'Element not found',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.severity).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(feedback.severity);
    });

    it('should use fallback when AI fails', async () => {
      (geminiService.generateContent as jest.Mock).mockRejectedValueOnce(
        new Error('API Error'),
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'test code',
        message: 'Test error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toContain('테스트 실패');
      expect(feedback.suggestion).toContain('코드를 확인');
    });

    it('should handle invalid JSON response', async () => {
      (geminiService.generateContent as jest.Mock).mockResolvedValueOnce(
        'Invalid JSON string',
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'test code',
        message: 'Test error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle partial JSON response', async () => {
      (geminiService.generateContent as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ summary: 'Only summary' }),
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'test code',
        message: 'Test error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });

    it('should handle empty response fields', async () => {
      (geminiService.generateContent as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ summary: '', suggestion: '' }),
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'test code',
        message: 'Test error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBeDefined();
      expect(feedback.suggestion).toBeDefined();
    });
  });

  describe('buildPrompt', () => {
    it('should build prompt with error information', async () => {
      const error: ScriptError = {
        taskName: 'Test task',
        code: 'test code',
        message: 'test error',
      };

      await service.generateFeedback(error);

      expect(geminiService.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Test task'),
      );
      expect(geminiService.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('test error'),
      );
      expect(geminiService.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('test code'),
      );
    });

    it('should request JSON format', async () => {
      const error: ScriptError = {
        taskName: 'Test',
        code: 'code',
        message: 'error',
      };

      await service.generateFeedback(error);

      expect(geminiService.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('JSON'),
      );
    });

    it('should include expected fields in prompt', async () => {
      const error: ScriptError = {
        taskName: 'Test',
        code: 'code',
        message: 'error',
      };

      await service.generateFeedback(error);

      const promptCall = (geminiService.generateContent as jest.Mock).mock
        .calls[0][0];
      expect(promptCall).toContain('summary');
      expect(promptCall).toContain('suggestion');
      expect(promptCall).toContain('severity');
    });
  });

  describe('parseFeedback', () => {
    it('should parse valid JSON response', async () => {
      (geminiService.generateContent as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          summary: 'Valid summary',
          suggestion: 'Valid suggestion',
          severity: 'high',
        }),
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'code',
        message: 'error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBe('Valid summary');
      expect(feedback.suggestion).toBe('Valid suggestion');
      expect(feedback.severity).toBe('high');
    });

    it('should handle missing severity', async () => {
      (geminiService.generateContent as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          summary: 'Summary',
          suggestion: 'Suggestion',
        }),
      );

      const error: ScriptError = {
        taskName: 'Test',
        code: 'code',
        message: 'error',
      };

      const feedback = await service.generateFeedback(error);

      expect(feedback.summary).toBe('Summary');
      expect(feedback.suggestion).toBe('Suggestion');
    });
  });
});
