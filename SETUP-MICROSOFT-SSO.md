# Microsoft SSO Setup Guide

This gets your @howleruk.com Microsoft accounts working as the login for DayTimer.
Estimated time: 15 minutes.

---

## Step 1 — Register the app in Azure

1. Go to https://portal.azure.com and sign in with your work Microsoft account
2. Search for **"App registrations"** in the top search bar → click it
3. Click **"New registration"**
4. Fill in:
   - **Name**: `DayTimer`
   - **Supported account types**: Select **"Accounts in this organizational directory only (Howler UK only - Single tenant)"**
     - This restricts login to @howleruk.com accounts only
   - **Redirect URI**: Select **"Web"** and enter:
     `https://YOUR_SUPABASE_PROJECT_REF.supabase.co/auth/v1/callback`
     - Find your project ref in Supabase → Settings → General → "Reference ID"
     - e.g. `https://abcdefghij.supabase.co/auth/v1/callback`
5. Click **Register**

---

## Step 2 — Get your credentials

On the app registration page:

1. Copy the **Application (client) ID** — looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
2. Copy the **Directory (tenant) ID** — on the same page, also a UUID

Then create a client secret:
1. Click **Certificates & secrets** in the left menu
2. Click **New client secret**
3. Description: `DayTimer`
4. Expires: **24 months**
5. Click **Add**
6. **Copy the secret Value immediately** — you can only see it once

---

## Step 3 — Configure Supabase

1. Go to your Supabase dashboard → **Authentication** → **Providers**
2. Find **Azure** and click to expand
3. Fill in:
   - **Azure client ID**: paste your Application (client) ID
   - **Azure client secret**: paste the secret Value from Step 2
   - **Azure tenant ID**: paste your Directory (tenant) ID (this restricts to your org)
4. Click **Save**

---

## Step 4 — Add GitHub Secrets

So the packaged app knows about Microsoft SSO, add to your GitHub repo secrets:

| Name | Value |
|---|---|
| `MS_TENANT_ID` | Your Directory (tenant) ID |

Go to: https://github.com/FlynnAskew/daytimer/settings/secrets/actions

---

## Step 5 — Test

1. Build and install a new version of DayTimer (push a new tag)
2. Open the app — you should see the Microsoft login screen
3. Sign in with your @howleruk.com account
4. If anyone tries to sign in with a non-@howleruk.com account, they'll be rejected

---

## How colleagues get access

There's no invite system to set up — just:
1. Send them the download link from your GitHub Releases page
2. They install and open the app
3. They click "Sign in with Microsoft" and use their @howleruk.com work account
4. Done — their account is created automatically

Their data is completely separate from yours — the Row Level Security in Supabase ensures they can only ever see their own entries.
