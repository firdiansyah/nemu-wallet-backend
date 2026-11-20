import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  TRANSFER = 'TRANSFER',
  QR_PAYMENT = 'QR_PAYMENT',
}

export enum TransactionStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Entity('transactions')
@Index(['senderWallet', 'createdAt'])
@Index(['receiverWallet', 'createdAt'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reference_no', unique: true, length: 40 })
  referenceNo: string;

  @Column({ name: 'idempotency_key', unique: true, length: 100 })
  idempotencyKey: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({
    type: 'numeric',
    precision: 19,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.SUCCESS })
  status: TransactionStatus;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'sender_wallet_id' })
  senderWallet: Wallet | null;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'receiver_wallet_id' })
  receiverWallet: Wallet | null;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
