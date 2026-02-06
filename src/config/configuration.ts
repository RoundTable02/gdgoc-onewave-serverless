export default () => ({
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY,
  gcs: {
    bucket: process.env.GCS_BUCKET,
    projectId: process.env.GCS_PROJECT_ID,
  },
  grading: {
    timeoutMs: parseInt(process.env.GRADING_TIMEOUT_MS || '300000', 10),
    maxConcurrentTests: parseInt(process.env.MAX_CONCURRENT_TESTS || '5', 10),
    testTimeoutMs: parseInt(process.env.TEST_TIMEOUT_MS || '30000', 10),
    enableParallelExecution: process.env.ENABLE_PARALLEL_EXECUTION !== 'false',
  },
  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    enableVideoRecording: process.env.ENABLE_VIDEO_RECORDING === 'true',
  },
});
