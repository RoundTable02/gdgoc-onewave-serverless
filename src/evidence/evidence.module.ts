import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EvidenceCollectorService } from './evidence-collector.service';
import { GcsStorageService } from './storage/gcs-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [EvidenceCollectorService, GcsStorageService],
  exports: [EvidenceCollectorService, GcsStorageService],
})
export class EvidenceModule {}
