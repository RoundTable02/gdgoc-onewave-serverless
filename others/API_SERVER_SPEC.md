# Connectable 개발 명세서

> REQUIREMENTS.md 기반 Spring Boot 서버 구현을 위한 상세 기술 명세

---

## 1. 프로젝트 개요

### 1.1 시스템 목적
- **구인자**: 프론트엔드 구현 과제를 생성하고, AI가 생성한 Playwright 스크립트로 자동 채점
- **구직자**: 과제 확인 후 빌드 파일(Zip) 제출, **즉시** 채점 결과 확인

### 1.3 핵심 설계 결정
- **동기식 채점**: 제출 API 호출 시 Cloud Run 워커 채점 완료까지 대기 후 결과 즉시 반환
- **단순한 상태 관리**: 비동기 상태 추적 불필요 (COMPLETED/FAILED만 사용)
- **Realtime 미사용**: Supabase는 순수 PostgreSQL DB로만 활용
- **Worker 분리**: Cloud Run Worker는 별도 레포지토리의 NestJS 서버

### 1.2 시스템 아키텍처
```
┌─────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  Frontend   │────▶│  Spring Boot API  │────▶│  Cloud Run      │
│  (React)    │     │  (Main Server)    │◀────│  Worker         │
└─────────────┘     └───────────────────┘     │  (NestJS)       │
      ▲                    │                   └─────────────────┘
      │                    │                         │
      │  채점 결과 즉시 반환   │                         │ 동기 호출
      └────────────────────┘                         │ (응답 대기)
                           │                         ▼
              ┌────────────┴────────────┐     ┌───────────────┐
              ▼                         ▼     │  Playwright   │
      ┌───────────────┐         ┌───────────────┐  Test 실행  │
      │   Supabase    │         │     GCS       │◀────────────┘
      │  (PostgreSQL) │         │  (정적 호스팅)  │
      └───────────────┘         └───────────────┘
              │
              ▼
      ┌───────────────┐
      │  Gemini API   │
      │  (스크립트 생성) │
      └───────────────┘

※ Cloud Run Worker는 별도 레포지토리 (NestJS 서버)
```

### 1.3 제출 → 채점 Flow (동기식)
```
1. 구직자가 Zip 파일 제출
2. Spring Boot가 GCS에 파일 업로드 (정적 호스팅 URL 생성)
3. Cloud Run 워커에 채점 요청 (동기 호출 - 응답 대기)
4. 워커가 Playwright로 테스트 실행
5. 채점 결과를 워커가 직접 반환
6. Spring Boot가 결과를 DB 저장 + 클라이언트에 즉시 응답
```

---

## 2. 기술 스택 상세

### 2.1 현재 상태 (build.gradle)
```groovy
// 현재 설정
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.2'
    id 'io.spring.dependency-management' version '1.1.7'
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    compileOnly 'org.projectlombok:lombok'
    runtimeOnly 'com.mysql:mysql-connector-j'  // ⚠️ PostgreSQL로 변경 필요
    annotationProcessor 'org.projectlombok:lombok'
}
```

### 2.2 필요 의존성 추가
```groovy
dependencies {
    // 기존 유지
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    compileOnly 'org.projectlombok:lombok'
    annotationProcessor 'org.projectlombok:lombok'
    
    // ✅ 변경: PostgreSQL 드라이버 (Supabase)
    runtimeOnly 'org.postgresql:postgresql'
    
    // ✅ 추가: WebClient (Cloud Run, Gemini API 호출용)
    implementation 'org.springframework.boot:spring-boot-starter-webflux'
    
    // ✅ 추가: GCS 연동
    implementation 'com.google.cloud:google-cloud-storage:2.36.1'
    
    // ✅ 추가: Validation
    implementation 'org.springframework.boot:spring-boot-starter-validation'
    
    // ✅ 추가: JSON 처리 (Hibernate Types)
    implementation 'io.hypersistence:hypersistence-utils-hibernate-63:3.7.3'
    
    // 테스트
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testRuntimeOnly 'org.junit.platform:junit-platform-launcher'
}
```

---

## 3. 데이터베이스 스키마 상세

### 3.1 ERD
```
┌─────────────────────┐
│     Assignment      │
├─────────────────────┤
│ id (PK, UUID)       │
│ title (VARCHAR)     │
│ content (TEXT)      │
│ sub_tasks (JSONB)   │
│ ai_script (TEXT)    │
│ created_at          │
│ updated_at          │
└─────────────────────┘
          │
          │ 1:N
          ▼
┌─────────────────────┐
│     Submission      │
├─────────────────────┤
│ id (PK, UUID)       │
│ assignment_id (FK)  │
│ candidate_name      │
│ file_url (TEXT)     │
│ status (ENUM)       │
│ created_at          │
│ updated_at          │
└─────────────────────┘
          │
          │ 1:N
          ▼
┌─────────────────────┐
│   GradingResult     │
├─────────────────────┤
│ id (PK, UUID)       │
│ submission_id (FK)  │
│ task_name (VARCHAR) │
│ is_passed (BOOLEAN) │
│ feedback (TEXT)     │
│ created_at          │
└─────────────────────┘
```

### 3.2 DDL (PostgreSQL/Supabase)
```sql
-- Assignment 테이블
CREATE TABLE assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    sub_tasks JSONB NOT NULL DEFAULT '[]',
    ai_script TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Submission 테이블
CREATE TYPE submission_status AS ENUM ('COMPLETED', 'FAILED');

CREATE TABLE submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    candidate_name VARCHAR(100) NOT NULL,
    file_url TEXT NOT NULL,
    status submission_status NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_submission_assignment ON submission(assignment_id);

-- GradingResult 테이블
CREATE TABLE grading_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES submission(id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    is_passed BOOLEAN NOT NULL,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_grading_result_submission ON grading_result(submission_id);

-- Updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_assignment_updated_at BEFORE UPDATE
    ON assignment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## 4. 패키지 구조

```
src/main/java/gdgoc/onewave/connectable/
├── ConnectableApplication.java
├── config/
│   ├── WebClientConfig.java          # WebClient 빈 설정
│   ├── GcsConfig.java                # GCS Storage 빈 설정
│   └── CorsConfig.java               # CORS 설정
├── domain/
│   ├── assignment/
│   │   ├── controller/
│   │   │   └── AssignmentController.java
│   │   ├── service/
│   │   │   └── AssignmentService.java
│   │   ├── repository/
│   │   │   └── AssignmentRepository.java
│   │   ├── entity/
│   │   │   └── Assignment.java
│   │   └── dto/
│   │       ├── AssignmentCreateRequest.java
│   │       ├── AssignmentResponse.java
│   │       └── AssignmentResultResponse.java
│   ├── submission/
│   │   ├── controller/
│   │   │   └── SubmissionController.java
│   │   ├── service/
│   │   │   └── SubmissionService.java
│   │   ├── repository/
│   │   │   └── SubmissionRepository.java
│   │   ├── entity/
│   │   │   ├── Submission.java
│   │   │   └── SubmissionStatus.java
│   │   └── dto/
│   │       └── SubmissionResponse.java
│   └── grading/
│       ├── entity/
│       │   └── GradingResult.java
│       ├── repository/
│       │   └── GradingResultRepository.java
│       └── dto/
│           └── GradingResultResponse.java
├── infrastructure/
│   ├── storage/
│   │   └── GcsStorageService.java    # GCS 파일 업로드/호스팅
│   ├── ai/
│   │   └── GeminiService.java        # Gemini API 호출
│   └── worker/
│       └── GradingWorkerClient.java  # Cloud Run 워커 호출
└── global/
    ├── exception/
    │   ├── GlobalExceptionHandler.java
    │   ├── BusinessException.java
    │   └── ErrorCode.java
    └── response/
        └── ApiResponse.java
```

---

## 5. Entity 상세 설계

### 5.1 Assignment.java
```java
package gdgoc.onewave.connectable.domain.assignment.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "assignment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class Assignment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Type(JsonType.class)
    @Column(name = "sub_tasks", columnDefinition = "jsonb")
    private List<String> subTasks;

    @Column(name = "ai_script", columnDefinition = "TEXT")
    private String aiScript;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public void updateAiScript(String aiScript) {
        this.aiScript = aiScript;
    }
}
```

### 5.2 Submission.java
```java
package gdgoc.onewave.connectable.domain.submission.entity;

import gdgoc.onewave.connectable.domain.assignment.entity.Assignment;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "submission")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignment_id", nullable = false)
    private Assignment assignment;

    @Column(name = "candidate_name", nullable = false, length = 100)
    private String candidateName;

    @Column(name = "file_url", nullable = false, columnDefinition = "TEXT")
    private String fileUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SubmissionStatus status;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
```

### 5.3 SubmissionStatus.java
```java
package gdgoc.onewave.connectable.domain.submission.entity;

public enum SubmissionStatus {
    COMPLETED,  // 채점 완료
    FAILED      // 채점 실패
}
```

### 5.4 GradingResult.java
```java
package gdgoc.onewave.connectable.domain.grading.entity;

import gdgoc.onewave.connectable.domain.submission.entity.Submission;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "grading_result")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class GradingResult {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "submission_id", nullable = false)
    private Submission submission;

    @Column(name = "task_name", nullable = false)
    private String taskName;

    @Column(name = "is_passed", nullable = false)
    private Boolean isPassed;

    @Column(columnDefinition = "TEXT")
    private String feedback;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
```

---

## 6. API 엔드포인트 상세

### 6.1 Assignment API

#### 6.1.1 과제 생성 (POST /api/assignments)
```yaml
Request:
  Method: POST
  Path: /api/assignments
  Content-Type: application/json
  Body:
    title: string (required, max 255)
    content: string (required)
    subTasks: string[] (required, min 1 item)

Response:
  201 Created:
    id: UUID
    title: string
    content: string
    subTasks: string[]
    aiScript: string  # Gemini가 생성한 Playwright 스크립트
    createdAt: datetime

  400 Bad Request:
    code: "INVALID_REQUEST"
    message: "Validation failed"
    
  500 Internal Server Error:
    code: "AI_GENERATION_FAILED"
    message: "Failed to generate grading script"
```

**비즈니스 로직:**
1. 요청 유효성 검증
2. Gemini API 호출하여 Playwright 스크립트 생성
3. Assignment 저장 (sub_tasks + ai_script 포함)
4. 응답 반환

#### 6.1.2 과제 목록 조회 (GET /api/assignments)
```yaml
Request:
  Method: GET
  Path: /api/assignments
  Query Parameters:
    page: integer (default: 0)
    size: integer (default: 20)

Response:
  200 OK:
    content:
      - id: UUID
        title: string
        content: string (truncated to 200 chars)
        subTaskCount: integer
        createdAt: datetime
    page: integer
    size: integer
    totalElements: integer
    totalPages: integer
```

#### 6.1.3 과제 상세 조회 (GET /api/assignments/{id})
```yaml
Request:
  Method: GET
  Path: /api/assignments/{id}

Response:
  200 OK:
    id: UUID
    title: string
    content: string
    subTasks: string[]
    createdAt: datetime
    # aiScript는 구직자에게 노출하지 않음

  404 Not Found:
    code: "ASSIGNMENT_NOT_FOUND"
    message: "Assignment not found"
```

#### 6.1.4 채점 결과 조회 (GET /api/assignments/{id}/results)
```yaml
Request:
  Method: GET
  Path: /api/assignments/{id}/results

Response:
  200 OK:
    assignmentId: UUID
    assignmentTitle: string
    submissions:
      - id: UUID
        candidateName: string
        fileUrl: string  # 배포된 정적 호스팅 URL
        status: PENDING | GRADING | COMPLETED | FAILED
        createdAt: datetime
        gradingResults:
          - taskName: string
            isPassed: boolean
            feedback: string
        passedCount: integer
        totalCount: integer
```

---

### 6.2 Submission API

#### 6.2.1 파일 제출 및 채점 (POST /api/assignments/{id}/submissions)
```yaml
Request:
  Method: POST
  Path: /api/assignments/{id}/submissions
  Content-Type: multipart/form-data
  Body:
    file: MultipartFile (required, .zip only, max 50MB)
    candidateName: string (required, max 100)

Response:
  200 OK:  # 동기식 - 채점 완료 후 즉시 반환
    id: UUID
    candidateName: string
    fileUrl: string
    status: "COMPLETED" | "FAILED"
    gradingResults:
      - taskName: string
        isPassed: boolean
        feedback: string
    summary:
      passedCount: integer
      totalCount: integer
      passRate: string  # e.g., "80%"

  400 Bad Request:
    code: "INVALID_FILE"
    message: "Only .zip files are allowed"

  404 Not Found:
    code: "ASSIGNMENT_NOT_FOUND"
    message: "Assignment not found"
    
  500 Internal Server Error:
    code: "GRADING_FAILED"
    message: "Grading process failed"
```

**비즈니스 로직 (동기식):**
1. 파일 유효성 검증 (.zip 확장자, 크기 제한)
2. Zip 압축 해제
3. GCS에 폴더 구조 그대로 업로드
4. 정적 호스팅 URL 생성 (index.html 기준)
5. **Cloud Run 워커에 채점 요청 (동기 - 응답 대기)**
6. 워커로부터 채점 결과 수신
7. Submission + GradingResult DB 저장
8. **채점 결과 포함하여 200 OK 응답**

**타임아웃 고려사항:**
- Cloud Run 워커 호출 타임아웃: 60초
- 전체 API 응답 타임아웃: 90초 (여유 확보)

---

## 7. Infrastructure 서비스 상세

### 7.1 GcsStorageService.java
```java
package gdgoc.onewave.connectable.infrastructure.storage;

import com.google.cloud.storage.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Slf4j
@Service
@RequiredArgsConstructor
public class GcsStorageService {

    private final Storage storage;

    @Value("${gcs.bucket-name}")
    private String bucketName;

    @Value("${gcs.base-url}")
    private String baseUrl;

    /**
     * Zip 파일을 압축 해제하여 GCS에 업로드하고 정적 호스팅 URL 반환
     * 
     * @param file 업로드된 Zip 파일
     * @param submissionId 제출 ID (경로 구성용)
     * @return 정적 호스팅 URL (index.html 경로)
     */
    public String uploadAndExtractZip(MultipartFile file, UUID submissionId) {
        String basePath = "submissions/" + submissionId + "/";
        Path tempDir = null;
        
        try {
            // 1. 임시 디렉토리에 압축 해제
            tempDir = Files.createTempDirectory("submission-");
            extractZip(file.getInputStream(), tempDir);
            
            // 2. 모든 파일을 GCS에 업로드
            Files.walk(tempDir)
                .filter(Files::isRegularFile)
                .forEach(path -> {
                    String relativePath = tempDir.relativize(path).toString();
                    String gcsPath = basePath + relativePath;
                    uploadFile(path, gcsPath);
                });
            
            // 3. 정적 호스팅 URL 반환
            return baseUrl + "/" + bucketName + "/" + basePath + "index.html";
            
        } catch (IOException e) {
            log.error("Failed to process zip file", e);
            throw new RuntimeException("Failed to process zip file", e);
        } finally {
            // 4. 임시 파일 정리
            if (tempDir != null) {
                deleteDirectory(tempDir);
            }
        }
    }

    private void extractZip(InputStream zipInputStream, Path targetDir) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(zipInputStream)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                Path targetPath = targetDir.resolve(entry.getName()).normalize();
                
                // Zip Slip 방지
                if (!targetPath.startsWith(targetDir)) {
                    throw new IOException("Invalid zip entry: " + entry.getName());
                }
                
                if (entry.isDirectory()) {
                    Files.createDirectories(targetPath);
                } else {
                    Files.createDirectories(targetPath.getParent());
                    Files.copy(zis, targetPath, StandardCopyOption.REPLACE_EXISTING);
                }
                zis.closeEntry();
            }
        }
    }

    private void uploadFile(Path localPath, String gcsPath) {
        try {
            String contentType = Files.probeContentType(localPath);
            if (contentType == null) {
                contentType = "application/octet-stream";
            }
            
            BlobInfo blobInfo = BlobInfo.newBuilder(bucketName, gcsPath)
                .setContentType(contentType)
                .build();
            
            storage.create(blobInfo, Files.readAllBytes(localPath));
            
            // Public Read 권한 부여
            storage.createAcl(
                BlobId.of(bucketName, gcsPath),
                Acl.of(Acl.User.ofAllUsers(), Acl.Role.READER)
            );
            
        } catch (IOException e) {
            log.error("Failed to upload file: {}", gcsPath, e);
            throw new RuntimeException("Failed to upload file", e);
        }
    }

    private void deleteDirectory(Path directory) {
        try {
            Files.walk(directory)
                .sorted((a, b) -> b.compareTo(a))
                .forEach(path -> {
                    try {
                        Files.delete(path);
                    } catch (IOException e) {
                        log.warn("Failed to delete temp file: {}", path, e);
                    }
                });
        } catch (IOException e) {
            log.warn("Failed to clean up temp directory", e);
        }
    }
}
```

### 7.2 GeminiService.java
```java
package gdgoc.onewave.connectable.infrastructure.ai;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class GeminiService {

    private final WebClient webClient;

    @Value("${gemini.api-key}")
    private String apiKey;

    @Value("${gemini.model}")
    private String model;

    /**
     * SubTasks를 기반으로 Playwright 채점 스크립트 생성
     */
    public String generatePlaywrightScript(List<String> subTasks, String assignmentContent) {
        String prompt = buildPrompt(subTasks, assignmentContent);
        
        Map<String, Object> requestBody = Map.of(
            "contents", List.of(
                Map.of("parts", List.of(
                    Map.of("text", prompt)
                ))
            ),
            "generationConfig", Map.of(
                "temperature", 0.2,
                "maxOutputTokens", 8192
            )
        );

        try {
            Map<String, Object> response = webClient.post()
                .uri("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                    model, apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Map.class)
                .block();

            return extractGeneratedScript(response);
            
        } catch (Exception e) {
            log.error("Failed to generate Playwright script", e);
            throw new RuntimeException("AI script generation failed", e);
        }
    }

    private String buildPrompt(List<String> subTasks, String assignmentContent) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are an expert Playwright test script generator.\n\n");
        sb.append("Assignment Description:\n").append(assignmentContent).append("\n\n");
        sb.append("Generate a Playwright test script that verifies the following requirements:\n\n");
        
        for (int i = 0; i < subTasks.size(); i++) {
            sb.append(i + 1).append(". ").append(subTasks.get(i)).append("\n");
        }
        
        sb.append("\nRequirements:\n");
        sb.append("- Use TypeScript with Playwright\n");
        sb.append("- Each subtask should be a separate test case\n");
        sb.append("- Include proper assertions\n");
        sb.append("- Handle dynamic content appropriately\n");
        sb.append("- Output ONLY the code, no explanations\n");
        sb.append("- Use test.describe for grouping\n");
        sb.append("- Include proper error handling\n");
        
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private String extractGeneratedScript(Map<String, Object> response) {
        List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
        if (candidates == null || candidates.isEmpty()) {
            throw new RuntimeException("No response from Gemini API");
        }
        
        Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
        List<Map<String, Object>> parts = (List<Map<String, Object>>) content.get("parts");
        
        return (String) parts.get(0).get("text");
    }
}
```

### 7.3 GradingWorkerClient.java
```java
package gdgoc.onewave.connectable.infrastructure.worker;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class GradingWorkerClient {

    private final WebClient webClient;

    @Value("${worker.url}")
    private String workerUrl;

    @Value("${worker.timeout-seconds:60}")
    private int timeoutSeconds;

    /**
     * Cloud Run 워커에 채점 요청 (동기 - 응답 대기)
     * 
     * @param request 채점 요청 정보
     * @return 채점 결과
     * @throws RuntimeException 채점 실패 시
     */
    public GradingResponse grade(GradingRequest request) {
        log.info("Sending grading request for submission: {}", request.submissionId());
        
        try {
            GradingResponse response = webClient.post()
                .uri(workerUrl + "/grade")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(GradingResponse.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .block();
            
            log.info("Grading completed for submission: {}, passed: {}/{}", 
                request.submissionId(), 
                response.results().stream().filter(GradingResultItem::isPassed).count(),
                response.results().size());
            
            return response;
            
        } catch (Exception e) {
            log.error("Grading failed for submission: {}", request.submissionId(), e);
            throw new RuntimeException("Grading process failed", e);
        }
    }

    public record GradingRequest(
        UUID submissionId,
        String targetUrl,
        String playwrightScript
    ) {}

    public record GradingResponse(
        UUID submissionId,
        boolean success,
        List<GradingResultItem> results,
        String errorMessage
    ) {}

    public record GradingResultItem(
        String taskName,
        boolean isPassed,
        String feedback
    ) {}
}
```

---

## 8. Configuration 상세

### 8.1 application.yml
```yaml
spring:
  application:
    name: connectable
  
  datasource:
    url: jdbc:postgresql://${SUPABASE_HOST}:5432/${SUPABASE_DB}
    username: ${SUPABASE_USER}
    password: ${SUPABASE_PASSWORD}
    driver-class-name: org.postgresql.Driver
  
  jpa:
    hibernate:
      ddl-auto: validate  # 프로덕션: validate 사용
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        format_sql: true
    show-sql: false  # 프로덕션: false

  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 50MB

# GCS 설정
gcs:
  bucket-name: ${GCS_BUCKET_NAME}
  base-url: https://storage.googleapis.com

# Gemini API 설정
gemini:
  api-key: ${GEMINI_API_KEY}
  model: gemini-1.5-pro

# Cloud Run 워커 설정
worker:
  url: ${WORKER_URL}
  timeout-seconds: 60  # 채점 대기 타임아웃

# 서버 설정
server:
  port: 8080

# 로깅
logging:
  level:
    gdgoc.onewave.connectable: INFO
    org.hibernate.SQL: WARN
```

### 8.2 WebClientConfig.java
```java
package gdgoc.onewave.connectable.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.handler.timeout.WriteTimeoutHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

@Configuration
public class WebClientConfig {

    @Bean
    public WebClient webClient() {
        HttpClient httpClient = HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 10000)
            .responseTimeout(Duration.ofSeconds(90))  // 채점 대기를 위해 90초로 증가
            .doOnConnected(conn -> conn
                .addHandlerLast(new ReadTimeoutHandler(90, TimeUnit.SECONDS))
                .addHandlerLast(new WriteTimeoutHandler(30, TimeUnit.SECONDS)));

        return WebClient.builder()
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .codecs(configurer -> configurer
                .defaultCodecs()
                .maxInMemorySize(10 * 1024 * 1024)) // 10MB
            .build();
    }
}
```

### 8.3 GcsConfig.java
```java
package gdgoc.onewave.connectable.config;

import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageOptions;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class GcsConfig {

    @Bean
    public Storage storage() {
        // GCP 환경에서는 Application Default Credentials 사용
        // 로컬에서는 GOOGLE_APPLICATION_CREDENTIALS 환경변수 설정 필요
        return StorageOptions.getDefaultInstance().getService();
    }
}
```

### 8.4 CorsConfig.java
```java
package gdgoc.onewave.connectable.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(
            "http://localhost:3000",
            "https://your-frontend-domain.com"
        ));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        
        return new CorsFilter(source);
    }
}
```

---

## 9. DTO 상세

### 9.1 Request DTOs

```java
// AssignmentCreateRequest.java
package gdgoc.onewave.connectable.domain.assignment.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

public record AssignmentCreateRequest(
    @NotBlank(message = "Title is required")
    @Size(max = 255, message = "Title must be less than 255 characters")
    String title,
    
    @NotBlank(message = "Content is required")
    String content,
    
    @NotEmpty(message = "At least one sub-task is required")
    List<@NotBlank(message = "Sub-task cannot be empty") String> subTasks
) {}
```

### 9.2 Response DTOs

```java
// AssignmentResponse.java
package gdgoc.onewave.connectable.domain.assignment.dto;

import gdgoc.onewave.connectable.domain.assignment.entity.Assignment;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record AssignmentResponse(
    UUID id,
    String title,
    String content,
    List<String> subTasks,
    String aiScript,
    LocalDateTime createdAt
) {
    public static AssignmentResponse from(Assignment assignment) {
        return new AssignmentResponse(
            assignment.getId(),
            assignment.getTitle(),
            assignment.getContent(),
            assignment.getSubTasks(),
            assignment.getAiScript(),
            assignment.getCreatedAt()
        );
    }
    
    // 구직자용 (aiScript 제외)
    public static AssignmentResponse forCandidate(Assignment assignment) {
        return new AssignmentResponse(
            assignment.getId(),
            assignment.getTitle(),
            assignment.getContent(),
            assignment.getSubTasks(),
            null, // AI Script 비공개
            assignment.getCreatedAt()
        );
    }
}

// SubmissionResponse.java (채점 결과 포함)
package gdgoc.onewave.connectable.domain.submission.dto;

import gdgoc.onewave.connectable.domain.grading.dto.GradingResultResponse;
import gdgoc.onewave.connectable.domain.submission.entity.Submission;
import gdgoc.onewave.connectable.domain.submission.entity.SubmissionStatus;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record SubmissionResponse(
    UUID id,
    String candidateName,
    String fileUrl,
    SubmissionStatus status,
    List<GradingResultResponse> gradingResults,
    GradingSummary summary,
    LocalDateTime createdAt
) {
    public record GradingSummary(
        int passedCount,
        int totalCount,
        String passRate
    ) {
        public static GradingSummary from(List<GradingResultResponse> results) {
            int passed = (int) results.stream().filter(GradingResultResponse::isPassed).count();
            int total = results.size();
            String rate = total > 0 ? String.format("%.0f%%", (passed * 100.0) / total) : "0%";
            return new GradingSummary(passed, total, rate);
        }
    }

    public static SubmissionResponse from(Submission submission, List<GradingResultResponse> gradingResults) {
        return new SubmissionResponse(
            submission.getId(),
            submission.getCandidateName(),
            submission.getFileUrl(),
            submission.getStatus(),
            gradingResults,
            GradingSummary.from(gradingResults),
            submission.getCreatedAt()
        );
    }
}

// GradingResultResponse.java
package gdgoc.onewave.connectable.domain.grading.dto;

import gdgoc.onewave.connectable.domain.grading.entity.GradingResult;
import java.util.UUID;

public record GradingResultResponse(
    UUID id,
    String taskName,
    Boolean isPassed,
    String feedback
) {
    public static GradingResultResponse from(GradingResult result) {
        return new GradingResultResponse(
            result.getId(),
            result.getTaskName(),
            result.getIsPassed(),
            result.getFeedback()
        );
    }

    // Worker 응답에서 변환 (DB 저장 전)
    public static GradingResultResponse fromWorkerResult(
        gdgoc.onewave.connectable.infrastructure.worker.GradingWorkerClient.GradingResultItem item
    ) {
        return new GradingResultResponse(
            null,  // DB 저장 전이므로 ID 없음
            item.taskName(),
            item.isPassed(),
            item.feedback()
        );
    }
}
```

---

## 10. 예외 처리

### 10.1 ErrorCode.java
```java
package gdgoc.onewave.connectable.global.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum ErrorCode {
    // Common
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "C001", "Invalid request"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "C002", "Internal server error"),
    
    // Assignment
    ASSIGNMENT_NOT_FOUND(HttpStatus.NOT_FOUND, "A001", "Assignment not found"),
    AI_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "A002", "Failed to generate AI script"),
    
    // Submission
    SUBMISSION_NOT_FOUND(HttpStatus.NOT_FOUND, "S001", "Submission not found"),
    INVALID_FILE_TYPE(HttpStatus.BAD_REQUEST, "S002", "Only .zip files are allowed"),
    FILE_TOO_LARGE(HttpStatus.BAD_REQUEST, "S003", "File size exceeds limit"),
    FILE_UPLOAD_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "S004", "Failed to upload file"),
    
    // Grading
    GRADING_TRIGGER_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "G001", "Failed to trigger grading");

    private final HttpStatus status;
    private final String code;
    private final String message;
}
```

### 10.2 GlobalExceptionHandler.java
```java
package gdgoc.onewave.connectable.global.exception;

import gdgoc.onewave.connectable.global.response.ApiResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException e) {
        log.warn("Business exception: {}", e.getMessage());
        return ResponseEntity
            .status(e.getErrorCode().getStatus())
            .body(ApiResponse.error(e.getErrorCode()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .map(error -> error.getField() + ": " + error.getDefaultMessage())
            .findFirst()
            .orElse("Validation failed");
        
        return ResponseEntity
            .badRequest()
            .body(ApiResponse.error(ErrorCode.INVALID_REQUEST.getCode(), message));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleMaxUploadSizeExceeded(MaxUploadSizeExceededException e) {
        return ResponseEntity
            .badRequest()
            .body(ApiResponse.error(ErrorCode.FILE_TOO_LARGE));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception e) {
        log.error("Unexpected exception", e);
        return ResponseEntity
            .internalServerError()
            .body(ApiResponse.error(ErrorCode.INTERNAL_ERROR));
    }
}
```

---

## 11. 테스트 계획

### 11.1 단위 테스트
| 대상 | 테스트 항목 |
|------|------------|
| GcsStorageService | Zip 압축 해제, 파일 업로드, Zip Slip 방지 |
| GeminiService | 프롬프트 생성, 응답 파싱 |
| AssignmentService | 과제 생성, 조회 |
| SubmissionService | 파일 검증, 제출 처리 |

### 11.2 통합 테스트
| 시나리오 | 검증 항목 |
|---------|----------|
| 과제 생성 Flow | API → Gemini → DB 저장 |
| 파일 제출 Flow | API → GCS 업로드 → 워커 호출 |
| 채점 결과 조회 | DB 조회 → 응답 포맷 |

### 11.3 E2E 테스트
```
1. 과제 생성 → 스크립트 생성 확인
2. Zip 파일 제출 → GCS 호스팅 URL 확인
3. 채점 완료 → 결과 조회
```

---

## 12. 환경 변수

```bash
# Supabase (PostgreSQL)
SUPABASE_HOST=db.xxxx.supabase.co
SUPABASE_DB=postgres
SUPABASE_USER=postgres
SUPABASE_PASSWORD=your-password

# GCS
GCS_BUCKET_NAME=connectable-submissions
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Gemini API
GEMINI_API_KEY=your-gemini-api-key

# Cloud Run Worker
WORKER_URL=https://grading-worker-xxxxx.run.app
```

---

## 13. 배포 체크리스트

### 13.1 사전 준비
- [ ] Supabase 프로젝트 생성 및 DDL 실행
- [ ] GCS 버킷 생성 및 정적 호스팅 설정
- [ ] Gemini API 키 발급
- [ ] Cloud Run 워커 배포
- [ ] 환경 변수 설정

### 13.2 GCS 버킷 설정
```bash
# 버킷 생성
gsutil mb -l asia-northeast3 gs://connectable-submissions

# 공개 읽기 권한 (정적 호스팅용)
gsutil iam ch allUsers:objectViewer gs://connectable-submissions

# CORS 설정
gsutil cors set cors.json gs://connectable-submissions
```

### 13.3 CORS 설정 파일 (cors.json)
```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

---

## 14. 구현 우선순위

| 순서 | 항목 | 예상 시간 |
|-----|------|----------|
| 1 | build.gradle 의존성 수정 | 10분 |
| 2 | application.yml 설정 | 15분 |
| 3 | Entity 클래스 생성 | 30분 |
| 4 | Repository 인터페이스 생성 | 10분 |
| 5 | Config 클래스 생성 | 20분 |
| 6 | GcsStorageService 구현 | 40분 |
| 7 | GeminiService 구현 | 30분 |
| 8 | GradingWorkerClient 구현 | 20분 |
| 9 | AssignmentService/Controller 구현 | 40분 |
| 10 | SubmissionService/Controller 구현 | 40분 |
| 11 | 예외 처리 및 공통 응답 | 20분 |
| 12 | 테스트 코드 작성 | 60분 |

**총 예상 시간: 약 5-6시간**

---

## 15. Cloud Run Worker (NestJS) 연동 스펙

> Worker는 별도 레포지토리에서 관리되는 NestJS 서버

### 15.1 Worker API 요청 스펙

**Endpoint:** `POST {WORKER_URL}/grade`

```typescript
// Request Body (Spring Boot → NestJS Worker)
{
  submissionId: string;      // UUID
  targetUrl: string;         // GCS 정적 호스팅 URL (index.html)
  playwrightScript: string;  // Gemini가 생성한 Playwright 테스트 코드
}
```

### 15.2 Worker API 응답 스펙

```typescript
// Response Body (NestJS Worker → Spring Boot)
{
  submissionId: string;      // UUID (요청과 동일)
  success: boolean;          // 채점 프로세스 성공 여부
  results: [
    {
      taskName: string;      // 테스트 케이스 이름
      isPassed: boolean;     // 통과 여부
      feedback: string;      // 상세 피드백 (실패 사유 등)
    }
  ];
  errorMessage?: string;     // success=false일 때 에러 메시지
}
```

### 15.3 Worker 구현 참고사항 (NestJS 측)

```typescript
// NestJS Worker Controller 예시
@Controller('grade')
export class GradeController {
  @Post()
  async grade(@Body() request: GradeRequestDto): Promise<GradeResponseDto> {
    // 1. targetUrl에 접속
    // 2. playwrightScript 실행
    // 3. 각 테스트 결과 수집
    // 4. 결과 반환
  }
}

// Playwright 테스트 실행 예시
async function runPlaywrightTests(targetUrl: string, script: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(targetUrl);
  
  // 동적으로 스크립트 실행하여 테스트 수행
  // 결과 수집 및 반환
}
```

### 15.4 타임아웃 및 에러 처리

| 상황 | 처리 |
|------|------|
| Worker 응답 지연 (>60초) | Spring Boot에서 타임아웃 처리 → FAILED |
| Playwright 테스트 실패 | success=true, 개별 results[].isPassed=false |
| Worker 내부 오류 | success=false, errorMessage 포함 |
| 네트워크 오류 | Spring Boot에서 catch → GRADING_FAILED 에러 |
