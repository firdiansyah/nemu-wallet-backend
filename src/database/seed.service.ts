import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { Wallet } from './entities/wallet.entity';
import { Transaction, TransactionType, TransactionStatus } from './entities/transaction.entity';
import { LedgerEntry, EntryType } from './entities/ledger-entry.entity';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
  ) {}

  async onApplicationBootstrap() {
    // 1. Default Administrator
    const adminEmail = 'admin@ewallet.id';
    if (!(await this.userRepo.findOne({ where: { email: adminEmail } }))) {
      await this.userRepo.save(
        this.userRepo.create({
          fullName: 'Super Admin E-Wallet',
          email: adminEmail,
          phoneNumber: '081100000001',
          passwordHash: await bcrypt.hash('Admin123!@#', 12),
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        }),
      );
      this.logger.log(`Seeded Default Admin: ${adminEmail} / Admin123!@#`);
    }

    // 2. Default Customer + Saldo Awal Rp 1.000.000 tercatat di Ledger
    const customerEmail = 'customer@ewallet.id';
    if (!(await this.userRepo.findOne({ where: { email: customerEmail } }))) {
      const customer = await this.userRepo.save(
        this.userRepo.create({
          fullName: 'Budi Santoso',
          email: customerEmail,
          phoneNumber: '081200000001',
          passwordHash: await bcrypt.hash('Customer123!@#', 12),
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
        }),
      );

      const wallet = await this.walletRepo.save(
        this.walletRepo.create({
          user: customer,
          accountNumber: '8801081200000001',
          balance: 1000000,
          currency: 'IDR',
        }),
      );

      const txRepo = this.userRepo.manager.getRepository(Transaction);
      const ledgerRepo = this.userRepo.manager.getRepository(LedgerEntry);

      const seedTx = await txRepo.save(
        txRepo.create({
          referenceNo: 'DEP-SEED-INITIAL-001',
          idempotencyKey: 'seed-initial-deposit-customer-001',
          type: TransactionType.DEPOSIT,
          amount: 1000000,
          status: TransactionStatus.SUCCESS,
          senderWallet: null,
          receiverWallet: wallet,
          description: 'Saldo Awal Akun Default Customer',
        }),
      );

      await ledgerRepo.save(
        ledgerRepo.create({
          transaction: seedTx,
          wallet,
          entryType: EntryType.CREDIT,
          amount: 1000000,
          balanceBefore: 0,
          balanceAfter: 1000000,
        }),
      );

      this.logger.log(`Seeded Default Customer: ${customerEmail} / Customer123!@#`);
    }

    // 3. Akun Merchant untuk Simulasi Upload QR Payment
    const merchantEmail = 'merchant@ewallet.id';
    if (!(await this.userRepo.findOne({ where: { email: merchantEmail } }))) {
      const merchant = await this.userRepo.save(
        this.userRepo.create({
          fullName: 'Kopi Nusantara Merchant',
          email: merchantEmail,
          phoneNumber: '081200000099',
          passwordHash: await bcrypt.hash('Merchant123!@#', 12),
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
        }),
      );
      await this.walletRepo.save(
        this.walletRepo.create({
          user: merchant,
          accountNumber: '8801081200000099',
          balance: 0,
          currency: 'IDR',
        }),
      );
    }
  }
}
