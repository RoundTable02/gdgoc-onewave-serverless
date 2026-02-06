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
