import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser, BrowserContext, BrowserContextOptions } from 'playwright';
import { BROWSER_CONFIG } from './browser.config';

@Injectable()
export class BrowserManagerService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private readonly logger = new Logger(BrowserManagerService.name);

  async launchBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    this.logger.log('Launching browser...');
    this.browser = await chromium.launch(BROWSER_CONFIG.launch);
    return this.browser;
  }

  async createContext(options?: BrowserContextOptions): Promise<BrowserContext> {
    if (!this.browser) {
      await this.launchBrowser();
    }

    return this.browser!.newContext({
      ...BROWSER_CONFIG.context,
      ...options,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowser();
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      this.logger.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}
