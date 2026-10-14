-- =====================================================================
--  Noël en famille — schéma Supabase (tables + sécurité RLS + fonctions)
--  À coller en entier dans : Supabase > SQL Editor > New query > Run
--  Peut être relancé sans risque (idempotent) tant qu'il n'y a pas de données
-- =====================================================================

-- ---------- 1. TABLES -------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  prenom      text not null check (char_length(prenom) between 1 and 50),
  nom         text not null check (char_length(nom)    between 1 and 50),
  avatar      text not null default 'elf-01.svg' check (avatar ~ '^[A-Za-z0-9._-]{1,60}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 60),
  code        text not null unique,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('admin', 'member')),
  joined_at   timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists family_members_user_idx on public.family_members(user_id);

-- Une "idée de cadeau" sur la liste de owner_id.
--   suggested_by IS NULL      -> souhait ajouté par le propriétaire lui-même
--   suggested_by = quelqu'un  -> suggestion d'un autre membre (invisible du propriétaire)
create table if not exists public.gifts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  description   text not null default '' check (char_length(description) <= 500),
  suggested_by  uuid references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists gifts_owner_idx on public.gifts(owner_id);

-- Table séparée : c'est elle qui garantit le secret des réservations.
create table if not exists public.reservations (
  gift_id      uuid primary key references public.gifts(id) on delete cascade,
  reserved_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- ---------- 2. FONCTIONS D'AIDE (utilisées par les règles RLS) ---------

create or replace function public.is_family_member(fid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.family_members where family_id = fid and user_id = auth.uid());
$$;

create or replace function public.is_family_admin(fid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.family_members
                 where family_id = fid and user_id = auth.uid() and role = 'admin');
$$;

-- Vrai si a et b appartiennent à au moins une même famille.
create or replace function public.shares_family(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.family_members m1
    join public.family_members m2 on m1.family_id = m2.family_id
    where m1.user_id = a and m2.user_id = b
  );
$$;

create or replace function public.gift_owner(gid uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select owner_id from public.gifts where id = gid;
$$;

-- ---------- 3. CRÉATION AUTOMATIQUE DU PROFIL À L'INSCRIPTION -----------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, prenom, nom, avatar)
  values (
    new.id,
    btrim(coalesce(new.raw_user_meta_data->>'prenom', '')),
    btrim(coalesce(new.raw_user_meta_data->>'nom', '')),
    coalesce(nullif(new.raw_user_meta_data->>'avatar', ''), 'elf-01.svg')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 4. FONCTIONS APPELÉES PAR LE SITE (RPC) ---------------------

create or replace function public.gen_family_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sans O/0/I/1/L
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.create_family(p_name text)
returns public.families language plpgsql security definer set search_path = public as $$
declare
  f public.families;
  c text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 60 then
    raise exception 'Le nom de la famille doit faire entre 2 et 60 caractères';
  end if;
  loop
    c := public.gen_family_code();
    exit when not exists (select 1 from public.families where code = c);
  end loop;
  insert into public.families (name, code, created_by) values (p_name, c, auth.uid()) returning * into f;
  insert into public.family_members (family_id, user_id, role) values (f.id, auth.uid(), 'admin');
  return f;
end;
$$;

create or replace function public.join_family(p_code text)
returns public.families language plpgsql security definer set search_path = public as $$
declare
  f public.families;
  c text;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  c := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into f from public.families where code = c;
  if not found then raise exception 'Code d''invitation invalide'; end if;
  insert into public.family_members (family_id, user_id, role)
  values (f.id, auth.uid(), 'member')
  on conflict do nothing;
  return f;
end;
$$;

-- Renvoie la liste d'une personne, déjà filtrée selon qui regarde :
--   * sa propre liste  -> uniquement ses souhaits, SANS réservations ni suggestions
--   * la liste d'un autre membre d'une de mes familles -> tout (souhaits, suggestions, réservations)
--   * sinon -> erreur
create or replace function public.get_list(p_owner uuid)
returns table (
  id                uuid,
  title             text,
  description       text,
  suggested_by      uuid,
  suggested_by_name text,
  reserved_by       uuid,
  reserved_by_name  text,
  created_at        timestamptz
) language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;

  if p_owner = auth.uid() then
    return query
      select g.id, g.title, g.description,
             null::uuid, null::text, null::uuid, null::text, g.created_at
      from public.gifts g
      where g.owner_id = auth.uid() and g.suggested_by is null
      order by g.created_at;
    return;
  end if;

  if not public.shares_family(p_owner, auth.uid()) then
    raise exception 'Accès refusé';
  end if;

  return query
    select g.id, g.title, g.description,
           g.suggested_by, sp.prenom,
           r.reserved_by,  rp.prenom,
           g.created_at
    from public.gifts g
    left join public.profiles sp on sp.id = g.suggested_by
    left join public.reservations r on r.gift_id = g.id
    left join public.profiles rp on rp.id = r.reserved_by
    where g.owner_id = p_owner
    order by g.created_at;
end;
$$;

-- ---------- 5. SÉCURITÉ (Row Level Security) ----------------------------

alter table public.profiles       enable row level security;
alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.gifts          enable row level security;
alter table public.reservations   enable row level security;

-- profiles : je vois mon profil et celui des membres de mes familles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_family(id, auth.uid()));

-- seul l'avatar est modifiable (le nom/prénom sert d'identifiant de connexion)
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant  update (avatar) on public.profiles to authenticated;

-- families : visibles par leurs membres ; création/adhésion uniquement via RPC
drop policy if exists families_select on public.families;
create policy families_select on public.families for select to authenticated
  using (public.is_family_member(id));

drop policy if exists families_update on public.families;
create policy families_update on public.families for update to authenticated
  using (public.is_family_admin(id)) with check (public.is_family_admin(id));
revoke update on public.families from authenticated, anon;
grant  update (name) on public.families to authenticated;

drop policy if exists families_delete on public.families;
create policy families_delete on public.families for delete to authenticated
  using (public.is_family_admin(id));

-- family_members : je vois les membres de mes familles ; je peux me retirer ;
-- un admin peut retirer quelqu'un
drop policy if exists fm_select on public.family_members;
create policy fm_select on public.family_members for select to authenticated
  using (public.is_family_member(family_id));

drop policy if exists fm_delete on public.family_members;
create policy fm_delete on public.family_members for delete to authenticated
  using (user_id = auth.uid() or public.is_family_admin(family_id));

-- gifts
--   propriétaire : voit seulement ses propres souhaits (jamais les suggestions)
--   les autres membres d'une famille commune : voient tout
drop policy if exists gifts_select on public.gifts;
create policy gifts_select on public.gifts for select to authenticated
  using (
    (owner_id = auth.uid() and suggested_by is null)
    or (owner_id <> auth.uid() and public.shares_family(owner_id, auth.uid()))
  );

drop policy if exists gifts_insert on public.gifts;
create policy gifts_insert on public.gifts for insert to authenticated
  with check (
    (owner_id = auth.uid() and suggested_by is null)
    or (owner_id <> auth.uid() and suggested_by = auth.uid()
        and public.shares_family(owner_id, auth.uid()))
  );

drop policy if exists gifts_update on public.gifts;
create policy gifts_update on public.gifts for update to authenticated
  using ((owner_id = auth.uid() and suggested_by is null) or suggested_by = auth.uid())
  with check ((owner_id = auth.uid() and suggested_by is null) or suggested_by = auth.uid());
revoke update on public.gifts from authenticated, anon;
grant  update (title, description) on public.gifts to authenticated;

drop policy if exists gifts_delete on public.gifts;
create policy gifts_delete on public.gifts for delete to authenticated
  using ((owner_id = auth.uid() and suggested_by is null) or suggested_by = auth.uid());

-- reservations : INVISIBLES pour le propriétaire de la liste
drop policy if exists res_select on public.reservations;
create policy res_select on public.reservations for select to authenticated
  using (
    public.gift_owner(gift_id) <> auth.uid()
    and public.shares_family(public.gift_owner(gift_id), auth.uid())
  );

drop policy if exists res_insert on public.reservations;
create policy res_insert on public.reservations for insert to authenticated
  with check (
    reserved_by = auth.uid()
    and public.gift_owner(gift_id) <> auth.uid()
    and public.shares_family(public.gift_owner(gift_id), auth.uid())
  );

drop policy if exists res_delete on public.reservations;
create policy res_delete on public.reservations for delete to authenticated
  using (reserved_by = auth.uid());

-- ---------- 6. DROITS D'EXÉCUTION DES FONCTIONS -------------------------

revoke all on function public.is_family_member(uuid)        from public, anon;
revoke all on function public.is_family_admin(uuid)         from public, anon;
revoke all on function public.shares_family(uuid, uuid)     from public, anon;
revoke all on function public.gift_owner(uuid)              from public, anon;
revoke all on function public.create_family(text)           from public, anon;
revoke all on function public.join_family(text)             from public, anon;
revoke all on function public.get_list(uuid)                from public, anon;
revoke all on function public.gen_family_code()             from public, anon;

grant execute on function public.is_family_member(uuid)     to authenticated;
grant execute on function public.is_family_admin(uuid)      to authenticated;
grant execute on function public.shares_family(uuid, uuid)  to authenticated;
grant execute on function public.gift_owner(uuid)           to authenticated;
grant execute on function public.create_family(text)        to authenticated;
grant execute on function public.join_family(text)          to authenticated;
grant execute on function public.get_list(uuid)             to authenticated;

-- =====================================================================
--  7. MINI-JEU « Attrape-cadeaux » : meilleurs scores + classement
--     (section ajoutée après la première version : relancer tout le fichier est sans danger)
-- =====================================================================

create table if not exists public.scores (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  best_score    int  not null default 0 check (best_score between 0 and 10000),
  games_played  int  not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.scores enable row level security;

-- Lecture directe : uniquement son propre score. Écriture : uniquement via submit_score().
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.scores from authenticated, anon;

-- Enregistre une partie et conserve le meilleur score.
-- Le jeu rapporte un score et la durée de jeu ; un score impossible vu la durée est refusé
-- (le jeu fait tomber au maximum environ 2,3 points par seconde).
create or replace function public.submit_score(p_score int, p_duration_ms int)
returns int language plpgsql security definer set search_path = public as $$
declare
  best int;
  secs numeric;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if p_score is null or p_score < 0 or p_duration_ms is null or p_duration_ms < 0 then
    raise exception 'Score invalide';
  end if;
  secs := least(p_duration_ms, 1800000) / 1000.0;      -- 30 min maximum prises en compte
  if p_score > 3 + secs * 3 then
    raise exception 'Score invalide';
  end if;

  insert into public.scores (user_id, best_score, games_played)
  values (auth.uid(), p_score, 1)
  on conflict (user_id) do update
    set best_score   = greatest(public.scores.best_score, excluded.best_score),
        games_played = public.scores.games_played + 1,
        updated_at   = now()
  returning public.scores.best_score into best;

  return best;
end;
$$;

-- Classement : p_family NULL -> toutes mes familles ; sinon une famille dont je suis membre.
create or replace function public.get_leaderboard(p_family uuid default null)
returns table (
  user_id    uuid,
  prenom     text,
  nom        text,
  avatar     text,
  best_score int,
  rank       bigint
) language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if p_family is not null and not public.is_family_member(p_family) then
    raise exception 'Accès refusé';
  end if;

  return query
    select s.user_id, p.prenom, p.nom, p.avatar, s.best_score,
           rank() over (order by s.best_score desc)
    from public.scores s
    join public.profiles p on p.id = s.user_id
    where s.best_score > 0
      and (
        case when p_family is null
          then (s.user_id = auth.uid() or public.shares_family(s.user_id, auth.uid()))
          else exists (select 1 from public.family_members m
                       where m.family_id = p_family and m.user_id = s.user_id)
        end
      )
    order by s.best_score desc, p.prenom
    limit 100;
end;
$$;

revoke all on function public.submit_score(int, int)   from public, anon;
revoke all on function public.get_leaderboard(uuid)    from public, anon;
grant execute on function public.submit_score(int, int) to authenticated;
grant execute on function public.get_leaderboard(uuid)  to authenticated;
