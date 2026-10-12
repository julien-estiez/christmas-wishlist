-- Réinitialiser le mot de passe de quelqu'un (tu es l'administrateur).
-- Supabase > SQL Editor > colle ceci, adapte les deux valeurs, puis Run.
--
-- L'identifiant est "nom.prenom@noel-famille.app" en minuscules, sans accents,
-- les espaces et apostrophes devenant des tirets. Exemple : Marie-Noëlle Estiez -> estiez.marie-noelle@noel-famille.app

update auth.users
set encrypted_password = crypt('MOT-DE-PASSE-TEMPORAIRE', gen_salt('bf')),
    updated_at = now()
where email = 'nom.prenom@noel-famille.app';

-- Vérifier qui existe (utile pour retrouver l'identifiant exact) :
-- select email, raw_user_meta_data->>'prenom' as prenom, raw_user_meta_data->>'nom' as nom from auth.users order by created_at;
