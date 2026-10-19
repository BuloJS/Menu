// Configuration Supabase.
//
// Ces deux valeurs sont PUBLIQUES par conception : la clé "anon" ne donne
// aucun droit par elle-même, c'est la Row Level Security (voir
// supabase/schema.sql) qui décide de ce que chaque utilisateur peut lire.
// Ne mets JAMAIS ici la clé "service_role" ni un token GitHub : ce fichier
// est servi tel quel à tous les visiteurs.
//
// Où les trouver : Supabase → ton projet → Settings → API.

export const SUPABASE_URL = "https://pyduueytagmzsdwtzltu.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5ZHV1ZXl0YWdtenNkd3R6bHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU0ODcsImV4cCI6MjEwMjAzMTQ4N30.6Fl5gkIDF8Vie2o8IRKWSYCFVpTIRw5LSXVHW5TalQk";

// Chemin de la page d'accueil, vers laquelle les autres sites renvoient
// lorsqu'aucune session valide n'est trouvée.
export const HOME_PATH = "/Home/";

// Exiger que la double authentification ait été franchie (niveau « aal2 »)
// pour accéder aux sites protégés.
//
// Sans cette exigence, la garde se fierait au champ `user.factors` de la
// session, qui n'est pas toujours présent : une session arrêtée à l'étape du
// code à 6 chiffres — donc ouverte avec le mot de passe seul — suffirait
// alors à entrer. À passer à false uniquement si la 2FA est retirée du
// compte, sinon plus personne ne peut entrer.
export const REQUIRE_AAL2 = true;

// Affichage du bouton "Créer le compte".
// Passe à false une fois ton compte créé et les inscriptions coupées dans
// Supabase (Authentication → Sign In / Providers → Allow new users to sign
// up). C'est ce réglage Supabase qui bloque réellement les inscriptions ;
// ce drapeau ne fait qu'éviter d'afficher un bouton qui échouerait.
export const ALLOW_SIGNUP = true;
