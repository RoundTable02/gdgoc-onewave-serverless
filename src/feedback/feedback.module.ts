import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeedbackGeneratorService } from './feedback-generator.service';
import { GeminiService } from './gemini/gemini.service';

@Module({
  imports: [ConfigModule],
  providers: [FeedbackGeneratorService, GeminiService],
  exports: [FeedbackGeneratorService, GeminiService],
})
export class FeedbackModule {}
