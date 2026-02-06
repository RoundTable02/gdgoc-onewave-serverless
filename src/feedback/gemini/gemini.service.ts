import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class GeminiService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GeminiService.name);

  constructor(private configService: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      configService.get('GEMINI_API_KEY')!,
    );
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });
  }

  async generateContent(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
        },
      });

      return result.response.text();
    } catch (error) {
      this.logger.error('Gemini API call failed', error);
      throw error;
    }
  }
}
