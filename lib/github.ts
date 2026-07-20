// Thin wrapper over GitHub's Contents API (docs.github.com/rest/repos/contents) —
// used to commit/read/delete Bikky CSVs directly in this repo instead of Postgres.
// See BIKKY_ADMIN_UPLOAD_PLAN.md for why (no local git/filesystem writes work on
// Vercel's serverless functions — this is API-only, no `git` binary involved).

const API_VERSION = '2022-11-28';

function config() {
  const token  = process.env.GITHUB_TOKEN;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!repo)  throw new Error('GITHUB_REPO is not set');
  return { token, repo, branch };
}

// Encode each path segment separately so folder names like "3PD+Loyalty"
// survive intact (encodeURIComponent on the whole path would also escape '/').
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function headers(token: string, accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': API_VERSION,
  };
}

async function githubError(res: Response, action: string): Promise<never> {
  const body = await res.text().catch(() => '');
  throw new Error(`GitHub ${action} failed: ${res.status} ${res.statusText} — ${body}`);
}

export interface GithubDirEntry {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
}

/** Lists a directory's contents. Returns [] if the directory doesn't exist yet. */
export async function listDir(path: string): Promise<GithubDirEntry[]> {
  const { token, repo, branch } = config();
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${branch}`,
    { headers: headers(token) },
  );
  if (res.status === 404) return [];
  if (!res.ok) return githubError(res, `list ${path}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []) as GithubDirEntry[];
}

/** Fetches a file's raw text content. Returns null if it doesn't exist. */
export async function getFileRaw(path: string): Promise<string | null> {
  const { token, repo, branch } = config();
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${branch}`,
    { headers: headers(token, 'application/vnd.github.raw+json') },
  );
  if (res.status === 404) return null;
  if (!res.ok) return githubError(res, `read ${path}`);
  return res.text();
}

/** Returns a file's current blob sha, or null if it doesn't exist. */
export async function getFileSha(path: string): Promise<string | null> {
  const { token, repo, branch } = config();
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${branch}`,
    { headers: headers(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) return githubError(res, `stat ${path}`);
  const data = await res.json();
  return data.sha as string;
}

/** Creates a file. Throws if it already exists — callers must delete first (see plan's replace semantics). */
export async function createFile(path: string, content: string, message: string): Promise<void> {
  const { token, repo, branch } = config();
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodePath(path)}`,
    {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        branch,
      }),
    },
  );
  if (!res.ok) return githubError(res, `create ${path}`);
}

/** Deletes a file. No-op (returns false) if it doesn't exist. */
export async function deleteFile(path: string, message: string): Promise<boolean> {
  const { token, repo, branch } = config();
  const sha = await getFileSha(path);
  if (!sha) return false;
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodePath(path)}`,
    {
      method: 'DELETE',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch }),
    },
  );
  if (!res.ok) return githubError(res, `delete ${path}`);
  return true;
}
