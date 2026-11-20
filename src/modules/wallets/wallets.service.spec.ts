import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as QRCode from 'qrcode';
import Jimp from 'jimp';
import { WalletsService } from './wallets.service';
import { Wallet } from '../../database/entities/wallet.entity';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
} from '../../database/entities/transaction.entity';
import { UserStatus } from '../../database/entities/user.entity';

describe('WalletsService (Unit Tests)', () => {
  let service: WalletsService;

  const mockQueryBuilder: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn(),
  };

  const mockManager = {
    findOne: jest.fn(),
    create: jest.fn((_, dto) => dto),
    save: jest.fn((entity) => Promise.resolve({ id: 'generated-uuid', ...entity })),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: mockManager,
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(() => mockQueryRunner),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(Wallet), useValue: {} },
        { provide: getRepositoryToken(Transaction), useValue: {} },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  describe('transferBalance() - Concurrency & Integrity Guards', () => {
    it('harus mengembalikan transaksi lama tanpa memotong saldo ulang jika X-Idempotency-Key sudah ada', async () => {
      const existingTx = {
        id: 'tx-existing-1',
        referenceNo: 'TRF-17000000-ABC123',
        amount: 50000,
        status: TransactionStatus.SUCCESS,
      };
      mockManager.findOne.mockResolvedValueOnce(existingTx);

      const result = await service.transferBalance(
        'user-sender-1',
        { recipientIdentifier: 'budi@ewallet.id', amount: 50000 },
        'idem-key-duplicate-001',
      );

      expect(result).toEqual({
        message: 'Transaksi sudah diproses sebelumnya',
        transaction: existingTx,
      });
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('harus mengunci baris wallet (pessimistic_write) berdasarkan urutan UUID ascending untuk mencegah deadlock', async () => {
      const senderWalletId = 'ffffffff-0000-0000-0000-000000000002';
      const receiverWalletId = '11111111-0000-0000-0000-000000000001';

      mockManager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: senderWalletId,
          balance: 200000,
          user: { id: 'sender-user', fullName: 'Pengirim', status: UserStatus.ACTIVE },
        });

      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: receiverWalletId,
        balance: 50000,
        user: { id: 'receiver-user', fullName: 'Penerima', status: UserStatus.ACTIVE },
      });

      mockQueryBuilder.getMany.mockResolvedValueOnce([
        { id: receiverWalletId, balance: 50000 },
        { id: senderWalletId, balance: 200000 },
      ]);

      await service.transferBalance(
        'sender-user',
        { recipientIdentifier: 'receiver@ewallet.id', amount: 75000 },
        'idem-key-lock-order',
      );

      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('w.id IN (:...ids)', {
        ids: [receiverWalletId, senderWalletId],
      });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('harus melakukan rollback jika saldo pengirim tidak mencukupi', async () => {
      mockManager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'wallet-a',
          balance: 20000,
          user: { id: 'user-a', status: UserStatus.ACTIVE },
        });

      mockQueryBuilder.getOne.mockResolvedValueOnce({
        id: 'wallet-b',
        balance: 0,
        user: { id: 'user-b', status: UserStatus.ACTIVE },
      });

      mockQueryBuilder.getMany.mockResolvedValueOnce([
        { id: 'wallet-a', balance: 20000 },
        { id: 'wallet-b', balance: 0 },
      ]);

      await expect(
        service.transferBalance(
          'user-a',
          { recipientIdentifier: 'userb@ewallet.id', amount: 50000 },
          'idem-insufficient',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('payWithQrImage() - Validasi Dekode Gambar QR Code', () => {
    it('harus gagal jika gambar PNG polos tanpa pola QR Code', async () => {
      const blankImage = new Jimp(200, 200, 0xffffffff);
      const blankPngBuffer = await blankImage.getBufferAsync(Jimp.MIME_PNG);

      await expect(
        service.payWithQrImage('user-a', blankPngBuffer, 'idem-qr-blank'),
      ).rejects.toThrow('Gambar tidak berisi QR Code yang valid atau gambar buram');
    });

    it('harus berhasil mem-parsing QR Code valid dan meneruskannya ke transferBalance sebagai QR_PAYMENT', async () => {
      const validQrBuffer = await QRCode.toBuffer(
        JSON.stringify({
          merchantName: 'Kopi Nusantara',
          recipient: 'merchant@ewallet.id',
          amount: 35000,
        }),
      );

      const transferSpy = jest.spyOn(service, 'transferBalance').mockResolvedValueOnce({
        message: 'Pembayaran QR berhasil',
        referenceNo: 'QRP-17000001-XYZ999',
        recipientName: 'Kopi Nusantara Merchant',
        amount: 35000,
        newBalance: 965000,
        currency: 'IDR',
      });

      const response = await service.payWithQrImage('user-a', validQrBuffer, 'idem-qr-valid');

      expect(transferSpy).toHaveBeenCalledWith(
        'user-a',
        {
          recipientIdentifier: 'merchant@ewallet.id',
          amount: 35000,
          note: 'QR Payment - Kopi Nusantara',
        },
        'idem-qr-valid',
        TransactionType.QR_PAYMENT,
      );
      expect(response.referenceNo).toContain('QRP-');
    });
  });
});
