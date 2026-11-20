import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { Transaction } from '../../database/entities/transaction.entity';
import { AuditLog } from '../../database/entities/audit-log.entity';
import {
  ReconciliationAuditResponseDto,
  WalletDiscrepancyDto,
} from './reconciliation.dto';
import { AuditLogQueryDto } from './audit-log.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(Transaction) private readonly txRepo: Repository<Transaction>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async getAdminDashboard() {
    const totalCustomers = await this.userRepo.count({ where: { role: UserRole.CUSTOMER } });
    const activeCustomers = await this.userRepo.count({
      where: { role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
    });
    const suspendedCustomers = await this.userRepo.count({
      where: { role: UserRole.CUSTOMER, status: UserStatus.SUSPENDED },
    });

    const liquidityRaw = await this.walletRepo
      .createQueryBuilder('w')
      .select('COALESCE(SUM(w.balance), 0)', 'totalLiquidity')
      .getRawOne();

    const txStatsRaw = await this.txRepo
      .createQueryBuilder('tx')
      .select('COUNT(tx.id)', 'totalCount')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'totalVolume')
      .getRawOne();

    const recentTransactions = await this.txRepo.find({
      relations: {
        senderWallet: { user: true },
        receiverWallet: { user: true },
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return {
      metrics: {
        totalCustomers,
        activeCustomers,
        suspendedCustomers,
        totalLiquidityIdr: parseFloat(liquidityRaw.totalLiquidity),
        totalTransactionsCount: parseInt(txStatsRaw.totalCount, 10),
        totalTransactionsVolumeIdr: parseFloat(txStatsRaw.totalVolume),
      },
      recentTransactions: recentTransactions.map((tx) => ({
        id: tx.id,
        referenceNo: tx.referenceNo,
        type: tx.type,
        amount: tx.amount,
        sender: tx.senderWallet?.user?.fullName || 'Deposit System',
        receiver: tx.receiverWallet?.user?.fullName || '-',
        createdAt: tx.createdAt,
      })),
    };
  }

  async listCustomers(search?: string) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.wallet', 'w')
      .where('u.role = :role', { role: UserRole.CUSTOMER });

    if (search) {
      qb.andWhere(
        '(LOWER(u.fullName) LIKE :q OR LOWER(u.email) LIKE :q OR u.phoneNumber LIKE :q)',
        { q: `%${search.toLowerCase()}%` },
      );
    }

    const customers = await qb.orderBy('u.createdAt', 'DESC').getMany();

    return customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phoneNumber: c.phoneNumber,
      status: c.status,
      accountNumber: c.wallet?.accountNumber || '-',
      balance: c.wallet?.balance ?? 0,
      createdAt: c.createdAt,
    }));
  }

  async updateCustomerStatus(adminId: string, customerId: string, status: UserStatus) {
    const customer = await this.userRepo.findOne({
      where: { id: customerId, role: UserRole.CUSTOMER },
    });
    if (!customer) throw new NotFoundException('Customer tidak ditemukan');

    const previousStatus = customer.status;
    customer.status = status;
    await this.userRepo.save(customer);

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: adminId,
        action: 'ADMIN_UPDATE_CUSTOMER_STATUS',
        targetId: customer.id,
        metadata: { previousStatus, newStatus: status, email: customer.email },
      }),
    );

    return {
      message: `Status customer ${customer.fullName} berhasil diubah menjadi ${status}`,
      customerId: customer.id,
      status: customer.status,
    };
  }

  async runBalanceReconciliation(adminId: string): Promise<ReconciliationAuditResponseDto> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('REPEATABLE READ');

    try {
      const walletRows: Array<{
        walletId: string;
        accountNumber: string;
        customerName: string;
        customerEmail: string;
        recordedBalance: string;
        totalCredit: string;
        totalDebit: string;
        calculatedBalance: string;
        discrepancy: string;
      }> = await queryRunner.query(`
        WITH ledger_summary AS (
          SELECT
            wallet_id,
            COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
            COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE 0 END), 0) AS total_debit
          FROM ledger_entries
          GROUP BY wallet_id
        )
        SELECT
          w.id AS "walletId",
          w.account_number AS "accountNumber",
          u.full_name AS "customerName",
          u.email AS "customerEmail",
          w.balance::numeric(19, 2) AS "recordedBalance",
          COALESCE(ls.total_credit, 0)::numeric(19, 2) AS "totalCredit",
          COALESCE(ls.total_debit, 0)::numeric(19, 2) AS "totalDebit",
          (COALESCE(ls.total_credit, 0) - COALESCE(ls.total_debit, 0))::numeric(19, 2) AS "calculatedBalance",
          (w.balance - (COALESCE(ls.total_credit, 0) - COALESCE(ls.total_debit, 0)))::numeric(19, 2) AS "discrepancy"
        FROM wallets w
        INNER JOIN users u ON u.id = w.user_id
        LEFT JOIN ledger_summary ls ON ls.wallet_id = w.id
        ORDER BY ABS(w.balance - (COALESCE(ls.total_credit, 0) - COALESCE(ls.total_debit, 0))) DESC,
                 w.account_number ASC;
      `);

      const [internalCheck]: Array<{ internalCredit: string; internalDebit: string }> =
        await queryRunner.query(`
          SELECT
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0)::numeric(19, 2) AS "internalCredit",
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE 0 END), 0)::numeric(19, 2) AS "internalDebit"
          FROM ledger_entries le
          INNER JOIN transactions t ON t.id = le.transaction_id
          WHERE t.type IN ('TRANSFER', 'QR_PAYMENT')
            AND t.status = 'SUCCESS';
        `);

      await queryRunner.commitTransaction();

      let totalWalletBalanceIdr = 0;
      let totalLedgerNetBalanceIdr = 0;
      const discrepancies: WalletDiscrepancyDto[] = [];

      for (const row of walletRows) {
        const recordedBalance = parseFloat(row.recordedBalance);
        const totalCredit = parseFloat(row.totalCredit);
        const totalDebit = parseFloat(row.totalDebit);
        const calculatedBalance = parseFloat(row.calculatedBalance);
        const discrepancy = parseFloat(row.discrepancy);

        totalWalletBalanceIdr += recordedBalance;
        totalLedgerNetBalanceIdr += calculatedBalance;

        if (discrepancy !== 0) {
          discrepancies.push({
            walletId: row.walletId,
            accountNumber: row.accountNumber,
            customerName: row.customerName,
            customerEmail: row.customerEmail,
            recordedBalance,
            totalCredit,
            totalDebit,
            calculatedBalance,
            discrepancy,
          });
        }
      }

      const internalCredit = parseFloat(internalCheck?.internalCredit || '0');
      const internalDebit = parseFloat(internalCheck?.internalDebit || '0');
      const isInternalDoubleEntryBalanced = internalCredit === internalDebit;
      const systemVarianceIdr = Number((totalWalletBalanceIdr - totalLedgerNetBalanceIdr).toFixed(2));

      const isBalanced =
        discrepancies.length === 0 &&
        systemVarianceIdr === 0 &&
        isInternalDoubleEntryBalanced;

      const report: ReconciliationAuditResponseDto = {
        summary: {
          status: isBalanced ? 'BALANCED' : 'DISCREPANCY_DETECTED',
          auditedAt: new Date().toISOString(),
          totalWalletsAudited: walletRows.length,
          matchedWalletsCount: walletRows.length - discrepancies.length,
          mismatchedWalletsCount: discrepancies.length,
          totalWalletBalanceIdr,
          totalLedgerNetBalanceIdr,
          systemVarianceIdr,
          isInternalDoubleEntryBalanced,
        },
        discrepancies,
      };

      await this.auditRepo.save(
        this.auditRepo.create({
          actorId: adminId,
          action: 'ADMIN_RUN_BALANCE_RECONCILIATION',
          targetId: null,
          metadata: {
            status: report.summary.status,
            totalWalletsAudited: report.summary.totalWalletsAudited,
            mismatchedWalletsCount: report.summary.mismatchedWalletsCount,
            systemVarianceIdr: report.summary.systemVarianceIdr,
          },
        }),
      );

      return report;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async getAuditLogs(query: AuditLogQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 15;

    const qb = this.auditRepo
      .createQueryBuilder('log')
      .leftJoinAndMapOne('log.actor', User, 'actor', 'actor.id = log.actorId')
      .leftJoinAndMapOne('log.target', User, 'target', 'target.id = log.targetId');

    if (query.action) {
      if (query.action === 'LOGOUT') {
        qb.andWhere('log.action LIKE :logoutPattern', { logoutPattern: '%_LOGOUT' });
      } else {
        qb.andWhere('log.action = :action', { action: query.action });
      }
    }

    if (query.search && query.search.trim() !== '') {
      const q = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(actor.fullName) LIKE :q OR
          LOWER(actor.email) LIKE :q OR
          LOWER(target.fullName) LIKE :q OR
          LOWER(target.email) LIKE :q OR
          LOWER(CAST(log.metadata AS TEXT)) LIKE :q
        )`,
        { q },
      );
    }

    if (query.startDate) {
      qb.andWhere('log.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }

    if (query.endDate) {
      qb.andWhere('log.createdAt <= :endDate', { endDate: new Date(query.endDate) });
    }

    const [rows, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const data = rows.map((row: any) => ({
      id: row.id,
      action: row.action,
      actor: row.actor
        ? {
            id: row.actor.id,
            fullName: row.actor.fullName,
            email: row.actor.email,
            role: row.actor.role,
          }
        : null,
      target: row.target
        ? {
            id: row.target.id,
            fullName: row.target.fullName,
            email: row.target.email,
            role: row.target.role,
          }
        : null,
      metadata: row.metadata || null,
      createdAt: row.createdAt,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    };
  }
}
