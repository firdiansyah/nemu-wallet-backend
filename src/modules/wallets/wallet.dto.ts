import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, Min, Max, IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType } from '../../database/entities/transaction.entity';

export class DepositDto {
  @ApiProperty({ example: 250000, description: 'Nominal deposit dalam Rupiah (IDR)' })
  @IsNumber()
  @Min(10000, { message: 'Minimal deposit Rp 10.000' })
  @Max(50000000, { message: 'Maksimal deposit Rp 50.000.000 per transaksi' })
  amount: number;

  @ApiPropertyOptional({ example: 'Virtual Account BCA' })
  @IsOptional()
  @IsString()
  channel?: string;
}

export class TransferDto {
  @ApiProperty({ example: 'merchant@ewallet.id', description: 'Email atau Nomor HP atau No Wallet tujuan' })
  @IsString()
  @IsNotEmpty()
  recipientIdentifier: string;

  @ApiProperty({ example: 50000, description: 'Nominal transfer dalam Rupiah (IDR)' })
  @IsNumber()
  @Min(1000, { message: 'Minimal transfer Rp 1.000' })
  amount: number;

  @ApiPropertyOptional({ example: 'Patungan makan siang' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
