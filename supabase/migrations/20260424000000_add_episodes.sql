-- pgvector拡張
CREATE EXTENSION IF NOT EXISTS vector;

-- episodesテーブル
CREATE TABLE public.episodes (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES public.users(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES public.sessions(id) ON DELETE CASCADE,  -- 現フローではNULL可
  occurred_at     timestamptz DEFAULT now(),

  topic           text NOT NULL,
  summary         text NOT NULL,
  emotion         text,

  followup        text,
  followup_done   boolean DEFAULT false,

  embedding       vector(1536),
  importance      int DEFAULT 1,

  created_at      timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX episodes_user_id_idx ON public.episodes(user_id);
CREATE INDEX episodes_occurred_at_idx ON public.episodes(occurred_at DESC);
CREATE INDEX episodes_embedding_idx ON public.episodes
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ユーザー自身のみアクセス可能" ON public.episodes
  FOR ALL USING (auth.uid() = user_id);

-- ベクトル類似検索用RPC（service_roleで呼ぶためSECURITY DEFINER）
CREATE OR REPLACE FUNCTION match_episodes(
  query_embedding vector(1536),
  match_user_id   uuid,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id            uuid,
  topic         text,
  summary       text,
  emotion       text,
  followup      text,
  followup_done boolean,
  occurred_at   timestamptz,
  importance    int,
  similarity    float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.topic,
    e.summary,
    e.emotion,
    e.followup,
    e.followup_done,
    e.occurred_at,
    e.importance,
    (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM public.episodes e
  WHERE e.user_id = match_user_id
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
