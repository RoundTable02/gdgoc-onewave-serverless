🛠️ Grading Worker 기술 명세서 (NestJS 기반)채점 워커는 메인 서버로부터 **"어떤 URL을 어떤 스크립트로 채점하라"**는 명령을 받아 독립적으로 수행되는 마이크로서비스입니다.1. 주요 역할 및 워크플로우Job 수신: 메인 서버(API)로부터 HTTP 요청 또는 Queue 메시지를 수신.환경 준비: Playwright 브라우저(Chromium) 인스턴스 초기화.스크립트 주입: DB에 저장된 AI 생성 Playwright 코드를 가져와 샌드박스 환경에서 실행.데이터 수집: 테스트 결과(Pass/Fail), 스크린샷, 콘솔 로그, 네트워크 요청 추적.AI 사후 분석: 실패한 항목이 있다면 해당 시점의 HTML 구조를 AI에게 보내 원인 분석 요청.결과 보고: 최종 리포트를 메인 서버 DB에 업데이트.2. 핵심 모듈 구성 (Internal Modules)모듈명주요 기능BrowserManagerPlaywright 브라우저 실행/종료 및 컨텍스트(뷰포트, 유저 에이전트) 관리ScriptRunnereval() 또는 가상 머신(vm2)을 사용하여 동적 스크립트 안전하게 실행EvidenceCollector실패 지점의 스크린샷 캡처 및 DOM 스냅샷 저장FeedbackGenerator에러 로그를 분석하여 인간 친화적인 피드백 생성 (OpenAI 연동)3. 입력 데이터 명세 (Input Payload)메인 서버가 워커에게 전달해야 하는 데이터 구조입니다.JSON{
  "submissionId": "sub_12345",
  "targetUrl": "https://storage.googleapis.com/hiring-bucket/user-a/index.html",
  "testScripts": [
    {
      "taskId": "task_1",
      "taskName": "로그인 버튼 가시성 확인",
      "code": "await expect(page.locator('button:has-text(\"로그인\")')).toBeVisible();"
    },
    {
      "taskId": "task_2",
      "taskName": "메인 페이지 이동",
      "code": "await page.click('button:has-text(\"로그인\")'); await expect(page).toHaveURL(/.*dashboard/);"
    }
  ]
}
4. 핵심 로직 상세: GradingService.ts워커 내부에서 가장 중요한 채점 실행 로직의 흐름입니다.TypeScript// NestJS Service 예시 구조
async runGrading(payload: GradingJobDto) {
  const browser = await this.browserManager.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [];

  try {
    await page.goto(payload.targetUrl);

    for (const script of payload.testScripts) {
      try {
        // AI가 만든 코드를 실행
        await this.scriptRunner.execute(script.code, { page });
        results.push({ taskId: script.taskId, status: 'PASS' });
      } catch (error) {
        // 실패 시 스크린샷 찍고 AI 분석 요청
        const screenshot = await page.screenshot();
        const feedback = await this.feedbackGenerator.analyze(error, page.content());
        results.push({ taskId: script.taskId, status: 'FAIL', error: error.message, feedback });
      }
    }
  } finally {
    await browser.close();
    await this.reportResult(payload.submissionId, results);
  }
}
5. GCP Cloud Run 최적화 설정
Playwright 워커는 일반적인 API 서버보다 리소스를 많이 사용하므로 아래 설정이 필수적입니다.

Concurrency (동시성): 1로 설정하는 것이 안전합니다. (인스턴스 하나당 브라우저 하나만 띄워 메모리 충돌 방지)

Memory: 최소 2GiB (4GiB 권장).

CPU: 2 vCPU 이상 (브라우저 렌더링 속도에 직접적인 영향).

Timeout: 프론트엔드 과제의 복잡도에 따라 300초(5분) 이상으로 넉넉히 설정.

6. 해커톤용 시연 팁 (Wow Point)
비디오 녹화 기능: Playwright의 recordVideo 옵션을 켜서 채점 과정을 .webm 파일로 저장한 뒤, GCS에 업로드하세요. 기업 담당자가 채점표에서 **"채점 당시의 실제 화면 녹화본"**을 플레이해 볼 수 있다면 심사위원들에게 매우 강력한 인상을 남길 수 있습니다.

실시간 로그 스트리밍: 워커가 채점 중인 상태(현재 2번 과제 수행 중...)를 Supabase Realtime을 통해 프론트엔드에 실시간으로 뿌려주면 "살아있는 서비스" 느낌을 줍니다.
