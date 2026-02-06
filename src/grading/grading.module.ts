import { Module } from '@nestjs/common';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';
import { BrowserModule } from '../browser/browser.module';
import { ScriptModule } from '../script/script.module';

@Module({
  imports: [BrowserModule, ScriptModule],
  controllers: [GradingController],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
