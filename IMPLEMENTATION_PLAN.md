# Grading Worker 구현 계획서

> NestJS 기반 Playwright 채점 워커 개발 계획

---

## 1. 프로젝트 개요

### 1.1 목적
Spring Boot API 서버로부터 채점 요청을 받아 Playwright를 통해 프론트엔드 과제를 자동 채점하는 마이크로서비스

### 1.2 기술 스택
| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20 LTS |
| Framework | NestJS 10.x |
| Browser | Playwright 1.58+ |
| AI | Google Gemini API (gemini-2.0-flash) - 피드백 생성용 |
| Deployment | GCP Cloud Run (gen2) |
| Storage | Google Cloud Storage (GCS) |

### 1.3 핵심 워크플로우
```
1. POST /grade 엔드포인트로 채점 요청 수신
2. playwrightScript 파싱 → 개별 테스트 케이스 추출
3. Playwright Chromium으로 targetUrl 접속 및 테스트 실행
4. 실패 시 Gemini AI로 피드백 생성
5. GCS에 스크린샷/영상 업로드
6. 결과 JSON 반환 (⚠️ 60초 이내 응답 필수)
```

**⚠️ 중요: 타임아웃 제약**
- Spring Boot API 서버 Worker 호출 타임아웃: 60초
- 전체 프로세스는 50초 이내 완료 권장
- 각 테스트는 25초 이내 실행

---

## 2. 구현 단계

### Phase 1: 프로젝트 초기화 (1-2시간)

#### 작업 내용
1. NestJS 프로젝트 생성
   ```bash
   npx @nestjs/cli new . --skip-git --package-manager npm
   ```

2. 필수 패키지 설치
   ```bash
   # Core
   npm install @nestjs/config class-validator class-transformer joi

   # Playwright
   npm install playwright @playwright/test
   npx playwright install chromium

   # Google Cloud
   npm install @google-cloud/storage @google/generative-ai

   # Utilities
   npm install uuid
   npm install -D @types/uuid
   ```

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/main.ts` | 앱 부트스트랩, ValidationPipe, 글로벌 필터 설정 |
| `src/app.module.ts` | 루트 모듈, ConfigModule 설정 |
| `src/config/configuration.ts` | 환경변수 로드 함수 |
| `src/config/validation.schema.ts` | Joi 환경변수 검증 스키마 |
| `.env.example` | 환경변수 템플릿 |

#### 핵심 코드

**src/main.ts**
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = process.env.PORT || 8080;
  await app.listen(port);
  logger.log(`Grading Worker listening on port ${port}`);
}
bootstrap();
```

**src/config/validation.schema.ts**
```typescript
import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(8080),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  GEMINI_API_KEY: Joi.string().required(),
  GCS_BUCKET: Joi.string().required(),
  GCS_PROJECT_ID: Joi.string().required(),
  GRADING_TIMEOUT_MS: Joi.number().default(50000), // API 서버 60초 타임아웃에 맞춤
  BROWSER_HEADLESS: Joi.boolean().default(true),
  ENABLE_VIDEO_RECORDING: Joi.boolean().default(false),
});
```

---

### Phase 2: Common 모듈 (30분)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/common/filters/http-exception.filter.ts` | 글로벌 예외 필터 |
| `src/common/interceptors/logging.interceptor.ts` | 요청/응답 로깅 |
| `src/common/utils/retry.util.ts` | 재시도 유틸리티 |

#### 핵심 코드

**src/common/filters/http-exception.filter.ts**
```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof Error
      ? exception.message
      : 'Internal server error';

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json(errorResponse);
  }
}
```

**src/common/utils/retry.util.ts**
```typescript
export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(error: Error): boolean {
  const retryablePatterns = [
    'net::ERR_',
    'ETIMEDOUT',
    'ECONNRESET',
    'Navigation timeout',
  ];
  return retryablePatterns.some(p => error.message.includes(p));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 10000 } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (!isRetryable(lastError) || attempt === maxAttempts) {
        throw error;
      }
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError!;
}
```

---

### Phase 3: Browser 모듈 (1시간)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/browser/browser.module.ts` | 브라우저 모듈 |
| `src/browser/browser-manager.service.ts` | Playwright 라이프사이클 관리 |
| `src/browser/browser.config.ts` | 브라우저 설정 상수 |

#### 핵심 코드

**src/browser/browser.config.ts**
```typescript
export const BROWSER_CONFIG = {
  launch: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
  context: {
    viewport: { width: 1280, height: 720 },
    userAgent: 'ConnectableGrader/1.0',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  timeouts: {
    navigation: 30000,
    action: 10000,
    script: 30000,
  },
};
```

**src/browser/browser-manager.service.ts**
```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser, BrowserContext, BrowserContextOptions } from 'playwright';
import { BROWSER_CONFIG } from './browser.config';

@Injectable()
export class BrowserManagerService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private readonly logger = new Logger(BrowserManagerService.name);

  async launchBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    this.logger.log('Launching browser...');
    this.browser = await chromium.launch(BROWSER_CONFIG.launch);
    return this.browser;
  }

  async createContext(options?: BrowserContextOptions): Promise<BrowserContext> {
    if (!this.browser) {
      await this.launchBrowser();
    }

    return this.browser!.newContext({
      ...BROWSER_CONFIG.context,
      ...options,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowser();
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      this.logger.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}
```

---

### Phase 4: Script 모듈 (2시간)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/script/script.module.ts` | 스크립트 모듈 |
| `src/script/script-parser.service.ts` | Playwright 스크립트 파싱 |
| `src/script/script-runner.service.ts` | 안전한 스크립트 실행 |
| `src/script/interfaces/script.interface.ts` | 타입 정의 |

#### 핵심 코드

**src/script/interfaces/script.interface.ts**
```typescript
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
  timeout?: number;  // 기본값: 25000ms (API 서버 60초 제한 고려)
  captureOnError?: boolean;
}
```

**src/script/script-parser.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ParsedTestScript } from './interfaces/script.interface';

@Injectable()
export class ScriptParserService {
  private readonly logger = new Logger(ScriptParserService.name);

  parsePlaywrightScript(script: string): ParsedTestScript[] {
    const tests: ParsedTestScript[] = [];

    // test('taskName', async ({ page }) => { ... }) 패턴 추출
    // 중첩된 중괄호를 처리하기 위한 더 정교한 파싱
    const testPattern = /test\s*\(\s*['"]([^'"]+)['"]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{/g;

    let match;
    while ((match = testPattern.exec(script)) !== null) {
      const taskName = match[1];
      const startIndex = match.index + match[0].length;

      // 중괄호 매칭으로 테스트 본문 추출
      let braceCount = 1;
      let endIndex = startIndex;

      for (let i = startIndex; i < script.length && braceCount > 0; i++) {
        if (script[i] === '{') braceCount++;
        else if (script[i] === '}') braceCount--;
        endIndex = i;
      }

      const code = script.substring(startIndex, endIndex).trim();

      tests.push({ taskName, code });
      this.logger.debug(`Parsed test: ${taskName}`);
    }

    this.logger.log(`Parsed ${tests.length} test(s) from script`);
    return tests;
  }
}
```

**src/script/script-runner.service.ts**
```typescript
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
    const { timeout = 25000, captureOnError = true } = options;  // 25초 (60초 전체 제한 고려)

    try {
      // AsyncFunction 생성자를 사용하여 동적 코드 실행
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('page', 'expect', code);

      // 타임아웃과 함께 실행 (기본 25초)
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
```

---

### Phase 5: Evidence 모듈 (1시간)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/evidence/evidence.module.ts` | 증거 수집 모듈 |
| `src/evidence/evidence-collector.service.ts` | 스크린샷/DOM 수집 |
| `src/evidence/storage/gcs-storage.service.ts` | GCS 업로드 |

#### 핵심 코드

**src/evidence/storage/gcs-storage.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class GcsStorageService {
  private readonly bucket: Bucket;
  private readonly logger = new Logger(GcsStorageService.name);

  constructor(private configService: ConfigService) {
    const storage = new Storage({
      projectId: configService.get('GCS_PROJECT_ID'),
    });
    this.bucket = storage.bucket(configService.get('GCS_BUCKET')!);
  }

  async uploadBuffer(
    buffer: Buffer,
    path: string,
    contentType: string,
  ): Promise<string> {
    const file = this.bucket.file(path);

    await file.save(buffer, {
      contentType,
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${path}`;
    this.logger.log(`Uploaded: ${publicUrl}`);

    return publicUrl;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<string> {
    await this.bucket.upload(localPath, {
      destination: remotePath,
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${remotePath}`;
    this.logger.log(`Uploaded file: ${publicUrl}`);

    return publicUrl;
  }
}
```

**src/evidence/evidence-collector.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Page, BrowserContext } from 'playwright';
import { GcsStorageService } from './storage/gcs-storage.service';

@Injectable()
export class EvidenceCollectorService {
  private readonly logger = new Logger(EvidenceCollectorService.name);

  constructor(private gcsStorage: GcsStorageService) {}

  async captureScreenshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string> {
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    const path = `evidence/${submissionId}/${taskId}/screenshot.png`;
    return this.gcsStorage.uploadBuffer(screenshot, path, 'image/png');
  }

  async captureDOMSnapshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string> {
    const html = await page.content();
    const buffer = Buffer.from(html, 'utf-8');

    const path = `evidence/${submissionId}/${taskId}/dom.html`;
    return this.gcsStorage.uploadBuffer(buffer, path, 'text/html');
  }

  async saveVideo(
    context: BrowserContext,
    submissionId: string,
  ): Promise<string | undefined> {
    const pages = context.pages();
    if (pages.length === 0) return undefined;

    const video = pages[0].video();
    if (!video) return undefined;

    try {
      const videoPath = await video.path();
      const remotePath = `evidence/${submissionId}/recording.webm`;
      return this.gcsStorage.uploadFile(videoPath!, remotePath);
    } catch (error) {
      this.logger.warn('Failed to save video recording');
      return undefined;
    }
  }
}
```

---

### Phase 6: Feedback 모듈 (1시간)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/feedback/feedback.module.ts` | 피드백 모듈 |
| `src/feedback/gemini/gemini.service.ts` | Gemini API 연동 |
| `src/feedback/feedback-generator.service.ts` | 피드백 생성 |
| `src/feedback/interfaces/feedback.interface.ts` | 타입 정의 |

#### 핵심 코드

**src/feedback/interfaces/feedback.interface.ts**
```typescript
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
```

**src/feedback/gemini/gemini.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class GeminiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GeminiService.name);

  constructor(private configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      configService.get('GEMINI_API_KEY')!,
    );
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
    });
  }

  async generateContent(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
        },
      });

      return result.response.text();
    } catch (error) {
      this.logger.error('Gemini API call failed', error);
      throw error;
    }
  }
}
```

**src/feedback/feedback-generator.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini/gemini.service';
import { ScriptError, Feedback } from './interfaces/feedback.interface';

@Injectable()
export class FeedbackGeneratorService {
  private readonly logger = new Logger(FeedbackGeneratorService.name);

  constructor(private geminiService: GeminiService) {}

  async generateFeedback(
    error: ScriptError,
    screenshotUrl?: string,
  ): Promise<Feedback> {
    const prompt = this.buildPrompt(error);

    try {
      const response = await this.geminiService.generateContent(prompt);
      return this.parseFeedback(response);
    } catch (err) {
      this.logger.warn('Failed to generate AI feedback, using fallback');
      return {
        summary: `테스트 실패: ${error.message}`,
        suggestion: '코드를 확인하고 다시 시도해주세요.',
      };
    }
  }

  private buildPrompt(error: ScriptError): string {
    return `당신은 프론트엔드 채점 전문가입니다.
학생의 과제 제출물에서 발생한 테스트 실패 원인을 분석하고
친절하고 교육적인 피드백을 제공해주세요.

## 테스트 정보
- 테스트명: ${error.taskName}
- 에러 메시지: ${error.message}

## 실행 코드
\`\`\`javascript
${error.code}
\`\`\`

위 정보를 바탕으로 다음 JSON 형식으로 응답해주세요:
{
  "summary": "실패 원인 (1-2문장)",
  "suggestion": "해결 방법 (구체적인 코드 예시 포함)",
  "severity": "low | medium | high"
}`;
  }

  private parseFeedback(response: string): Feedback {
    try {
      const parsed = JSON.parse(response);
      return {
        summary: parsed.summary || '테스트 실패',
        suggestion: parsed.suggestion || '코드를 확인해주세요.',
        severity: parsed.severity,
      };
    } catch {
      return {
        summary: '테스트 실패',
        suggestion: '코드를 확인해주세요.',
      };
    }
  }
}
```

---

### Phase 7: Grading 모듈 (2시간)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `src/grading/grading.module.ts` | 채점 도메인 모듈 |
| `src/grading/grading.controller.ts` | HTTP 엔드포인트 |
| `src/grading/grading.service.ts` | 채점 오케스트레이션 |
| `src/grading/dto/grading-request.dto.ts` | 입력 DTO |
| `src/grading/dto/grading-response.dto.ts` | 출력 DTO |

#### 핵심 코드

**src/grading/dto/grading-request.dto.ts**
```typescript
import { IsString, IsUUID, IsUrl } from 'class-validator';

export class GradingRequestDto {
  @IsUUID()
  submissionId: string;

  @IsUrl()
  targetUrl: string;

  @IsString()
  playwrightScript: string;
}
```

**src/grading/dto/grading-response.dto.ts**
```typescript
export class GradingResultItem {
  taskName: string;
  isPassed: boolean;
  feedback: string;
}

export class GradingResponseDto {
  submissionId: string;
  success: boolean;
  results: GradingResultItem[];
  errorMessage?: string;
}
```

**src/grading/grading.controller.ts**
```typescript
import { Controller, Post, Get, Body, HttpCode, Logger } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import { GradingResponseDto } from './dto/grading-response.dto';

@Controller()
export class GradingController {
  private readonly logger = new Logger(GradingController.name);

  constructor(private readonly gradingService: GradingService) {}

  @Post('grade')
  @HttpCode(200)
  async runGrading(@Body() request: GradingRequestDto): Promise<GradingResponseDto> {
    this.logger.log(`Grading request received: ${request.submissionId}`);
    return this.gradingService.runGrading(request);
  }

  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    };
  }
}
```

**src/grading/grading.service.ts**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { BrowserManagerService } from '../browser/browser-manager.service';
import { ScriptParserService } from '../script/script-parser.service';
import { ScriptRunnerService } from '../script/script-runner.service';
import { EvidenceCollectorService } from '../evidence/evidence-collector.service';
import { FeedbackGeneratorService } from '../feedback/feedback-generator.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import { GradingResponseDto, GradingResultItem } from './dto/grading-response.dto';
import { expect } from '@playwright/test';

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
    const testScripts = this.scriptParser.parsePlaywrightScript(playwrightScript);

    if (testScripts.length === 0) {
      this.logger.warn('No test cases found in script');
      return {
        submissionId,
        success: false,
        results: [],
        errorMessage: 'No test cases found in playwrightScript',
      };
    }

    // 2. 브라우저 실행
    const browser = await this.browserManager.launchBrowser();
    const context = await this.browserManager.createContext();
    const page = await context.newPage();

    try {
      // 3. 타겟 URL 접속
      this.logger.log(`Navigating to: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // 4. 각 테스트 실행
      for (const script of testScripts) {
        this.logger.log(`Running test: ${script.taskName}`);

        const result = await this.scriptRunner.execute(
          script.code,
          { page, expect },
        );

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
            page, submissionId, taskId
          );

          // AI 피드백 생성
          const feedback = await this.feedbackGenerator.generateFeedback({
            taskName: script.taskName,
            code: script.code,
            message: result.error || 'Unknown error',
          }, screenshotUrl);

          results.push({
            taskName: script.taskName,
            isPassed: false,
            feedback: `${feedback.summary} ${feedback.suggestion}`,
          });
        }
      }

      this.logger.log(`Grading completed: ${results.filter(r => r.isPassed).length}/${results.length} passed`);

      return {
        submissionId,
        success: !hasErrors,
        results,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Grading failed: ${errorMessage}`);

      return {
        submissionId,
        success: false,
        results: [],
        errorMessage,
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
```

---

### Phase 8: 배포 설정 (30분)

#### 생성 파일
| 파일 경로 | 설명 |
|----------|------|
| `Dockerfile` | 컨테이너 이미지 빌드 |
| `cloudbuild.yaml` | Cloud Build CI/CD |
| `.dockerignore` | Docker 빌드 제외 |
| `.env.example` | 환경변수 템플릿 |

#### 핵심 코드

**Dockerfile**
```dockerfile
# 공식 Playwright 이미지 사용
FROM mcr.microsoft.com/playwright:v1.58.0-noble

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY dist/ ./dist/

# Cloud Run 필수 환경변수
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# 비root 사용자로 실행 (보안)
USER pwuser

CMD ["node", "dist/main.js"]
```

**cloudbuild.yaml**
```yaml
steps:
  # 빌드
  - name: 'node:20'
    entrypoint: 'npm'
    args: ['ci']

  - name: 'node:20'
    entrypoint: 'npm'
    args: ['run', 'build']

  # Docker 이미지 빌드
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/grading-worker:$COMMIT_SHA', '.']

  # 이미지 푸시
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/grading-worker:$COMMIT_SHA']

  # Cloud Run 배포
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'grading-worker'
      - '--image=gcr.io/$PROJECT_ID/grading-worker:$COMMIT_SHA'
      - '--region=asia-northeast3'
      - '--platform=managed'
      - '--memory=2Gi'
      - '--cpu=2'
      - '--concurrency=1'
      - '--timeout=120s'  # API 서버 90초 타임아웃 + 여유 (60초 Worker + 30초 오버헤드)
      - '--min-instances=1'
      - '--max-instances=10'
      - '--execution-environment=gen2'
      - '--allow-unauthenticated'

timeout: 1800s
```

**.env.example**
```bash
# Server
PORT=8080
NODE_ENV=development

# Google Gemini AI
GEMINI_API_KEY=AIza...

# Google Cloud Storage
GCS_BUCKET=connectable-grading-evidence
GCS_PROJECT_ID=your-project-id

# Grading Settings
GRADING_TIMEOUT_MS=50000  # API 서버 60초 타임아웃에 맞춤 (50초 + 여유)
BROWSER_HEADLESS=true
ENABLE_VIDEO_RECORDING=false
```

---

## 3. 전체 파일 구조

```
connectable-serverless/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── validation.schema.ts
│   ├── grading/
│   │   ├── grading.module.ts
│   │   ├── grading.controller.ts
│   │   ├── grading.service.ts
│   │   └── dto/
│   │       ├── grading-request.dto.ts
│   │       └── grading-response.dto.ts
│   ├── browser/
│   │   ├── browser.module.ts
│   │   ├── browser-manager.service.ts
│   │   └── browser.config.ts
│   ├── script/
│   │   ├── script.module.ts
│   │   ├── script-parser.service.ts
│   │   ├── script-runner.service.ts
│   │   └── interfaces/
│   │       └── script.interface.ts
│   ├── evidence/
│   │   ├── evidence.module.ts
│   │   ├── evidence-collector.service.ts
│   │   └── storage/
│   │       └── gcs-storage.service.ts
│   ├── feedback/
│   │   ├── feedback.module.ts
│   │   ├── feedback-generator.service.ts
│   │   ├── gemini/
│   │   │   └── gemini.service.ts
│   │   └── interfaces/
│   │       └── feedback.interface.ts
│   └── common/
│       ├── filters/
│       │   └── http-exception.filter.ts
│       ├── interceptors/
│       │   └── logging.interceptor.ts
│       └── utils/
│           └── retry.util.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── Dockerfile
├── cloudbuild.yaml
├── .dockerignore
├── .env.example
├── .gitignore
├── DEVELOPMENT_SPEC.md
├── REQUIREMENTS.md
└── IMPLEMENTATION_PLAN.md
```

---

## 4. 환경 변수 목록

| 변수명 | 필수 | 기본값 | 설명 |
|--------|------|--------|------|
| `PORT` | X | 8080 | 서버 포트 |
| `NODE_ENV` | X | development | 실행 환경 |
| `GEMINI_API_KEY` | O | - | Google Gemini API 키 |
| `GCS_BUCKET` | O | - | GCS 버킷 이름 |
| `GCS_PROJECT_ID` | O | - | GCP 프로젝트 ID |
| `GRADING_TIMEOUT_MS` | X | 50000 | 채점 타임아웃 (ms, API 서버 60초 제한) |
| `BROWSER_HEADLESS` | X | true | 헤드리스 모드 |
| `ENABLE_VIDEO_RECORDING` | X | false | 비디오 녹화 활성화 |

---

## 5. 검증 방법

### 5.1 로컬 테스트
```bash
# 개발 서버 실행
npm run start:dev

# Health Check
curl http://localhost:8080/health

# 채점 테스트
curl -X POST http://localhost:8080/grade \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "550e8400-e29b-41d4-a716-446655440000",
    "targetUrl": "https://example.com",
    "playwrightScript": "test(\"title check\", async ({ page }) => { await expect(page).toHaveTitle(/Example/); });"
  }'
```

### 5.2 테스트 실행
```bash
# 단위 테스트
npm run test

# E2E 테스트
npm run test:e2e

# 커버리지
npm run test:cov
```

### 5.3 Docker 빌드
```bash
# 빌드
npm run build

# Docker 이미지 빌드
docker build -t grading-worker .

# 로컬 실행
docker run -p 8080:8080 \
  -e GEMINI_API_KEY=xxx \
  -e GCS_BUCKET=xxx \
  -e GCS_PROJECT_ID=xxx \
  grading-worker
```

---

## 6. 예상 소요 시간

| Phase | 작업 내용 | 예상 시간 |
|-------|----------|----------|
| 1 | 프로젝트 초기화 | 1-2시간 |
| 2 | Common 모듈 | 30분 |
| 3 | Browser 모듈 | 1시간 |
| 4 | Script 모듈 | 2시간 |
| 5 | Evidence 모듈 | 1시간 |
| 6 | Feedback 모듈 | 1시간 |
| 7 | Grading 모듈 | 2시간 |
| 8 | 배포 설정 | 30분 |
| **Total** | | **~10시간** |

---

## 7. 주요 고려사항

### 7.1 보안
- AsyncFunction을 사용한 동적 코드 실행 (vm2 deprecated 대응)
- 모든 스크립트에 30초 타임아웃 적용
- Cloud Run에서 비root 사용자로 실행
- 환경변수로 민감 정보 관리

### 7.2 성능
- Cloud Run concurrency=1 (브라우저 메모리 충돌 방지)
- 2GiB 메모리, 2 vCPU 설정
- 120초 Cloud Run 타임아웃 (API 서버 90초 타임아웃 + 여유)
- **Worker 응답: 60초 이내 필수** (Spring Boot 타임아웃)
- 실제 채점 프로세스: 50초 이내 권장
- min-instances=1로 Cold Start 방지

### 7.3 에러 처리
- 재시도 가능한 에러 (네트워크) vs 불가능한 에러 (assertion) 구분
- 글로벌 예외 필터로 일관된 에러 응답
- AI 피드백 생성 실패 시 폴백 메시지 제공

### 7.4 API 서버 연동
- 입력: `submissionId`, `targetUrl`, `playwrightScript`
- 출력: `submissionId`, `success`, `results[]`, `errorMessage?`
- **60초 내 응답 필수** (Spring Boot Worker 호출 타임아웃)
- **50초 이내 응답 권장** (네트워크 지연 고려)

---

## 8. 참고 문서

- [DEVELOPMENT_SPEC.md](./DEVELOPMENT_SPEC.md) - 상세 개발 명세
- [REQUIREMENTS.md](./REQUIREMENTS.md) - 프로젝트 요구사항
- [Playwright 공식 문서](https://playwright.dev/docs/intro)
- [NestJS 공식 문서](https://docs.nestjs.com)
- [GCP Cloud Run 문서](https://cloud.google.com/run/docs)
- [Google Gemini API 문서](https://ai.google.dev/docs)

---

*작성일: 2026-02-06*
