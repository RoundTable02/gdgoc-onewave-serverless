<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

NestJS 기반의 Playwright 자동화 채점 워커 서비스입니다. 프론트엔드 과제를 자동으로 채점하고 AI 피드백을 생성하는 마이크로서비스로, GCP Cloud Run에 배포되어 실행됩니다.

### 주요 기능

- 🎭 **Playwright 자동화**: Chromium 브라우저를 사용한 프론트엔드 테스트 자동화
- 🤖 **AI 피드백**: Google Gemini API를 활용한 지능형 피드백 생성
- 📸 **증거 수집**: 스크린샷 및 비디오 녹화를 GCS에 저장
- ☁️ **Cloud Native**: GCP Cloud Run에 최적화된 컨테이너 아키텍처
- 🔄 **CI/CD**: GitHub Actions를 통한 자동 배포

### 기술 스택

- **Framework**: NestJS 11.x
- **Runtime**: Node.js 20 LTS
- **Browser Automation**: Playwright 1.58.1
- **Cloud Storage**: Google Cloud Storage
- **AI**: Google Gemini API
- **Deployment**: Docker + Cloud Run
- **CI/CD**: GitHub Actions

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Environment Variables

애플리케이션 실행에 필요한 환경 변수:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | 서버 포트 |
| `NODE_ENV` | No | `development` | 실행 환경 (development/production/test) |
| `GEMINI_API_KEY` | **Yes** | - | Google Gemini API 키 |
| `GCS_BUCKET` | **Yes** | - | 증거 파일을 저장할 GCS 버킷 이름 |
| `GCS_PROJECT_ID` | **Yes** | - | GCP 프로젝트 ID |
| `GRADING_TIMEOUT_MS` | No | `300000` | 채점 타임아웃 (밀리초) |
| `BROWSER_HEADLESS` | No | `true` | Headless 모드 실행 여부 |
| `ENABLE_VIDEO_RECORDING` | No | `false` | 비디오 녹화 활성화 여부 |

`.env.example` 파일을 복사하여 로컬 환경 설정:

```bash
cp .env.example .env
# .env 파일 편집하여 실제 값 입력
```

## Architecture

```
┌─────────────────────────────────────────┐
│         GitHub Actions                  │
│  (CI/CD Pipeline)                       │
│  • Test → Build → Deploy                │
└──────────────┬──────────────────────────┘
               │
               v
┌─────────────────────────────────────────┐
│    GCP Artifact Registry                │
│  (Docker Image Repository)              │
└──────────────┬──────────────────────────┘
               │
               v
┌─────────────────────────────────────────┐
│    GCP Cloud Run                        │
│  ┌────────────────────────────────────┐ │
│  │  connectable-worker               │ │
│  │  • NestJS Application             │ │
│  │  • Playwright + Chromium          │ │
│  │  • Memory: 2GiB, CPU: 2 vCPU     │ │
│  └────────────────────────────────────┘ │
└──────────┬─────────────────┬────────────┘
           │                 │
           v                 v
  ┌────────────────┐  ┌─────────────────┐
  │  Google Cloud  │  │  Google Gemini  │
  │    Storage     │  │      API        │
  │  (Screenshots) │  │   (Feedback)    │
  └────────────────┘  └─────────────────┘
```

## API Endpoints

### Health Check
```http
GET /health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-02-06T10:30:00.000Z"
}
```

### Grade Submission
```http
POST /grade
Content-Type: application/json
```

**Request Body**:
```json
{
  "submissionId": "sub_12345",
  "targetUrl": "https://storage.googleapis.com/bucket/user/index.html",
  "testScripts": [
    {
      "taskId": "task_1",
      "taskName": "로그인 버튼 가시성 확인",
      "code": "await expect(page.locator('button:has-text(\"로그인\")')).toBeVisible();"
    }
  ]
}
```

## Deployment

이 프로젝트는 GitHub Actions를 통해 GCP Cloud Run에 자동으로 배포됩니다.

### 자동 배포

`main` 브랜치에 push하면 자동으로 배포가 시작됩니다:

```bash
git push origin main
```

### 수동 배포

1. GitHub 레포지토리의 **Actions** 탭으로 이동
2. **Deploy to Cloud Run** 워크플로우 선택
3. **Run workflow** 버튼 클릭

### 배포 가이드

전체 배포 설정 및 GCP 인프라 구성 방법은 [DEPLOYMENT.md](docs/DEPLOYMENT.md) 문서를 참조하세요.

**주요 내용**:
- GCP 인프라 설정
- Service Account 생성
- GitHub Secrets 설정
- 트러블슈팅 가이드
- 롤백 절차

## Docker

### 로컬 빌드 및 실행

```bash
# Docker 이미지 빌드
docker build -t grading-worker:local .

# 컨테이너 실행
docker run -p 8080:8080 --env-file .env grading-worker:local

# 헬스체크
curl http://localhost:8080/health
```

### Multi-Stage Build

Dockerfile은 3단계 빌드를 사용하여 최종 이미지 크기를 최적화합니다:

1. **Builder**: TypeScript 컴파일
2. **Playwright**: Chromium 설치
3. **Runtime**: 최소한의 프로덕션 이미지

## Development

### Prerequisites

- Node.js 20 LTS
- Docker (for containerization)
- Google Cloud SDK (for deployment)

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Development Mode

```bash
# Watch mode with hot reload
npm run start:dev
```

## Resources

### Project Documentation
- [Deployment Guide](docs/DEPLOYMENT.md) - 배포 설정 및 GCP 인프라 가이드
- [API Server Spec](others/API_SERVER_SPEC.md) - API 서버 명세
- [Requirements](REQUIREMENTS.md) - 프로젝트 요구사항

### External Resources
- [NestJS Documentation](https://docs.nestjs.com)
- [Playwright Documentation](https://playwright.dev/)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Google Gemini API](https://ai.google.dev/)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the UNLICENSED license.
