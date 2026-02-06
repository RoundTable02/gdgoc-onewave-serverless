import { Module } from '@nestjs/common';
import { ScriptParserService } from './script-parser.service';
import { ScriptRunnerService } from './script-runner.service';

@Module({
  providers: [ScriptParserService, ScriptRunnerService],
  exports: [ScriptParserService, ScriptRunnerService],
})
export class ScriptModule {}
