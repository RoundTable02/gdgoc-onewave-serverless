import { Controller, Post, Get, Body, HttpCode, Logger } from '@nestjs/common';
import { GradingService } from './grading.service';
import { GradingRequestDto } from './dto/grading-request.dto';
import { GradingResponseDto } from './dto/grading-response.dto';

@Controller()
export class GradingController {
  private readonly logger = new Logger(GradingController.name);

  constructor(private readonly gradingService: GradingService) {}

  @Post('grade')
  @HttpCode(200)
  async runGrading(@Body() request: GradingRequestDto): Promise<GradingResponseDto> {
    this.logger.log(`Grading request received: ${request.submissionId}`);
    return this.gradingService.runGrading(request);
  }

  @Get('health')
  healthCheck(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    };
  }
}
