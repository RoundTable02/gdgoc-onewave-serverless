import { IsString, IsUUID, IsUrl } from 'class-validator';

export class GradingRequestDto {
  @IsUUID()
  submissionId: string;

  @IsUrl()
  targetUrl: string;

  @IsString()
  playwrightScript: string;
}
