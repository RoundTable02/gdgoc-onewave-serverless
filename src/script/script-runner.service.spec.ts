import { Test, TestingModule } from '@nestjs/testing';
import { ScriptRunnerService } from './script-runner.service';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { expect as playwrightExpect } from '@playwright/test';

describe('ScriptRunnerService', () => {
  let service: ScriptRunnerService;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScriptRunnerService],
    }).compile();

    service = module.get<ScriptRunnerService>(ScriptRunnerService);

    context = await browser.newContext();
    page = await context.newPage();
    await page.setContent('<html><body><h1>Test Page</h1></body></html>');
  });

  afterEach(async () => {
    await page.close();
    await context.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('execute', () => {
    it('should successfully execute valid script', async () => {
      const code = `
        const title = await page.textContent('h1');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid script', async () => {
      const code = `
        throw new Error('Test error');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error');
    });

    it('should capture screenshot on error when captureOnError is true', async () => {
      const code = `
        throw new Error('Capture test');
      `;

      const result = await service.execute(
        code,
        { page, expect: playwrightExpect },
        { captureOnError: true },
      );

      expect(result.success).toBe(false);
      expect(result.screenshot).toBeDefined();
      expect(result.screenshot).toBeInstanceOf(Buffer);
      expect(result.screenshot!.length).toBeGreaterThan(0);
    });

    it('should capture HTML on error when captureOnError is true', async () => {
      const code = `
        throw new Error('HTML capture test');
      `;

      const result = await service.execute(
        code,
        { page, expect: playwrightExpect },
        { captureOnError: true },
      );

      expect(result.success).toBe(false);
      expect(result.html).toBeDefined();
      expect(result.html).toContain('<h1>Test Page</h1>');
    });

    it('should not capture evidence when captureOnError is false', async () => {
      const code = `
        throw new Error('No capture test');
      `;

      const result = await service.execute(
        code,
        { page, expect: playwrightExpect },
        { captureOnError: false },
      );

      expect(result.success).toBe(false);
      expect(result.screenshot).toBeUndefined();
      expect(result.html).toBeUndefined();
    });

    it('should handle timeout', async () => {
      const code = `
        await new Promise(resolve => setTimeout(resolve, 2000));
      `;

      const result = await service.execute(
        code,
        { page, expect: playwrightExpect },
        { timeout: 500 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should execute script with page interactions', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="btn">Click me</button>
            <div id="result"></div>
            <script>
              document.getElementById('btn').addEventListener('click', () => {
                document.getElementById('result').textContent = 'Clicked!';
              });
            </script>
          </body>
        </html>
      `);

      const code = `
        await page.click('#btn');
        const result = await page.textContent('#result');
        await expect(page.locator('#result')).toHaveText('Clicked!');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
    });

    it('should handle assertion failures', async () => {
      const code = `
        await expect(page.locator('h1')).toHaveText('Wrong Text', { timeout: 1000 });
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle syntax errors in script', async () => {
      const code = `
        const invalid syntax here
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should allow accessing page methods', async () => {
      const code = `
        await page.goto('about:blank');
        const url = page.url();
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
    });

    it('should handle multiple await statements', async () => {
      await page.setContent(`
        <html>
          <body>
            <h1>Title</h1>
            <p>Paragraph</p>
          </body>
        </html>
      `);

      const code = `
        const title = await page.textContent('h1');
        const paragraph = await page.textContent('p');
        await expect(page.locator('h1')).toHaveText('Title');
        await expect(page.locator('p')).toHaveText('Paragraph');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
    });

    it('should use default timeout when not specified', async () => {
      const code = `
        await page.textContent('h1');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
    });

    it('should capture error message with special characters', async () => {
      const code = `
        throw new Error('Error with "quotes" and \\n newlines');
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('quotes');
      expect(result.error).toContain('newlines');
    });

    it('should handle scripts with Korean comments', async () => {
      const code = `
        // 제목 확인
        const title = await page.textContent('h1');
        /* 여러 줄
           주석 */
      `;

      const result = await service.execute(code, {
        page,
        expect: playwrightExpect,
      });

      expect(result.success).toBe(true);
    });
  });
});
