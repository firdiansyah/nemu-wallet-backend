import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

const ATOMIC_THROTTLE_LUA = `
  local hitKey = KEYS[1]
  local blockKey = KEYS[2]
  local ttlMs = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local blockDurationMs = tonumber(ARGV[3])

  local blockTtl = redis.call('PTTL', blockKey)
  if blockTtl > 0 then
    local currentHits = tonumber(redis.call('GET', hitKey) or limit)
    local hitTtl = math.max(redis.call('PTTL', hitKey), 0)
    return { currentHits, math.ceil(hitTtl / 1000), 1, math.ceil(blockTtl / 1000) }
  end

  local totalHits = redis.call('INCR', hitKey)
  if totalHits == 1 then
    redis.call('PEXPIRE', hitKey, ttlMs)
  end

  local hitTtl = math.max(redis.call('PTTL', hitKey), 0)

  if totalHits > limit then
    local effectiveBlockTtl = hitTtl
    if blockDurationMs > 0 then
      redis.call('SET', blockKey, '1', 'PX', blockDurationMs)
      effectiveBlockTtl = blockDurationMs
    end
    return { totalHits, math.ceil(hitTtl / 1000), 1, math.ceil(effectiveBlockTtl / 1000) }
  end

  return { totalHits, math.ceil(hitTtl / 1000), 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}:hits`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    const [totalHits, timeToExpire, isBlockedFlag, timeToBlockExpire] =
      await this.redisService.eval<[number, number, number, number]>(
        ATOMIC_THROTTLE_LUA,
        [hitKey, blockKey],
        [ttl, limit, blockDuration],
      );

    return {
      totalHits,
      timeToExpire,
      isBlocked: isBlockedFlag === 1,
      timeToBlockExpire,
    };
  }
}
