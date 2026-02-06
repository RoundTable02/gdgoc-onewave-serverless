import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { BrowserModule } from '../browser/browser.module';
import { ScriptModule } from '../script/script.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { FeedbackModule } from '../feedback/feedback.module';

@Module({
  imports: [
    BrowserModule,
    ScriptModule,
    EvidenceModule,
    FeedbackModule,
  ],
  controllers: [GradingController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
