-- Per-challenge toggle: whether to invite jury members as collaborators on forked repos
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS invite_jury_to_forks BOOLEAN DEFAULT false;
