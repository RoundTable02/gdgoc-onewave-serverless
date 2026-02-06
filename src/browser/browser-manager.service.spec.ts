import { Test, TestingModule } from '@nestjs/testing';
import { BrowserManagerService } from './browser-manager.service';

describe('BrowserManagerService', () => {
  let service: BrowserManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BrowserManagerService],
    }).compile();

    service = module.get<BrowserManagerService>(BrowserManagerService);
  });

  afterEach(async () => {
    await service.closeBrowser();
  });

  describe('launchBrowser', () => {
    it('should launch a browser instance', async () => {
      const browser = await service.launchBrowser();

      expect(browser).toBeDefined();
      expect(browser.isConnected()).toBe(true);
    });

    it('should return the same browser instance on multiple calls', async () => {
      const browser1 = await service.launchBrowser();
      const browser2 = await service.launchBrowser();

      expect(browser1).toBe(browser2);
    });

    it('should launch browser with correct configuration', async () => {
      const browser = await service.launchBrowser();

      expect(browser).toBeDefined();
      expect(browser.isConnected()).toBe(true);

      // 브라우저가 Chromium인지 확인
      const context = await browser.newContext();
      const page = await context.newPage();
      const userAgent = await page.evaluate(() => navigator.userAgent);

      expect(userAgent).toContain('Chrome');

      await page.close();
      await context.close();
    });
  });

  describe('createContext', () => {
    it('should create a browser context', async () => {
      const context = await service.createContext();

      expect(context).toBeDefined();
      expect(context.pages()).toBeDefined();

      await context.close();
    });

    it('should launch browser automatically if not launched', async () => {
      const context = await service.createContext();

      expect(context).toBeDefined();

      await context.close();
    });

    it('should create context with default configuration', async () => {
      const context = await service.createContext();
      const page = await context.newPage();

      const viewport = page.viewportSize();
      expect(viewport).toEqual({ width: 1280, height: 720 });

      await page.close();
      await context.close();
    });

    it('should allow custom context options', async () => {
      const context = await service.createContext({
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      const viewport = page.viewportSize();

      expect(viewport).toEqual({ width: 1920, height: 1080 });

      await page.close();
      await context.close();
    });

    it('should set correct locale and timezone', async () => {
      const context = await service.createContext();
      const page = await context.newPage();

      const locale = await page.evaluate(() => navigator.language);
      const timezone = await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      );

      expect(locale).toBe('ko-KR');
      expect(timezone).toBe('Asia/Seoul');

      await page.close();
      await context.close();
    });
  });

  describe('closeBrowser', () => {
    it('should close the browser', async () => {
      const browser = await service.launchBrowser();
      expect(browser.isConnected()).toBe(true);

      await service.closeBrowser();

      expect(browser.isConnected()).toBe(false);
    });

    it('should handle multiple close calls gracefully', async () => {
      await service.launchBrowser();
      await service.closeBrowser();
      await service.closeBrowser(); // Should not throw

      expect(true).toBe(true); // Test passes if no error thrown
    });

    it('should do nothing if browser was never launched', async () => {
      await service.closeBrowser();

      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('onModuleDestroy', () => {
    it('should close browser on module destroy', async () => {
      const browser = await service.launchBrowser();
      expect(browser.isConnected()).toBe(true);

      await service.onModuleDestroy();

      expect(browser.isConnected()).toBe(false);
    });
  });

  describe('resource management', () => {
    it('should handle multiple contexts from same browser', async () => {
      const context1 = await service.createContext();
      const context2 = await service.createContext();

      expect(context1).toBeDefined();
      expect(context2).toBeDefined();
      expect(context1).not.toBe(context2);

      await context1.close();
      await context2.close();
    });

    it('should allow new browser after closing', async () => {
      const browser1 = await service.launchBrowser();
      await service.closeBrowser();

      const browser2 = await service.launchBrowser();
      expect(browser2).toBeDefined();
      expect(browser2.isConnected()).toBe(true);
      expect(browser2).not.toBe(browser1);
    });
  });
});
