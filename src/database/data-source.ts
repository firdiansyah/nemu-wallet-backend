import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { User } from './entities/user.entity';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { AuditLog } from './entities/audit-log.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER || 'ewallet_user',
  password: process.env.DB_PASS || 'ewallet_secret_password',
  database: process.env.DB_NAME || 'ewallet_db',
  entities: [User, Wallet, Transaction, LedgerEntry, AuditLog],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
});
