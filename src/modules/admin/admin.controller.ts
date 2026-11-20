import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AdminService } from './admin.service';
import { ReconciliationAuditResponseDto } from './reconciliation.dto';
import { AuditLogQueryDto } from './audit-log.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, CurrentUser, JwtPayload } from '../../common/decorators/auth.decorators';
import { UserRole, UserStatus } from '../../database/entities/user.entity';

class UpdateStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;
}

@ApiTags('Administrator Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Administrator Dashboard (Statistik Likuiditas & Transaksi)' })
  getDashboard() {
    return this.adminService.getAdminDashboard();
  }

  @Get('customers')
  @ApiQuery({ name: 'search', required: false })
  @ApiOperation({ summary: 'Daftar & Pencarian seluruh Customer' })
  getCustomers(@Query('search') search?: string) {
    return this.adminService.listCustomers(search);
  }

  @Patch('customers/:id/status')
  @ApiBody({ schema: { properties: { status: { enum: ['ACTIVE', 'SUSPENDED'] } } } })
  @ApiOperation({ summary: 'Aktivasi atau Suspend akun Customer' })
  updateCustomerStatus(
    @CurrentUser() admin: JwtPayload,
    @Param('id') customerId: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.adminService.updateCustomerStatus(admin.sub, customerId, dto.status);
  }

  @Post('reconciliation/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Jalankan Audit Rekonsiliasi Saldo (Wallets vs Ledger Entries)' })
  @ApiOkResponse({ type: ReconciliationAuditResponseDto })
  runReconciliation(@CurrentUser() admin: JwtPayload): Promise<ReconciliationAuditResponseDto> {
    return this.adminService.runBalanceReconciliation(admin.sub);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Riwayat Audit Trail Sistem' })
  getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLogs(query);
  }
}
