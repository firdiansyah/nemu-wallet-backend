import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../decorators/auth.decorators';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly ttlSeconds = Number(process.env.IDEMPOTENCY_TTL_SECONDS) || 86400;

  constructor(private readonly redisService: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      return next.handle();
    }

    const user: JwtPayload | undefined = request.user;
    const scope = user?.sub || 'anonymous';
    const redisKey = `idempotency:${scope}:${idempotencyKey}`;

    const existingRecord = await this.redisService.get(redisKey);
    if (existingRecord) {
      if (existingRecord === 'PROCESSING') {
        throw new ConflictException(
          'Permintaan dengan X-Idempotency-Key ini sedang diproses. Mohon tunggu.',
        );
      }
      return of(JSON.parse(existingRecord));
    }

    const acquired = await this.redisService.setIfNotExists(redisKey, 'PROCESSING', 60);
    if (!acquired) {
      throw new ConflictException('Permintaan duplikat terdeteksi secara bersamaan.');
    }

    return next.handle().pipe(
      tap(async (responseBody) => {
        await this.redisService.set(redisKey, JSON.stringify(responseBody), this.ttlSeconds);
      }),
      catchError((err) => {
        this.redisService.del(redisKey).catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}
