-- One-time, short-lived callback correlation for the Meta Embedded Signup flow.
CREATE TABLE IF NOT EXISTS public.zernio_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL
    REFERENCES public.usuarios(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  zernio_profile_id text NOT NULL
    CHECK (zernio_profile_id ~ '^[a-fA-F0-9]{24}$'),
  onboarding_mode text NOT NULL
    CHECK (onboarding_mode IN ('api', 'business_app')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'cancelled', 'failed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  callback_error text
);

CREATE INDEX IF NOT EXISTS idx_zernio_onboarding_owner_status
  ON public.zernio_onboarding_sessions (id_usuario, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zernio_onboarding_expiry
  ON public.zernio_onboarding_sessions (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.zernio_onboarding_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zernio_onboarding_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.zernio_onboarding_sessions TO service_role;

COMMENT ON TABLE public.zernio_onboarding_sessions IS
  'Callback states hashed at rest, bound to one landlord/profile, expiring and usable once. Backend-only.';
