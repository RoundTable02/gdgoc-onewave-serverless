# Deployment Guide

이 문서는 NestJS Playwright 채점 워커를 GCP Cloud Run에 배포하는 전체 과정을 설명합니다.

## 목차

1. [사전 요구사항](#사전-요구사항)
2. [GCP 인프라 확인](#gcp-인프라-확인)
3. [Service Account 생성](#service-account-생성)
4. [GitHub Secrets 설정](#github-secrets-설정)
5. [첫 배포 실행](#첫-배포-실행)
6. [배포 검증](#배포-검증)
7. [트러블슈팅](#트러블슈팅)
8. [롤백 절차](#롤백-절차)

---

## 사전 요구사항

### 로컬 환경
- **Google Cloud SDK** 설치됨 ([설치 가이드](https://cloud.google.com/sdk/docs/install))
- **Docker** 설치됨 (로컬 테스트용)
- **Git** 설치됨
- **gcloud CLI** 인증 완료:
  ```bash
  gcloud auth login
  gcloud config set project YOUR_PROJECT_ID
  ```

### GCP 프로젝트
- Cloud Run 서비스 `connectable-worker`가 Terraform으로 생성되어 있음
- Artifact Registry가 생성되어 있음
- 필요한 API가 활성화되어 있음

---

## GCP 인프라 확인

### 1. 기존 리소스 확인

#### Cloud Run 서비스 확인
```bash
gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format="yaml"
```

**확인 사항**:
- 서비스 이름: `connectable-worker`
- 리전: `asia-northeast3`
- 현재 이미지
- 환경 변수 설정
- 메모리/CPU 설정

#### Artifact Registry 확인
```bash
gcloud artifacts repositories list \
  --location=asia-northeast3
```

**결과에서 레포지토리 이름을 메모**하세요 (예: `docker-repo`, `grading-worker` 등).

#### Cloud Run Runtime Service Account 확인
```bash
gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format="value(spec.template.spec.serviceAccountName)"
```

이 Service Account는 런타임에 GCS 및 Gemini API 접근 권한이 필요합니다.

### 2. GCS 버킷 확인 (또는 생성)

```bash
# 기존 버킷 확인
gsutil ls | grep grading

# 버킷이 없다면 생성
gsutil mb -l asia-northeast3 gs://connectable-grading-evidence
gsutil uniformbucketlevelaccess set on gs://connectable-grading-evidence
```

### 3. 필요한 API 활성화 확인

```bash
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable aiplatform.googleapis.com
```

---

## Service Account 생성

GitHub Actions에서 Cloud Run에 배포하기 위한 Service Account를 생성합니다.

### 1. Service Account 생성

```bash
gcloud iam service-accounts create github-actions-deployer \
  --display-name="GitHub Actions Deployer" \
  --description="Service Account for deploying from GitHub Actions"
```

### 2. IAM 역할 부여

```bash
PROJECT_ID=$(gcloud config get-value project)

# Cloud Run 관리 권한
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

# Service Account 사용 권한
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Artifact Registry 쓰기 권한
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

### 3. JSON 키 생성

```bash
gcloud iam service-accounts keys create ~/github-sa-key.json \
  --iam-account=github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com

echo "Service Account JSON key saved to: ~/github-sa-key.json"
```

**⚠️ 보안 주의사항**:
- 이 JSON 키는 민감한 정보입니다
- GitHub Secrets에 저장한 후 즉시 로컬 파일 삭제
- 절대 Git에 커밋하지 마세요

### 4. Runtime Service Account 권한 확인

Cloud Run 서비스가 실행 시 사용하는 Service Account에 필요한 권한 확인:

```bash
# Runtime SA 확인
RUNTIME_SA=$(gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format="value(spec.template.spec.serviceAccountName)")

echo "Runtime Service Account: $RUNTIME_SA"

# GCS 접근 권한 부여 (없다면)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin"

# Gemini API 접근 권한 부여 (없다면)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/aiplatform.user"
```

---

## GitHub Secrets 설정

GitHub 레포지토리 설정에서 Secrets를 추가합니다.

### 1. GitHub Secrets 페이지로 이동

```
https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions
```

### 2. 다음 Secrets 추가

| Secret Name | 값 가져오기 | 설명 |
|-------------|------------|------|
| `GCP_PROJECT_ID` | `gcloud config get-value project` | GCP 프로젝트 ID |
| `GCP_SA_KEY` | `cat ~/github-sa-key.json` | Service Account JSON 키 **전체 내용** |
| `GEMINI_API_KEY` | [Google AI Studio](https://makersuite.google.com/app/apikey) | Gemini API 키 |
| `GCS_BUCKET` | `connectable-grading-evidence` | GCS 버킷 이름 |
| `ARTIFACT_REGISTRY_REPO` | (위에서 확인한 값) | Artifact Registry 레포지토리 이름 |

### 3. 값 확인 명령어

```bash
# GCP_PROJECT_ID
echo "GCP_PROJECT_ID: $(gcloud config get-value project)"

# GCS_BUCKET
echo "GCS_BUCKET: connectable-grading-evidence"

# ARTIFACT_REGISTRY_REPO
gcloud artifacts repositories list \
  --location=asia-northeast3 \
  --format="value(name)" | cut -d'/' -f6

# GCP_SA_KEY (전체 JSON 내용 복사)
cat ~/github-sa-key.json
```

**GCP_SA_KEY 추가 방법**:
1. `cat ~/github-sa-key.json` 실행
2. 출력된 **전체 JSON 내용** 복사 (중괄호 포함)
3. GitHub Secrets에 붙여넣기

**GEMINI_API_KEY 발급**:
1. [Google AI Studio](https://makersuite.google.com/app/apikey) 접속
2. "Create API Key" 클릭
3. 프로젝트 선택
4. 생성된 키 복사

---

## 첫 배포 실행

### 방법 1: main 브랜치에 Push (자동 배포)

```bash
git add .
git commit -m "Add CI/CD pipeline"
git push origin main
```

GitHub Actions 탭에서 워크플로우 실행 확인:
```
https://github.com/YOUR_USERNAME/YOUR_REPO/actions
```

### 방법 2: 수동 트리거

1. GitHub 레포지토리의 **Actions** 탭으로 이동
2. 왼쪽에서 **Deploy to Cloud Run** 워크플로우 선택
3. **Run workflow** 버튼 클릭
4. 브랜치 선택 후 실행

### 배포 소요 시간

- **Test Job**: 2-4분
- **Build & Deploy Job**: 6-10분
- **총 소요 시간**: 약 8-12분

---

## 배포 검증

### 1. 로컬 Docker 테스트 (배포 전)

```bash
# .env 파일 생성
cp .env.example .env
# .env 파일 편집하여 실제 값 입력

# Docker 이미지 빌드
docker build -t grading-worker:local .

# 컨테이너 실행
docker run -p 8080:8080 --env-file .env grading-worker:local

# 다른 터미널에서 헬스체크
curl http://localhost:8080/health
# 예상 응답: {"status":"ok","timestamp":"2024-..."}
```

### 2. Cloud Run 배포 확인

```bash
# 서비스 URL 확인
SERVICE_URL=$(gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format='value(status.url)')

echo "Service URL: $SERVICE_URL"

# 헬스체크 (인증 필요)
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  ${SERVICE_URL}/health

# 예상 응답
# {"status":"ok","timestamp":"2024-02-06T10:30:00.000Z"}
```

### 3. 실제 채점 요청 테스트

```bash
# test-payload.json 파일 생성
cat > test-payload.json <<'EOF'
{
  "submissionId": "test-123",
  "targetUrl": "https://example.com",
  "testScripts": [
    {
      "taskId": "task-1",
      "taskName": "페이지 로드 확인",
      "code": "await expect(page).toHaveTitle(/Example/);"
    }
  ]
}
EOF

# 채점 요청
curl -X POST ${SERVICE_URL}/grade \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d @test-payload.json
```

### 4. Cloud Logging 확인

```bash
# 최근 로그 조회
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=connectable-worker" \
  --limit=50 \
  --format=json

# 에러 로그만 조회
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=connectable-worker AND severity>=ERROR" \
  --limit=20 \
  --format=json
```

### 5. GCS 업로드 확인

```bash
# 스크린샷 파일 확인
gsutil ls gs://connectable-grading-evidence/

# 특정 submission의 파일 확인
gsutil ls gs://connectable-grading-evidence/submission-*/
```

---

## 트러블슈팅

### 문제 1: GitHub Actions 인증 실패

**증상**:
```
Error: google-github-actions/auth failed with: the GitHub Action workflow must have permission to access the resource
```

**해결**:
1. `GCP_SA_KEY` Secret이 올바른 JSON 형식인지 확인
   ```bash
   # 로컬에서 JSON 유효성 검증
   jq . < ~/github-sa-key.json
   ```
2. JSON 전체 내용이 복사되었는지 확인 (중괄호 포함)
3. Service Account에 필요한 IAM 역할이 부여되었는지 확인

### 문제 2: Docker 빌드 실패

**증상**:
```
ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete successfully
```

**해결**:
1. `package-lock.json`이 레포지토리에 커밋되어 있는지 확인
2. Node.js 버전 확인 (Node 20 필요)
3. 로컬에서 Docker 빌드 테스트

### 문제 3: Playwright 브라우저 실행 실패

**증상**:
```
browserType.launch: Executable doesn't exist
```

**해결**:
- Dockerfile의 Stage 2에서 Playwright 이미지 버전 확인
- `mcr.microsoft.com/playwright:v1.58.1-noble` 사용 확인

### 문제 4: Cloud Run 메모리 부족 (OOMKilled)

**증상**:
- 컨테이너가 종료 코드 137로 종료
- 로그에 "out of memory" 메시지

**해결**:
```bash
# Terraform에서 메모리를 4GiB로 증가 또는
gcloud run services update connectable-worker \
  --memory=4Gi \
  --region=asia-northeast3
```

### 문제 5: GCS 업로드 권한 오류

**증상**:
```
Error: Permission denied when uploading to GCS
```

**해결**:
```bash
# Runtime Service Account 확인
RUNTIME_SA=$(gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format="value(spec.template.spec.serviceAccountName)")

# GCS 권한 부여
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/storage.objectAdmin"
```

### 문제 6: Gemini API 오류

**증상**:
```
Error: 403 Forbidden - API key not valid
```

**해결**:
1. `GEMINI_API_KEY` Secret 값 확인
2. [Google AI Studio](https://makersuite.google.com/app/apikey)에서 키 유효성 확인
3. API 키에 프로젝트 연결 확인

---

## 롤백 절차

### 즉시 롤백 (이전 리비전으로)

```bash
# 1. 리비전 목록 확인
gcloud run revisions list \
  --service=connectable-worker \
  --region=asia-northeast3

# 2. 이전 리비전 선택 (예: connectable-worker-00042-xyz)
gcloud run services update-traffic connectable-worker \
  --to-revisions=connectable-worker-00042-xyz=100 \
  --region=asia-northeast3

# 3. 확인
gcloud run services describe connectable-worker \
  --region=asia-northeast3 \
  --format="value(status.traffic)"
```

**⚠️ 주의**: Terraform으로 관리되는 서비스이므로, 수동 변경 사항은 다음 Terraform apply 시 덮어씌워질 수 있습니다.

### GitHub에서 Revert

```bash
# 1. 문제가 있는 커밋 되돌리기
git log --oneline -10  # 최근 10개 커밋 확인
git revert COMMIT_SHA  # 문제 커밋 SHA

# 2. Push (자동으로 새 배포 트리거)
git push origin main
```

### 리비전 삭제 (오래된 리비전 정리)

```bash
# 특정 리비전 삭제
gcloud run revisions delete connectable-worker-00035-old \
  --region=asia-northeast3 \
  --quiet
```

---

## 추가 리소스

- [Cloud Run 문서](https://cloud.google.com/run/docs)
- [Playwright 문서](https://playwright.dev/)
- [NestJS 문서](https://docs.nestjs.com/)
- [GitHub Actions 문서](https://docs.github.com/actions)

---

## 비용 최적화 팁

1. **Min instances = 0**: 트래픽이 없을 때 비용 절감
2. **Concurrency = 1**: 메모리 충돌 방지
3. **GCS 라이프사이클 정책**: 오래된 스크린샷 자동 삭제
   ```bash
   gsutil lifecycle set lifecycle.json gs://connectable-grading-evidence
   ```
4. **로그 보관 기간 설정**: Cloud Logging 비용 절감
5. **예산 알림 설정**:
   ```bash
   gcloud billing budgets create \
     --display-name="Cloud Run Budget" \
     --budget-amount=100USD
   ```

---

## 지원 및 문의

문제가 발생하면 다음을 확인하세요:
1. Cloud Logging 로그
2. GitHub Actions 워크플로우 로그
3. Cloud Run 리비전 상태

추가 도움이 필요하면 팀에 문의하세요.
