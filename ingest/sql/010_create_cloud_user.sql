-- 1) create login role
create role bff_reader login password 'REPLACE_WITH_STRONG_PASSWORD';

-- 2) allow it to connect + see schema
grant connect on database postgres to bff_reader;
grant usage on schema public to bff_reader;

-- 3) Grant read access to all existing tables in public
grant select on all tables in schema public to bff_reader;

-- Keep your default privileges (future tables)
alter default privileges in schema public
    grant select on tables to bff_reader;

-- 4) future-proof: new tables get SELECT automatically
alter default privileges in schema public
    grant select on tables to bff_reader;

alter role bff_reader set search_path = public;

alter role bff_reader set statement_timeout = '6s';
alter role bff_reader set lock_timeout = '4s';
alter role bff_reader set idle_in_transaction_session_timeout = '12s';


revoke create on schema public from bff_reader;