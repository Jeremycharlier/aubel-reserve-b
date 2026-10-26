import { describe, it, expect, beforeAll, inject } from "vitest";
import {
  adminClient,
  anonClient,
  createPlayers,
  DOMAIN,
  login,
  loginMaitre,
  sql,
} from "./helpers";
import {
  AccountError,
  changeOwnPassword,
  createAccount,
  loginWithUsername,
  resetPassword,
  setAccountActive,
} from "../../src/lib/accounts";

describe("Comptes et authentification", () => {
  const admin = adminClient();
  let maitreId: string;

  beforeAll(() => {
    maitreId = inject("maitre").userId;
  });

  it("le maître crée un compte joueur avec mot de passe temporaire", async () => {
    const acc = await createAccount(admin, maitreId, DOMAIN, {
      username: "Jean Dupont",
      newPlayerName: "Jean Dupont",
      shirtNumber: 7,
    });
    expect(acc.username).toBe("jean.dupont");
    expect(acc.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const [profile] = await sql<{ role: string; must_change_password: boolean }>(
      "select role, must_change_password from profiles where user_id = $1",
      [acc.userId],
    );
    expect(profile).toEqual({ role: "joueur", must_change_password: true });
    const audit = await sql("select 1 from audit_log where action = 'compte.creation' and entity_id = $1", [acc.userId]);
    expect(audit).toHaveLength(1);
  });

  it("refuse un identifiant déjà utilisé", async () => {
    await expect(
      createAccount(admin, maitreId, DOMAIN, { username: "jean.dupont", newPlayerName: "Autre Jean" }),
    ).rejects.toThrow("déjà utilisé");
  });

  it("un joueur ne peut pas créer de compte (même avec la fonction serveur)", async () => {
    const [p] = await createPlayers(1, "acc");
    await expect(
      createAccount(admin, p.userId, DOMAIN, { username: "intrus", newPlayerName: "Intrus" }),
    ).rejects.toBeInstanceOf(AccountError);
    // Et directement via l'API avec son propre jeton : fonction non exposée
    const { error } = await p.client.rpc("svc_create_account", {
      p_actor: p.userId,
      p_user_id: p.userId,
      p_username: "x",
      p_role: "maitre",
      p_player_id: null,
      p_new_player_name: "X",
      p_shirt_number: null,
    });
    expect(error?.code).toBe("42501");
  });

  it("première connexion : changement de mot de passe obligatoire puis connexion", async () => {
    const acc = await createAccount(admin, maitreId, DOMAIN, { username: "premiere.co", newPlayerName: "Premiere Co" });
    const client = await login("premiere.co", acc.tempPassword);
    // Refus d'un mot de passe trop faible
    await expect(changeOwnPassword(admin, client, acc.userId, "premiere.co", "court")).rejects.toThrow(
      "Au moins 8",
    );
    await changeOwnPassword(admin, client, acc.userId, "premiere.co", "MonMotDePasse9");
    const [p] = await sql<{ must_change_password: boolean }>(
      "select must_change_password from profiles where user_id = $1",
      [acc.userId],
    );
    expect(p.must_change_password).toBe(false);
    // L'ancien mot de passe temporaire ne fonctionne plus
    const res = await loginWithUsername(admin, anonClient(), DOMAIN, "premiere.co", acc.tempPassword, "10.0.0.2");
    expect(res).toEqual({ ok: false, reason: "invalid" });
    await login("premiere.co", "MonMotDePasse9");
  });

  it("déconnexion : le jeton n'est plus utilisable", async () => {
    const [p] = await createPlayers(1, "logout");
    const { data: before } = await p.client.auth.getUser();
    expect(before.user?.id).toBe(p.userId);
    await p.client.auth.signOut();
    const { data: after } = await p.client.auth.getUser();
    expect(after.user).toBeNull();
    const { error } = await p.client.from("ballots").select("id");
    // Sans session, le client redevient anonyme : aucun accès
    expect(error?.code).toBe("42501");
  });

  it("réinitialisation du mot de passe par le maître", async () => {
    const [p] = await createPlayers(1, "reset");
    const temp = await resetPassword(admin, maitreId, p.userId);
    const res = await loginWithUsername(admin, anonClient(), DOMAIN, p.username, p.password, "10.0.0.3");
    expect(res.ok).toBe(false);
    await login(p.username, temp);
    const [row] = await sql<{ must_change_password: boolean }>(
      "select must_change_password from profiles where user_id = $1",
      [p.userId],
    );
    expect(row.must_change_password).toBe(true);
  });

  it("désactivation puis réactivation d'un compte, historique conservé", async () => {
    const [p] = await createPlayers(1, "desac");
    await setAccountActive(admin, maitreId, p.userId, false);
    const res = await loginWithUsername(admin, anonClient(), DOMAIN, p.username, p.password, "10.0.0.4");
    expect(res.ok).toBe(false);
    const [player] = await sql<{ active: boolean }>("select active from players where id = $1", [p.playerId]);
    expect(player.active).toBe(false);
    await setAccountActive(admin, maitreId, p.userId, true);
    await login(p.username, p.password);
  });

  it("le maître ne peut pas se désactiver lui-même", async () => {
    await expect(setAccountActive(admin, maitreId, maitreId, false)).rejects.toThrow("CANNOT_DISABLE_SELF");
  });

  it("limite les tentatives de connexion abusives (5 échecs / 15 min)", async () => {
    const [p] = await createPlayers(1, "brute");
    for (let i = 0; i < 5; i++) {
      const r = await loginWithUsername(admin, anonClient(), DOMAIN, p.username, "mauvais-1", `10.1.0.${i}`);
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
    // Même le bon mot de passe est refusé pendant le blocage
    const blocked = await loginWithUsername(admin, anonClient(), DOMAIN, p.username, p.password, "10.1.0.9");
    expect(blocked).toEqual({ ok: false, reason: "throttled" });
    await sql("delete from login_attempts where username = $1", [p.username]);
    await login(p.username, p.password);
  });

  it("aucune inscription libre : l'inscription publique est désactivée", async () => {
    const { error } = await anonClient().auth.signUp({ email: `libre@${DOMAIN}`, password: "Inscription-123" });
    expect(error).not.toBeNull();
  });

  it("le maître se connecte et dispose du rôle maître", async () => {
    const m = await loginMaitre();
    const { data } = await m.rpc("is_maitre");
    expect(data).toBe(true);
  });
});
