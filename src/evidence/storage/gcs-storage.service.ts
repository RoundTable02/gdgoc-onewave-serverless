import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class GcsStorageService {
  private readonly bucket: Bucket;
  private readonly logger = new Logger(GcsStorageService.name);

  constructor(private configService: ConfigService) {
    const storage = new Storage({
      projectId: configService.get('GCS_PROJECT_ID'),
    });
    this.bucket = storage.bucket(configService.get('GCS_BUCKET')!);
  }

  async uploadBuffer(
    buffer: Buffer,
    path: string,
    contentType: string,
  ): Promise<string> {
    const file = this.bucket.file(path);

    await file.save(buffer, {
      contentType,
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${path}`;
    this.logger.log(`Uploaded: ${publicUrl}`);

    return publicUrl;
  }

  async uploadFile(localPath: string, remotePath: string): Promise<string> {
    await this.bucket.upload(localPath, {
      destination: remotePath,
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucket.name}/${remotePath}`;
    this.logger.log(`Uploaded file: ${publicUrl}`);

    return publicUrl;
  }
}
