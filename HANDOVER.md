# DayTimer Handover — 2026-05-08

## What's Deployed & Working

**v5.3.4** is the last released version on GitHub. **v5.4.0** is built and ready to commit/tag.

### Changes in v5.4.0 (this session):
- **Bug fix**: Tour z-order race — widget window is now hidden from the main process before `start-tour` is sent, so its `alwaysOnTop` can't overlay the onboarding tour tooltips
- **Bug fix**: Categories desync — added a 3-second delayed second `loadCategories()` call after auth ready, catches first-install race where categories table was empty on first fetch
- **Bug fix**: Troop dot colours — `updateTroopBadge()` now detects missing colour data and calls `loadCategories()` before rendering (one attempt, guarded against infinite loop with `_troopColorLoadAttempted` flag)
- **Bug fix**: Streak weekends — streak counter now skips weekends and UK bank holidays (England & Wales, 2025–2027 pre-loaded). Badge tooltip updated to "working days in a row"
- **Feature**: Inbound call button — ☎ button appears in widget titlebar when day is started. Click logs the current task as a normal entry, then sets up "Inbound call" as the next entry with `entry_type='inbound_call'`. Button highlights while on call; Next Task logs it and clears the state.
- **Feature**: User initial in sidebar — main app sidebar logo now shows the first letter of the signed-in user's name (derived from email local part) instead of hardcoded "D". Updates on auth ready and on `user-info` IPC.
- **Icon update**: Updated icon.ico + icon.png already in build folder — will be picked up by next build automatically

## Nothing In Progress

No half-finished work. Clean state. Just needs commit + tag to release.

## Release Steps

```
cd C:\ai_projects\daytimer
git add -A
git commit -m "v5.4.0: fix tour z-order, categories desync, troop colours, streak weekends; add inbound call btn, user initial"
git push origin main
git tag v5.4.0
git push origin v5.4.0
```

Then poll GitHub until release assets appear (~2 min build).

## Quick Reference

- **Repo**: https://github.com/FlynnAskew/daytimer
- **Supabase**: wjepdxhpcvpynpdgtivd
- **Current version**: 5.4.0 (not yet released)
- **Build time**: ~2 minutes on GitHub Actions
