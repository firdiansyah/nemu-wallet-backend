import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import Jimp from 'jimp';
import jsQR from 'jsqr';
import { Wallet } from '../../database/entities/wallet.entity';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
} from '../../database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../../database/entities/ledger-entry.entity';
import { UserStatus } from '../../database/entities/user.entity';
import { DepositDto, TransferDto, TransactionQueryDto } from './wallet.dto';

@Injectable()
export class WalletsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(Transaction) private readonly txRepo: Repository<Transaction>,
  ) {}

  async getCustomerDashboard(userId: string) {
    const wallet = await this.walletRepo.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
    });
    if (!wallet) throw new NotFoundException('Wallet customer tidak ditemukan');

    const recentTransactions = await this.txRepo
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.senderWallet', 'senderWallet')
      .leftJoinAndSelect('senderWallet.user', 'senderUser')
      .leftJoinAndSelect('tx.receiverWallet', 'receiverWallet')
      .leftJoinAndSelect('receiverWallet.user', 'receiverUser')
      .where('senderWallet.id = :walletId OR receiverWallet.id = :walletId', {
        walletId: wallet.id,
      })
      .orderBy('tx.createdAt', 'DESC')
      .take(5)
      .getMany();

    return {
      profile: {
        id: wallet.user.id,
        fullName: wallet.user.fullName,
        email: wallet.user.email,
        phoneNumber: wallet.user.phoneNumber,
      },
      wallet: {
        id: wallet.id,
        accountNumber: wallet.accountNumber,
        balance: wallet.balance,
        currency: wallet.currency,
      },
      recentTransactions: recentTransactions.map((tx) => this.formatTxForWallet(tx, wallet.id)),
    };
  }

  async depositBalance(userId: string, dto: DepositDto, idempotencyKey: string) {
    const key = idempotencyKey || uuidv4();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { idempotencyKey: key },
      });
      if (existing) {
        await queryRunner.rollbackTransaction();
        return { message: 'Transaksi sudah diproses sebelumnya', transaction: existing };
      }

      const walletMeta = await queryRunner.manager.findOne(Wallet, {
        where: { user: { id: userId } },
      });
      if (!walletMeta) throw new NotFoundException('Wallet tidak ditemukan');

      const wallet = await queryRunner.manager
        .createQueryBuilder(Wallet, 'w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id: walletMeta.id })
        .getOneOrFail();

      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + Number(dto.amount);
      wallet.balance = balanceAfter;
      await queryRunner.manager.save(wallet);

      const tx = queryRunner.manager.create(Transaction, {
        referenceNo: `DEP-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`,
        idempotencyKey: key,
        type: TransactionType.DEPOSIT,
        amount: dto.amount,
        status: TransactionStatus.SUCCESS,
        senderWallet: null,
        receiverWallet: wallet,
        description: `Deposit Saldo via ${dto.channel || 'Instant Top-Up'}`,
      });
      const savedTx = await queryRunner.manager.save(tx);

      const creditEntry = queryRunner.manager.create(LedgerEntry, {
        transaction: savedTx,
        wallet,
        entryType: EntryType.CREDIT,
        amount: dto.amount,
        balanceBefore,
        balanceAfter,
      });
      await queryRunner.manager.save(creditEntry);

      await queryRunner.commitTransaction();
      return {
        message: 'Deposit saldo berhasil',
        referenceNo: savedTx.referenceNo,
        amount: savedTx.amount,
        newBalance: balanceAfter,
        currency: 'IDR',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async transferBalance(
    senderUserId: string,
    dto: TransferDto,
    idempotencyKey: string,
    txType: TransactionType = TransactionType.TRANSFER,
  ) {
    const key = idempotencyKey || uuidv4();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const existing = await queryRunner.manager.findOne(Transaction, {
        where: { idempotencyKey: key },
      });
      if (existing) {
        await queryRunner.rollbackTransaction();
        return { message: 'Transaksi sudah diproses sebelumnya', transaction: existing };
      }

      const senderMeta = await queryRunner.manager.findOne(Wallet, {
        where: { user: { id: senderUserId } },
        relations: { user: true },
      });

      const receiverMeta = await queryRunner.manager
        .createQueryBuilder(Wallet, 'w')
        .leftJoinAndSelect('w.user', 'u')
        .where(
          'u.email = :id OR u.phoneNumber = :id OR w.accountNumber = :id',
          { id: dto.recipientIdentifier.trim() },
        )
        .getOne();

      if (!senderMeta) throw new NotFoundException('Wallet pengirim tidak ditemukan');
      if (!receiverMeta) throw new NotFoundException('Akun customer tujuan tidak ditemukan');
      if (receiverMeta.user.status === UserStatus.SUSPENDED) {
        throw new BadRequestException('Akun tujuan sedang ditangguhkan dan tidak dapat menerima dana');
      }
      if (senderMeta.id === receiverMeta.id) {
        throw new BadRequestException('Tidak dapat mengirim saldo ke wallet sendiri');
      }

      const sortedIds = [senderMeta.id, receiverMeta.id].sort();
      const lockedWallets = await queryRunner.manager
        .createQueryBuilder(Wallet, 'w')
        .setLock('pessimistic_write')
        .where('w.id IN (:...ids)', { ids: sortedIds })
        .getMany();

      const senderWallet = lockedWallets.find((w) => w.id === senderMeta.id)!;
      const receiverWallet = lockedWallets.find((w) => w.id === receiverMeta.id)!;

      const senderBefore = Number(senderWallet.balance);
      const receiverBefore = Number(receiverWallet.balance);

      if (senderBefore < dto.amount) {
        throw new BadRequestException('Saldo Rupiah tidak mencukupi untuk transaksi ini');
      }

      const senderAfter = senderBefore - Number(dto.amount);
      const receiverAfter = receiverBefore + Number(dto.amount);

      senderWallet.balance = senderAfter;
      receiverWallet.balance = receiverAfter;
      await queryRunner.manager.save([senderWallet, receiverWallet]);

      const prefix = txType === TransactionType.QR_PAYMENT ? 'QRP' : 'TRF';
      const tx = queryRunner.manager.create(Transaction, {
        referenceNo: `${prefix}-${Date.now()}-${uuidv4().slice(0, 6).toUpperCase()}`,
        idempotencyKey: key,
        type: txType,
        amount: dto.amount,
        status: TransactionStatus.SUCCESS,
        senderWallet,
        receiverWallet,
        description: dto.note || `Transfer ke ${receiverMeta.user.fullName}`,
      });
      const savedTx = await queryRunner.manager.save(tx);

      const debitEntry = queryRunner.manager.create(LedgerEntry, {
        transaction: savedTx,
        wallet: senderWallet,
        entryType: EntryType.DEBIT,
        amount: dto.amount,
        balanceBefore: senderBefore,
        balanceAfter: senderAfter,
      });
      const creditEntry = queryRunner.manager.create(LedgerEntry, {
        transaction: savedTx,
        wallet: receiverWallet,
        entryType: EntryType.CREDIT,
        amount: dto.amount,
        balanceBefore: receiverBefore,
        balanceAfter: receiverAfter,
      });
      await queryRunner.manager.save([debitEntry, creditEntry]);

      await queryRunner.commitTransaction();

      return {
        message:
          txType === TransactionType.QR_PAYMENT
            ? 'Pembayaran QR berhasil'
            : 'Transfer saldo berhasil',
        referenceNo: savedTx.referenceNo,
        recipientName: receiverMeta.user.fullName,
        amount: savedTx.amount,
        newBalance: senderAfter,
        currency: 'IDR',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async payWithQrImage(userId: string, fileBuffer: Buffer, idempotencyKey: string) {
    if (!fileBuffer) {
      throw new BadRequestException('File gambar QR Code wajib diunggah');
    }

    let qrText: string;
    try {
      const image = await Jimp.read(fileBuffer);
      const { data, width, height } = image.bitmap;
      const decoded = jsQR(new Uint8ClampedArray(data), width, height);
      if (!decoded || !decoded.data) {
        throw new Error('QR tidak terbaca');
      }
      qrText = decoded.data;
    } catch {
      throw new BadRequestException('Gambar tidak berisi QR Code yang valid atau gambar buram');
    }

    let payload: { recipient?: string; amount?: number; merchantName?: string };
    try {
      payload = JSON.parse(qrText);
    } catch {
      throw new BadRequestException(
        'Format QR Code tidak sesuai standar E-Wallet (wajib JSON dengan recipient & amount)',
      );
    }

    if (!payload.recipient || !payload.amount || Number(payload.amount) <= 0) {
      throw new BadRequestException('Payload QR Code tidak memiliki tujuan atau nominal valid');
    }

    return this.transferBalance(
      userId,
      {
        recipientIdentifier: payload.recipient,
        amount: Number(payload.amount),
        note: `QR Payment - ${payload.merchantName || payload.recipient}`,
      },
      idempotencyKey,
      TransactionType.QR_PAYMENT,
    );
  }

  async getTransactionHistory(userId: string, query: TransactionQueryDto) {
    const wallet = await this.walletRepo.findOne({ where: { user: { id: userId } } });
    if (!wallet) throw new NotFoundException('Wallet tidak ditemukan');

    const page = query.page || 1;
    const limit = query.limit || 10;

    const qb = this.txRepo
      .createQueryBuilder('tx')
      .leftJoinAndSelect('tx.senderWallet', 'senderWallet')
      .leftJoinAndSelect('senderWallet.user', 'senderUser')
      .leftJoinAndSelect('tx.receiverWallet', 'receiverWallet')
      .leftJoinAndSelect('receiverWallet.user', 'receiverUser')
      .where('(senderWallet.id = :walletId OR receiverWallet.id = :walletId)', {
        walletId: wallet.id,
      });

    if (query.type) {
      qb.andWhere('tx.type = :type', { type: query.type });
    }

    const [items, total] = await qb
      .orderBy('tx.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: items.map((tx) => this.formatTxForWallet(tx, wallet.id)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private formatTxForWallet(tx: Transaction, currentWalletId: string) {
    const isIncoming = tx.receiverWallet?.id === currentWalletId;
    return {
      id: tx.id,
      referenceNo: tx.referenceNo,
      type: tx.type,
      direction: isIncoming ? 'IN' : 'OUT',
      amount: tx.amount,
      status: tx.status,
      counterparty: isIncoming
        ? tx.senderWallet?.user?.fullName || 'Top-Up Sistem'
        : tx.receiverWallet?.user?.fullName || '-',
      description: tx.description,
      createdAt: tx.createdAt,
    };
  }
}
