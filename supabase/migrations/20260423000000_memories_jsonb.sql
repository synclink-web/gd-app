-- key_statements を text[] → jsonb に変更
-- （既存データは NULL にリセット。本番運用前なので問題なし）
ALTER TABLE public.memories
  ALTER COLUMN key_statements TYPE jsonb
  USING NULL;
