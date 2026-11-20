import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterCustomerDto, LoginDto, ResetPasswordDto } from './auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, JwtPayload } from '../../common/decorators/auth.decorators';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Authentication (Customer & Admin)')
@Controller('api/v1')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('customer/auth/register')
  @ApiOperation({ summary: 'Registrasi akun Customer baru + pembuatan Wallet IDR' })
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Post('customer/auth/login')
  @Throttle({ auth: { limit: 5, ttl: 60000, blockDuration: 300000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login Customer (Rate limit: 5x/menit)' })
  loginCustomer(@Body() dto: LoginDto) {
    return this.authService.login(dto, UserRole.CUSTOMER);
  }

  @Post('customer/auth/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout Customer (Revoke JWT di Redis)' })
  logoutCustomer(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user);
  }

  @Post('customer/auth/reset-password')
  @Throttle({ auth: { limit: 5, ttl: 60000, blockDuration: 300000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset Password Customer (Rate limit: 5x/menit)' })
  resetCustomerPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('admin/auth/login')
  @Throttle({ auth: { limit: 5, ttl: 60000, blockDuration: 300000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login Administrator (Rate limit: 5x/menit)' })
  loginAdmin(@Body() dto: LoginDto) {
    return this.authService.login(dto, UserRole.ADMIN);
  }

  @Post('admin/auth/logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout Administrator (Revoke JWT di Redis)' })
  logoutAdmin(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user);
  }
}
