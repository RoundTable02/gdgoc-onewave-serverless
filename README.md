<h1 align="center">
  <br>
  Connectable Grading Worker
  <br>
</h1>

<h4 align="center">Playwright 기반 프론트엔드 과제 자동 채점 마이크로서비스</h4>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11.x-E0234E?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/Playwright-1.58-2EAD33?style=flat-square&logo=playwright" alt="Playwright" />
  <img src="https://img.shields.io/badge/Node.js-20%20LTS-339933?style=flat-square&logo=nodedotjs" alt="Node.js" />
  <img src="https://img.shields.io/badge/GCP-Cloud%20Run-4285F4?style=flat-square&logo=googlecloud" alt="Cloud Run" />
  <img src="https://img.shields.io/badge/AI-Gemini%20API-8E75B2?style=flat-square&logo=google" alt="Gemini" />
</p>

<p align="center">
  <a href="#-highlights">Highlights</a> •
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-api">API</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## Overview

**Connectable Grading Worker**는 프론트엔드 과제를 자동으로 채점하고 AI 피드백을 생성하는 서버리스 마이크로서비스입니다. Spring Boot API 서버로부터 채점 요청을 받아 Playwright로 테스트를 실행하고, 실패 시 Google Gemini API를 통해 학습자에게 도움이 되는 피드백을 생성합니다.

```
Request  →  Playwright Test  →  AI Analysis  →  Result
```

---

## Highlights

### Parallel Test Execution

동시성이 제어된 병렬 테스트 실행으로 채점 시간을 획기적으로 단축합니다.

```typescript
// 최대 5개 테스트를 동시에 실행하며 순서 보존
private async executeTestsParallel(testScripts, context, targetUrl) {
  const maxConcurrent = 5;
  const executing: Set<Promise<void>> = new Set();

  for (const script of testScripts) {
    const promise = this.executeOneTest(script, context, targetUrl);
    executing.add(promise);

    // 동시성 제한: maxConcurrent 도달 시 하나 완료될 때까지 대기
    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
```

| 실행 방식                    | 10개 테스트 (각 2초) | 개선율      |
| ---------------------------- | -------------------- | ----------- |
| 순차 실행                    | ~20초                | -           |
| **병렬 실행 (5 concurrent)** | **~4초**             | **5x 빠름** |

### AI-Powered Feedback

Google Gemini API를 활용하여 테스트 실패 시 학습자 친화적인 피드백을 자동 생성합니다.

```json
{
  "summary": "로그인 버튼을 찾을 수 없습니다",
  "suggestion": "button 요소에 '로그인' 텍스트가 포함되어 있는지 확인하세요. 예: <button>로그인</button>",
  "severity": "medium"
}
```

### Multi-Stage Docker Build

3단계 빌드로 최적화된 프로덕션 이미지를 생성합니다.

```dockerfile
# Stage 1: Build - TypeScript 컴파일
FROM node:20-slim AS builder

# Stage 2: Playwright - Chromium 설치
FROM mcr.microsoft.com/playwright:v1.58.1-noble AS playwright

# Stage 3: Runtime - 최소한의 프로덕션 이미지
FROM node:20-slim
```

| 단계       | 목적                    | 결과                   |
| ---------- | ----------------------- | ---------------------- |
| Builder    | TypeScript → JavaScript | 빌드 의존성 분리       |
| Playwright | Chromium 브라우저 설치  | 브라우저 바이너리 추출 |
| Runtime    | 프로덕션 실행           | 최소 이미지 크기       |

---

## Features

| Feature               | Description                                |
| --------------------- | ------------------------------------------ |
| **Playwright 자동화** | Chromium 브라우저를 사용한 실제 DOM 테스트 |
| **병렬 테스트 실행**  | 동시성 제어 기반 병렬 처리로 빠른 채점     |
| **AI 피드백 생성**    | Gemini API로 실패 원인 분석 및 개선 제안   |
| **증거 수집**         | 스크린샷, DOM 스냅샷을 GCS에 저장          |
| **클라우드 네이티브** | GCP Cloud Run에 최적화된 컨테이너          |
| **자동 배포**         | GitHub Actions CI/CD 파이프라인            |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GCP Infrastructure                             │
│                                                                          │
│  ┌─────────────────────┐      HTTP POST /grade      ┌─────────────────┐  │
│  │   Spring Boot API   │ ───────────────────────▶  │   Cloud Run     │  │
│  │   (Main Server)     │                           │  Grading Worker │  │
│  │                     │ ◀───────────────────────  │                 │  │
│  │  • 과제 관리         │      JSON Response        │  • Playwright   │  │
│  │  • 스크립트 생성     │                           │  • AI Feedback  │  │
│  └─────────────────────┘                           └────────┬────────┘  │
│                                                              │           │
│                              ┌───────────────────────────────┼───────┐   │
│                              │                               │       │   │
│                              ▼                               ▼       │   │
│                   ┌─────────────────────┐     ┌─────────────────────┐│   │
│                   │  Google Cloud       │     │   Google Gemini     ││   │
│                   │  Storage (GCS)      │     │   API               ││   │
│                   │                     │     │                     ││   │
│                   │  • 스크린샷         │     │  • 피드백 생성       ││   │
│                   │  • DOM 스냅샷       │     │  • 원인 분석         ││   │
│                   │  • 비디오 녹화      │     │                     ││   │
│                   └─────────────────────┘     └─────────────────────┘│   │
│                                                                      │   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Internal Modules

```
src/
├── grading/              # 채점 도메인 (오케스트레이션)
│   ├── grading.controller.ts
│   └── grading.service.ts      ← 병렬 실행 로직
│
├── browser/              # Playwright 브라우저 관리
│   └── browser-manager.service.ts
│
├── script/               # 스크립트 파싱 및 실행
│   ├── script-parser.service.ts
│   └── script-runner.service.ts
│
├── evidence/             # 증거 수집 (스크린샷, DOM)
│   ├── evidence-collector.service.ts
│   └── storage/gcs-storage.service.ts
│
├── feedback/             # AI 피드백 생성
│   ├── feedback-generator.service.ts
│   └── gemini/gemini.service.ts
│
└── common/               # 공통 유틸리티
    ├── filters/http-exception.filter.ts
    ├── interceptors/logging.interceptor.ts
    └── utils/retry.util.ts
```

---

## Quick Start

### Prerequisites

- Node.js 20 LTS
- Docker (선택)
- Google Cloud SDK (배포 시)

### Installation

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집하여 API 키 입력
```

### Development

```bash
# 개발 모드 (Hot Reload)
npm run start:dev

# 빌드
npm run build

# 프로덕션 모드
npm run start:prod
```

### Testing

```bash
# 단위 테스트
npm run test

# E2E 테스트
npm run test:e2e

# 테스트 커버리지
npm run test:cov
```

### Docker

```bash
# 이미지 빌드
docker build -t grading-worker:local .

# 컨테이너 실행
docker run -p 8080:8080 --env-file .env grading-worker:local

# 헬스체크
curl http://localhost:8080/health
```

---

## API

### Health Check

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-07T10:30:00.000Z"
}
```

### Grade Submission

```http
POST /grade
Content-Type: application/json
```

**Request Body:**

```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "targetUrl": "https://storage.googleapis.com/bucket/user/index.html",
  "playwrightScript": "test.describe('과제 채점', () => { test('로그인 버튼 확인', async ({ page }) => { await expect(page.locator('button:has-text(\"로그인\")')).toBeVisible(); }); });"
}
```

**Response (Success):**

```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "results": [
    {
      "taskName": "로그인 버튼 확인",
      "isPassed": true
    }
  ]
}
```

**Response (Partial Failure):**

```json
{
  "submissionId": "550e8400-e29b-41d4-a716-446655440000",
  "success": false,
  "results": [
    {
      "taskName": "로그인 버튼 확인",
      "isPassed": true
    },
    {
      "taskName": "메인 페이지 이동",
      "isPassed": false
    }
  ]
}
```

---

## Configuration

### Environment Variables

| Variable                 | Required | Default       | Description             |
| ------------------------ | -------- | ------------- | ----------------------- |
| `PORT`                   | No       | `8080`        | 서버 포트               |
| `NODE_ENV`               | No       | `development` | 실행 환경               |
| `GEMINI_API_KEY`         | **Yes**  | -             | Google Gemini API 키    |
| `GCS_BUCKET`             | **Yes**  | -             | 증거 저장용 GCS 버킷    |
| `GCS_PROJECT_ID`         | **Yes**  | -             | GCP 프로젝트 ID         |
| `GRADING_TIMEOUT_MS`     | No       | `300000`      | 전체 채점 타임아웃 (ms) |
| `BROWSER_HEADLESS`       | No       | `true`        | Headless 모드           |
| `ENABLE_VIDEO_RECORDING` | No       | `false`       | 비디오 녹화 활성화      |

### Performance Tuning

```typescript
// 병렬 실행 설정 (configuration.ts)
grading: {
  enableParallelExecution: true,  // 병렬 실행 활성화
  maxConcurrentTests: 5,          // 동시 실행 테스트 수
  testTimeoutMs: 30000,           // 개별 테스트 타임아웃
  timeoutMs: 300000,              // 전체 채점 타임아웃
}
```

---

## Deployment

### GitHub Actions CI/CD

`main` 브랜치에 push하면 자동으로 배포됩니다.

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
```

**파이프라인:**

```
Test → Lint → Build → Docker Build → Push to Artifact Registry → Deploy to Cloud Run
```

### Manual Deployment

1. GitHub 레포지토리 → **Actions** 탭
2. **Deploy to Cloud Run** 워크플로우 선택
3. **Run workflow** 클릭

### Cloud Run Configuration

| Setting       | Value           | Reason                   |
| ------------- | --------------- | ------------------------ |
| Memory        | 2 GiB           | Chromium 렌더링 요구사항 |
| CPU           | 2 vCPU          | 브라우저 성능 확보       |
| Concurrency   | 1               | 메모리 충돌 방지         |
| Timeout       | 300s            | 복잡한 테스트 대응       |
| Min Instances | 1               | Cold Start 방지          |
| Region        | asia-northeast3 | 한국 서울                |

자세한 배포 가이드는 [DEPLOYMENT.md](docs/DEPLOYMENT.md)를 참조하세요.

---

## Project Structure

```
connectable-serverless/
├── src/
│   ├── main.ts                 # 앱 부트스트랩
│   ├── app.module.ts           # 루트 모듈
│   ├── grading/                # 채점 도메인
│   ├── browser/                # 브라우저 관리
│   ├── script/                 # 스크립트 실행
│   ├── evidence/               # 증거 수집
│   ├── feedback/               # AI 피드백
│   ├── common/                 # 공통 유틸
│   └── config/                 # 설정
├── test/                       # 테스트
├── docs/                       # 문서
│   └── DEPLOYMENT.md
├── Dockerfile                  # Multi-stage 빌드
├── .github/workflows/          # CI/CD
│   └── deploy.yml
└── package.json
```

---

## Tech Stack

| Category               | Technology           |
| ---------------------- | -------------------- |
| **Framework**          | NestJS 11.x          |
| **Runtime**            | Node.js 20 LTS       |
| **Browser Automation** | Playwright 1.58.1    |
| **AI/ML**              | Google Gemini API    |
| **Cloud Storage**      | Google Cloud Storage |
| **Container**          | Docker (Multi-stage) |
| **Deployment**         | GCP Cloud Run        |
| **CI/CD**              | GitHub Actions       |
| **Language**           | TypeScript 5.x       |

---

## Documentation

| Document                                         | Description                    |
| ------------------------------------------------ | ------------------------------ |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)              | 배포 가이드 및 GCP 인프라 설정 |
| [DEVELOPMENT_SPEC.md](DEVELOPMENT_SPEC.md)       | 상세 개발 명세서               |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 구현 계획서                    |

---

## License

This project is developed for **GDG on Campus OneWave Hackathon**.

---

## Team

**GDG on Campus OneWave**

Built with Spring Boot, Gemini AI, and Playwright.
