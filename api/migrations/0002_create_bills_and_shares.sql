
CREATE TABLE bills (
    id TEXT PRIMARY KEY NOT NULL,
    home_id TEXT NOT NULL,
    title TEXT NOT NULL
        CONSTRAINT bills_title_not_empty CHECK (length(trim(title)) > 0),
    total_cents INTEGER NOT NULL
        CONSTRAINT bills_total_positive CHECK (total_cents > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT bills_home_fk
        FOREIGN KEY (home_id)
        REFERENCES homes(id)
        ON DELETE CASCADE
);

CREATE TABLE shares (
    id TEXT PRIMARY KEY NOT NULL,
    bill_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL
        CONSTRAINT shares_amount_nonnegative CHECK (amount_cents >= 0),
    paid_at TEXT DEFAULT NULL,
    idempotency_key TEXT DEFAULT NULL,

    CONSTRAINT shares_bill_fk
        FOREIGN KEY (bill_id)
        REFERENCES bills(id)
        ON DELETE CASCADE,

    CONSTRAINT shares_member_fk
        FOREIGN KEY (member_id)
        REFERENCES members(id)
        ON DELETE CASCADE,

    CONSTRAINT shares_bill_member_unique
        UNIQUE (bill_id, member_id)
);
