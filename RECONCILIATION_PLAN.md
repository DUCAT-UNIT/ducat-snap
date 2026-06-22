# Snap Reconciliation — Plan A in Practice (`wallet-snap` → `ducat-snap`)

**Canonical repo: `ducat-snap` (this repo).** `wallet-snap` is harvested, then archived.
Rationale (decided): `ducat-snap` is the npm source of truth (published `0.1.5` = its commit
`0426b14`), and the MetaMask audit submission is hard-anchored to it — `submission/metamask-directory.json`
references `github.com/DUCAT-UNIT/ducat-snap`, the `audit-candidate-*` tags (75 of them), and
`ducat-snap/actions/workflows/verify.yml`. Re-homing to `wallet-snap` would mean re-doing the audit
submission. The reverse port also moves ~7,400 LOC + the whole `submission/` system vs. ~600 LOC the
other way. Plan A is smaller AND preserves provenance.

---

## What the port actually is (after reading both signers)

It is **NOT** "swap in `wallet-snap`'s signer." `ducat-snap`'s signer is already *more* hardened:

| | `ducat-snap` `signPreparedPsbt` (psbt.ts) | `wallet-snap` `sign_psbt` (sign.ts) |
|---|---|---|
| Primitive | `bitcoinjs-lib` `signInput`/`signTaprootInput` | `@scure/btc-signer` + `@ducat-unit/core/sign` |
| Multi-input taproot sighash | **safe by construction** (lib gathers all prevouts) | needed an explicit fix (`15d3062`) |
| Account-mismatch rejection | ✅ `PSBT_INPUT_ACCOUNT_MISMATCH` (key-path + script-path) | partial |
| Cosign-leaf ownership + leaf-hash validation | ✅ `checkOwnedTaprootScriptPathInput` | ✅ `match_input`/`sign_cosign_input` |
| Sighash allowlists | ✅ | implicit |
| BitVM3 / timeout-leaf reclaim | ✅ | ❌ none |

**Conclusion:** keep `ducat-snap`'s entire signing + policy + confirmation + BitVM3 architecture.
The port is **selective harvesting**, not a signer swap. The "canonical signer" migration (Phase 3)
is OPTIONAL and de-risked because ducat-snap is already correct.

---

## The actual harvest list (small, bounded)

### Tier 1 — port now (additive, no behavior change to signing)
- [ ] **`.nvmrc`** (pin Node `^20 || >=22`; mm-snap needs it — would've prevented the Node-21 build fail
      during the 0.1.5 publish).
- [ ] **`e2e/live/` Playwright harness** (`vault-open-live.mjs`, `repay-live.mjs`, `sign-harness.mjs`,
      `fund.mjs`, `import-check.mjs`): real frontend/guardian/regtest signing e2e. ducat-snap only has
      `scripts/snap-simulation-harness.mjs`. **Adapt RPC names** `btc_*` → `ducat_*`.
- [ ] **Dev config**: `.editorconfig`, `.prettierrc.mjs`, `eslint.config.mjs` (ducat-snap lacks).
- [ ] **CI**: `security-code-scanner.yml` (complements existing `verify.yml`).

### Tier 2 — review-and-port individual fix commits (verify each still applies to ducat-snap's signer)
For each: does ducat-snap already cover it? If not, port the *idea*, not the `@scure`-specific code.
- [ ] `35ee4fe` guard derived ducat account addresses against undefined
- [ ] `44f0b6c` harden ord-envelope validator (unsigned PUSHDATA4 length)
- [ ] `a1db89e` accept inscribed cosign leaf (prefix-match + ord envelope validate)
- [ ] `fa9bace` / `bf26de5` empty signInputs ⇒ sign all owned inputs
- [ ] `61ae410` real `proposedName`/`description`/`repository` in install prompt (compare to ducat-snap's manifest)

### Tier 3 — OPTIONAL architecture (team decision, NOT required)
- [ ] Migrate ducat-snap to `@ducat-unit/core/sign` (port `wallet-snap` `sign.ts`, ~600 LOC).
      Only if the team wants one shared signer across the stack. **Requires re-audit** (touches the
      audited signing core). De-risked because ducat-snap is already correct, so this is a refactor for
      maintainability, not a bug fix. Defer to next audit cycle unless there's a strong reason.

### Tier 4 — salvage the genuinely-unique-and-good
- [ ] `wallet-snap`'s `packages/site/` Gatsby **demo dApp** is a useful standalone snap tester. Either
      keep `wallet-snap` alive *only* as that demo, or copy `packages/site` into ducat-snap as `examples/`.

---

## "Ensure nothing breaks" — the safety net

Run in this order. Each gate must pass before the next.

### Gate 0 — Stop the double-publish hazard (do FIRST)
- [ ] In `wallet-snap`: `packages/snap/package.json` → `"private": true` (or a failing `prepublishOnly`).
      Prevents a divergent `@ducat-unit/wallet-snap` publish race while we work.

### Gate 1 — Baseline green on ducat-snap (prove current state is good)
- [ ] `nvm use 22 && npm run verify` (type-check + 92 tests + build + manifest) — must pass before changes.
- [ ] Record current published behavior: `0.1.5` is live, frontend pinned to `0.1.3` (intentional).

### Gate 2 — Funds-safety regression test (THE critical one — add BEFORE any signer touch)
- [ ] Add a **multi-input taproot test** to `src/__tests__/psbt.test.ts`: a PSBT with ≥2 inputs where a
      single-key P2TR key-path input (asset/UNIT) is signed alongside a funds input — the repay-burn-PSBT
      shape that broke `wallet-snap`. Assert each produced sig verifies against a sighash computed over
      ALL inputs' prevouts. Expectation: **ducat-snap passes** (bitcoinjs-lib handles it). If it fails →
      release-blocking; patch + publish before anything else.
- [ ] This test is the permanent guard: it must stay green through every later phase (esp. Tier 3).

### Gate 3 — Per-port verification (after EACH Tier-1/2 item)
- [ ] Re-run `npm run verify` after every harvested item. No item lands red.
- [ ] For ported e2e: run `npm run verify:harness` + the new `e2e/live` against regtest; confirm a real
      vault-open and a repay both sign + settle.

### Gate 4 — Full release gate (before re-publishing)
- [ ] `npm run verify:release` (the prepublishOnly gate: verify + harness + audit:prod + snapper +
      metadata + release-manifest + pack). Must be green on Node 22.
- [ ] If Tier 3 (signer migration) was done: **re-audit** + diff the produced signatures against the
      pre-migration signer on a fixture corpus (byte-for-byte where deterministic) before publish.

### Gate 5 — Provenance integrity (don't break the audit submission)
- [ ] Keep `submission/metamask-directory.json` URLs pointing at `ducat-snap` (no repo rename).
- [ ] Cut a fresh `audit-candidate-*` tag at the post-harvest commit; update `candidateTag` in the
      directory; re-run `verify:metadata` (the same check that blocked the 0.1.5 publish earlier).
- [ ] Publish the next version (e.g. `0.1.8`) from ducat-snap only.

### Gate 6 — Frontend compatibility
- [ ] ducat-snap keeps `ducat_*` RPC names (frontend depends on them). No renames.
- [ ] After publish, bump/unpin the frontend (currently `0.1.3`) deliberately, only once the new snap is
      verified against the whitelisted-address concern that caused the earlier pin.

---

## Rollback / blast-radius
- Every change lands on a branch in ducat-snap; nothing publishes until Gate 4.
- The published `0.1.5` and the `0.1.3` the frontend uses are untouched until we choose to bump.
- `wallet-snap` is set non-publishing (Gate 0) but not deleted until Tier 4 is settled — full fallback.

## TL;DR
Plan A is smaller than it looked: **don't swap the signer** (ducat-snap's is already better + multi-input-safe).
Harvest scaffolding + e2e + a few fixes from `wallet-snap`, guarded by a permanent multi-input signing
test and the existing `verify:release` gate. The canonical-signer migration is an optional, re-audit-gated
refactor — not part of the safe baseline. Provenance stays on `ducat-snap` throughout.
