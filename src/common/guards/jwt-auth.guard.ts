import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '../decorators/auth.decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token autentikasi tidak ditemukan');
    }

    const token = authHeader.split(' ')[1];
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kedaluwarsa');
    }

    const isRevoked = await this.redisService.exists(`blacklist:jti:${payload.jti}`);
    if (isRevoked) {
      throw new UnauthorizedException('Sesi telah berakhir. Silakan login kembali.');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Pengguna tidak ditemukan');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Akun Anda ditangguhkan oleh Administrator');
    }

    request.user = payload;
    return true;
  }
}
