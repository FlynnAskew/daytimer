# 🚀 DayTimer v4 — Setup Guide

This guide walks you through everything needed to package DayTimer as a proper Windows installer, host it on GitHub, and have updates automatically flow to all your machines.

**Estimated time: 30–45 minutes for first-time setup. After this, releasing updates is a single command.**

---

## What we're going to do

1. Set up a GitHub repository for DayTimer
2. Add your Supabase keys as GitHub Secrets (so they're never committed in code)
3. Push the code to GitHub
4. Trigger the first build
5. Download the resulting `.exe` installer
6. Install on your laptop — proper Windows app, with auto-update built in

After this, every time you (or I) push a new version tag, GitHub builds a new installer in the cloud and your installed app picks it up automatically.

---

## Step 1 — Prepare the project locally

You should already have the `daytimer-v4` folder. Open it and:

### 1a. Copy your Supabase keys into a local config

1. Find the file `src/supabase-config.example.js`
2. **Copy it** (right-click → Copy, then paste in same folder)
3. Rename the copy to `src/supabase-config.js`
4. Open it in Notepad, replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY` with your real Supabase values

> **Why?** This is for testing locally. The real installer won't include this file — instead, GitHub Actions will create one fresh during build using GitHub Secrets (Step 4 below).

---

## Step 2 — Create the GitHub repository

1. Go to https://github.com (sign in with your account)
2. Click the **+** in the top-right → **New repository**
3. Settings:
   - **Repository name**: `daytimer`
   - **Description**: (optional) "Personal time tracking app"
   - **Public** ✓
   - **Do NOT** tick "Add a README", "Add .gitignore", or "Choose a license" — we have those already
4. Click **Create repository**

You'll see a page with instructions like *"…or push an existing repository from the command line"*. Keep it open — we'll use those commands in a moment.

---

## Step 3 — Update package.json with your GitHub username

1. Open `package.json` in Notepad
2. Find this section near the bottom:
   ```json
   "publish": [
     {
       "provider": "github",
       "owner": "REPLACE_WITH_YOUR_GITHUB_USERNAME",
       "repo": "daytimer"
     }
   ]
   ```
3. Replace `REPLACE_WITH_YOUR_GITHUB_USERNAME` with your actual GitHub username (e.g. `flynn-dorsetfire`)
4. Save the file

---

## Step 4 — Add your Supabase keys to GitHub Secrets

This is the magic that lets your code stay on a public repo without exposing your Supabase keys.

1. Go to your new GitHub repo page
2. Click **Settings** (top-right of the repo, NOT your account settings)
3. In the left sidebar: **Secrets and variables** → **Actions**
4. Click **New repository secret** and add these one at a time:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Your Supabase project URL (e.g. `https://abcdef.supabase.co`) |
   | `SUPABASE_ANON_KEY` | Your Supabase `anon` / `public` key (long string starting with `eyJ...`) |

   *(`MS_CLIENT_ID` is optional — we'll add it later when we set up Microsoft To Do)*

5. Confirm both show in the list. The values are encrypted — even you can't view them again, only update them.

---

## Step 5 — Upload code to GitHub

Now we push your local code up to the GitHub repo. You'll need **Git** installed.

### 5a. Install Git (if you haven't already)

1. Download from https://git-scm.com/download/win
2. Run installer with default options
3. Open Command Prompt and verify: `git --version`

### 5b. Push your code

Open Command Prompt and:

```
cd C:\Users\flynn\Downloads\daytimer-v4
```

```
git init
git add .
git commit -m "Initial commit"
git branch -M main
```

Then add the GitHub remote (replace `YOUR_USERNAME`):

```
git remote add origin https://github.com/YOUR_USERNAME/daytimer.git
git push -u origin main
```

**First time?** It'll ask you to log in via your browser. Follow the prompts.

If successful, refresh your GitHub repo page and you should see all the files there.

---

## Step 6 — Tag and trigger the first build

GitHub Actions only builds when you push a **git tag** starting with `v`. Let's tag the first version:

```
git tag v4.0.0
git push origin v4.0.0
```

Now go to your GitHub repo → **Actions** tab. You should see a workflow running called "Build & Release". It takes about 5–8 minutes.

When it finishes (green checkmark):

1. Go to **Releases** (right sidebar of repo, or just `https://github.com/YOUR_USERNAME/daytimer/releases`)
2. You should see **v4.0.0** with attached files including `DayTimer Setup 4.0.0.exe`
3. **Download the .exe** — that's your installer!

---

## Step 7 — Install on your laptop

1. Run the downloaded `.exe`
2. Windows might warn "Unknown publisher" — click **More info** → **Run anyway**
   - *(This warning goes away once we add code signing in a future phase)*
3. Choose where to install (default is fine)
4. Tick "Create desktop shortcut" / "Create start menu shortcut"
5. Done!

You should now have:
- 🖥️ Desktop shortcut to DayTimer
- 📋 Start Menu entry
- 🔄 Auto-update built in — when you push a new version, your installed app will detect it within hours and prompt to update

**You can now uninstall the v3 setup** (delete the `daytimer-v3` folder, remove the old shortcut). Your data is in Supabase — it'll all still be there in the new app.

---

## Pushing future updates

When you (or I) make changes:

```
# Make your code changes...
git add .
git commit -m "Describe what changed"
git push
```

To release the new version:

```
# Bump version in package.json (e.g. "4.0.1")
# Then:
git add package.json
git commit -m "Bump to 4.0.1"
git push
git tag v4.0.1
git push origin v4.0.1
```

GitHub Actions will rebuild and publish. Within a few hours, every installed copy will see the update available.

---

## Troubleshooting

### Build fails on GitHub

- Go to the **Actions** tab → click the failed workflow → check the logs
- Most common: missing GitHub Secret. Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` exist
- If a different package install error: copy the error and let me know

### "Unknown publisher" warning when installing

- This is normal until we add a code-signing certificate (~£100/year)
- Click "More info" → "Run anyway"
- For colleagues, you can right-click the `.exe` → Properties → tick "Unblock" before running

### Auto-update isn't picking up new versions

- Make sure version in `package.json` is incremented
- Tag must start with `v` (e.g. `v4.0.1`, not `4.0.1`)
- Tag version must match `package.json` version
- Check the Actions tab to see if the workflow ran successfully
- Updates check every 6 hours — restart the app to force an immediate check

### Git push asks for password and fails

- Modern GitHub requires a Personal Access Token, not a password
- Go to: GitHub → Settings (account) → Developer settings → Personal access tokens → Generate new token (classic)
- Give it `repo` scope
- Use that token as your password when prompted

---

## What's next (Phase 4 continued)

Once this is all working day-to-day, we'll layer in:

1. **Microsoft To Do auth flow** — needs Azure setup first (I'll walk you through it)
2. **User login** — so colleagues can each have their own data, and you can re-enable Supabase RLS
3. **Admin/team view** — see your team's category breakdowns without exposing individual task names

For now: get this packaged, install it, use it. Then we'll know what else needs polishing before sharing with the team.
