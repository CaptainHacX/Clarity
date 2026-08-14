# Windows Code Signing Setup (Azure Trusted Signing / Artifact Signing)

Clarity's Windows releases are **hard-blocked until signing is configured** — the release
workflow refuses to build an unsigned installer (SmartScreen would flag it with the
"Windows protected your PC" dialog, which is a trust-killer for downloads). This document
walks you through enabling real signing via Microsoft's **Azure Trusted Signing** service
(renamed **Azure Artifact Signing** in 2026).

Once configured, everything is automatic: pushing a `v*` tag produces a **signed
installer** on the GitHub release.

## Cost & eligibility (read this first)

| Item | Detail |
|---|---|
| Cost | **$9.99/month** (Basic) for up to 5,000 signatures, then $0.005/signature. Premium: $99.99/mo for 100,000. |
| What you need | A Microsoft account + an Azure **Pay-As-You-Go** subscription. |
| Eligibility | Identity validation is limited to **US / Canada / EU / UK** entities (individuals or organizations). If you're outside these regions, Trusted Signing won't accept you — you'd need a CA-issued code signing certificate instead. |
| Identity check | Microsoft verifies your identity (name/organization) and it takes **hours to days**; it must be renewed yearly. |
| Reputation | A standard (non-EV) signature removes most of SmartScreen's scariness but may still show a **one-time** "More info → Run anyway" on very first run until Windows builds reputation. Full clearance needs an EV certificate (~$100s/yr) or a track record of installs. |

If the monthly fee is a blocker, the same options from `SIGNING.md` apply: get added to an
organization that already has a Trusted Signing account, or fund it via GitHub Sponsors.

## What you'll end up with

**3 GitHub secrets** (credentials for a service principal the CI uses):

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

**4 GitHub variables** (non-secret values that identify your Azure signing resources):

- `AZURE_SIGNING_ENDPOINT` — e.g. `https://eus.codesigning.azure.net`
- `AZURE_SIGNING_ACCOUNT` — your **Trusted Signing account** name
- `AZURE_SIGNING_PROFILE` — your **certificate profile** name
- `AZURE_SIGNING_PUBLISHER` — the exact identity-validation name shown as the publisher

---

## Step 1 — Create an Azure subscription

1. Go to https://azure.microsoft.com/free/ and sign up (or sign in if you have an account).
2. Create a **Pay-As-You-Go** subscription. The free-trial credit is nice for other Azure
   things, but **Trusted Signing itself is paid** — it's not covered by the free tier.

## Step 2 — Create the Trusted Signing account

1. In the Azure portal, search for **"Trusted Signing Accounts"** (may appear as
   **Artifact Signing**).
2. Click **Create** and fill in:
   - **Account name:** lowercase, no spaces — e.g. `clarity-signing`
     (this exact string becomes the `AZURE_SIGNING_ACCOUNT` variable)
   - **Region:** **East US** (matches the `https://eus.codesigning.azure.net` endpoint;
     use the region that gives you that endpoint — East US is the safe default)
   - **Pricing:** Basic
3. After creation, open the resource and copy the **Account Endpoint**
   (something like `https://eus.codesigning.azure.net`) → `AZURE_SIGNING_ENDPOINT`.

## Step 3 — Give yourself permission to validate identity

1. Trusted Signing account → **Access control (IAM)** → **Add role assignment**.
2. Role: **Trusted Signing Identity Verifier** → assign to your Azure account.

## Step 4 — Validate your identity

1. Trusted Signing account → **Identity Validations** → **Request identity validation**.
2. Choose **Individual** or **Organization** and upload the requested documents
   (government ID; for an organization: business registration + proof you may sign).
3. The **name you enter here is the publisher name** that appears on the signed file
   (e.g. `Advent Development, Inc.` or your legal name). It must match the
   `AZURE_SIGNING_PUBLISHER` variable exactly.
4. Wait for approval — **hours to days** (Microsoft is explicit that you cannot create
   certificate profiles before this completes).

## Step 5 — Create the certificate profile

1. Trusted Signing account → **Certificate Profiles** → **Create**.
2. Profile type: **Public Trust** (this is what makes signatures trusted by Windows).
3. Select your **validated identity** from Step 4.
4. Name it, e.g. `clarity-sign`
   (this exact string becomes the `AZURE_SIGNING_PROFILE` variable).

## Step 6 — Create an App Registration (the CI's identity)

The GitHub Action can't log in as you — it needs its own identity in Microsoft Entra ID.

1. Microsoft Entra ID → **App registrations** → **New registration**.
2. Name: e.g. `clarity-codesign` → Register.
3. On the app's overview page, copy:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`
4. **Certificates & secrets** → **New client secret** → choose an expiry (longest
   available, and rotate before it expires) → **copy the Value now** — Azure shows it
   only once → `AZURE_CLIENT_SECRET`.

## Step 7 — Grant the app the right to sign

1. Trusted Signing account → **Access control (IAM)** → **Add role assignment**.
2. Role: **Trusted Signing Certificate Profile Signer**.
3. Assign it to the **app registration** you made in Step 6 — search for
   `clarity-codesign`. **Double-check you're assigning to the app, not to yourself** —
   getting this wrong produces confusing 403 errors.

## Step 8 — Add the secrets and variables to GitHub

1. GitHub repo → **Settings → Secrets and variables → Actions**.
2. **Variables** tab → **New repository variable**:
   | Variable | Example value |
   |---|---|
   | `AZURE_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net` |
   | `AZURE_SIGNING_ACCOUNT` | `clarity-signing` |
   | `AZURE_SIGNING_PROFILE` | `clarity-sign` |
   | `AZURE_SIGNING_PUBLISHER` | `Advent Development, Inc.` (the name from Step 4 — exact match) |
3. **Secrets** tab → **New repository secret**:
   | Secret | Value |
   |---|---|
   | `AZURE_TENANT_ID` | Directory (tenant) ID from Step 6 |
   | `AZURE_CLIENT_ID` | Application (client) ID from Step 6 |
   | `AZURE_CLIENT_SECRET` | Client secret **Value** from Step 6 |

> No `AZURE_CREDENTIALS` secret is needed — the workflow authenticates with these three
> secrets via electron-builder's Azure module.

## Step 9 — Verify end-to-end

1. Push a `v*` tag. Open **Actions** → the **Release** workflow → the **Windows** job.
   - The **Build, package, and upload** step must pass (it now hard-fails if any secret or
     variable is missing).
   - `Clarity-Setup-<version>.exe` appears on the release page.
2. Confirm the signature locally (PowerShell on any Windows machine):

   ```powershell
   Get-AuthenticodeSignature .\Clarity-Setup-1.0.2.exe
   ```

   `Status` should be `Valid` and `SignerCertificate.Subject` should contain your
   publisher name.

---

## Troubleshooting

**403 / "Forbidden" when signing**
Almost always the app registration (Step 6) is missing the **Trusted Signing Certificate
Profile Signer** role (Step 7), or the role was assigned to you instead of the app. Also
confirm `AZURE_SIGNING_PUBLISHER` matches the identity-validation name byte-for-byte.

**"Account not found" / "Profile not found"**
`AZURE_SIGNING_ACCOUNT` must be the **Trusted Signing account** name (not the app
registration name), and `AZURE_SIGNING_PROFILE` the **certificate profile** name — these
are two different things in Azure.

**Invalid endpoint / network error**
Use the exact **Account Endpoint** from the portal. East US = `https://eus.codesigning.azure.net`.

**Client secret rejected**
The secret **Value** (not the secret's ID) is required, and it must still be within its
expiry. Regenerate in Entra ID if needed.

**`AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` seen as empty on Windows**
The workflow only injects these secrets on the Windows runner. Verify you added them under
**Settings → Secrets** (not variables) and that the workflow run uses the updated secrets.

**Signature is valid but SmartScreen still shows once**
Normal for a freshly-issued standard (non-EV) cert. Windows builds reputation as installs
grow; users click **More info → Run anyway** once. EV signing eliminates it entirely but
costs more.

---

## Related

- [Apple signing (macOS)](./SIGNING.md)
- [Azure Trusted Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Microsoft: Set up Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/how-to-signing-integrations)
