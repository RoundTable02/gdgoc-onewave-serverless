export class GradingResultItem {
  taskName: string;
  isPassed: boolean;
  feedback: string;
}

export class GradingResponseDto {
  submissionId: string;
  success: boolean;
  results: GradingResultItem[];
  errorMessage?: string;
}
