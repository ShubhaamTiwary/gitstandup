const STORAGE_KEYS = {
  profile: 'profile.v2',
  encryptedSecrets: 'encryptedSecrets.v2'
};

const FREE_TIER_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
];
const DEFAULT_MODEL = 'gemini-2.0-flash-lite';
const el = {
  githubUsername: document.getElementById('githubUsername'),
  githubToken: document.getElementById('githubToken'),
  geminiKey: document.getElementById('geminiKey'),
  geminiModel: document.getElementById('geminiModel'),
  passphrase: document.getElementById('passphrase'),
  standupDate: document.getElementById('standupDate'),
  tone: document.getElementById('tone'),
  extraContext: document.getElementById('extraContext'),
  activitySummary: document.getElementById('activitySummary'),
  standupOutput: document.getElementById('standupOutput'),
  statusLog: document.getElementById('statusLog'),
  unlockStatus: document.getElementById('unlockStatus'),
  saveSecretsBtn: document.getElementById('saveSecretsBtn'),
  unlockBtn: document.getElementById('unlockBtn'),
  clearSecretsBtn: document.getElementById('clearSecretsBtn'),
  generateBtn: document.getElementById('generateBtn'),
  copyBtn: document.getElementById('copyBtn')
};

const state = {
  secrets: null,
  activity: null,
  profile: null
};

function todayLocalISO() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now - tzOffset).toISOString().slice(0, 10);
}

function getUtcRangeForLocalDate(date) {
  const startLocal = new Date(`${date}T00:00:00`);
  const endLocal = new Date(`${date}T23:59:59.999`);
  return {
    from: startLocal.toISOString(),
    to: endLocal.toISOString()
  };
}

function log(message, data) {
  const timestamp = new Date().toLocaleTimeString();
  const suffix = data ? `\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}` : '';
  el.statusLog.textContent = `[${timestamp}] ${message}${suffix}\n\n${el.statusLog.textContent}`.trim();
}

function setUnlockStatus(locked) {
  el.unlockStatus.textContent = locked ? 'Locked' : 'Unlocked';
  el.unlockStatus.classList.toggle('unlocked', !locked);
}

function chromeStorageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function chromeStorageSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

function chromeStorageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 250000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(data, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = enc.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    version: 1,
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext)
  };
}

async function decryptJson(payload, passphrase) {
  const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function ensureSecretsUnlocked() {
  if (!state.secrets) {
    throw new Error('Secrets are locked. Unlock them first using your passphrase.');
  }
  return state.secrets;
}

async function saveProfile() {
  const selectedModel = el.geminiModel.value;
  const profile = {
    githubUsername: el.githubUsername.value.trim(),
    geminiModel: FREE_TIER_MODELS.includes(selectedModel) ? selectedModel : DEFAULT_MODEL
  };
  state.profile = profile;
  await chromeStorageSet({ [STORAGE_KEYS.profile]: profile });
}

async function loadSavedProfile() {
  const data = await chromeStorageGet([STORAGE_KEYS.profile, STORAGE_KEYS.encryptedSecrets]);
  const profile = data[STORAGE_KEYS.profile] || {};
  state.profile = profile;
  el.githubUsername.value = profile.githubUsername || '';
  const savedModel = profile.geminiModel || profile.openaiModel || DEFAULT_MODEL;
  el.geminiModel.value = FREE_TIER_MODELS.includes(savedModel) ? savedModel : DEFAULT_MODEL;
  setUnlockStatus(true);
  if (data[STORAGE_KEYS.encryptedSecrets]) {
    log('Encrypted secrets found locally. Enter your passphrase and click “Unlock secrets”.');
  } else {
    log('No encrypted secrets saved yet.');
  }
}

async function saveSecrets() {
  const githubUsername = el.githubUsername.value.trim();
  const githubToken = el.githubToken.value.trim();
  const geminiKey = el.geminiKey.value.trim();
  const geminiModel = FREE_TIER_MODELS.includes(el.geminiModel.value) ? el.geminiModel.value : DEFAULT_MODEL;
  const passphrase = el.passphrase.value;

  if (!githubUsername || !githubToken || !geminiKey || !passphrase) {
    throw new Error('GitHub username, GitHub token, Gemini key, and passphrase are all required.');
  }

  const encrypted = await encryptJson({ githubToken, geminiKey }, passphrase);
  await chromeStorageSet({ [STORAGE_KEYS.encryptedSecrets]: encrypted });
  state.secrets = { githubToken, geminiKey };
  setUnlockStatus(false);
  el.geminiModel.value = geminiModel;
  await saveProfile();
  log('Secrets encrypted and stored locally.');
}

async function unlockSecrets() {
  const passphrase = el.passphrase.value;
  if (!passphrase) throw new Error('Enter your passphrase first.');
  const data = await chromeStorageGet([STORAGE_KEYS.encryptedSecrets]);
  const encrypted = data[STORAGE_KEYS.encryptedSecrets];
  if (!encrypted) throw new Error('No encrypted secrets found. Save them first.');
  const secrets = await decryptJson(encrypted, passphrase);
  const normalizedSecrets = {
    githubToken: secrets.githubToken || '',
    geminiKey: secrets.geminiKey || secrets.openaiKey || ''
  };
  state.secrets = normalizedSecrets;
  setUnlockStatus(false);
  el.githubToken.value = normalizedSecrets.githubToken;
  el.geminiKey.value = normalizedSecrets.geminiKey;
  await saveProfile();
  log('Secrets unlocked for this popup session.');
}

async function clearSecrets() {
  await chromeStorageRemove([STORAGE_KEYS.profile, STORAGE_KEYS.encryptedSecrets]);
  state.secrets = null;
  state.profile = null;
  [
    el.githubUsername,
    el.githubToken,
    el.geminiKey,
    el.passphrase,
    el.extraContext,
    el.standupOutput,
    el.statusLog
  ].forEach((node) => { node.value !== undefined ? (node.value = '') : (node.textContent = ''); });
  el.geminiModel.value = DEFAULT_MODEL;
  el.activitySummary.innerHTML = 'No activity loaded yet.';
  el.activitySummary.classList.add('empty');
  setUnlockStatus(true);
  log('Saved profile and encrypted secrets cleared.');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function githubFetch(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }
  return response.json();
}

async function fetchGithubViewer(token) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub viewer lookup failed ${response.status}: ${text}`);
  }
  const user = await response.json();
  const scopes = response.headers.get('x-oauth-scopes') || '';
  return { login: user.login || '', scopes };
}

async function githubGraphQL(query, variables, token) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json();
  if (!response.ok || json.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors || json, null, 2)}`);
  }
  return json.data;
}

async function fetchContributionSnapshot(username, date, token) {
  const { from, to } = getUtcRangeForLocalDate(date);
  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
            repository {
              nameWithOwner
              isPrivate
              url
              defaultBranchRef { name }
            }
            contributions(first: 100) {
              totalCount
            }
          }
          pullRequestContributionsByRepository(maxRepositories: 100) {
            repository {
              nameWithOwner
              isPrivate
              url
              defaultBranchRef { name }
            }
            contributions(first: 100) {
              totalCount
            }
          }
          pullRequestReviewContributionsByRepository(maxRepositories: 100) {
            repository {
              nameWithOwner
              isPrivate
              url
              defaultBranchRef { name }
            }
            contributions(first: 100) {
              totalCount
            }
          }
          pullRequestContributions(first: 100) {
            nodes {
              occurredAt
              pullRequest {
                number
                title
                url
                state
                mergedAt
                repository {
                  nameWithOwner
                  url
                }
              }
            }
          }
          pullRequestReviewContributions(first: 100) {
            nodes {
              occurredAt
              pullRequest {
                number
                title
                url
                state
                mergedAt
                repository {
                  nameWithOwner
                  url
                }
              }
            }
          }
          hasAnyRestrictedContributions
          restrictedContributionsCount
        }
      }
    }
  `;
  const data = await githubGraphQL(query, { username, from, to }, token);
  const collection = data?.user?.contributionsCollection;
  const repoMap = new Map();
  const addRepos = (entries = []) => {
    for (const entry of entries) {
      const nameWithOwner = entry.repository.nameWithOwner;
      const existing = repoMap.get(nameWithOwner);
      const contributionCount = entry.contributions?.totalCount || 0;
      const next = {
        nameWithOwner,
        defaultBranch: entry.repository.defaultBranchRef?.name || 'main',
        contributionCount: (existing?.contributionCount || 0) + contributionCount,
        isPrivate: Boolean(entry.repository.isPrivate),
        url: entry.repository.url
      };
      repoMap.set(nameWithOwner, next);
    }
  };
  addRepos(collection?.commitContributionsByRepository || []);
  addRepos(collection?.pullRequestContributionsByRepository || []);
  addRepos(collection?.pullRequestReviewContributionsByRepository || []);

  const prMap = new Map();
  const addPrActivity = (nodes = [], activityType) => {
    for (const node of nodes) {
      const pr = node?.pullRequest;
      const repo = pr?.repository?.nameWithOwner;
      if (!repo || !pr?.number) continue;
      const key = `${repo}#${pr.number}`;
      if (!prMap.has(key)) {
        prMap.set(key, {
          repository: repo,
          prNumber: pr.number,
          prTitle: pr.title || `PR #${pr.number}`,
          state: String(pr.state || 'OPEN').toLowerCase(),
          mergedAt: pr.mergedAt || null,
          prUrl: pr.url || null,
          activityTypes: new Set()
        });
      }
      prMap.get(key).activityTypes.add(activityType);
    }
  };
  addPrActivity(collection?.pullRequestContributions?.nodes || [], 'OPENED_PR');
  addPrActivity(collection?.pullRequestReviewContributions?.nodes || [], 'REVIEWED_PR');

  return {
    repos: Array.from(repoMap.values()).filter((repo) => repo.contributionCount > 0),
    prActivities: Array.from(prMap.values()).map((item) => ({
      ...item,
      activityTypes: Array.from(item.activityTypes)
    })),
    hasAnyRestrictedContributions: Boolean(collection?.hasAnyRestrictedContributions),
    restrictedContributionsCount: collection?.restrictedContributionsCount || 0
  };
}

async function fetchContributionReposFallback(username, date, token) {
  const query = `author:${username} author-date:${date}`;
  try {
    const result = await githubFetch(`/search/commits?q=${encodeURIComponent(query)}&per_page=100`, token, {
      headers: {
        Accept: 'application/vnd.github.cloak-preview+json'
      }
    });
    const repoNames = [...new Set((result.items || []).map((item) => item.repository?.full_name).filter(Boolean))];
    const repos = [];
    for (const nameWithOwner of repoNames) {
      const repo = await githubFetch(`/repos/${nameWithOwner}`, token);
      repos.push({
        nameWithOwner,
        defaultBranch: repo.default_branch || 'main',
        contributionCount: 1,
        isPrivate: Boolean(repo.private),
        url: repo.html_url
      });
    }
    return repos;
  } catch (error) {
    log('Fallback repo discovery via commit search failed.', error.message || String(error));
    return [];
  }
}

async function fetchRepoCommits({ owner, repo, username, date, token }) {
  const { from: since, to: until } = getUtcRangeForLocalDate(date);
  const byAuthor = await githubFetch(`/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, token);
  let all = byAuthor;
  if (!all.length) {
    const broad = await githubFetch(`/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, token);
    const needle = username.toLowerCase();
    all = broad.filter((c) => {
      const authorLogin = (c.author?.login || '').toLowerCase();
      const committerLogin = (c.committer?.login || '').toLowerCase();
      return authorLogin === needle || committerLogin === needle;
    });
    if (all.length) {
      log(`Used fallback commit detection for ${owner}/${repo} (${all.length} matched by login).`);
    }
  }
  return all.map((c) => ({
    sha: c.sha,
    message: c.commit?.message || '',
    htmlUrl: c.html_url,
    apiUrl: c.url,
    date: c.commit?.author?.date || c.commit?.committer?.date,
    author: c.author?.login || username,
    repository: `${owner}/${repo}`
  }));
}

async function fetchDefaultBranchCommitShas({ owner, repo, username, date, defaultBranch, token }) {
  const { from: since, to: until } = getUtcRangeForLocalDate(date);
  const byAuthor = await githubFetch(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&author=${encodeURIComponent(username)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, token);
  let commits = byAuthor;
  if (!commits.length) {
    const broad = await githubFetch(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, token);
    const needle = username.toLowerCase();
    commits = broad.filter((c) => {
      const authorLogin = (c.author?.login || '').toLowerCase();
      const committerLogin = (c.committer?.login || '').toLowerCase();
      return authorLogin === needle || committerLogin === needle;
    });
  }
  return new Set(commits.map((c) => c.sha));
}

async function fetchAssociatedPullRequests({ owner, repo, sha, token }) {
  try {
    const pulls = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}/pulls`, token);
    return Array.isArray(pulls)
      ? pulls.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          mergedAt: pr.merged_at,
          url: pr.html_url,
          baseRef: pr.base?.ref || null,
          headRef: pr.head?.ref || null,
          updatedAt: pr.updated_at
        }))
      : [];
  } catch (error) {
    log(`PR association lookup failed for ${owner}/${repo}@${sha.slice(0, 7)}. Treating as no PR match.`, error.message);
    return [];
  }
}

async function fetchPullRequestActivities({ username, date, token }) {
  const openedQuery = `is:pr author:${username} created:${date}`;
  const reviewedQuery = `is:pr reviewed-by:${username} updated:${date}`;
  const [opened, reviewed] = await Promise.all([
    githubFetch(`/search/issues?q=${encodeURIComponent(openedQuery)}&per_page=100`, token),
    githubFetch(`/search/issues?q=${encodeURIComponent(reviewedQuery)}&per_page=100`, token)
  ]);

  const map = new Map();
  const ingest = (items, sourceType) => {
    for (const item of items || []) {
      if (!item.pull_request?.url) continue;
      const match = String(item.repository_url || '').match(/\/repos\/([^/]+\/[^/]+)$/);
      if (!match) continue;
      const repository = match[1];
      const key = `${repository}#${item.number}`;
      if (!map.has(key)) {
        map.set(key, {
          repository,
          prNumber: item.number,
          prTitle: item.title || `PR #${item.number}`,
          issueState: item.state || 'open',
          activityTypes: new Set()
        });
      }
      map.get(key).activityTypes.add(sourceType);
    }
  };

  ingest(opened.items, 'OPENED_PR');
  ingest(reviewed.items, 'REVIEWED_PR');

  const activities = [];
  for (const item of map.values()) {
    const [owner, repo] = item.repository.split('/');
    try {
      const pr = await githubFetch(`/repos/${owner}/${repo}/pulls/${item.prNumber}`, token);
      activities.push({
        repository: item.repository,
        prNumber: item.prNumber,
        prTitle: pr.title || item.prTitle,
        state: pr.state || item.issueState,
        mergedAt: pr.merged_at || null,
        prUrl: pr.html_url || null,
        activityTypes: Array.from(item.activityTypes)
      });
    } catch (error) {
      activities.push({
        repository: item.repository,
        prNumber: item.prNumber,
        prTitle: item.prTitle,
        state: item.issueState,
        mergedAt: null,
        prUrl: null,
        activityTypes: Array.from(item.activityTypes)
      });
    }
  }
  return activities;
}

function chooseBestPr(prs, defaultBranch) {
  if (!prs.length) return null;
  const scored = [...prs].sort((a, b) => {
    const score = (pr) => {
      let total = 0;
      if (pr.mergedAt) total += 100;
      if (pr.baseRef === defaultBranch) total += 30;
      if (pr.state === 'open') total += 10;
      return total;
    };
    return score(b) - score(a);
  });
  return scored[0];
}

function normalizeWorkItems({ repos, repoData, prActivities = [] }) {
  const workItems = [];
  const seenPrs = new Map();

  for (const repoInfo of repos) {
    const bundle = repoData[repoInfo.nameWithOwner];
    if (!bundle) continue;
    const { commits, defaultBranchShas, prAssociations } = bundle;
    for (const commit of commits) {
      const prs = prAssociations[commit.sha] || [];
      const chosenPr = chooseBestPr(prs, repoInfo.defaultBranch);
      if (chosenPr) {
        const key = `${repoInfo.nameWithOwner}#${chosenPr.number}`;
        if (!seenPrs.has(key)) {
          seenPrs.set(key, {
            type: chosenPr.mergedAt ? 'MERGED_PR_WORK' : 'OPEN_PR_WORK',
            repository: repoInfo.nameWithOwner,
            repoUrl: repoInfo.url,
            prNumber: chosenPr.number,
            prTitle: chosenPr.title,
            prUrl: chosenPr.url,
            state: chosenPr.state,
            mergedAt: chosenPr.mergedAt,
            baseRef: chosenPr.baseRef,
            headRef: chosenPr.headRef,
            commits: []
          });
        }
        seenPrs.get(key).commits.push(commit);
      } else if (defaultBranchShas.has(commit.sha)) {
        workItems.push({
          type: 'DIRECT_DEFAULT_BRANCH_WORK',
          repository: repoInfo.nameWithOwner,
          repoUrl: repoInfo.url,
          branch: repoInfo.defaultBranch,
          commits: [commit]
        });
      } else {
        workItems.push({
          type: 'UNCATEGORIZED',
          repository: repoInfo.nameWithOwner,
          repoUrl: repoInfo.url,
          commits: [commit]
        });
      }
    }
  }

  const prItems = Array.from(seenPrs.values()).map((item) => ({
    ...item,
    commitCount: item.commits.length,
    representativeMessages: dedupeMessages(item.commits.map((commit) => firstMeaningfulLine(commit.message))).slice(0, 6)
  }));

  const existingPrKeys = new Set(prItems.map((item) => `${item.repository}#${item.prNumber}`));
  const prActivityItems = prActivities
    .filter((item) => !existingPrKeys.has(`${item.repository}#${item.prNumber}`))
    .map((item) => ({
      type: item.mergedAt ? 'MERGED_PR_WORK' : 'OPEN_PR_WORK',
      repository: item.repository,
      repoUrl: `https://github.com/${item.repository}`,
      prNumber: item.prNumber,
      prTitle: item.prTitle,
      prUrl: item.prUrl,
      state: item.state,
      mergedAt: item.mergedAt,
      baseRef: null,
      headRef: null,
      commits: [],
      commitCount: 0,
      representativeMessages: item.activityTypes.map((activityType) =>
        activityType === 'OPENED_PR' ? 'Opened PR on selected date' : 'Reviewed PR on selected date'
      )
    }));

  const reduced = collapseDirectCommitItems(workItems);
  return [...prItems, ...prActivityItems, ...reduced].sort((a, b) => a.repository.localeCompare(b.repository));
}

function firstMeaningfulLine(message) {
  return String(message || '').split('\n').map((s) => s.trim()).find(Boolean) || 'Updated code';
}

function dedupeMessages(messages) {
  return [...new Set(messages.filter(Boolean))];
}

function collapseDirectCommitItems(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = `${item.type}:${item.repository}:${item.branch || ''}`;
    if (!grouped.has(key)) grouped.set(key, { ...item, commits: [] });
    grouped.get(key).commits.push(...item.commits);
  }
  return Array.from(grouped.values()).map((item) => ({
    ...item,
    commitCount: item.commits.length,
    representativeMessages: dedupeMessages(item.commits.map((commit) => firstMeaningfulLine(commit.message))).slice(0, 6)
  }));
}

function renderActivitySummary(activity) {
  const counts = activity.workItems.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const parts = [];
  const chip = (label, cls) => `<span class="repo-chip ${cls}">${label}</span>`;
  if (counts.MERGED_PR_WORK) parts.push(chip(`${counts.MERGED_PR_WORK} merged PR${counts.MERGED_PR_WORK > 1 ? 's' : ''}`, 'merged'));
  if (counts.OPEN_PR_WORK) parts.push(chip(`${counts.OPEN_PR_WORK} open PR${counts.OPEN_PR_WORK > 1 ? 's' : ''}`, 'open'));
  if (counts.DIRECT_DEFAULT_BRANCH_WORK) parts.push(chip(`${counts.DIRECT_DEFAULT_BRANCH_WORK} direct branch item${counts.DIRECT_DEFAULT_BRANCH_WORK > 1 ? 's' : ''}`, 'direct'));
  if (counts.UNCATEGORIZED) parts.push(chip(`${counts.UNCATEGORIZED} uncategorized`, 'uncat'));

  const detailSections = activity.workItems.slice(0, 12).map((item) => {
    const title = item.prTitle
      ? `<strong>${escapeHtml(item.repository)} · PR #${item.prNumber}: ${escapeHtml(item.prTitle)}</strong>`
      : `<strong>${escapeHtml(item.repository)} · ${escapeHtml(item.type.replaceAll('_', ' '))}</strong>`;
    const messages = item.representativeMessages.map((msg) => `• ${escapeHtml(msg)}`).join('<br/>');
    return `${title}<br/><span class="small-label">${item.commitCount} commit${item.commitCount > 1 ? 's' : ''}</span>${messages}`;
  });

  el.activitySummary.classList.remove('empty');
  el.activitySummary.innerHTML = `${parts.join('')}${parts.length ? '<hr class="sep" />' : ''}${detailSections.join('<hr class="sep" />') || 'No qualifying activity found for this date.'}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchActivityForDate(date) {
  const { githubToken } = ensureSecretsUnlocked();
  const requestedUsername = el.githubUsername.value.trim();
  const viewer = await fetchGithubViewer(githubToken);
  if (!viewer.login) throw new Error('Unable to identify authenticated GitHub user for this token.');

  let username = requestedUsername || viewer.login;
  if (requestedUsername && requestedUsername.toLowerCase() !== viewer.login.toLowerCase()) {
    log(`GitHub username mismatch detected. Using token owner "${viewer.login}" instead of "${requestedUsername}".`);
    username = viewer.login;
    el.githubUsername.value = viewer.login;
  }
  log(`GitHub token authenticated as "${viewer.login}".`);
  if (viewer.scopes) {
    log(`Token scopes: ${viewer.scopes}`);
  }

  log(`Looking up repositories with contribution activity for ${date}...`);
  const snapshot = await fetchContributionSnapshot(username, date, githubToken);
  let repos = snapshot.repos;
  let prActivities = snapshot.prActivities;
  log(`Contribution snapshot: ${repos.length} repo(s), ${prActivities.length} PR/review item(s).`);
  if (snapshot.hasAnyRestrictedContributions && snapshot.restrictedContributionsCount > 0) {
    log(`GitHub reports ${snapshot.restrictedContributionsCount} restricted contribution(s). Some private activity may be hidden by token visibility.`);
  }
  if (!repos.length) {
    log('Primary contribution lookup returned 0 repos. Trying fallback repo discovery...');
    repos = await fetchContributionReposFallback(username, date, githubToken);
  }
  log(`Found ${repos.length} repository/repositories with contribution activity.`);

  if (!prActivities.length) {
    log(`Looking up PR activity via search fallback for ${date}...`);
    prActivities = await fetchPullRequestActivities({ username, date, token: githubToken });
    log(`Found ${prActivities.length} PR activity item(s) from opened/reviewed search.`);
  }

  const repoSet = new Map(repos.map((repo) => [repo.nameWithOwner, repo]));
  for (const pr of prActivities) {
    if (!repoSet.has(pr.repository)) {
      repoSet.set(pr.repository, {
        nameWithOwner: pr.repository,
        defaultBranch: 'main',
        contributionCount: 1,
        isPrivate: false,
        url: `https://github.com/${pr.repository}`
      });
    }
  }
  repos = Array.from(repoSet.values());

  const repoData = {};
  for (const repoInfo of repos) {
    const [owner, repo] = repoInfo.nameWithOwner.split('/');
    log(`Fetching commits for ${repoInfo.nameWithOwner}...`);
    const commits = await fetchRepoCommits({ owner, repo, username, date, token: githubToken });
    const defaultBranchShas = await fetchDefaultBranchCommitShas({ owner, repo, username, date, defaultBranch: repoInfo.defaultBranch, token: githubToken });
    const prAssociations = {};
    for (const group of chunk(commits, 5)) {
      await Promise.all(group.map(async (commit) => {
        prAssociations[commit.sha] = await fetchAssociatedPullRequests({ owner, repo, sha: commit.sha, token: githubToken });
      }));
    }
    repoData[repoInfo.nameWithOwner] = { commits, defaultBranchShas, prAssociations };
  }

  const workItems = normalizeWorkItems({ repos, repoData, prActivities });
  return { date, username, repos, workItems };
}

function buildStandupPrompt(activity, extraContext, tone) {
  const instructions = `You write polished engineering standup drafts from GitHub activity. Be truthful and concise. Never invent work. Never say a task was completed if the PR is still open. Use PR titles as the strongest signal. Commit messages are supporting evidence only. Merge micro-commits into meaningful accomplishments.`;
  const payload = {
    tone,
    standup_date: activity.date,
    github_username: activity.username,
    extra_context: extraContext || '',
    work_items: activity.workItems.map((item) => ({
      type: item.type,
      repository: item.repository,
      pr_number: item.prNumber || null,
      pr_title: item.prTitle || null,
      pr_state: item.state || null,
      merged_at: item.mergedAt || null,
      branch: item.branch || null,
      commit_count: item.commitCount,
      representative_messages: item.representativeMessages,
      commit_urls: item.commits.slice(0, 8).map((commit) => commit.htmlUrl)
    }))
  };

  return {
    instructions,
    inputText: `Create a standup draft in markdown with exactly these sections:\n\n# One-line summary\n# Yesterday\n# Today\n# Blockers\n\nRules:\n- Write in a natural first-person engineering style.\n- Keep Yesterday and Today to concise bullets.\n- Use open PR work as likely in-progress items for Today when appropriate.\n- If blockers are not clear, write "- None currently."\n- Include extra context when it adds important truth not visible in git history.\n- Avoid raw commit-message phrasing unless needed for precision.\n\nData:\n${JSON.stringify(payload, null, 2)}`
  };
}

async function generateStandupFromGemini(activity) {
  const { geminiKey } = ensureSecretsUnlocked();
  const model = FREE_TIER_MODELS.includes(el.geminiModel.value) ? el.geminiModel.value : DEFAULT_MODEL;
  const tone = el.tone.value;
  const extraContext = el.extraContext.value.trim();
  const prompt = buildStandupPrompt(activity, extraContext, tone);

  log(`Generating standup with ${model}...`);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: prompt.instructions }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt.inputText }]
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(data, null, 2)}`);
  }
  return extractGeminiText(data) || 'No generated text returned by Gemini.';
}

function extractGeminiText(data) {
  const outputs = data.candidates || [];
  const texts = [];
  for (const item of outputs) {
    for (const part of item.content?.parts || []) {
      if (part.text) texts.push(part.text);
    }
  }
  return texts.join('\n').trim();
}

async function handleGenerate() {
  try {
    el.generateBtn.disabled = true;
    el.generateBtn.textContent = 'Generating...';
    const activity = await fetchAndRenderActivity();
    const markdown = await generateStandupFromGemini(activity);
    el.standupOutput.value = markdown;
    log('Standup draft generated successfully.');
  } catch (error) {
    log('Generation failed.', error.message || String(error));
    alert(error.message || String(error));
  } finally {
    el.generateBtn.disabled = false;
    el.generateBtn.textContent = 'Generate standup';
  }
}

async function fetchAndRenderActivity() {
  const date = el.standupDate.value;
  if (!date) throw new Error('Select a date first.');
  const activity = await fetchActivityForDate(date);
  state.activity = activity;
  renderActivitySummary(activity);
  return activity;
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(el.standupOutput.value || '');
    log('Standup copied to clipboard.');
  } catch (error) {
    log('Clipboard copy failed.', error.message || String(error));
  }
}

el.saveSecretsBtn.addEventListener('click', async () => {
  try { await saveSecrets(); } catch (error) { alert(error.message || String(error)); log('Save failed.', error.message || String(error)); }
});
el.unlockBtn.addEventListener('click', async () => {
  try { await unlockSecrets(); } catch (error) { alert(error.message || String(error)); log('Unlock failed.', error.message || String(error)); }
});
el.clearSecretsBtn.addEventListener('click', async () => {
  try { await clearSecrets(); } catch (error) { alert(error.message || String(error)); log('Clear failed.', error.message || String(error)); }
});
el.generateBtn.addEventListener('click', handleGenerate);
el.copyBtn.addEventListener('click', handleCopy);

(async function init() {
  el.standupDate.value = todayLocalISO();
  await loadSavedProfile();
})();