import { IsString, IsUUID, IsUrl, IsArray } from 'class-validator';

export class GradingRequestDto {
  @IsUUID()
  submissionId: string;

  @IsUrl()
  targetUrl: string;

  @IsString()
  playwrightScript: string;

  @IsArray()
  @IsString({ each: true })
  subTasks: string[];
}
