import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { Wallet } from './wallet.entity';

export enum EntryType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

@Entity('ledger_entries')
@Index(['wallet', 'createdAt'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Transaction)
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column({ name: 'entry_type', type: 'enum', enum: EntryType })
  entryType: EntryType;

  @Column({
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  amount: number;

  @Column({
    name: 'balance_before',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  balanceBefore: number;

  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => parseFloat(v),
    },
  })
  balanceAfter: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
