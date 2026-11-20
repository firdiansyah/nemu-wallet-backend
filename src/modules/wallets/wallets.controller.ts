import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiHeader,
} from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { DepositDto, TransferDto, TransactionQueryDto } from './wallet.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { Roles, CurrentUser, JwtPayload } from '../../common/decorators/auth.decorators';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Customer Wallet & Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('api/v1/customer')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'User Dashboard (Saldo IDR + 5 mutasi terbaru)' })
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.walletsService.getCustomerDashboard(user.sub);
  }

  @Post('wallets/deposit')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Deposit Balance (IDR) ke akun sendiri' })
  deposit(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DepositDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
  ) {
    return this.walletsService.depositBalance(user.sub, dto, idempotencyKey);
  }

  @Post('wallets/transfer')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Transfer Balance (IDR) ke Customer lain' })
  transfer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TransferDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
  ) {
    return this.walletsService.transferBalance(user.sub, dto, idempotencyKey);
  }

  @Post('payments/qr')
  @UseInterceptors(
    IdempotencyInterceptor,
    FileInterceptor('qrImage', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(png|jpeg|jpg)$/)) {
          return cb(new BadRequestException('Hanya file PNG/JPG yang diizinkan'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        qrImage: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Payment dengan upload gambar QR Code (IDR)' })
  payWithQr(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-idempotency-key') idempotencyKey: string,
  ) {
    return this.walletsService.payWithQrImage(user.sub, file?.buffer, idempotencyKey);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Riwayat Transaksi Customer (Pagination & Filter)' })
  getTransactions(@CurrentUser() user: JwtPayload, @Query() query: TransactionQueryDto) {
    return this.walletsService.getTransactionHistory(user.sub, query);
  }
}
