# Windows Code Signing Setup (SignPath Foundation)

Clarity's Windows releases are **hard-blocked until signing is configured** — the release
workflow refuses to build an unsigned installer (SmartScreen would flag it with the
"Windows protected your PC" dialog). This document walks you through enabling real signing
for free via **SignPath Foundation**.

Once configured, everything is automatic: pushing a `v*` tag builds the installer, submits
it to SignPath, and attaches the **signed installer** to the GitHub release.

## Why SignPath Foundation (instead of Azure)

| Option | Cost | Notes |
|---|---|---|
| **SignPath Foundation** | **Free** | Certificate is issued to *SignPath Foundation* (not to you). Requires your project to be an eligible open-source project. |
| Azure Trusted Signing / Artifact Signing | $9.99/month + paid Azure subscription | Signatures show *your* validated name. Microsoft explicitly does not support free/trial/sponsored Azure subscriptions. |

SignPath Foundation is a nonprofit that provides a code-signing certificate for
qualifying open-source projects. The signature is a **real, Windows-trusted Authenticode
signature** (Sectigo-issued), so it removes most SmartScreen warnings from day one — the
certificate already carries reputation from projects like vim and flameshot. The only cost
is that the **publisher name shows "SignPath Foundation"** rather than your name.

## Eligibility (read first)

- The project must be **open-source** with a publicly accessible repository (✓ Clarity is).
- The project must have **already released software** in the form that needs signing
  (✓ Clarity ships v1.0.x releases).
- The functionality must be documented on the download page (✓ README covers this).
- You must follow SignPath Foundation's **Code of Conduct**, and the software must not be
  malicious or adware-bundled.
- SignPath reserves the right to revoke the certificate if a project violates the Code of
  Conduct (retroactive revocation). For a legitimate OSS project this is not a practical
  concern.

## What you'll end up with

**1 GitHub secret** (the API token SignPath's GitHub Action uses to submit signing requests):

- `SIGNPATH_API_TOKEN`

**4 GitHub variables** (non-secret values identifying your SignPath project — the slugs you
create in the SignPath dashboard):

- `SIGNPATH_ORGANIZATION_ID` — your SignPath organization ID
- `SIGNPATH_PROJECT_SLUG` — your SignPath project slug
- `SIGNPATH_SIGNING_POLICY_SLUG` — your signing policy slug (e.g. `release-signing`)
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` — the artifact configuration that describes how to
  sign the `.exe`

---

## Step 1 — Apply to SignPath Foundation

1. Go to https://signpath.org/ and click **Apply**.
2. Fill in the application with your repository URL and release info. Approval is not
   instant — expect **days to weeks** (it's a human-reviewed process).
3. Once approved, you'll get an account on the SignPath platform.

## Step 2 — Install the SignPath GitHub App

1. Go to https://github.com/apps/signpath and install it into the Clarity repository
   (or the org that owns it).
2. Grant it access to the repository. This lets SignPath verify the build really came from
   your GitHub Actions workflow (origin verification) and download the artifact to sign.

## Step 2b — Add the GitHub trusted build system and link it to the project

**Do not skip this.** Installing the GitHub App is not sufficient on its own, and
omitting this step is the single most likely reason a correctly-configured token still
fails. The connector refuses submissions from an organisation that has no trusted build
system for GitHub, and the error it returns does not say so.

In the SignPath dashboard (`app.signpath.io`):

1. Open your organisation → **Trusted Build Systems**.
2. Add the predefined **GitHub.com** build system to the organisation.
3. Open the Clarity project → link the **GitHub.com** trusted build system to it.

Both actions are required: adding it to the organisation alone leaves the project
unlinked, and the submission is still rejected.

Reference: https://docs.signpath.io/trusted-build-systems/github

## Step 3 — Create a project, artifact configuration, and signing policy

In the SignPath dashboard (`app.signpath.io`):

1. **Project** — create one for Clarity, e.g. slug `clarity`. Set the repository URL to
   `https://github.com/CaptainHacX/Clarity`.
2. **Artifact configuration** — create one describing a single Windows executable
   (Authenticode). Upload a sample unsigned `Clarity-Setup-<version>.exe` or use the EXE
   template. Name it e.g. `exe-signing`.
3. **Signing policy** — create one, e.g. slug `release-signing`, and link it to the
   certificate provided by SignPath Foundation. Add your **CI user** (see Step 4) as a
   Submitter.

> The GitHub connector performs origin verification for OSS projects: the artifact must be
> uploaded as a GitHub Actions artifact and all jobs must run on GitHub-hosted runners.
> The release workflow already does exactly this.

## Step 4 — Create an API token

1. In the SignPath dashboard, create a dedicated **CI user** (recommended) or use your own
   interactive user.
2. Generate an **API token** for that user (under user settings → API tokens).
3. The token must belong to a user with **Submitter** permission on the signing policy
   from Step 3. This is the `SIGNPATH_API_TOKEN` value — copy it now, it's shown once.

## Step 5 — Add the secret and variables to GitHub

1. GitHub repo → **Settings → Secrets and variables → Actions**.
2. **Secrets** tab → **New repository secret**:
   | Secret | Value |
   |---|---|
   | `SIGNPATH_API_TOKEN` | The API token from Step 4 |
3. **Variables** tab → **New repository variable**:
   | Variable | Value |
   |---|---|
   | `SIGNPATH_ORGANIZATION_ID` | Your SignPath organization ID |
   | `SIGNPATH_PROJECT_SLUG` | e.g. `clarity` |
   | `SIGNPATH_SIGNING_POLICY_SLUG` | e.g. `release-signing` |
   | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | e.g. `exe-signing` |

## Step 6 — Verify end-to-end

1. Push a `v*` tag. Open **Actions** → the **Release** workflow → the **Windows** job.
   - The job must build the installer, upload it, submit the signing request, and the
     final **Publish signed installer to release** step must pass.
   - `Clarity-Setup-<version>.exe` appears on the release page **signed**.
2. Confirm the signature locally (PowerShell on any Windows machine):

   ```powershell
   Get-AuthenticodeSignature .\Clarity-Setup-1.0.2.exe
   ```

   `Status` should be `Valid` and `SignerCertificate.Subject` should contain
   **SignPath Foundation**.

---

## How the release workflow signs Windows builds

For Windows only, the release job:

1. Builds the installer **unsigned** (`electron-builder --win`, no publish).
2. Uploads the unsigned `.exe` as a GitHub Actions artifact (`archive: false`, so it's the
   raw file).
3. Submits it to SignPath via
   `signpath/github-action-submit-signing-request@v2` and waits for completion.
4. Downloads the signed `.exe`, **regenerates `latest.yml`** (signing changes the binary,
   so the sha512 recorded for the unsigned build would otherwise be stale), and uploads the
   signed installer + metadata to the release.

macOS and Linux builds are unaffected.

---

## Troubleshooting

**Job fails at "Verify SignPath Foundation configuration"**
One of the 5 required settings is missing. Check that `SIGNPATH_API_TOKEN` is a **secret**
and the four slugs are **variables** (not secrets), and the names match exactly.

**"Could not authorize against SignPath API" — read the lines above it first**

This message is the action's catch-all: it is printed for a rejected token *and* for a
server error, so on its own it says almost nothing. Scroll up in the step log. If you see

```
SignPath REST API is temporarily unavailable (server responded with 503).
```

then the connector returned **HTTP 503** and the token is very likely fine. In order of
likelihood:

1. **The GitHub.com trusted build system is not added to the organisation, or not linked
   to the project** — see Step 2b. This is the usual cause when signing has *never* worked.
2. The API token's user is not a **Submitter** on the signing policy.
3. One of the slugs (`SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`,
   `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`) does not exist under that organisation id.
4. SignPath is genuinely degraded — check https://about.signpath.io/status.

The release workflow runs a **Preflight SignPath connector** step before building, which
prints the connector's raw HTTP status. Read that first; it distinguishes "service
unavailable" from "credentials rejected" in one line, without waiting for a 20-minute
build.

Note that the known integer-overflow bug with large GitHub artifact IDs (GitHub's global
IDs crossed max-int in Nov 2024) was fixed **server-side** in GitHub Connector 1.0.1 and
1.1.0. It is not a cause of current failures and needs no action version change.

**Blocked on signing and need to ship?** Set the repository variable
`ALLOW_UNSIGNED_WINDOWS` to `true`. The release then publishes an **unsigned** installer
plus valid `latest.yml`, with a warning in the job log — SmartScreen will warn users on
install. Unset it as soon as signing works. Leaving it set silently ships unsigned builds
forever, which defeats the point of this document.

**Signing request is rejected / origin verification fails**
- The **SignPath GitHub App** must be installed (Step 2) and the workflow must run on
  GitHub-hosted runners (it does).
- The **project repository URL** must match this repo.
- The signing policy must allow the **branch** you're pushing the tag from (usually `main`).
- The CI user must be a **Submitter** on the signing policy.

**"Artifact type not supported" / upload format errors**
The **artifact configuration** (Step 3) must describe a **Windows executable** (Authenticode
EXE), not a generic zip. If you used the sample-upload route, upload the actual
`Clarity-Setup-<version>.exe`.

**`signed-installer/Clarity-Setup-<version>.exe` not found after signing**
The download step found no signed artifact under the expected name. Check the signing
request in the SignPath dashboard for errors, and confirm the artifact configuration's
output file name matches `Clarity-Setup-<version>.exe`.

**Signature is valid but SmartScreen still shows once**
Normal for a freshly-issued certificate on a brand-new publisher lineage. Windows builds
reputation as installs grow; users click **More info → Run anyway** once. Because SignPath
Foundation's certificate already has OSS reputation, this is usually minimal from day one.

---

## Related

- [SignPath Foundation application](https://signpath.org/)
- [SignPath GitHub Action docs](https://docs.signpath.io/trusted-build-systems/github)
- [Apple signing (macOS)](./SIGNING.md)
