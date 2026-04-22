-- =============================================
-- 1. users
-- =============================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  tone_preference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: select own" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users: insert own" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "users: update own" ON public.users
  FOR UPDATE USING (auth.uid() = id);


-- =============================================
-- 2. memories
-- =============================================
CREATE TABLE public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  frequent_topics TEXT[],
  emotion_state TEXT,
  key_statements TEXT[],
  past_insights TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memories: select own" ON public.memories
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "memories: insert own" ON public.memories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "memories: update own" ON public.memories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "memories: delete own" ON public.memories
  FOR DELETE USING (auth.uid() = user_id);


-- =============================================
-- 3. buddy_stats
-- =============================================
CREATE TABLE public.buddy_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  intimacy INTEGER NOT NULL DEFAULT 0,
  understanding INTEGER NOT NULL DEFAULT 0,
  engagement INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  streak_days INTEGER NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.buddy_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buddy_stats: select own" ON public.buddy_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "buddy_stats: insert own" ON public.buddy_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "buddy_stats: update own" ON public.buddy_stats
  FOR UPDATE USING (auth.uid() = user_id);


-- =============================================
-- 4. sessions
-- =============================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  turn_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  insights TEXT[],
  next_step TEXT,
  emotion_detected TEXT
);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: select own" ON public.sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "sessions: insert own" ON public.sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sessions: update own" ON public.sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "sessions: delete own" ON public.sessions
  FOR DELETE USING (auth.uid() = user_id);


-- =============================================
-- 5. messages
-- =============================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT,
  audio_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages: select own sessions" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sessions
      WHERE sessions.id = messages.session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "messages: insert own sessions" ON public.messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions
      WHERE sessions.id = messages.session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "messages: delete own sessions" ON public.messages
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.sessions
      WHERE sessions.id = messages.session_id
        AND sessions.user_id = auth.uid()
    )
  );


-- =============================================
-- 6. onboarding_answers
-- =============================================
CREATE TABLE public.onboarding_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  q1_use_purpose TEXT,
  q2_personality_pref TEXT,
  q3_current_mood TEXT,
  q4_talk_style TEXT,
  q5_main_concern TEXT
);

ALTER TABLE public.onboarding_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_answers: select own" ON public.onboarding_answers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "onboarding_answers: insert own" ON public.onboarding_answers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "onboarding_answers: update own" ON public.onboarding_answers
  FOR UPDATE USING (auth.uid() = user_id);


-- =============================================
-- Trigger: auth.users → public.users 自動作成
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
