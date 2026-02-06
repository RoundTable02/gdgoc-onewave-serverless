import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  PORT: Joi.number().default(8080),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  GEMINI_API_KEY: Joi.string().required(),
  GCS_BUCKET: Joi.string().required(),
  GCS_PROJECT_ID: Joi.string().required(),
  GRADING_TIMEOUT_MS: Joi.number().default(300000),
  MAX_CONCURRENT_TESTS: Joi.number().min(1).max(10).default(5),
  TEST_TIMEOUT_MS: Joi.number().default(30000),
  ENABLE_PARALLEL_EXECUTION: Joi.boolean().default(true),
  BROWSER_HEADLESS: Joi.boolean().default(true),
  ENABLE_VIDEO_RECORDING: Joi.boolean().default(false),
});
