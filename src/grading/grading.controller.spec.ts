import { Test, TestingModule } from '@nestjs/testing';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import { GradingResponseDto } from './dto/grading-response.dto';

describe('GradingController', () => {
  let controller: GradingController;
  let service: GradingService;

  const mockGradingResponse: GradingResponseDto = {
    submissionId: '550e8400-e29b-41d4-a716-446655440000',
    success: true,
    results: [
      {
        taskName: 'Test 1',
        isPassed: true,
        feedback: '테스트 통과',
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GradingController],
      providers: [
        {
          provide: GradingService,
          useValue: {
            runGrading: jest.fn().mockResolvedValue(mockGradingResponse),
          },
        },
      ],
    }).compile();

    controller = module.get<GradingController>(GradingController);
    service = module.get<GradingService>(GradingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('runGrading', () => {
    const request: GradingRequestDto = {
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
      targetUrl: 'https://example.com',
      playwrightScript: 'test("Test 1", async ({ page }) => { await page.click("button"); });',
    };

    it('should handle grading request', async () => {
      const result = await controller.runGrading(request);

      expect(result).toEqual(mockGradingResponse);
      expect(service.runGrading).toHaveBeenCalledWith(request);
    });

    it('should return grading response', async () => {
      const result = await controller.runGrading(request);

      expect(result.submissionId).toBe(request.submissionId);
      expect(result.success).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('should handle successful grading', async () => {
      const result = await controller.runGrading(request);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].isPassed).toBe(true);
    });

    it('should handle failed grading', async () => {
      const failedResponse: GradingResponseDto = {
        submissionId: request.submissionId,
        success: false,
        results: [
          {
            taskName: 'Test 1',
            isPassed: false,
            feedback: 'Test failed',
          },
        ],
      };

      (service.runGrading as jest.Mock).mockResolvedValueOnce(failedResponse);

      const result = await controller.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.results[0].isPassed).toBe(false);
    });

    it('should handle grading with error message', async () => {
      const errorResponse: GradingResponseDto = {
        submissionId: request.submissionId,
        success: false,
        results: [],
        errorMessage: 'Browser launch failed',
      };

      (service.runGrading as jest.Mock).mockResolvedValueOnce(errorResponse);

      const result = await controller.runGrading(request);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Browser launch failed');
    });

    it('should handle multiple test results', async () => {
      const multipleResults: GradingResponseDto = {
        submissionId: request.submissionId,
        success: true,
        results: [
          { taskName: 'Test 1', isPassed: true, feedback: '통과' },
          { taskName: 'Test 2', isPassed: true, feedback: '통과' },
          { taskName: 'Test 3', isPassed: true, feedback: '통과' },
        ],
      };

      (service.runGrading as jest.Mock).mockResolvedValueOnce(multipleResults);

      const result = await controller.runGrading(request);

      expect(result.results).toHaveLength(3);
    });

    it('should propagate service errors', async () => {
      (service.runGrading as jest.Mock).mockRejectedValueOnce(
        new Error('Service error')
      );

      await expect(controller.runGrading(request)).rejects.toThrow('Service error');
    });

    it('should handle different submission IDs', async () => {
      const differentRequest = {
        ...request,
        submissionId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const differentResponse = {
        ...mockGradingResponse,
        submissionId: differentRequest.submissionId,
      };

      (service.runGrading as jest.Mock).mockResolvedValueOnce(differentResponse);

      const result = await controller.runGrading(differentRequest);

      expect(result.submissionId).toBe(differentRequest.submissionId);
    });

    it('should handle Korean task names', async () => {
      const koreanResponse: GradingResponseDto = {
        submissionId: request.submissionId,
        success: true,
        results: [
          {
            taskName: '제목 확인하기',
            isPassed: true,
            feedback: '테스트 통과',
          },
        ],
      };

      (service.runGrading as jest.Mock).mockResolvedValueOnce(koreanResponse);

      const result = await controller.runGrading(request);

      expect(result.results[0].taskName).toBe('제목 확인하기');
    });
  });

  describe('healthCheck', () => {
    it('should return health status', () => {
      const result = controller.healthCheck();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('should return valid ISO timestamp', () => {
      const result = controller.healthCheck();

      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should return current timestamp', () => {
      const before = new Date();
      const result = controller.healthCheck();
      const after = new Date();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
