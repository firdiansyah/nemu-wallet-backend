import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { RedisService } from '../../common/redis/redis.service';
import { RegisterCustomerDto, LoginDto, ResetPasswordDto } from './auth.dto';
import { JwtPayload } from '../../common/decorators/auth.decorators';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async registerCustomer(dto: RegisterCustomerDto) {
    const existing = await this.userRepo.findOne({
      where: [{ email: dto.email }, { phoneNumber: dto.phoneNumber }],
    });
    if (existing) {
      throw new ConflictException('Email atau nomor telepon sudah terdaftar');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = queryRunner.manager.create(User, {
        fullName: dto.fullName,
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        passwordHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      });
      const savedUser = await queryRunner.manager.save(user);

      const wallet = queryRunner.manager.create(Wallet, {
        user: savedUser,
        accountNumber: `8801${dto.phoneNumber}`,
        balance: 0,
        currency: 'IDR',
      });
      await queryRunner.manager.save(wallet);

      await queryRunner.commitTransaction();
      return {
        message: 'Registrasi customer berhasil',
        user: {
          id: savedUser.id,
          fullName: savedUser.fullName,
          email: savedUser.email,
          phoneNumber: savedUser.phoneNumber,
          accountNumber: wallet.accountNumber,
        },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async login(dto: LoginDto, expectedRole: UserRole) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      relations: { wallet: true },
    });

    if (!user || user.role !== expectedRole) {
      throw new UnauthorizedException('Kredensial email atau password tidak valid');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Akun Anda sedang ditangguhkan oleh Administrator');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Kredensial email atau password tidak valid');
    }

    const jti = uuidv4();
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: user.id,
        action: `${expectedRole}_LOGIN`,
        targetId: user.id,
        metadata: { email: user.email },
      }),
    );

    return {
      accessToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        accountNumber: user.wallet?.accountNumber || null,
      },
    };
  }

  async logout(user: JwtPayload) {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const remainingTtl = user.exp ? Math.max(user.exp - nowInSeconds, 1) : 86400;

    await this.redisService.set(`blacklist:jti:${user.jti}`, 'revoked', remainingTtl);

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: user.sub,
        action: `${user.role}_LOGOUT`,
        targetId: user.sub,
        metadata: { jti: user.jti, ttlSeconds: remainingTtl },
      }),
    );

    return { message: 'Logout berhasil, sesi telah dicabut secara instan' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepo.findOne({
      where: {
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        role: UserRole.CUSTOMER,
      },
    });

    if (!user) {
      throw new NotFoundException('Kombinasi email dan nomor HP customer tidak ditemukan');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.userRepo.save(user);

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: user.id,
        action: 'CUSTOMER_RESET_PASSWORD',
        targetId: user.id,
        metadata: { email: user.email },
      }),
    );

    return { message: 'Password berhasil diperbarui. Silakan login dengan password baru.' };
  }
}
