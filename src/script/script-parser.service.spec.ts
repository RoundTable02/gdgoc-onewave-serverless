import { Test, TestingModule } from '@nestjs/testing';
import { ScriptParserService } from './script-parser.service';

describe('ScriptParserService', () => {
  let service: ScriptParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScriptParserService],
    }).compile();

    service = module.get<ScriptParserService>(ScriptParserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parsePlaywrightScript', () => {
    it('should parse a single test case', () => {
      const script = `
        test('Check title', async ({ page }) => {
          await expect(page).toHaveTitle(/Example/);
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].taskName).toBe('Check title');
      expect(result[0].code).toContain('toHaveTitle');
    });

    it('should parse multiple test cases', () => {
      const script = `
        test('First test', async ({ page }) => {
          await expect(page).toHaveTitle(/Example/);
        });

        test('Second test', async ({ page }) => {
          await page.click('button');
        });

        test('Third test', async ({ page }) => {
          const text = await page.textContent('h1');
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(3);
      expect(result[0].taskName).toBe('First test');
      expect(result[1].taskName).toBe('Second test');
      expect(result[2].taskName).toBe('Third test');
    });

    it('should handle test with nested braces', () => {
      const script = `
        test('Complex test', async ({ page }) => {
          if (true) {
            await page.click('button');
          }
          const obj = { key: 'value' };
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].taskName).toBe('Complex test');
      expect(result[0].code).toContain('if (true)');
      expect(result[0].code).toContain("{ key: 'value' }");
    });

    it('should handle test with double quotes', () => {
      const script = `
        test("Test with double quotes", async ({ page }) => {
          await page.click("button");
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].taskName).toBe('Test with double quotes');
    });

    it('should return empty array for script with no tests', () => {
      const script = `
        const foo = 'bar';
        console.log('hello');
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(0);
    });

    it('should handle empty script', () => {
      const script = '';

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(0);
    });

    it('should trim whitespace from code', () => {
      const script = `
        test('Whitespace test', async ({ page }) => {

          await page.click('button');

        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].code).not.toMatch(/^\s+/);
      expect(result[0].code).not.toMatch(/\s+$/);
    });

    it('should handle test with multi-line await', () => {
      const script = `
        test('Multi-line test', async ({ page }) => {
          await expect(page.locator('h1'))
            .toHaveText('Hello World');
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].code).toContain('toHaveText');
    });

    it('should handle test with arrow functions', () => {
      const script = `
        test('Arrow function test', async ({ page }) => {
          const items = [1, 2, 3].map(n => n * 2);
          await page.click('button');
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].code).toContain('map(n => n * 2)');
    });

    it('should handle Korean test names', () => {
      const script = `
        test('제목 확인하기', async ({ page }) => {
          await expect(page).toHaveTitle(/예제/);
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].taskName).toBe('제목 확인하기');
    });

    it('should handle special characters in test names', () => {
      const script = `
        test('Test #1: Check @ symbol & more!', async ({ page }) => {
          await page.click('button');
        });
      `;

      const result = service.parsePlaywrightScript(script);

      expect(result).toHaveLength(1);
      expect(result[0].taskName).toBe('Test #1: Check @ symbol & more!');
    });
  });
});
