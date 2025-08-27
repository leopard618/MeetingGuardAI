-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table with both manual and Google authentication support
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  google_id character varying(255) NULL,
  email character varying(255) NOT NULL,
  name character varying(255) NULL,
  picture text NULL,
  given_name character varying(255) NULL,
  family_name character varying(255) NULL,
  password_hash character varying(255) NULL, -- For manual authentication
  is_active boolean NULL DEFAULT true,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  last_login timestamp with time zone NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_google_id_key UNIQUE (google_id),
  -- Ensure either google_id or password_hash is present
  CONSTRAINT users_auth_method_check CHECK (
    (google_id IS NOT NULL) OR (password_hash IS NOT NULL)
  )
) TABLESPACE pg_default;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users USING btree (google_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON public.users USING btree (password_hash) TABLESPACE pg_default;

-- Create trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create user_tokens table for storing OAuth tokens
CREATE TABLE public.user_tokens (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NULL,
  expires_at timestamp with time zone NOT NULL,
  token_type character varying(50) NOT NULL DEFAULT 'google',
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT user_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT user_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_tokens_user_type_unique UNIQUE (user_id, token_type)
) TABLESPACE pg_default;

-- Create indexes for user_tokens
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id ON public.user_tokens USING btree (user_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_user_tokens_type ON public.user_tokens USING btree (token_type) TABLESPACE pg_default;

-- Create trigger for user_tokens updated_at
CREATE TRIGGER update_user_tokens_updated_at 
    BEFORE UPDATE ON user_tokens 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for users table
CREATE POLICY "Users can view their own data" ON public.users
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update their own data" ON public.users
    FOR UPDATE USING (auth.uid()::text = id::text);

CREATE POLICY "Allow service role full access" ON public.users
    FOR ALL USING (auth.role() = 'service_role');

-- Create RLS policies for user_tokens table
CREATE POLICY "Users can view their own tokens" ON public.user_tokens
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can manage their own tokens" ON public.user_tokens
    FOR ALL USING (auth.uid()::text = user_id::text);

CREATE POLICY "Allow service role full access to tokens" ON public.user_tokens
    FOR ALL USING (auth.role() = 'service_role');
