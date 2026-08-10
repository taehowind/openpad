-- AI STUDY (openPad) - initial schema for Postgres / Supabase.
--
-- Optional. The app creates this schema itself on first start, so a fresh Supabase project
-- works without running anything here. Apply this file instead when you would rather the
-- database be provisioned up front - to keep DDL off the serverless cold path, or to review
-- the schema before it is created.
--
-- Every table below also exists verbatim on the SQLite path; see src/lib/schema.ts.

--
-- PostgreSQL database dump
--

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    board_id text NOT NULL,
    actor_type text NOT NULL,
    actor_name text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    device_id text,
    details_json text DEFAULT '{}'::text NOT NULL,
    created_at text NOT NULL
);

--
-- Name: board_columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_columns (
    id text NOT NULL,
    board_id text NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    grid_col integer DEFAULT 0 NOT NULL
);

--
-- Name: board_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_revisions (
    id text NOT NULL,
    board_id text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    state_json text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT board_revisions_kind_check CHECK ((kind = ANY (ARRAY['auto'::text, 'final'::text])))
);

--
-- Name: boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boards (
    id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    share_token text NOT NULL,
    share_mode text DEFAULT 'readonly'::text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    share_code text,
    owner_id text,
    audience text DEFAULT 'link'::text NOT NULL,
    access_password_hash text,
    type text DEFAULT 'board'::text NOT NULL,
    background text DEFAULT 'default'::text NOT NULL,
    CONSTRAINT boards_share_mode_check CHECK ((share_mode = ANY (ARRAY['readonly'::text, 'write'::text])))
);

--
-- Name: card_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_reactions (
    card_id text NOT NULL,
    identity_key text NOT NULL,
    created_at text NOT NULL
);

--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id text NOT NULL,
    board_id text NOT NULL,
    column_id text NOT NULL,
    participant_id text,
    actor_type text NOT NULL,
    author_name text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    link_url text,
    file_id text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    share_code text,
    CONSTRAINT cards_actor_type_check CHECK ((actor_type = ANY (ARRAY['teacher'::text, 'guest'::text])))
);

--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id text NOT NULL,
    board_id text NOT NULL,
    participant_id text,
    actor_type text NOT NULL,
    author_name text NOT NULL,
    author_emoji text NOT NULL,
    content text NOT NULL,
    created_at text NOT NULL,
    hidden integer DEFAULT 0 NOT NULL,
    CONSTRAINT chat_messages_actor_type_check CHECK ((actor_type = ANY (ARRAY['teacher'::text, 'guest'::text])))
);

--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id text NOT NULL,
    card_id text NOT NULL,
    participant_id text,
    actor_type text NOT NULL,
    author_name text NOT NULL,
    content text NOT NULL,
    created_at text NOT NULL,
    CONSTRAINT comments_actor_type_check CHECK ((actor_type = ANY (ARRAY['teacher'::text, 'guest'::text])))
);

--
-- Name: device_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_profiles (
    device_id text NOT NULL,
    nickname text NOT NULL,
    emoji text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);

--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id text NOT NULL,
    board_id text NOT NULL,
    original_name text NOT NULL,
    stored_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    created_at text NOT NULL
);

--
-- Name: instructors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructors (
    id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'instructor'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT instructors_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'instructor'::text]))),
    CONSTRAINT instructors_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text])))
);

--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id text NOT NULL,
    board_id text NOT NULL,
    nickname text NOT NULL,
    emoji text DEFAULT '🙂'::text NOT NULL,
    device_id text,
    updated_at text,
    created_at text NOT NULL
);

--
-- Name: presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presence (
    board_id text NOT NULL,
    identity_key text NOT NULL,
    participant_id text,
    actor_type text NOT NULL,
    nickname text NOT NULL,
    emoji text NOT NULL,
    last_seen text NOT NULL,
    CONSTRAINT presence_actor_type_check CHECK ((actor_type = ANY (ARRAY['teacher'::text, 'guest'::text])))
);

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: board_columns board_columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_columns
    ADD CONSTRAINT board_columns_pkey PRIMARY KEY (id);

--
-- Name: board_revisions board_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_revisions
    ADD CONSTRAINT board_revisions_pkey PRIMARY KEY (id);

--
-- Name: boards boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);

--
-- Name: boards boards_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_share_token_key UNIQUE (share_token);

--
-- Name: card_reactions card_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_reactions
    ADD CONSTRAINT card_reactions_pkey PRIMARY KEY (card_id, identity_key);

--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);

--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

--
-- Name: device_profiles device_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_profiles
    ADD CONSTRAINT device_profiles_pkey PRIMARY KEY (device_id);

--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);

--
-- Name: files files_stored_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_stored_name_key UNIQUE (stored_name);

--
-- Name: instructors instructors_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructors
    ADD CONSTRAINT instructors_email_key UNIQUE (email);

--
-- Name: instructors instructors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructors
    ADD CONSTRAINT instructors_pkey PRIMARY KEY (id);

--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);

--
-- Name: presence presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence
    ADD CONSTRAINT presence_pkey PRIMARY KEY (board_id, identity_key);

--
-- Name: audit_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_board_idx ON public.audit_logs USING btree (board_id, created_at DESC);

--
-- Name: boards_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX boards_owner_idx ON public.boards USING btree (owner_id);

--
-- Name: boards_share_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX boards_share_code_unique ON public.boards USING btree (share_code) WHERE (share_code IS NOT NULL);

--
-- Name: cards_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cards_board_idx ON public.cards USING btree (board_id, column_id, "position");

--
-- Name: cards_share_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cards_share_code_unique ON public.cards USING btree (share_code) WHERE (share_code IS NOT NULL);

--
-- Name: chat_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_board_idx ON public.chat_messages USING btree (board_id, created_at DESC);

--
-- Name: comments_card_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_card_idx ON public.comments USING btree (card_id, created_at);

--
-- Name: participants_board_device_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participants_board_device_unique ON public.participants USING btree (board_id, device_id) WHERE (device_id IS NOT NULL);

--
-- Name: participants_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_board_idx ON public.participants USING btree (board_id);

--
-- Name: presence_board_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX presence_board_seen_idx ON public.presence USING btree (board_id, last_seen DESC);

--
-- Name: reactions_card_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reactions_card_idx ON public.card_reactions USING btree (card_id);

--
-- Name: revisions_board_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX revisions_board_idx ON public.board_revisions USING btree (board_id, created_at DESC);

--
-- Name: audit_logs audit_logs_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: board_columns board_columns_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_columns
    ADD CONSTRAINT board_columns_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: board_revisions board_revisions_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_revisions
    ADD CONSTRAINT board_revisions_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: card_reactions card_reactions_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_reactions
    ADD CONSTRAINT card_reactions_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

--
-- Name: cards cards_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: cards cards_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.board_columns(id) ON DELETE CASCADE;

--
-- Name: cards cards_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE SET NULL;

--
-- Name: cards cards_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

--
-- Name: chat_messages chat_messages_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: chat_messages chat_messages_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

--
-- Name: comments comments_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;

--
-- Name: comments comments_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

--
-- Name: files files_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: participants participants_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: presence presence_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence
    ADD CONSTRAINT presence_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id) ON DELETE CASCADE;

--
-- Name: presence presence_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence
    ADD CONSTRAINT presence_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--
