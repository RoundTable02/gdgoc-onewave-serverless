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
  },
  browser: {
    headless: process.env.BROWSER_HEADLESS === 'true',
    enableVideoRecording: process.env.ENABLE_VIDEO_RECORDING === 'true',
  },
});
