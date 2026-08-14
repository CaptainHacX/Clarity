# Code Signing & Notarization Setup (macOS)

macOS releases are best shipped **signed and notarized** so every user gets a clean,
Gatekeeper-approved install. Until the Apple secrets below are configured, the release
pipeline ships an **ad-hoc signed** build that users must approve once
(see README → "Installing on macOS"). The moment you add the secrets, the same workflow
automatically switches to proper Developer ID signing + notarization — no pipeline changes
needed.

This document walks you through creating the certificate and wiring the secrets into GitHub.

## Why this matters

Without signing + notarization, macOS users see:

```
"Clarity" cannot be opened because the developer cannot be verified.
```

They can still approve the app once via **System Settings → Privacy & Security → Open
Anyway**, but that extra step sends less technical users away. Signed + notarized builds
open cleanly for everyone with zero friction.

## Requirements

- A **paid** Apple Developer account (membership is required — free Apple IDs cannot
  sign or notarize). If you don't have one: https://developer.apple.com/programs/
- Two-factor authentication (2FA) enabled on the Apple ID used for notarization.
- **Admin** (or "Manage Actions secrets") access to the GitHub repository.

You need **5 secrets**, which fall into two groups:

| GitHub secret | What it is |
|---|---|
| `MAC_CERTIFICATE_P12` | Your "Developer ID Application" certificate, exported as `.p12`, then base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID **email** (used for notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password generated for that Apple ID |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer **Team ID** |

---

## Step 1 — Find your Team ID

1. Go to https://developer.apple.com/account and sign in.
2. Click **Membership details** (bottom of the left sidebar).
3. Copy the **Team ID** — a 10-character string like `AB12CD3456`.

Save it — this is the `APPLE_TEAM_ID` secret.

## Step 2 — Create a "Developer ID Application" certificate

1. Go to **Certificates, Identifiers & Profiles**:
   https://developer.apple.com/account/resources/certificates/list
2. Click **+** (Create a certificate).
3. Under **Software**, choose **Developer ID Application**.
   > **Important:** *not* "Mac App Distribution" and *not* "Apple Distribution". You want
   > **Developer ID Application** — it signs apps distributed outside the Mac App Store,
   > which is what Clarity does.
4. Click **Continue**. You'll be asked for a Certificate Signing Request (CSR):
   - On your Mac, open **Keychain Access** → menu **Keychain Access** → **Certificate
     Assistant** → **Request a Certificate From a Certificate Authority…**
   - Enter your Apple ID email and your name. Select **Saved to disk**, **Let me specify
     key pair information**, with **Key Size: 2048** and **Algorithm: RSA**.
   - Save the `.certSigningRequest` file and upload it on the Apple site.
5. Click **Continue**. Apple issues your certificate — download the `.cer` file and
   double-click it to install it into **Keychain Access → My Certificates**.

   You should now see an entry like *Developer ID Application: Advent Development, Inc.
   (TEAMID)* **with an attached, expandable private key**.

   Verify from a terminal:

   ```bash
   security find-identity -v -p codesigning
   ```

   You should see a `1) <hash> "Developer ID Application: ... (TEAMID)"` line. If it shows
   "0 valid identities found", the certificate isn't installed or the private key is
   missing (see Troubleshooting).

## Step 3 — Create an app-specific password (for notarization)

Notarization submits the app to Apple's servers and is authenticated with an
**app-specific password** — you never expose your real Apple ID password.

1. Go to https://account.apple.com/sign-in and sign in with your Apple ID.
2. **Sign-in and Security** → **App-Specific Passwords** → **Generate**.
   (If you don't see the option, enable 2FA first.)
3. Name it something like `clarity-notarize` — Apple shows you a password like
   `abcd-efgh-ijkl-mnop`.
4. Copy it immediately — it's shown only once.

Save it — this is the `APPLE_APP_SPECIFIC_PASSWORD` secret.

## Step 4 — Export the certificate as a `.p12`

1. In **Keychain Access → My Certificates**, expand your *Developer ID Application*
   certificate, right-click the **private key** underneath it, and choose **Export**.
2. Save as `Clarity-DeveloperID.p12` (format: **Personal Information Exchange (.p12)**).
3. Set a **password** you choose — you'll need it again in a second.

> Exporting from the private key (not the certificate itself) guarantees the key is
> bundled in the `.p12`.

Save this password — it's the `MAC_CERTIFICATE_PASSWORD` secret.

## Step 5 — Base64-encode the `.p12`

GitHub secrets can't hold binary files, so the workflow expects the `.p12` **base64-encoded
on a single line**. On your Mac:

```bash
base64 -i Clarity-DeveloperID.p12 | tr -d '\n' > Clarity-DeveloperID.p12.b64
```

Open `Clarity-DeveloperID.p12.b64` and copy its full contents.

> The `tr -d '\n'` matters — a value wrapped across lines will make the workflow fail with
> something like *"unable to load p12"*.

Save this — it's the `MAC_CERTIFICATE_P12` secret.

## Step 6 — Add the secrets to GitHub

1. Open the repository on GitHub: **Settings** → **Secrets and variables** →
   **Actions**.
2. Click **New repository secret** and add each of the five (paste the value, don't
   include quotes or spaces):

   | Secret name | Value |
   |---|---|
   | `MAC_CERTIFICATE_P12` | Full contents of `Clarity-DeveloperID.p12.b64` (one long line) |
   | `MAC_CERTIFICATE_PASSWORD` | The `.p12` export password from Step 4 |
   | `APPLE_ID` | Your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | The `abcd-efgh-ijkl-mnop` password from Step 3 |
   | `APPLE_TEAM_ID` | The 10-character Team ID from Step 1 |

3. **Security hygiene afterwards:**
   - Delete `Clarity-DeveloperID.p12` and `Clarity-DeveloperID.p12.b64` from disk once the
     secrets are set (or keep the `.p12` in a password manager — it's a signing key, treat
     it like a password).
   - Never commit either file to the repository.

## Step 7 — Verify end-to-end

1. Commit a version bump and push a release tag (the workflow triggers on `v*` tags):

   ```bash
   npm version patch --no-git-tag-version
   git add package.json CHANGELOG.md
   git commit -m "release: v0.1.2"
   git tag v0.1.2
   git push origin main --tags
   ```

2. Open **Actions** in GitHub. The `macOS` job of the **Release** workflow should:
   - The **Configure macOS code signing** step should complete with no errors (before the
     secrets exist it prints a warning and ships an ad-hoc build; once the secrets are set
     it signs for real).
   - Produce `Clarity-<version>-prod-arm64.dmg`, `Clarity-<version>-prod-x64.dmg`, and the
     matching `.zip` files on the GitHub release page.
3. Download the `.dmg` on a *different* Mac (or via a fresh download so it gets the
   quarantine attribute), mount it, and open the app. It should open with **no** Gatekeeper
   warning.
4. Confirm notarization explicitly:

   ```bash
   spctl -a -vv "/Volumes/Clarity/Clarity.app"
   ```

   Expected output ends with:

   ```
   source=Notarized Developer ID
   origin=Developer ID Application: Advent Development, Inc. (TEAMID)
   ```

---

## Testing locally (optional, on your Mac)

With the certificate installed in your Keychain (Step 2) you can reproduce the CI
signing locally:

```bash
export CSC_LINK="Clarity-DeveloperID.p12.b64"        # base64 of the .p12
export CSC_KEY_PASSWORD="<p12 password>"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="AB12CD3456"

npx electron-builder --mac -c.directories.output=dist-prod
```

(`CSC_LINK` also accepts a plain `.p12` file path; base64 works for both local and CI use.)

---

## Troubleshooting

**`cannot find valid "Developer ID Application" identity`**
The certificate isn't in the signing keychain, or the private key is missing.
Re-run `security find-identity -v -p codesigning`; if the key is absent, re-import:
`security import Clarity-DeveloperID.p12 -k ~/Library/Keychains/login.keychain-db -P '<p12 password>'`.
On CI this message means `MAC_CERTIFICATE_P12` / `MAC_CERTIFICATE_PASSWORD` are wrong.

**The release still ships an ad-hoc build even though you set the secrets**
One of the five secrets is missing, empty, or malformed — the workflow only switches to
real signing when all of them are set. Re-encode the `.p12` with
`base64 -i ... | tr -d '\n'` (no line breaks, no quotes, no trailing spaces) and update the
secret.

**Notarization errors like `The operation couldn’t be completed` or
`HTTP status code: 401`**
Check `APPLE_ID` is the exact Apple ID email, and `APPLE_APP_SPECIFIC_PASSWORD` matches the
generated value (they're case-sensitive). Confirm 2FA is on for that Apple ID.

**`-60007` / "The application bundle is not signed properly"**
You used the wrong certificate type (e.g. Mac App Distribution instead of Developer ID
Application), or `hardenedRuntime` was toggled off. Re-export the correct certificate.

**Certificate expires**
Developer ID certificates are time-limited. When one expires, issue a new one (Step 2),
re-export, re-encode, and update `MAC_CERTIFICATE_P12` + `MAC_CERTIFICATE_PASSWORD`.

---

## Windows (for reference)

The Windows installer is signed via **Azure Trusted Signing** using separate secrets —
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — plus four repo variables
(`AZURE_SIGNING_ENDPOINT` / `AZURE_SIGNING_ACCOUNT` / `AZURE_SIGNING_PROFILE` /
`AZURE_SIGNING_PUBLISHER`). No `AZURE_CREDENTIALS` secret is needed; the workflow
authenticates via the three secrets directly. That pipeline is independent of the Apple
secrets above — see [`WINDOWS_SIGNING.md`](WINDOWS_SIGNING.md) for the full setup guide.
The same fail-if-unsigned guard applies.
