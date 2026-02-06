import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini/gemini.service';
import { ScriptError, Feedback } from './interfaces/feedback.interface';

@Injectable()
export class FeedbackGeneratorService {
  private readonly logger = new Logger(FeedbackGeneratorService.name);

  constructor(private geminiService: GeminiService) {}

  async generateFeedback(
    error: ScriptError,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _screenshotUrl?: string,
  ): Promise<Feedback> {
    const prompt = this.buildPrompt(error);

    try {
      const response = await this.geminiService.generateContent(prompt);
      return this.parseFeedback(response);
    } catch {
      this.logger.warn('Failed to generate AI feedback, using fallback');
      return {
        summary: `테스트 실패: ${error.message}`,
        suggestion: '코드를 확인하고 다시 시도해주세요.',
      };
    }
  }

  private buildPrompt(error: ScriptError): string {
    return `당신은 프론트엔드 채점 전문가입니다.
학생의 과제 제출물에서 발생한 테스트 실패 원인을 분석하고
친절하고 교육적인 피드백을 제공해주세요.

## 테스트 정보
- 테스트명: ${error.taskName}
- 에러 메시지: ${error.message}

## 실행 코드
\`\`\`javascript
${error.code}
\`\`\`

위 정보를 바탕으로 다음 JSON 형식으로 응답해주세요:
{
  "summary": "실패 원인 (1-2문장)",
  "suggestion": "해결 방법 (구체적인 코드 예시 포함)",
  "severity": "low | medium | high"
}`;
  }

  private parseFeedback(response: string): Feedback {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(response);
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        summary: parsed.summary || '테스트 실패',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        suggestion: parsed.suggestion || '코드를 확인해주세요.',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        severity: parsed.severity,
      };
    } catch {
      return {
        summary: '테스트 실패',
        suggestion: '코드를 확인해주세요.',
      };
    }
  }
}
