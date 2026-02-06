import { Injectable, Logger } from '@nestjs/common';
import { Page, BrowserContext } from 'playwright';
import { GcsStorageService } from './storage/gcs-storage.service';

@Injectable()
export class EvidenceCollectorService {
  private readonly logger = new Logger(EvidenceCollectorService.name);

  constructor(private gcsStorage: GcsStorageService) {}

  async captureScreenshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string> {
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    });

    const path = `evidence/${submissionId}/${taskId}/screenshot.png`;
    return this.gcsStorage.uploadBuffer(screenshot, path, 'image/png');
  }

  async captureDOMSnapshot(
    page: Page,
    submissionId: string,
    taskId: string,
  ): Promise<string> {
    const html = await page.content();
    const buffer = Buffer.from(html, 'utf-8');

    const path = `evidence/${submissionId}/${taskId}/dom.html`;
    return this.gcsStorage.uploadBuffer(buffer, path, 'text/html');
  }

  async saveVideo(
    context: BrowserContext,
    submissionId: string,
  ): Promise<string | undefined> {
    const pages = context.pages();
    if (pages.length === 0) return undefined;

    const video = pages[0].video();
    if (!video) return undefined;

    try {
      const videoPath = await video.path();
      const remotePath = `evidence/${submissionId}/recording.webm`;
      return this.gcsStorage.uploadFile(videoPath, remotePath);
    } catch {
      this.logger.warn('Failed to save video recording');
      return undefined;
    }
  }
}
