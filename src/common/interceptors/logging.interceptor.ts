import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, headers } = request;
    const now = Date.now();

    // 요청 헤더 로그
    this.logger.log(`Request Headers: ${JSON.stringify(headers, null, 2)}`);

    // 요청 바디 로그
    this.logger.log(`Request Body: ${JSON.stringify(request.body, null, 2)}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const delay = Date.now() - now;
        this.logger.log(`${method} ${url} ${response.statusCode} - ${delay}ms`);
      }),
    );
  }
}
