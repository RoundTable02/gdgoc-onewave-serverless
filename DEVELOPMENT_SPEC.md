# Grading Worker 개발 명세서

> NestJS 기반 Playwright 채점 워커 - GCP Cloud Run 배포

---

## 1. 프로젝트 개요

### 1.1 목적
메인 서버로부터 채점 요청을 받아 Playwright를 통해 프론트엔드 과제를 자동 채점하는 마이크로서비스

### 1.2 핵심 기능
| 기능 | 설명 |
|------|------|
| Job 수신 | Spring Boot API 서버로부터 HTTP 요청 수신 |
| 스크립트 파싱 | Gemini가 생성한 Playwright 코드를 개별 테스트로 분해 |
| 브라우저 관리 | Playwright Chromium 인스턴스 라이프사이클 관리 |
| 스크립트 실행 | 테스트 코드를 안전하게 실행 (25초 이내) |
| 증거 수집 | 스크린샷, 비디오 녹화 등 캡처 |
| AI 분석 | 실패 항목에 대한 Gemini 기반 원인 분석 |
| 결과 반환 | 채점 결과를 Spring Boot API 서버에 반환 (⚠️ 60초 이내 필수) |

### 1.3 기술 스택
```
Runtime:        Node.js 20 LTS
Framework:      NestJS 10.x
Browser:        Playwright 1.58+
AI:             Google Gemini API (gemini-2.0-flash-exp) - 피드백 생성 전용
                ※ API 서버는 gemini-1.5-pro로 Playwright 스크립트 생성
Deployment:     GCP Cloud Run (gen2)
Storage:        Google Cloud Storage (GCS)
Database:       ※ Worker는 DB 직접 접근 안 함 (API 서버가 담당)
Caller:         Spring Boot API 서버 (메인 서버)
```

---

## 2. 아키텍처 설계

### 2.1 시스템 아키텍처
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              GCP Infrastructure                              │
│                                                                              │
│  ┌─────────────────────┐         HTTP (직접 호출)         ┌───────────────┐  │
│  │   Compute Engine    │ ─────────────────────────────▶  │   Cloud Run   │  │
│  │   (메인 서버)        │                                 │ (Grading Worker)│ │
│  │                     │ ◀─────────────────────────────  │               │  │
│  │  - NestJS API       │         채점 결과 반환           │               │  │
│  │  - 채점 Job 생성     │                                 │               │  │
│  └─────────────────────┘                                 └───────┬───────┘  │
│            │                                                     │          │
│            │                                                     │          │
│            ▼                                                     ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           Supabase                                   │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │    │
│  │  │ submissions │    │   results   │    │   tasks     │              │    │
│  │  │   테이블     │    │   테이블     │    │   테이블    │              │    │
│  │  └─────────────┘    └─────────────┘    └─────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                     Cloud Run: Grading Worker                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                                                             │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    │  │
│  │  │   HTTP      │───▶│   Grading   │───▶│   Browser    │    │  │
│  │  │  Controller │    │   Service   │    │   Manager    │    │  │
│  │  └─────────────┘    └──────┬──────┘    └──────────────┘    │  │
│  │                            │                                │  │
│  │         ┌──────────────────┼──────────────────┐            │  │
│  │         ▼                  ▼                  ▼            │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    │  │
│  │  │   Script    │    │  Evidence   │    │   Feedback   │    │  │
│  │  │   Runner    │    │  Collector  │    │   Generator  │    │  │
│  │  └─────────────┘    └──────┬──────┘    └──────┬───────┘    │  │
│  │                            │                  │            │  │
│  │                    ┌───────┴──────────────────┴───────┐    │  │
│  │                    ▼                                  ▼    │  │
│  │             ┌─────────────┐                   ┌──────────┐ │  │
│  │             │  Supabase   │                   │  Gemini  │ │  │
│  │             │  Service    │                   │  Service │ │  │
│  │             └─────────────┘                   └──────────┘ │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   [Target URL]         [GCS Bucket]         [Gemini API]
   (학생 제출물)          (스크린샷/영상)        (AI 피드백)
```

### 2.2 호출 흐름
```
1. Spring Boot API 서버 (Compute Engine 또는 Cloud Run)
   └─▶ POST https://grading-worker-xxx.run.app/grade
       Request Body:
       {
         "submissionId": "UUID",
         "targetUrl": "GCS 정적 호스팅 URL",
         "playwrightScript": "Gemini가 생성한 테스트 코드"
       }

       └─▶ Cloud Run Worker가 채점 수행 (⚠️ 60초 이내 응답 필수)
           1. playwrightScript 파싱하여 개별 테스트 추출
           2. 각 테스트 실행 (테스트당 최대 25초)
           3. 실패 시 Gemini로 AI 피드백 생성
           4. GCS에 증거(스크린샷/영상) 업로드

       └─▶ 채점 결과 JSON 반환 (50초 이내 권장)
       Response Body:
       {
         "submissionId": "UUID",
         "success": true,
         "results": [
           { "taskName": "...", "isPassed": true/false, "feedback": "..." }
         ],
         "errorMessage": "..."  // 실패 시
       }

   └─▶ Spring Boot가 응답 수신 후 DB 저장 및 클라이언트에 반환
       (전체 프로세스: 90초 이내)
```

### 2.3 모듈 구성
```
src/
├── main.ts                          # 앱 부트스트랩
├── app.module.ts                    # 루트 모듈
│
├── grading/                         # 채점 도메인
│   ├── grading.module.ts
│   ├── grading.controller.ts        # HTTP 엔드포인트
│   ├── grading.service.ts           # 채점 오케스트레이션
│   ├── dto/
│   │   ├── grading-job.dto.ts       # 입력 DTO
│   │   └── grading-result.dto.ts    # 출력 DTO
│   └── interfaces/
│       └── grading.interface.ts
│
├── browser/                         # 브라우저 관리
│   ├── browser.module.ts
│   ├── browser-manager.service.ts   # Playwright 라이프사이클
│   └── browser.config.ts
│
├── script/                          # 스크립트 실행
│   ├── script.module.ts
│   ├── script-runner.service.ts     # 안전한 코드 실행
│   ├── script-sandbox.worker.ts     # Worker Thread
│   └── script.interface.ts
│
├── evidence/                        # 증거 수집
│   ├── evidence.module.ts
│   ├── evidence-collector.service.ts
│   └── storage/
│       └── gcs-storage.service.ts   # GCS 업로드
│
├── feedback/                        # AI 피드백
│   ├── feedback.module.ts
│   ├── feedback-generator.service.ts
│   └── gemini/
│       └── gemini.service.ts        # Google Gemini API
│
├── common/                          # 공통 유틸
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   ├── utils/
│   │   └── retry.util.ts
│   └── constants/
│       └── error-codes.ts
│
└── config/                          # 설정
    ├── configuration.ts
    └── validation.schema.ts
```

---

## 3. 모듈별 상세 명세

### 3.1 GradingModule

#### 3.1.1 GradingController
```typescript
@Controller()
export class GradingController {
  /**
   * Spring Boot API 서버에서 호출하는 메인 채점 엔드포인트
   */
  @Post('grade')
  @HttpCode(200)
  async runGrading(@Body() job: GradingRequestDto): Promise<GradingResponseDto> {
    // 1. playwrightScript 파싱하여 개별 테스트 추출
    // 2. GradingService 실행
    // 3. API 서버가 기대하는 형식으로 응답
  }
  
  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

#### 3.1.2 GradingService
```typescript
@Injectable()
export class GradingService {
  constructor(
    private browserManager: BrowserManagerService,
    private scriptRunner: ScriptRunnerService,
    private evidenceCollector: EvidenceCollectorService,
    private feedbackGenerator: FeedbackGeneratorService,
  ) {}

  async runGrading(job: GradingJobDto): Promise<GradingResult> {
    const startTime = Date.now();
    const results: TaskResult[] = [];
    let hasErrors = false;

    // 1. 브라우저 실행 및 페이지 로드
    const browser = await this.browserManager.launchBrowser();
    const context = await this.browserManager.createContext({
      recordVideo: job.options?.recordVideo ? { dir: '/tmp/recordings' } : undefined,
    });
    const page = await context.newPage();

    try {
      await page.goto(job.targetUrl, { waitUntil: 'domcontentloaded' });

      // 2. 각 테스트 스크립트 실행
      for (const script of job.testScripts) {
        const taskStartTime = Date.now();
        
        try {
          await this.scriptRunner.execute(script.code, { page });
          
          results.push({
            taskId: script.taskId,
            taskName: script.taskName,
            status: 'PASS',
            score: script.weight || 1,
            maxScore: script.weight || 1,
            duration: Date.now() - taskStartTime,
          });
        } catch (error) {
          hasErrors = true;
          
          // 실패 시 증거 수집
          const screenshot = await this.evidenceCollector.captureScreenshot(
            page, job.submissionId, script.taskId
          );
          
          // Gemini로 피드백 생성
          const feedback = await this.feedbackGenerator.generateFeedback({
            taskName: script.taskName,
            code: script.code,
            message: error.message,
          }, {
            screenshotUrl: screenshot,
          });

          results.push({
            taskId: script.taskId,
            taskName: script.taskName,
            status: 'FAIL',
            score: 0,
            maxScore: script.weight || 1,
            error: { message: error.message },
            feedback: feedback,
            evidence: { screenshotUrl: screenshot },
            duration: Date.now() - taskStartTime,
          });
        }
      }

      // 3. 비디오 녹화 저장
      const videoUrl = job.options?.recordVideo 
        ? await this.evidenceCollector.saveVideo(context, job.submissionId)
        : undefined;

      // 4. 결과 집계
      return {
        submissionId: job.submissionId,
        success: !hasErrors,
        status: hasErrors ? 'PARTIAL' : 'COMPLETED',
        totalScore: results.reduce((sum, r) => sum + r.score, 0),
        maxScore: results.reduce((sum, r) => sum + r.maxScore, 0),
        results: results.map(r => ({
          taskName: r.taskName,
          isPassed: r.status === 'PASS',
          feedback: r.feedback?.summary || (r.status === 'PASS' ? '테스트 통과' : '테스트 실패'),
        })),
        evidence: {
          videoUrl,
          screenshotUrls: results
            .filter(r => r.evidence?.screenshotUrl)
            .map(r => r.evidence!.screenshotUrl!),
        },
        duration: Date.now() - startTime,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      return {
        submissionId: job.submissionId,
        success: false,
        status: 'FAILED',
        totalScore: 0,
        maxScore: job.testScripts.reduce((sum, t) => sum + (t.weight || 1), 0),
        results: [],
        errorMessage: error.message,
        duration: Date.now() - startTime,
        completedAt: new Date().toISOString(),
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
```

### 3.2 BrowserModule

#### 3.2.1 BrowserManagerService
```typescript
@Injectable()
export class BrowserManagerService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;

  async onModuleInit(): Promise<void> {
    // 브라우저 사전 시작 (선택적 - Cold Start 최적화)
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowser();
  }

  async launchBrowser(): Promise<Browser>;
  async createContext(options?: BrowserContextOptions): Promise<BrowserContext>;
  async createPage(context: BrowserContext): Promise<Page>;
  async closeBrowser(): Promise<void>;
}
```

#### 3.2.2 브라우저 설정
```typescript
// browser.config.ts
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
    navigation: 20000,  // 20초 (전체 60초 제한 고려)
    action: 10000,      // 10초
    script: 30000,      // 30초
  },
  recording: {
    enabled: true,
    dir: '/tmp/recordings',
  },
};
```

### 3.3 ScriptModule

#### 3.3.1 ScriptRunnerService
```typescript
@Injectable()
export class ScriptRunnerService {
  /**
   * Worker Thread를 사용한 안전한 스크립트 실행
   * - vm2 deprecated (CVE-2026-22709) → Worker Threads 사용
   * - 리소스 제한 및 타임아웃 적용
   */
  async execute(
    code: string,
    context: ScriptContext,
    options?: ExecutionOptions,
  ): Promise<ScriptResult>;
}
```

#### 3.3.2 Worker Thread 구현
```typescript
// script-sandbox.worker.ts
import { parentPort, workerData } from 'worker_threads';
import { chromium, Page } from 'playwright';

interface WorkerInput {
  code: string;
  targetUrl: string;
  timeout: number;
}

(async () => {
  const { code, targetUrl, timeout } = workerData as WorkerInput;
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    
    // Playwright expect API를 사용한 스크립트 실행
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('page', 'expect', code);
    
    await Promise.race([
      fn(page, require('@playwright/test').expect),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Script timeout')), timeout)
      ),
    ]);

    parentPort?.postMessage({ success: true });
  } catch (error) {
    const screenshot = await page.screenshot({ type: 'png' });
    const html = await page.content();
    
    parentPort?.postMessage({
      success: false,
      error: error.message,
      screenshot: screenshot.toString('base64'),
      html,
    });
  } finally {
    await browser.close();
  }
})();
```

#### 3.3.3 실행 옵션
```typescript
interface ExecutionOptions {
  timeout: number;           // 실행 타임아웃 (ms)
  maxMemory: number;         // 최대 메모리 (MB)
  captureOnError: boolean;   // 에러 시 스크린샷 캡처
}

const DEFAULT_OPTIONS: ExecutionOptions = {
  timeout: 25000,  // API 서버 60초 타임아웃 고려
  maxMemory: 512,
  captureOnError: true,
};
```

### 3.4 EvidenceModule

#### 3.4.1 EvidenceCollectorService
```typescript
@Injectable()
export class EvidenceCollectorService {
  constructor(private gcsStorage: GcsStorageService) {}

  async captureScreenshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string>;  // GCS URL 반환

  async captureDOMSnapshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string>;  // GCS URL 반환

  async captureVideo(
    context: BrowserContext,
    submissionId: string,
  ): Promise<string>;  // GCS URL 반환

  async collectConsoleLogs(page: Page): Promise<ConsoleLog[]>;
  
  async collectNetworkLogs(page: Page): Promise<NetworkLog[]>;
}
```

#### 3.4.2 GCS Storage Service
```typescript
@Injectable()
export class GcsStorageService {
  private bucket: Bucket;

  constructor(private configService: ConfigService) {
    const storage = new Storage();
    this.bucket = storage.bucket(configService.get('GCS_BUCKET'));
  }

  async uploadBuffer(
    buffer: Buffer,
    path: string,
    contentType: string,
  ): Promise<string> {
    const file = this.bucket.file(path);
    await file.save(buffer, { contentType });
    return file.publicUrl();
  }

  async uploadFile(localPath: string, remotePath: string): Promise<string>;
  
  generateSignedUrl(path: string, expiresIn: number): Promise<string>;
}
```

### 3.5 FeedbackModule

#### 3.5.1 FeedbackGeneratorService
```typescript
@Injectable()
export class FeedbackGeneratorService {
  constructor(private geminiService: GeminiService) {}

  async generateFeedback(
    error: ScriptError,
    evidence: Evidence,
  ): Promise<Feedback> {
    const prompt = this.buildPrompt(error, evidence);
    const response = await this.geminiService.generateContent(prompt);
    return this.parseFeedback(response);
  }

  private buildPrompt(error: ScriptError, evidence: Evidence): string {
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

## 페이지 상태
- 현재 URL: ${evidence.currentUrl}
- 콘솔 에러: ${evidence.consoleLogs.filter(l => l.type === 'error').map(l => l.text).join('\n')}

## DOM 스냅샷 (관련 부분)
\`\`\`html
${this.extractRelevantDOM(evidence.domSnapshot, error.selector)}
\`\`\`

위 정보를 바탕으로 다음 JSON 형식으로 응답해주세요:
{
  "summary": "실패 원인 (1-2문장)",
  "suggestion": "해결 방법 (구체적인 코드 예시 포함)",
  "severity": "low | medium | high",
  "learningPoint": "학습 포인트 (선택적)"
}`;
  }
}
```

#### 3.5.2 Gemini Service
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(private configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      configService.get('GEMINI_API_KEY'),
    );
    this.model = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
    });
  }

  async generateContent(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<string> {
    const result = await this.model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxTokens ?? 1000,
        responseMimeType: 'application/json',
      },
    });
    
    return result.response.text();
  }

  async generateContentWithImage(
    prompt: string,
    imageBase64: string,
    mimeType: string = 'image/png',
  ): Promise<string> {
    const result = await this.model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { data: imageBase64, mimeType } },
        ],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000,
      },
    });
    
    return result.response.text();
  }
}
```

### 3.6 참고: 데이터베이스 스키마 (API 서버 기준)

> **참고**: Cloud Run Worker는 DB에 직접 접근하지 않습니다.  
> 채점 결과는 Spring Boot API 서버로 반환되며, API 서버가 DB에 저장합니다.

#### 테이블 스키마
```sql
-- Assignment 테이블 (과제 정보)
CREATE TABLE assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    sub_tasks JSONB NOT NULL DEFAULT '[]',
    ai_script TEXT,           -- Gemini가 생성한 Playwright 코드
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Submission 테이블 (제출 정보)
CREATE TYPE submission_status AS ENUM ('COMPLETED', 'FAILED');

CREATE TABLE submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    candidate_name VARCHAR(100) NOT NULL,
    file_url TEXT NOT NULL,    -- GCS 정적 호스팅 URL
    status submission_status NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_submission_assignment ON submission(assignment_id);

-- GradingResult 테이블 (채점 결과)
CREATE TABLE grading_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    is_passed BOOLEAN NOT NULL,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_grading_result_submission ON grading_result(submission_id);
```

---

## 4. API 명세

### 4.1 입력 (Request)

#### POST /grade
> **참고**: 이 엔드포인트는 Spring Boot API 서버에서 Cloud Run Worker로 호출됩니다.

```typescript
interface GradingRequestDto {
  submissionId: string;        // 제출 고유 ID (UUID)
  targetUrl: string;           // GCS 정적 호스팅 URL (index.html)
  playwrightScript: string;    // Gemini가 생성한 Playwright 테스트 코드
}
```

**요청 예시:**
```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "targetUrl": "https://storage.googleapis.com/connectable-submissions/submissions/550e8400-e29b-41d4-a716-446655440000/index.html",
  "playwrightScript": "test.describe('과제 채점', () => { test('로그인 버튼 가시성 확인', async ({ page }) => { await expect(page.locator('button:has-text(\"로그인\")')).toBeVisible(); }); test('메인 페이지 이동', async ({ page }) => { await page.click('button:has-text(\"로그인\")'); await expect(page).toHaveURL(/.*dashboard/); }); });"
}
```

#### Worker 내용 테스트 스크립트 파싱
```typescript
// playwrightScript에서 개별 테스트 케이스 추출
interface ParsedTestScript {
  taskName: string;     // test()의 첫 번째 인자 (테스트 설명)
  code: string;         // test 함수 낸부 코드
}

// 예시 파싱 로직
function parsePlaywrightScript(script: string): ParsedTestScript[] {
  // test('taskName', async ({ page }) => { ... }) 패턴 추출
  const testRegex = /test\(['"](.+?)['"],\s*async\s*\(\{[^}]+\}\)\s*=>\s*\{([^}]+)\}\)/g;
  const tests: ParsedTestScript[] = [];
  let match;
  
  while ((match = testRegex.exec(script)) !== null) {
    tests.push({
      taskName: match[1],
      code: match[2].trim(),
    });
  }
  
  return tests;
}
```

### 4.2 출력 (Response)

> **API 서버 연동용**: 이 응답은 Spring Boot API 서버가 받아 DB에 저장합니다.

```typescript
interface GradingResponseDto {
  submissionId: string;      // UUID (요청과 동일)
  success: boolean;          // 채점 프로세스 성공 여부
  results: GradingResultItem[];  // 각 테스트 케이스 결과
  errorMessage?: string;     // success=false일 때 에러 메시지
}

interface GradingResultItem {
  taskName: string;      // 테스트 케이스 이름 (playwrightScript의 test 설명)
  isPassed: boolean;     // 통과 여부
  feedback: string;      // 상세 피드백 (실패 사유 및 개선 제안)
}
```

**응답 예시 (성공):**
```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "results": [
    {
      "taskName": "로그인 버튼 가시성 확인",
      "isPassed": true,
      "feedback": "로그인 버튼이 정상적으로 표시됩니다."
    },
    {
      "taskName": "메인 페이지 이동",
      "isPassed": false,
      "feedback": "로그인 버튼 클릭 후 대시보드로 이동하지 않았습니다. router.push('/dashboard') 호출 여부를 확인하세요."
    }
  ]
}
```

**응답 예시 (실패 - Worker 낶부 오류):**
```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "success": false,
  "results": [],
  "errorMessage": "Playwright browser launch failed: Executable doesn't exist"
}
```

#### 낶부 사용용 상세 결과 (Worker 낶부 처리용)
```typescript
// Worker 낶부에서만 사용하는 상세 결과 타입
interface InternalGradingResult {
  submissionId: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  success: boolean;
  totalScore: number;
  maxScore: number;
  results: InternalTaskResult[];
  evidence: EvidenceBundle;
  duration: number;
  completedAt: string;
  errorMessage?: string;
}

interface InternalTaskResult {
  taskName: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  score: number;
  maxScore: number;
  error?: { message: string };
  feedback?: {
    summary: string;
    suggestion: string;
    severity: 'low' | 'medium' | 'high';
  };
  evidence?: {
    screenshotUrl?: string;
  };
  duration: number;
}

interface EvidenceBundle {
  videoUrl?: string;
  screenshotUrls: string[];
  consoleLogs: ConsoleLog[];
}
```

---

## 5. Cloud Run 배포 설정

### 5.1 Dockerfile
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

### 5.2 Cloud Run 설정
```yaml
# cloudbuild.yaml
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
      - '--timeout=120s'  # API 서버 90초 타임아웃 + 여유
      - '--min-instances=1'
      - '--max-instances=10'
      - '--execution-environment=gen2'
      - '--set-env-vars=NODE_ENV=production'
      - '--allow-unauthenticated'

timeout: 1800s  # 30분 (Cloud Build 전체 타임아웃)
```

### 5.3 리소스 설정 상세

| 설정 | 값 | 이유 |
|------|-----|------|
| **Memory** | 2 GiB | Chromium 렌더링 + 스크립트 실행 오버헤드 |
| **CPU** | 2 vCPU | 브라우저 렌더링 성능 확보 |
| **Concurrency** | 1 | 인스턴스당 브라우저 1개 (메모리 충돌 방지) |
| **Timeout** | 120s | API 서버 90초 타임아웃 + 여유 (Worker는 60초 이내 응답) |
| **Min Instances** | 1 | Cold Start 방지 (데모용) |
| **Max Instances** | 10 | 비용 제어 + 적정 스케일 |
| **Region** | asia-northeast3 | 한국 서울 리전 |

---

## 6. 에러 처리 전략

### 6.1 에러 분류
```typescript
enum ErrorCategory {
  // 재시도 가능
  TRANSIENT = 'TRANSIENT',      // 네트워크 타임아웃, 일시적 오류
  
  // 재시도 불가 - 과제 실패
  ASSERTION = 'ASSERTION',       // 테스트 assertion 실패
  
  // 재시도 불가 - 시스템 오류
  SCRIPT_ERROR = 'SCRIPT_ERROR', // 스크립트 문법/런타임 오류
  INTERNAL = 'INTERNAL',         // 워커 내부 오류
}
```

### 6.2 재시도 정책
```typescript
// retry.util.ts
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
      lastError = error;
      
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }
      
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

function isRetryable(error: Error): boolean {
  const retryablePatterns = [
    'net::ERR_',
    'ETIMEDOUT',
    'ECONNRESET',
    'Navigation timeout',
  ];
  return retryablePatterns.some(p => error.message.includes(p));
}
```

### 6.3 글로벌 예외 필터
```typescript
// http-exception.filter.ts
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

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: this.extractMessage(exception),
      errorCode: this.extractErrorCode(exception),
    };

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json(errorResponse);
  }
}
```

---

## 7. 테스트 전략

### 7.1 테스트 구조
```
test/
├── unit/
│   ├── browser-manager.service.spec.ts
│   ├── script-runner.service.spec.ts
│   ├── evidence-collector.service.spec.ts
│   └── feedback-generator.service.spec.ts
│
├── integration/
│   ├── grading.controller.spec.ts
│   └── grading-flow.spec.ts
│
├── e2e/
│   └── grading.e2e-spec.ts
│
└── fixtures/
    ├── sample-submission/
    │   └── index.html
    └── test-scripts/
        └── basic-tests.json
```

### 7.2 테스트 커맨드
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  }
}
```

### 7.3 E2E 테스트 예시
```typescript
// grading.e2e-spec.ts
describe('GradingController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/grading/run (POST) - should grade submission', async () => {
    const job: GradingJobDto = {
      submissionId: 'test_001',
      targetUrl: 'http://localhost:3001/fixtures/sample.html',
      testScripts: [
        {
          taskId: 'task_1',
          taskName: '버튼 존재 확인',
          code: "await expect(page.locator('button')).toBeVisible();",
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post('/grading/run')
      .send(job)
      .expect(200);

    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.results[0].status).toBe('PASS');
  });
});
```

---

## 8. 환경 변수

### 8.1 필수 환경 변수
```bash
# .env.example

# Server
PORT=8080
NODE_ENV=development

# Google Gemini AI (피드백 생성용)
GEMINI_API_KEY=AIza...

# Google Cloud Storage (증거 저장용)
GCS_BUCKET=connectable-grading-evidence
GCS_PROJECT_ID=your-project-id

# Grading Worker 설정
GRADING_TIMEOUT_MS=50000  # API 서버 60초 타임아웃에 맞춤
BROWSER_HEADLESS=true
ENABLE_VIDEO_RECORDING=false
```

> **참고**: Worker는 Supabase에 직접 접근하지 않습니다.  
> 모든 데이터는 Spring Boot API 서버로 반환됩니다.

### 8.2 설정 검증
```typescript
// validation.schema.ts
import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(8080),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  
  GEMINI_API_KEY: Joi.string().required(),
  
  GCS_BUCKET: Joi.string().required(),
  GCS_PROJECT_ID: Joi.string().required(),

  GRADING_TIMEOUT_MS: Joi.number().default(50000),  // API 서버 60초 타임아웃 고려
  BROWSER_HEADLESS: Joi.boolean().default(true),
  ENABLE_VIDEO_RECORDING: Joi.boolean().default(false),
});
```

---

## 9. 구현 단계 (Implementation Phases)

### Phase 1: 기본 구조 (1-2일)
- [ ] NestJS 프로젝트 초기화
- [ ] 모듈 구조 생성
- [ ] 환경 변수 설정
- [ ] Health check 엔드포인트

### Phase 2: 브라우저 관리 (1일)
- [ ] BrowserManagerService 구현
- [ ] Playwright 설정 최적화
- [ ] 컨텍스트 라이프사이클 관리

### Phase 3: 스크립트 실행 (2일)
- [ ] ScriptRunnerService 구현
- [ ] Worker Thread 샌드박스
- [ ] 타임아웃 및 에러 처리

### Phase 4: 증거 수집 (1일)
- [ ] EvidenceCollectorService 구현
- [ ] GCS 업로드 연동
- [ ] 스크린샷/DOM 스냅샷 캡처

### Phase 5: AI 피드백 (1일)
- [ ] FeedbackGeneratorService 구현
- [ ] Gemini API 연동 및 프롬프트 최적화
- [ ] 피드백 포맷팅 (API 서버 응답 형식에 맞춤)

### Phase 6: 통합 및 배포 (1-2일)
- [ ] GradingService 통합
- [ ] API 서버 연동 테스트 (Spring Boot 호출 테스트)
- [ ] E2E 테스트
- [ ] Dockerfile 작성
- [ ] Cloud Run 배포

### Phase 7: 해커톤 Wow Factor (선택)
- [ ] 비디오 녹화 기능
- [ ] Supabase Realtime 실시간 로그 스트리밍

---

## 10. 보안 고려사항

### 10.1 스크립트 샌드박싱
- **절대 금지**: 메인 프로세스에서 `eval()` 직접 실행
- **필수**: Worker Thread + 리소스 제한으로 격리
- **타임아웃**: 모든 스크립트에 강제 타임아웃 적용

### 10.2 네트워크 보안
- 채점 대상 URL만 접근 허용 (allowlist)
- 내부 네트워크 접근 차단

### 10.3 비밀 관리
- API 키는 환경 변수 또는 Secret Manager 사용
- 로그에 민감 정보 노출 금지

### 10.4 Cloud Run 보안
- 인증된 요청만 허용 (프로덕션)
- IAM 권한 최소화
- VPC 커넥터로 내부 리소스 접근 제한

---

## 11. 모니터링 및 로깅

### 11.1 로깅 전략
```typescript
// 구조화된 로깅
this.logger.log({
  event: 'grading_started',
  submissionId: job.submissionId,
  taskCount: job.testScripts.length,
});

this.logger.log({
  event: 'task_completed',
  submissionId: job.submissionId,
  taskId: task.taskId,
  status: result.status,
  duration: result.duration,
});
```

### 11.2 메트릭
- 채점 소요 시간 (p50, p95, p99)
- 성공/실패 비율
- AI 피드백 생성 시간
- 브라우저 메모리 사용량

---

## 12. API 서버 연동 가이드

### 12.1 엔드포인트 매핑

| API 서버 (Spring Boot) | Worker (NestJS) | 설명 |
|------------------------|-----------------|------|
| `POST /api/assignments/{id}/submissions` | `POST /grade` | 파일 제출 시 채점 요청 |

### 12.2 요청/응답 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Frontend → Spring Boot                                       │
│     POST /api/assignments/{id}/submissions                      │
│     (multipart/form-data with zip file)                         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Spring Boot 처리                                            │
│     a. Zip 파일 GCS 업로드                                       │
│     b. 정적 호스팅 URL 생성                                       │
│     c. Gemini로 Playwright 스크립트 조회 (assignment.ai_script) │
│     d. Worker 호출 준비                                          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Spring Boot → Cloud Run Worker                              │
│     POST https://worker-url.run.app/grade                       │
│     {                                                            │
│       "submissionId": "...",                                     │
│       "targetUrl": "https://storage.googleapis.com/...",        │
│       "playwrightScript": "test.describe(...)"                  │
│     }                                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Worker 채점 처리                                             │
│     a. playwrightScript 파싱 → 개별 테스트 추출                   │
│     b. Playwright로 테스트 실행                                  │
│     c. 실패 시 Gemini로 피드백 생성                              │
│     d. 결과 반환                                                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Worker → Spring Boot                                        │
│     {                                                            │
│       "submissionId": "...",                                     │
│       "success": true,                                           │
│       "results": [                                               │
│         { "taskName": "...", "isPassed": true, "feedback": "" } │
│       ]                                                          │
│     }                                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Spring Boot DB 저장 및 응답                                  │
│     a. Submission, GradingResult 테이블 저장                    │
│     b. 클라이언트에 즉시 채점 결과 반환                           │
└─────────────────────────────────────────────────────────────────┘
```

### 12.3 Worker 개발 시 주의사항

1. **API 서버 의존성 없음**: Worker는 독립적으로 동작하며, API 서버 없이도 테스트 가능해야 함
2. **단순한 입출력**: 입력은 `submissionId`, `targetUrl`, `playwrightScript`만 받음
3. **결과는 반환만**: DB 저장은 API 서버가 담당, Worker는 JSON만 반환
4. **타임아웃 준수 (중요)**:
   - **Worker 응답: 60초 이내 필수** (Spring Boot Worker 호출 타임아웃)
   - API 서버 전체 타임아웃: 90초
   - 따라서 모든 채점 프로세스는 50초 이내 완료 권장

### 12.4 로컬 테스트 방법

```bash
# 1. Worker 실행
npm run start:dev

# 2. curl로 직접 테스트
curl -X POST http://localhost:8080/grade \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "test-123",
    "targetUrl": "https://example.com/test",
    "playwrightScript": "test.describe('test', () => { test('test1', async ({ page }) => { await page.goto('https://example.com'); await expect(page).toHaveTitle(/Example/); }); });"
  }'
```

## 13. 참고 자료

- [Playwright 공식 문서](https://playwright.dev/docs/intro)
- [NestJS 공식 문서](https://docs.nestjs.com)
- [GCP Cloud Run 문서](https://cloud.google.com/run/docs)
- [Google Gemini API 문서](https://ai.google.dev/docs)
- [Supabase 문서](https://supabase.com/docs)
- [Crawlee Browser Pool](https://crawlee.dev/docs/guides/browser-management)

---

*마지막 업데이트: 2026-02-06*
