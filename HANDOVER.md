# DayTimer Handover — 2026-05-07

## What's Deployed & Working

**v5.3.4** is live on GitHub Releases with all assets:
- DayTimer-Setup-5.3.4.exe
- DayTimer-Setup-5.3.4.exe.blockmap
- latest.yml

Users will auto-update next time they open the app.

### Changes in this session:
- **v5.3.3**: Added CLAUDE.md (codebase guidelines for Claude Code), test comment in fun.js
- **v5.3.4**: Updated app icon (icon.ico + icon.png)

### Claude Code setup complete:
- CLAUDE.md created with full codebase documentation
- Release workflow verified end-to-end (commit → push → tag → GitHub Actions → published release)
- Git credentials working (no PAT needed)

## Nothing In Progress

No half-finished work. Clean state.

## Next Session — Pick One

### Known Bugs (priority order from brief):
1. **Tour z-order race**: Widget tour box overlays main app on initial run only — replay works fine
2. **Categories desync**: Widget shows stale defaults on first install until user changes something
3. **Troop dot colours**: `_cachedCategories` race condition causes missing category colours
4. **Streak weekends**: Counter resets on Sat/Sun — should skip weekends + UK bank holidays

### Feature Requests:
1. **Inbound call button**: 📞 icon on widget, pauses current task, logs as `inbound_call` entry_type
2. **User initial in widget**: Replace "D" logo with first letter of user's name (e.g. "F" for Flynn)

## Quick Reference

- **Repo**: https://github.com/FlynnAskew/daytimer
- **Supabase**: wjepdxhpcvpynpdgtivd
- **Current version**: 5.3.4
- **Build time**: ~2 minutes on GitHub Actions
