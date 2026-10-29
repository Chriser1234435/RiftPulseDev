-- Kick OAuth authorization code verifier is encrypted and short-lived alongside its one-time state.
ALTER TABLE provider_oauth_states ADD COLUMN code_verifier_ciphertext TEXT;
