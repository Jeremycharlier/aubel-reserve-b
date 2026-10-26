// Génère les clés anon / service_role du banc de test local (HS256).
// Usage : node scripts/stack/keys.mjs  -> affiche des lignes KEY=VALUE
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "local-test-secret-with-at-least-32-characters",
);
const sign = (role) =>
  new SignJWT({ role, iss: "supabase-local" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(secret);

console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${await sign("anon")}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY=${await sign("service_role")}`);
