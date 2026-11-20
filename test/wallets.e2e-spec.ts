import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import Jimp from 'jimp';
import { v4 as uuidv4 } from 'uuid';

import { AppModule } from '../src/app.module';
import { User, UserRole, UserStatus } from '../src/database/entities/user.entity';
import { Wallet } from '../src/database/entities/wallet.entity';
import { Transaction } from '../src/database/entities/transaction.entity';
import { LedgerEntry, EntryType } from '../src/database/entities/ledger-entry.entity';
import { RedisService } from '../src/common/redis/redis.service';

describe('E-Wallet Concurrency & QR Upload Integration Tests (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redisService: RedisService;
  let userRepo: Repository<User>;
  let walletRepo: Repository<Wallet>;
  let txRepo: Repository<Transaction>;
  let ledgerRepo: Repository<LedgerEntry>;

  let customerAToken: string;
  let customerBToken: string;
  let customerAId: string;
  let customerBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);
    redisService = moduleFixture.get<RedisService>(RedisService);
    userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    walletRepo = moduleFixture.get<Repository<Wallet>>(getRepositoryToken(Wallet));
    txRepo = moduleFixture.get<Repository<Transaction>>(getRepositoryToken(Transaction));
    ledgerRepo = moduleFixture.get<Repository<LedgerEntry>>(getRepositoryToken(LedgerEntry));
  });

  beforeEach(async () => {
    await redisService.flushTestKeys();
    await dataSource.query('TRUNCATE TABLE ledger_entries, transactions, audit_logs, wallets, users CASCADE');

    const passHash = await bcrypt.hash('Test1234!', 10);

    const userA = await userRepo.save(
      userRepo.create({
        fullName: 'Customer Alpha',
        email: 'alpha@ewallet.id',
        phoneNumber: '081211111111',
        passwordHash: passHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      }),
    );
    customerAId = userA.id;
    await walletRepo.save(
      walletRepo.create({
        user: userA,
        accountNumber: '8801081211111111',
        balance: 100000,
        currency: 'IDR',
      }),
    );

    const userB = await userRepo.save(
      userRepo.create({
        fullName: 'Customer Beta',
        email: 'beta@ewallet.id',
        phoneNumber: '081222222222',
        passwordHash: passHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      }),
    );
    customerBId = userB.id;
    await walletRepo.save(
      walletRepo.create({
        user: userB,
        accountNumber: '8801081222222222',
        balance: 50000,
        currency: 'IDR',
      }),
    );

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/customer/auth/login')
      .send({ email: 'alpha@ewallet.id', password: 'Test1234!' });
    customerAToken = loginA.body.accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/customer/auth/login')
      .send({ email: 'beta@ewallet.id', password: 'Test1234!' });
    customerBToken = loginB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Pengujian Race Condition pada transferBalance', () => {
    it('harus mencegah double-spending saat 5 request transfer Rp 60.000 dikirim bersamaan dari saldo Rp 100.000', async () => {
      const concurrentRequests = Array.from({ length: 5 }).map(() =>
        request(app.getHttpServer())
          .post('/api/v1/customer/wallets/transfer')
          .set('Authorization', `Bearer ${customerAToken}`)
          .set('X-Idempotency-Key', uuidv4())
          .send({
            recipientIdentifier: 'beta@ewallet.id',
            amount: 60000,
            note: 'Concurrent double-spend test',
          }),
      );

      const responses = await Promise.all(concurrentRequests);
      const succeeded = responses.filter((r) => r.status === 201);
      const failed = responses.filter((r) => r.status !== 201);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(4);

      const walletA = await walletRepo.findOneOrFail({ where: { user: { id: customerAId } } });
      const walletB = await walletRepo.findOneOrFail({ where: { user: { id: customerBId } } });

      expect(walletA.balance).toBe(40000);
      expect(walletB.balance).toBe(110000);

      const entries = await ledgerRepo.find();
      const totalDebit = entries
        .filter((e) => e.entryType === EntryType.DEBIT)
        .reduce((acc, cur) => acc + cur.amount, 0);
      const totalCredit = entries
        .filter((e) => e.entryType === EntryType.CREDIT)
        .reduce((acc, cur) => acc + cur.amount, 0);

      expect(totalDebit).toBe(60000);
      expect(totalCredit).toBe(60000);
    });

    it('harus mengeksekusi transfer dua arah (A -> B dan B -> A) secara bersamaan tanpa deadlock', async () => {
      const [resAtoB, resBtoA] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/customer/wallets/transfer')
          .set('Authorization', `Bearer ${customerAToken}`)
          .set('X-Idempotency-Key', uuidv4())
          .send({ recipientIdentifier: 'beta@ewallet.id', amount: 30000 }),
        request(app.getHttpServer())
          .post('/api/v1/customer/wallets/transfer')
          .set('Authorization', `Bearer ${customerBToken}`)
          .set('X-Idempotency-Key', uuidv4())
          .send({ recipientIdentifier: 'alpha@ewallet.id', amount: 20000 }),
      ]);

      expect(resAtoB.status).toBe(201);
      expect(resBtoA.status).toBe(201);

      const walletA = await walletRepo.findOneOrFail({ where: { user: { id: customerAId } } });
      const walletB = await walletRepo.findOneOrFail({ where: { user: { id: customerBId } } });

      expect(walletA.balance).toBe(90000);
      expect(walletB.balance).toBe(60000);
    });
  });

  describe('2. Pengujian Validasi Upload QR Code (/api/v1/customer/payments/qr)', () => {
    it('harus menolak gambar PNG polos yang tidak memiliki QR Code (HTTP 400)', async () => {
      const blankImg = new Jimp(150, 150, 0xffffffff);
      const blankBuffer = await blankImg.getBufferAsync(Jimp.MIME_PNG);

      const res = await request(app.getHttpServer())
        .post('/api/v1/customer/payments/qr')
        .set('Authorization', `Bearer ${customerAToken}`)
        .attach('qrImage', blankBuffer, {
          filename: 'blank.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Gambar tidak berisi QR Code yang valid');
    });

    it('harus memproses pembayaran QR valid dan memperbarui saldo pengirim & penerima secara atomik (HTTP 201)', async () => {
      const qrPayload = JSON.stringify({
        merchantName: 'Warung Kopi Beta',
        recipient: 'beta@ewallet.id',
        amount: 35000,
      });
      const validQrPng = await QRCode.toBuffer(qrPayload, { width: 250 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/customer/payments/qr')
        .set('Authorization', `Bearer ${customerAToken}`)
        .set('X-Idempotency-Key', uuidv4())
        .attach('qrImage', validQrPng, {
          filename: 'qr-merchant.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(201);
      expect(res.body.referenceNo).toMatch(/^QRP-/);
      expect(res.body.amount).toBe(35000);
      expect(res.body.newBalance).toBe(65000);

      const walletB = await walletRepo.findOneOrFail({ where: { user: { id: customerBId } } });
      expect(walletB.balance).toBe(85000);
    });
  });
});
