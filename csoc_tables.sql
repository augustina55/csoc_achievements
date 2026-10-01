-- CSOC Achievements tables (PostgreSQL, NocoBase main database).
-- Replace the Google Sheet tabs "Achivements", "Got Rating" and "Consent".
-- Created in the NocoBase main database (the block reads/writes them through
-- the "main" data source; end_date should be a "Date only" field).

-- Tournament results fetched from chess-results.com
CREATE TABLE cc_csoc_achievements (
    id               BIGSERIAL PRIMARY KEY,
    player_name      VARCHAR(255) NOT NULL,          -- name as on chess-results
    fide_id          BIGINT       NOT NULL,
    mobile_number    VARCHAR(20),
    tournament_name  TEXT         NOT NULL,
    tournament_id    VARCHAR(20),                    -- chess-results tnr number
    tournament_link  TEXT,                           -- player page (art=9)
    rank             INTEGER,
    rating_change    INTEGER,
    is_rated         BOOLEAN      NOT NULL DEFAULT FALSE,
    end_date         DATE         NOT NULL,          -- tournament end date
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_csoc_ach_player_tournament UNIQUE (fide_id, tournament_name)
);
CREATE INDEX idx_csoc_ach_end_date ON cc_csoc_achievements (end_date);
CREATE INDEX idx_csoc_ach_fide_id  ON cc_csoc_achievements (fide_id);

-- First FIDE rating per player: one row per player, first rating of each type and
-- the month it first appeared on a FIDE list ('YYYY-MM'); NULL = never rated in that type.
-- (Created in NocoBase as single-line text fields.)
CREATE TABLE cc_csoc_got_rating (
    id                BIGSERIAL PRIMARY KEY,
    player_name       VARCHAR(255),
    fide_id           VARCHAR(20)  NOT NULL UNIQUE,
    mobile_number     VARCHAR(20),
    classical_rating  VARCHAR(10),
    rapid_rating      VARCHAR(10),
    blitz_rating      VARCHAR(10),
    classical_period  VARCHAR(7),
    rapid_period      VARCHAR(7),
    blitz_period      VARCHAR(7),
    "createdAt"       TIMESTAMPTZ,
    "updatedAt"       TIMESTAMPTZ
);

-- Poster / publicity consent per player
CREATE TABLE cc_csoc_consent (
    id             BIGSERIAL PRIMARY KEY,
    fide_id        BIGINT       NOT NULL UNIQUE,
    player_name    VARCHAR(255),
    mobile_number  VARCHAR(20),
    consent        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
