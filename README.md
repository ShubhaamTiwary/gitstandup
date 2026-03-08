# GitStandup

<img width="300" height="400" alt="GitStandup UI" src="https://github.com/user-attachments/assets/069a419a-3047-449b-9c24-2deac275c3e9" />

Turn your daily GitHub activity into a clear, human-sounding standup draft in seconds.

## Why GitStandup
- Converts raw commits and PR activity into readable updates
- Separates completed vs in-progress work
- Includes manual context for non-code tasks
- Outputs polished markdown ready to post

## How It Works
1. Select a date
2. Fetch GitHub activity (commits + PR/review signals)
3. Normalize and classify work
4. Generate standup draft with Gemini

## Quick Start
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (or `dist/`)

## Required Inputs
- GitHub username
- GitHub personal access token
- Gemini API key
- Master passphrase (for local encryption)

Recommended GitHub token access:
- Private repo read access (if you want private/org work included)
- Org SSO authorization (for org-owned private repos)

## Security
- Secrets are encrypted locally using `AES-GCM`
- Encryption key is derived from your passphrase via `PBKDF2`
- Encrypted payload is stored in `chrome.storage.local`

## Project Structure
- `manifest.json` — MV3 extension config
- `popup.html` — popup UI
- `styles.css` — visual design
- `popup.js` — crypto, GitHub fetch, classification, Gemini generation

## Notes
- GitHub may show private contribution counts even when API details are restricted by token access.
- If no activity appears, verify token scopes and org SSO permissions.
