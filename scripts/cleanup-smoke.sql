DELETE FROM pairing_challenges
WHERE device_id = '00000000-0000-4000-8000-000000000007'
   OR claimed_account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM module_settings WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM devices WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM chat_commands WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM song_requests WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM integration_health WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM idempotency_keys WHERE account_id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM account WHERE userId IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM verification WHERE identifier LIKE 'riftpulse-smoke-%@example.test';
DELETE FROM accounts WHERE id IN (SELECT id FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test');
DELETE FROM user WHERE email LIKE 'riftpulse-smoke-%@example.test';
