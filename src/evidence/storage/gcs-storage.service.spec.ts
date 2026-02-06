import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GcsStorageService } from './gcs-storage.service';

// Mock @google-cloud/storage
jest.mock('@google-cloud/storage', () => {
  const mockFile = {
    save: jest.fn().mockResolvedValue(undefined),
  };

  const mockBucket = {
    file: jest.fn().mockReturnValue(mockFile),
    upload: jest.fn().mockResolvedValue([{}]),
    name: 'test-bucket',
  };

  const mockStorage = jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue(mockBucket),
  }));

  return {
    Storage: mockStorage,
  };
});

describe('GcsStorageService', () => {
  let service: GcsStorageService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GcsStorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                GCS_PROJECT_ID: 'test-project',
                GCS_BUCKET: 'test-bucket',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GcsStorageService>(GcsStorageService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadBuffer', () => {
    it('should upload buffer to GCS', async () => {
      const buffer = Buffer.from('test content');
      const path = 'test/file.txt';
      const contentType = 'text/plain';

      const url = await service.uploadBuffer(buffer, path, contentType);

      expect(url).toBe('https://storage.googleapis.com/test-bucket/test/file.txt');
    });

    it('should upload PNG image buffer', async () => {
      const buffer = Buffer.from('fake png data');
      const path = 'evidence/123/screenshot.png';
      const contentType = 'image/png';

      const url = await service.uploadBuffer(buffer, path, contentType);

      expect(url).toBe('https://storage.googleapis.com/test-bucket/evidence/123/screenshot.png');
      expect(url).toContain('.png');
    });

    it('should upload HTML buffer', async () => {
      const html = '<html><body>Test</body></html>';
      const buffer = Buffer.from(html, 'utf-8');
      const path = 'evidence/456/dom.html';
      const contentType = 'text/html';

      const url = await service.uploadBuffer(buffer, path, contentType);

      expect(url).toBe('https://storage.googleapis.com/test-bucket/evidence/456/dom.html');
      expect(url).toContain('.html');
    });

    it('should handle nested paths', async () => {
      const buffer = Buffer.from('test');
      const path = 'level1/level2/level3/file.txt';
      const contentType = 'text/plain';

      const url = await service.uploadBuffer(buffer, path, contentType);

      expect(url).toContain('level1/level2/level3/file.txt');
    });

    it('should handle paths with special characters', async () => {
      const buffer = Buffer.from('test');
      const path = 'evidence/test-123_abc/file.png';
      const contentType = 'image/png';

      const url = await service.uploadBuffer(buffer, path, contentType);

      expect(url).toContain('test-123_abc');
    });
  });

  describe('uploadFile', () => {
    it('should upload local file to GCS', async () => {
      const localPath = '/tmp/video.webm';
      const remotePath = 'evidence/789/recording.webm';

      const url = await service.uploadFile(localPath, remotePath);

      expect(url).toBe('https://storage.googleapis.com/test-bucket/evidence/789/recording.webm');
    });

    it('should handle video file upload', async () => {
      const localPath = '/tmp/test-video.webm';
      const remotePath = 'videos/test.webm';

      const url = await service.uploadFile(localPath, remotePath);

      expect(url).toContain('.webm');
      expect(url).toContain('videos/test.webm');
    });

    it('should handle absolute paths', async () => {
      const localPath = '/var/tmp/file.txt';
      const remotePath = 'uploads/file.txt';

      const url = await service.uploadFile(localPath, remotePath);

      expect(url).toBe('https://storage.googleapis.com/test-bucket/uploads/file.txt');
    });
  });

  describe('initialization', () => {
    it('should initialize with correct config', () => {
      expect(configService.get).toHaveBeenCalledWith('GCS_PROJECT_ID');
      expect(configService.get).toHaveBeenCalledWith('GCS_BUCKET');
    });

    it('should create bucket instance', () => {
      expect(service).toBeDefined();
      // Bucket은 private이므로 서비스가 정상적으로 생성되었는지만 확인
    });
  });

  describe('URL format', () => {
    it('should return public URL format', async () => {
      const buffer = Buffer.from('test');
      const path = 'test.txt';
      const url = await service.uploadBuffer(buffer, path, 'text/plain');

      expect(url).toMatch(/^https:\/\/storage\.googleapis\.com\//);
    });

    it('should include bucket name in URL', async () => {
      const buffer = Buffer.from('test');
      const path = 'test.txt';
      const url = await service.uploadBuffer(buffer, path, 'text/plain');

      expect(url).toContain('test-bucket');
    });

    it('should include full path in URL', async () => {
      const buffer = Buffer.from('test');
      const path = 'evidence/submission-123/task-1/screenshot.png';
      const url = await service.uploadBuffer(buffer, path, 'image/png');

      expect(url).toContain('evidence/submission-123/task-1/screenshot.png');
    });
  });
});
