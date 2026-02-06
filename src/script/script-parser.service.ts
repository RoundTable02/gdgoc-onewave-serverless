import { Injectable, Logger } from '@nestjs/common';
import { ParsedTestScript } from './interfaces/script.interface';

@Injectable()
export class ScriptParserService {
  private readonly logger = new Logger(ScriptParserService.name);

  parsePlaywrightScript(script: string): ParsedTestScript[] {
    const tests: ParsedTestScript[] = [];

    // test('taskName', async ({ page }) => { ... }) 패턴 추출
    // 중첩된 중괄호를 처리하기 위한 더 정교한 파싱
    const testPattern = /test\s*\(\s*['"]([^'"]+)['"]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{/g;

    let match;
    while ((match = testPattern.exec(script)) !== null) {
      const taskName = match[1];
      const startIndex = match.index + match[0].length;

      // 중괄호 매칭으로 테스트 본문 추출
      let braceCount = 1;
      let endIndex = startIndex;

      for (let i = startIndex; i < script.length && braceCount > 0; i++) {
        if (script[i] === '{') braceCount++;
        else if (script[i] === '}') braceCount--;
        endIndex = i;
      }

      const code = script.substring(startIndex, endIndex).trim();

      tests.push({ taskName, code });
      this.logger.debug(`Parsed test: ${taskName}`);
    }

    this.logger.log(`Parsed ${tests.length} test(s) from script`);
    return tests;
  }
}
