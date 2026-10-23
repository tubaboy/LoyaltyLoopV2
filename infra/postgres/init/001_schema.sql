CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE account_role AS ENUM ('admin', 'merchant');
CREATE TYPE account_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE loyalty_option_type AS ENUM ('add', 'redeem');
CREATE TYPE point_transaction_type AS ENUM ('add', 'redeem', 'manual_redeem', 'adjustment');
CREATE TYPE actor_type AS ENUM ('merchant', 'terminal', 'admin', 'system', 'import');

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role account_role NOT NULL,
  status account_status NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  store_code varchar(4) NOT NULL UNIQUE,
  contact_person text,
  contact_phone text,
  contact_address text,
  tax_id varchar(8),
  status account_status NOT NULL DEFAULT 'active',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  legacy_source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchant_members (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  membership_role text NOT NULL DEFAULT 'owner' CHECK (membership_role IN ('owner', 'manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, merchant_id)
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Taipei',
  legacy_source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('logo', 'screensaver', 'collection_sound', 'redemption_sound', 'other')),
  object_key text NOT NULL UNIQUE,
  original_name text,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  daily_redemption_limit smallint NOT NULL DEFAULT 2 CHECK (daily_redemption_limit BETWEEN 0 AND 10),
  theme_color text NOT NULL DEFAULT 'teal',
  reset_interval integer NOT NULL DEFAULT 10 CHECK (reset_interval >= 0),
  reminder_interval integer NOT NULL DEFAULT 10 CHECK (reminder_interval >= 0),
  enable_confetti boolean NOT NULL DEFAULT true,
  enable_sound boolean NOT NULL DEFAULT true,
  point_collection_effect text NOT NULL DEFAULT 'shower',
  redemption_effect text NOT NULL DEFAULT 'confetti',
  screensaver_timeout integer NOT NULL DEFAULT 0 CHECK (screensaver_timeout >= 0),
  logo_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  screensaver_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  collection_sound_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  redemption_sound_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terminal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX terminal_credentials_one_active_per_branch
  ON terminal_credentials(branch_id)
  WHERE is_active = true;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  phone_normalized text NOT NULL,
  phone_display text NOT NULL,
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  legacy_source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, phone_normalized)
);

CREATE TABLE loyalty_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  type loyalty_option_type NOT NULL,
  label text NOT NULL,
  value_points integer NOT NULL CHECK (value_points > 0),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE point_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type point_transaction_type NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  actor_type actor_type NOT NULL,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terminal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX branches_merchant_id_idx ON branches(merchant_id);
CREATE INDEX customers_merchant_id_idx ON customers(merchant_id);
CREATE INDEX point_transactions_merchant_created_idx ON point_transactions(merchant_id, created_at DESC);
CREATE INDEX point_transactions_customer_created_idx ON point_transactions(customer_id, created_at DESC);
CREATE INDEX sessions_account_id_idx ON sessions(account_id);
CREATE INDEX terminal_sessions_branch_id_idx ON terminal_sessions(branch_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER merchants_set_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER branches_set_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER branch_settings_set_updated_at
  BEFORE UPDATE ON branch_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER loyalty_options_set_updated_at
  BEFORE UPDATE ON loyalty_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

