import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialEwalletSchema1732000000000 implements MigrationInterface {
  name = 'InitialEwalletSchema1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM ('CUSTOMER', 'ADMIN');`);
    await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED');`);
    await queryRunner.query(`CREATE TYPE "public"."transactions_type_enum" AS ENUM ('DEPOSIT', 'TRANSFER', 'QR_PAYMENT');`);
    await queryRunner.query(`CREATE TYPE "public"."transactions_status_enum" AS ENUM ('SUCCESS', 'FAILED');`);
    await queryRunner.query(`CREATE TYPE "public"."ledger_entries_entry_type_enum" AS ENUM ('DEBIT', 'CREDIT');`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "full_name" character varying(120) NOT NULL,
        "email" character varying(150) NOT NULL,
        "phone_number" character varying(20) NOT NULL,
        "password_hash" character varying NOT NULL,
        "role" "public"."users_role_enum" NOT NULL DEFAULT 'CUSTOMER',
        "status" "public"."users_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_phone_number" UNIQUE ("phone_number")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "account_number" character varying(20) NOT NULL,
        "balance" numeric(19, 2) NOT NULL DEFAULT '0',
        "currency" character varying(3) NOT NULL DEFAULT 'IDR',
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_wallets_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_wallets_account_number" UNIQUE ("account_number"),
        CONSTRAINT "CHK_wallets_balance_non_negative" CHECK ("balance" >= 0),
        CONSTRAINT "FK_wallets_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reference_no" character varying(40) NOT NULL,
        "idempotency_key" character varying(100) NOT NULL,
        "type" "public"."transactions_type_enum" NOT NULL,
        "amount" numeric(19, 2) NOT NULL,
        "status" "public"."transactions_status_enum" NOT NULL DEFAULT 'SUCCESS',
        "sender_wallet_id" uuid,
        "receiver_wallet_id" uuid,
        "description" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_transactions_reference_no" UNIQUE ("reference_no"),
        CONSTRAINT "UQ_transactions_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "CHK_transactions_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "FK_transactions_sender_wallet" FOREIGN KEY ("sender_wallet_id")
          REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_transactions_receiver_wallet" FOREIGN KEY ("receiver_wallet_id")
          REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_transactions_sender_created_at" ON "transactions" ("sender_wallet_id", "created_at" DESC);`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_receiver_created_at" ON "transactions" ("receiver_wallet_id", "created_at" DESC);`);

    await queryRunner.query(`
      CREATE TABLE "ledger_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "transaction_id" uuid NOT NULL,
        "wallet_id" uuid NOT NULL,
        "entry_type" "public"."ledger_entries_entry_type_enum" NOT NULL,
        "amount" numeric(19, 2) NOT NULL,
        "balance_before" numeric(19, 2) NOT NULL,
        "balance_after" numeric(19, 2) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_ledger_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "CHK_ledger_balances_non_negative" CHECK ("balance_before" >= 0 AND "balance_after" >= 0),
        CONSTRAINT "FK_ledger_entries_transaction" FOREIGN KEY ("transaction_id")
          REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_ledger_entries_wallet" FOREIGN KEY ("wallet_id")
          REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_ledger_entries_wallet_created_at" ON "ledger_entries" ("wallet_id", "created_at" DESC);`);
    await queryRunner.query(`CREATE INDEX "IDX_ledger_entries_transaction_id" ON "ledger_entries" ("transaction_id");`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_ledger_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Tabel ledger_entries bersifat immutable (append-only): operasi % tidak diizinkan', TG_OP;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_immutable_ledger_entries
      BEFORE UPDATE OR DELETE ON "ledger_entries"
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_id" uuid,
        "action" character varying(100) NOT NULL,
        "target_id" uuid,
        "metadata" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_actor_created_at" ON "audit_logs" ("actor_id", "created_at" DESC);`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_audit_logs_action";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_audit_logs_actor_created_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs";`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_immutable_ledger_entries ON "ledger_entries";`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_ledger_modification();`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ledger_entries_transaction_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_ledger_entries_wallet_created_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entries";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_transactions_receiver_created_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_transactions_sender_created_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "wallets";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);

    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ledger_entries_entry_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."transactions_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."transactions_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_role_enum";`);
  }
}
