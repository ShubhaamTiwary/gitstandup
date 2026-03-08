# GitStandup Chrome Extension v2

A Manifest V3 Chrome extension that:
- stores your GitHub token and Gemini API key locally in encrypted form using a user-provided passphrase
- fetches your GitHub commit activity for a selected date
- maps commits to associated PRs where possible
- distinguishes merged PR work, open PR work, direct default-branch work, and uncategorized commits
- lets you add manual extra context
- generates a structured standup draft with the Gemini API

## Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

## Required secrets
- GitHub username
- GitHub personal access token (repo read scope recommended for private repos)
- Gemini API key
- A passphrase you choose for local encryption

## Notes
- Secrets are encrypted with AES-GCM using a key derived from your passphrase via PBKDF2.
- If you forget the passphrase, the extension cannot decrypt the saved secrets.
- This is client-side encryption inside the extension. It protects saved values at rest in `chrome.storage.local`, but it is not equivalent to hardware-backed secure storage.

## Recommended next upgrades
- repo filter UI
- week range support
- Slack export
- PR diff summarization
- better today/blockers inference
