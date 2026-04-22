-- users テーブルに personality_type を追加
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS personality_type TEXT;
