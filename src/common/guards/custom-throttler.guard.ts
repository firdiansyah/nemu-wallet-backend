import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    const clientIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : req.ip || 'unknown-ip';

    const userId = req.user?.sub;
    return userId ? `${clientIp}:user:${userId}` : clientIp;
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'Terlalu banyak permintaan dari perangkat Anda. Silakan coba beberapa saat lagi.',
    );
  }
}
