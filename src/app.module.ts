import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as dotenv from 'dotenv';

import { User } from './database/entities/user.entity';
import { Wallet } from './database/entities/wallet.entity';
import { Transaction } from './database/entities/transaction.entity';
import { LedgerEntry } from './database/entities/ledger-entry.entity';
import { AuditLog } from './database/entities/audit-log.entity';
import { SeedService } from './database/seed.service';

import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { WalletsController } from './modules/wallets/wallets.controller';
import { WalletsService } from './modules/wallets/wallets.service';
import { AdminController } from './modules/admin/admin.controller';
import { AdminService } from './modules/admin/admin.service';

import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';

dotenv.config();

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      username: process.env.DB_USER || 'ewallet_user',
      password: process.env.DB_PASS || 'ewallet_secret_password',
      database: process.env.DB_NAME || 'ewallet_db',
      entities: [User, Wallet, Transaction, LedgerEntry, AuditLog],
      migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
      synchronize: false,
      migrationsRun: true,
    }),
    TypeOrmModule.forFeature([User, Wallet, Transaction, LedgerEntry, AuditLog]),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'super-secret-ewallet-jwt-key-2026',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '1d' },
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redisService: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60000,
            limit: 100,
          },
          {
            name: 'auth',
            ttl: 60000,
            limit: 5,
            blockDuration: 300000,
          },
        ],
        storage: new RedisThrottlerStorage(redisService),
      }),
    }),
  ],
  controllers: [AuthController, WalletsController, AdminController],
  providers: [
    AuthService,
    WalletsService,
    AdminService,
    SeedService,
    JwtAuthGuard,
    RolesGuard,
    IdempotencyInterceptor,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
