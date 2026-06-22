# Security Audit — Ducat Wallet Snap

**Scope:** `src/` of `@ducat-unit/wallet-snap` (MetaMask Snap: Bitcoin key derivation via
`snap_getBip32Entropy`, PSBT signing, BIP322 message signing, self-broadcasting BTC transfer,
Snap Home).
**Method:** Multi-agent review — parallel recon readers per attack surface, offensive finding
lenses (key extraction, sign-without-consent, cosign/guardian bypass, account ownership,
origin/network/DoS, UI spoofing, supply chain, value/fee math), adversarial verification of every
candidate finding, and a synthesized score. Baseline signals: `tsc` clean, full jest suite green,
`npm audit --omit=dev` = 0 vulnerabilities, dependencies pinned, no `eval`/`child_process`/dynamic
`require`.

## Result

**Score: 92 / 100 — "Strong."** No Critical, High, or Medium finding survived adversarial
verification. Every threat-model invariant that moves funds or touches key material holds:

- **Key custody** — private key / chain-code material is confined to `bip32.ts`/`accounts.ts` and
  is never serialized into an RPC response, error detail, notification, or persisted state;
  `ducat_getAccounts` returns only addresses and public hex. Derivation paths are hardcoded and not
  influenced by RPC params.
- **No blind-signing / value substitution** — confirm-before-sign ordering in all five paths
  (validate → summary → `snap_dialog` gate → sign/broadcast); displayed money figures derive
  strictly from the PSBT-decoded summary; `witnessUtxo`↔`nonWitnessUtxo` reconciliation closes
  ECDSA value substitution for signed inputs.
- **No malleability** — SIGHASH pinned (ECDSA `[ALL]`, taproot `[DEFAULT, ALL]`) at validate-time
  and re-passed at every `signInput`/`signTaprootInput`.
- **Sound cosign/guardian policy** — vault script-path signing requires a structurally-anchored
  true 2-of-2 cosign leaf (client == derived vault key), a full BIP341 leaf→output-key commitment
  with parity check, a per-network guardian allowlist re-checked at sign time (non-empty and
  enforced for every production network; see the regtest note below), and the verified leaf is the
  leaf signed.
- **Locked origin allowlist** — exact-string match of three HTTPS `ducatprotocol.com` origins,
  enforced first on every RPC and mirrored in the manifest; `localhost`/`*.vercel.app` excluded; no
  attacker-controlled fetch host.
- **Hardened supply chain** — runtime deps pinned with an integrity-hashed lockfile; tight manifest
  permissions; 0 production vulnerabilities.

All residual findings were **Low or Info** — confined to UI disclosure/labeling and
defense-in-depth hygiene, none of which substitutes value, leaks keys, or signs without consent.

## Findings addressed in this change

### #1 — Null/Unavailable fee allowed approval without a hard stop (Low)

`summarizePsbt` returns `feeSats === null` when any input omits its value data. Previously
`confirmPsbt` still rendered the dialog with the total/fee shown as "Unavailable" behind a soft
warning, so a user could approve a signature without seeing the net BTC leaving the wallet.

**Fix:** `confirmPsbt` and `confirmBatch` now hard-stop with `PSBT_FEE_UNAVAILABLE` **before** any
dialog is shown when the total fee cannot be computed. (`src/confirmations.ts`, `src/errors.ts`)

### #2 — Action-label header not stripped of Unicode bidi/control characters (Low)

App-supplied `context.title`/`actionType`/`flow` flowed into confirmation Card titles and Row
labels through `titleCaseFallback`, which only normalizes ASCII whitespace. MetaMask renders these
as plain text (no markdown-link injection), but invisible bidi-override / zero-width / format
characters passed through and could visually disguise the headline action name over a spend.

**Fix:** `titleCaseFallback` now strips Unicode format/control characters
(`\p{Cf}`/`\p{Cc}`) before formatting, so every dapp-supplied label renders as the legible
characters the Snap intends. Known action keys still map to their safe constant labels.
(`src/display.ts`)

**Regression coverage:** `src/__tests__/audit-hardening.test.ts` asserts the null-fee PSBT and
batch paths reject before `snap_dialog` is called, and that the label path strips bidi/control
characters while preserving known labels.

## Findings tracked for follow-up (not in this change)

These are bounded, non-fund-moving, and were left out to keep this change focused; they are good
next hardening steps:

- **Hidden recipients beyond the visible slice** (Low) — outputs past the first 8 (batch entries
  past 6) collapse into an aggregate "hidden external total"; consider rendering all external
  destination addresses. The complete correct total is always shown.
- **Guardian "verified" badge derivation** (Low) — the badge at `psbt.ts` is derived from
  allowlist-existence rather than the matched key; fail-safe today (signing is gated on the real
  per-key match), but the badge should track the matched key.
- **Unreconciled non-signed-input values feeding the displayed fee** (Info) — self-defeating
  griefing (yields an invalid tx), not theft; consider surfacing an "unverified co-signer value"
  indicator.

## Network scope note — `regtest` (intentional, by design)

`regtest` is a supported network for the local DUCAT development stack. Its security posture
differs from the production networks (mainnet/signet/mutinynet) in **one deliberate way**, called
out here so it reads as intended rather than as a missed control:

- **Guardian allowlist is intentionally empty on regtest** (`DUCAT_GUARDIAN_PUBKEYS.regtest = []`).
  The local stack runs an ephemeral guardian whose key is not knowable in advance, so the Snap does
  **not** pin a guardian key for regtest. `isKnownGuardianPubkey('regtest', …)` therefore accepts
  any guard key on the cosign leaf.
- **This is not blind-signing.** The cosign leaf is still fully structurally validated (true 2-of-2,
  client == derived vault key, leaf→output-key commitment, leaf-signed-is-leaf-verified). The only
  relaxation is the *known-key* check, and the confirmation dialog surfaces the cosigner as
  **"Not verified as a Ducat guardian" (warning)** for explicit user verification
  (`src/confirmations.ts`).
- **No effect on production networks.** mainnet/signet/mutinynet allowlists remain pinned and
  `guardianAllowlistEnforced()` is `true` for them; the regtest relaxation is scoped to the
  `regtest` value only.
- **Endpoints are localhost** (esplora `http://localhost:3002`, validator `http://localhost:8083`)
  and regtest coins carry no value, bounding real-world impact to a local developer's own stack.

The `regtest` network ships in the published bundle (it is a runtime network value, not a build-time
dev gate), so it is in audit scope. The *other* dev affordances added alongside it —
`DUCAT_SNAP_DEBUG` logging and `DUCAT_SNAP_DEV_ORIGINS` (localhost origin allowlisting) — are
build-time gated, default-off, and dead-code-eliminated from the published/audited build (same
pattern as `DUCAT_SNAP_DEV_UNPROMPTED`); the committed `snap.manifest.json` stays HTTPS-Ducat-only
and a verify-gate test (`src/__tests__/rpc.test.ts`) fails the release if a dev-patched manifest is
ever committed.
- **Unbounded response-body reads from hardcoded esplora/validator endpoints** (Info) — only
  reachable by compromising that semi-trusted infra, outside the dapp-parameter threat model.
- **`snap_manageState` does not explicitly pin `encrypted: true`** (Info) — relies on the SDK
  default; no key material is ever stored in state.
- **`signet`/`mutinynet` both map to bitcoinjs `testnet`** (Info) — identical testnet address
  format; no displayed-vs-signed divergence.
