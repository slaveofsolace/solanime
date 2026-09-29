-- Existing accounts remain approved. New requests explicitly opt into pending approval.
ALTER TABLE accounts ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'approved'
  CHECK(approval_state IN ('pending','approved','rejected'));
ALTER TABLE accounts ADD COLUMN approval_requested_at INTEGER;
ALTER TABLE accounts ADD COLUMN approval_decided_at INTEGER;
ALTER TABLE accounts ADD COLUMN owner_notice_state TEXT NOT NULL DEFAULT 'not_required'
  CHECK(owner_notice_state IN ('not_required','pending','sent','failed'));
ALTER TABLE accounts ADD COLUMN applicant_notice_state TEXT NOT NULL DEFAULT 'not_required'
  CHECK(applicant_notice_state IN ('not_required','pending','sent','failed'));
CREATE INDEX accounts_approval_queue ON accounts(approval_state,approval_requested_at,id);
