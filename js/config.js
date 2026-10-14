// ====== À REMPLIR après avoir créé ton projet Supabase ======
// Supabase > Project Settings > API
// (la clé "anon / publishable" est PUBLIQUE par conception : la sécurité vient des règles RLS du schéma SQL)
export const SUPABASE_URL = "https://mxzafijrmdofhplsuwjy.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14emFmaWpybWRvZmhwbHN1d2p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NjAwMjAsImV4cCI6MjEwNzMzNjAyMH0.SUayWNSZqYEYkD-0oqxI9oEALq7Zi8PLod7p0-9NP7M";

// Supabase exige un email : on en fabrique un à partir de "nom.prenom" (jamais utilisé pour écrire à quelqu'un).
// Dans Supabase > Authentication > Providers > Email : DÉSACTIVE "Confirm email".
export const EMAIL_DOMAIN = "noel-famille.app";

// Avatars proposés à l'inscription : fichiers du dossier assets/avatars/
// Remplace les .png d'exemple par tes images d'elfes (png, jpg, png, webp…) et mets leurs noms ici.
export const AVATARS = [
  "elf-01.png", "elf-02.png", "elf-03.png", "elf-04.png",
  "elf-05.png", "elf-06.png", "elf-07.png", "elf-08.png",
  "elf-09.png", "elf-10.png"
];

export const AVATARS_FAM = [
  "elf-01.svg", "elf-02.svg", "elf-03.svg", "elf-04.svg",
  "elf-05.svg", "elf-06.svg", "elf-07.svg", "elf-08.svg",
  "elf-09.svg", "elf-10.svg"
];
