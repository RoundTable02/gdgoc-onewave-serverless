export class GradingResultItem {
  taskName: string;
  isPassed: boolean;
}

export class GradingResponseDto {
  submissionId: string;
  success: boolean;
  results: GradingResultItem[];
  errorMessage?: string;
}
