import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => this.logger.log('Terhubung ke Redis Server'));
    this.client.on('error', (err) => this.logger.error(`Redis Error: ${err.message}`));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count === 1;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async eval<T = any>(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<T> {
    return (await this.client.eval(
      script,
      keys.length,
      ...keys,
      ...args.map(String),
    )) as T;
  }

  async flushTestKeys(): Promise<void> {
    const keys = await this.client.keys('*');
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
