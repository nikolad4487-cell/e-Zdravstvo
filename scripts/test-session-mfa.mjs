import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id } = await workflowFixture();
try {
  await db.exec(
    "create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text)",
  );
  await as(1, () => rpc("enforce_session_mfa"));
  await db.query(
    "insert into auth.mfa_factors(user_id,status) values($1,'unverified')",
    [id(1)],
  );
  await as(1, () => rpc("enforce_session_mfa"));
  await db.query(
    "update auth.mfa_factors set status='verified' where user_id=$1",
    [id(1)],
  );
  await as(1, () => db.exec(`set request.jwt.claims='{"aal":"aal1"}'`));
  await assert.rejects(
    as(1, () => rpc("enforce_session_mfa")),
    /autentifikatorom/,
  );
  const blocked = await as(1, () =>
    db.query("select id from profiles where id=$1", [id(1)]),
  );
  assert.equal(blocked.rows.length, 0);
  console.log(
    "PASS verified MFA blocks AAL1 at the API guard and direct table policies",
  );
  await db.exec(`set request.jwt.claims='{"aal":"aal2"}'`);
  await as(1, () => rpc("enforce_session_mfa"));
  const allowed = await as(1, () =>
    db.query("select id from profiles where id=$1", [id(1)]),
  );
  assert.equal(allowed.rows.length, 1);
  console.log("PASS AAL2 restores existing role-scoped access");
  await db.exec(`set request.jwt.claims='{"aal":"aal1"}'`);
  await as(2, () => rpc("enforce_session_mfa"));
  await as(0, () => rpc("enforce_session_mfa"));
  console.log(
    "PASS another user and anonymous readiness are not locked by someone else's factors",
  );
  await db.query("delete from auth.mfa_factors where user_id=$1", [id(1)]);
  await as(1, () => rpc("enforce_session_mfa"));
  console.log(
    "PASS removing a factor through the Auth authority releases the challenge requirement",
  );
} finally {
  await db.close();
}
