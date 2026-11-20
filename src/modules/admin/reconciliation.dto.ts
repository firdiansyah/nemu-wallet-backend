import { ApiProperty } from '@nestjs/swagger';

export class WalletDiscrepancyDto {
  @ApiProperty()
  walletId: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  customerName: string;

  @ApiProperty()
  customerEmail: string;

  @ApiProperty()
  recordedBalance: number;

  @ApiProperty()
  totalCredit: number;

  @ApiProperty()
  totalDebit: number;

  @ApiProperty()
  calculatedBalance: number;

  @ApiProperty()
  discrepancy: number;
}

export class ReconciliationSummaryDto {
  @ApiProperty({ enum: ['BALANCED', 'DISCREPANCY_DETECTED'] })
  status: 'BALANCED' | 'DISCREPANCY_DETECTED';

  @ApiProperty()
  auditedAt: string;

  @ApiProperty()
  totalWalletsAudited: number;

  @ApiProperty()
  matchedWalletsCount: number;

  @ApiProperty()
  mismatchedWalletsCount: number;

  @ApiProperty()
  totalWalletBalanceIdr: number;

  @ApiProperty()
  totalLedgerNetBalanceIdr: number;

  @ApiProperty()
  systemVarianceIdr: number;

  @ApiProperty()
  isInternalDoubleEntryBalanced: boolean;
}

export class ReconciliationAuditResponseDto {
  @ApiProperty({ type: ReconciliationSummaryDto })
  summary: ReconciliationSummaryDto;

  @ApiProperty({ type: [WalletDiscrepancyDto] })
  discrepancies: WalletDiscrepancyDto[];
}
