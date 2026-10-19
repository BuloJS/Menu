// Module d'authentification et de synchronisation.
//
// Utilisé par Home pour la connexion, la 2FA et la lecture/écriture des
// données. Réutilisable tel quel dans les autres repos si tu veux un jour y
// synchroniser des données : copie ce fichier plus config.js, puis
//
//   import { requireSession, loadData, saveData } from "./assets/auth.js";
//
// La session est stockée dans le localStorage du navigateur et rafraîchie
// automatiquement : une fois connecté sur un PC, tu y restes.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const SDK_TIMEOUT_MS = 12000;

/** Les valeurs d'exemple de config.js sont-elles encore en place ? */
export function isConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("TON-PROJET") &&
    !SUPABASE_ANON_KEY.includes("TA_CLE")
  );
}

let clientPromise = null;

/**
 * Instancie le client au premier appel. Le SDK est chargé dynamiquement pour
 * que la page reste affichable même si le CDN est injoignable.
 */
export function getClient() {
  if (!isConfigured()) {
    return Promise.reject(new Error("Supabase n'est pas configuré : renseigne assets/config.js."));
  }
  if (!clientPromise) {
    // Course contre la montre : un CDN filtré par un pare-feu ou un bloqueur
    // peut laisser la requête en attente sans jamais échouer. Sans ce
    // garde-fou, la page resterait bloquée sur « Chargement… ».
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("délai dépassé")), SDK_TIMEOUT_MS)
    );

    clientPromise = Promise.race([import(SDK_URL), timeout])
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      )
      .catch((error) => {
        clientPromise = null; // permet de réessayer au prochain appel
        throw new Error(`Chargement de Supabase impossible (réseau ?) : ${error.message}`);
      });
  }
  return clientPromise;
}

/** Remonte un message d'erreur lisible plutôt qu'un objet Supabase brut. */
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// --- Session -------------------------------------------------------------

export async function getSession() {
  const supabase = await getClient();
  return unwrap(await supabase.auth.getSession()).session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function signIn(email, password) {
  const supabase = await getClient();
  return unwrap(await supabase.auth.signInWithPassword({ email, password }));
}

export async function signUp(email, password) {
  const supabase = await getClient();
  return unwrap(await supabase.auth.signUp({ email, password }));
}

export async function signOut() {
  const supabase = await getClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

// --- 2FA (TOTP : Google Authenticator, 1Password, Aegis…) ----------------

/**
 * Niveau d'authentification courant.
 * currentLevel "aal1" = mot de passe seul, "aal2" = 2FA validée.
 * Si nextLevel vaut "aal2" alors que currentLevel est "aal1", un code est attendu.
 */
export async function getAssuranceLevel() {
  const supabase = await getClient();
  return unwrap(await supabase.auth.mfa.getAuthenticatorAssuranceLevel());
}

export function needsMfaChallenge(aal) {
  return aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel;
}

/** Facteurs TOTP déjà activés sur le compte. */
export async function listTotpFactors() {
  const supabase = await getClient();
  const data = unwrap(await supabase.auth.mfa.listFactors());
  return (data.totp ?? []).filter((factor) => factor.status === "verified");
}

/**
 * Démarre l'ajout d'une application d'authentification.
 * Renvoie le QR code (image SVG en data URI) et le secret à saisir à la main.
 * Tant que verifyTotp() n'a pas été appelé, le facteur reste inactif.
 */
export async function enrollTotp(friendlyName = "Home") {
  const supabase = await getClient();
  const data = unwrap(
    await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `${friendlyName} ${new Date().toISOString().slice(0, 16)}`,
    })
  );
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Valide un code à 6 chiffres, aussi bien pour activer un nouveau facteur
 * que pour franchir la 2FA à la connexion.
 */
export async function verifyTotp(factorId, code) {
  const supabase = await getClient();
  const challenge = unwrap(await supabase.auth.mfa.challenge({ factorId }));
  return unwrap(
    await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() })
  );
}

export async function unenrollTotp(factorId) {
  const supabase = await getClient();
  return unwrap(await supabase.auth.mfa.unenroll({ factorId }));
}

// --- Données synchronisées ----------------------------------------------

/**
 * Lit les données de l'utilisateur courant pour une application donnée
 * ("home", "series", "finance"…). Renvoie null si rien n'a encore été
 * enregistré. La RLS garantit qu'on ne peut lire que ses propres lignes.
 */
export async function loadData(app) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("user_data")
    .select("data")
    .eq("app", app)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.data ?? null;
}

/** Écrit (ou remplace) les données de l'utilisateur courant pour une application. */
export async function saveData(app, payload) {
  const supabase = await getClient();
  const user = await getUser();
  if (!user) throw new Error("Aucune session : impossible d'enregistrer.");

  const { error } = await supabase
    .from("user_data")
    .upsert(
      { user_id: user.id, app, data: payload, updated_at: new Date().toISOString() },
      { onConflict: "user_id,app" }
    );

  if (error) throw new Error(error.message);
}

/**
 * Pour une page à protéger : renvoie la session si elle est complète (2FA
 * franchie le cas échéant), sinon renvoie l'utilisateur vers Home.
 * Rappel : cela masque le contenu, mais un site statique public reste
 * téléchargeable — seules les données servies par Supabase sont réellement
 * protégées, par la RLS.
 */
export async function requireSession(loginUrl = "https://bulojs.github.io/Home/") {
  const session = await getSession();
  if (!session || needsMfaChallenge(await getAssuranceLevel())) {
    window.location.replace(loginUrl);
    return null;
  }
  return session;
}
