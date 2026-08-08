import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  collectFiles,
  kinds,
  publishedName,
  screenshotsFrom,
  type Kind,
  type Screenshot,
} from './visual-screenshots.js';

const marker = '<!-- visual-review-gallery -->';
const reportBranch = 'visual-reports';
const pageSize = 100;

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_REPOSITORY: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  PR_NUMBER: z.coerce.number().int().positive(),
  RUN_ID: z.coerce.number().int().positive(),
  VISUAL_OUTCOME: z.enum(['success', 'failure']),
  VISUAL_ARTIFACT_DIR: z.string().min(1),
  AI_VERDICTS: z.string().optional(),
});

const commentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string().nullable(),
  user: z.object({ type: z.string() }),
});

const pullSchema = z.object({ number: z.number().int().positive() });

const verdictSchema = z.object({
  verdicts: z.array(z.object({ screenshot: z.string(), line: z.string() })),
});

const env = envSchema.parse(process.env);
const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.RUN_ID}`;

const api = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} returned ${response.status}.`);
  }
  if (response.status === 204) return null;
  return response.json();
};

const paginate = async <T>(
  path: string,
  query: Record<string, string>,
  itemSchema: z.ZodType<T>,
): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const search = new URLSearchParams({ ...query, per_page: String(pageSize), page: String(page) });
    const batch = z.array(itemSchema).parse(await api(`${path}?${search.toString()}`));
    items.push(...batch);
    if (batch.length < pageSize) return items;
  }
};

const git = (
  cwd: string,
  args: string[],
  options: { readonly allowFailure?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
): boolean => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  if (result.status === 0) return true;
  if (options.allowFailure) return false;
  throw new Error(result.stderr.trim() || `git ${args[0] ?? ''} failed.`);
};

const publish = async (screenshots: Screenshot[]): Promise<void> => {
  const worktree = mkdtempSync(join(tmpdir(), 'visual-reports-'));
  const auth = Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString('base64');
  const gitEnv = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
  };

  try {
    git(worktree, ['init']);
    git(worktree, ['remote', 'add', 'origin', `https://github.com/${env.GITHUB_REPOSITORY}.git`]);
    const branchExists = git(
      worktree,
      ['fetch', '--depth=1', 'origin', `refs/heads/${reportBranch}`],
      { allowFailure: true, env: gitEnv },
    );
    if (!branchExists && screenshots.length === 0) return;
    git(
      worktree,
      branchExists
        ? ['checkout', '--orphan', 'publication', 'FETCH_HEAD']
        : ['checkout', '--orphan', 'publication'],
    );

    const open = new Set(
      (await paginate(`/repos/${env.GITHUB_REPOSITORY}/pulls`, { state: 'open' }, pullSchema)).map(
        (pull) => pull.number,
      ),
    );
    for (const entry of readdirSync(worktree, { withFileTypes: true })) {
      const number = Number(/^pr-(\d+)$/.exec(entry.name)?.[1]);
      if (!entry.isDirectory() || Number.isNaN(number)) continue;
      if (!open.has(number) || number === env.PR_NUMBER) {
        rmSync(join(worktree, entry.name), { recursive: true, force: true });
      }
    }

    if (screenshots.length > 0) {
      const destination = join(worktree, `pr-${env.PR_NUMBER}`, `run-${env.RUN_ID}`);
      mkdirSync(destination, { recursive: true });
      for (const screenshot of screenshots) {
        for (const kind of kinds) {
          copyFileSync(
            screenshot.files[kind],
            join(destination, `${screenshot.stem}-${publishedName(kind)}.png`),
          );
        }
      }
    }

    git(worktree, ['config', 'user.name', 'github-actions[bot]']);
    git(worktree, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    git(worktree, ['add', '-A']);
    git(worktree, ['commit', '--allow-empty', '-m', `Visual reports for run ${env.RUN_ID}`]);
    git(worktree, ['push', '--force', 'origin', `HEAD:refs/heads/${reportBranch}`], {
      env: gitEnv,
    });
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
};

const imageUrl = (stem: string, kind: Kind): string =>
  `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/${reportBranch}/` +
  `pr-${env.PR_NUMBER}/run-${env.RUN_ID}/${encodeURIComponent(`${stem}-${publishedName(kind)}.png`)}`;

const aiReadSection = (screenshots: Screenshot[]): string => {
  const note =
    `_Advisory only — the AI read can never gate this job; ` +
    `the gallery posts with or without it._`;
  const parsed = ((): Map<string, string> | undefined => {
    if (env.AI_VERDICTS === undefined || env.AI_VERDICTS === '') return undefined;
    const raw = ((): unknown => {
      try {
        return JSON.parse(env.AI_VERDICTS ?? '');
      } catch {
        return undefined;
      }
    })();
    const result = verdictSchema.safeParse(raw);
    if (!result.success) return undefined;
    return new Map(
      result.data.verdicts.map((verdict) => [
        verdict.screenshot,
        verdict.line.replace(/\s+/g, ' ').trim().slice(0, 200),
      ]),
    );
  })();
  if (parsed === undefined) {
    return `### AI read\n\nVerdict unavailable this run. ${note}`;
  }
  const lines = screenshots.map(
    (screenshot) =>
      `- \`${screenshot.stem}\` — ` +
      (parsed.get(screenshot.stem) ?? 'uwaga — brak werdyktu dla tego zrzutu'),
  );
  return `### AI read\n\n${lines.join('\n')}\n\n${note}`;
};

const galleryBody = (screenshots: Screenshot[]): string => {
  if (screenshots.length === 0) {
    return env.VISUAL_OUTCOME === 'success'
      ? `${marker}\n## Visual review\n\nNo visual changes. [Workflow run](${runUrl}).`
      : `${marker}\n## Visual review\n\nThe comparison produced no complete baseline/actual/diff ` +
          `set to show — a screenshot with no baseline yet, or a run that died before writing one. ` +
          `[Read the run and its artifacts](${runUrl}#artifacts).`;
  }

  const rows = screenshots
    .map(
      (screenshot) =>
        `<tr><td><code>${screenshot.stem}</code><br>${screenshot.pixels}</td>` +
        kinds
          .map(
            (kind) =>
              `<td><img width="260" alt="${screenshot.stem} ${publishedName(kind)}" ` +
              `src="${imageUrl(screenshot.stem, kind)}"></td>`,
          )
          .join('') +
        `</tr>`,
    )
    .join('\n');

  return (
    `${marker}\n## Visual review\n\n` +
    `<table><thead><tr><th>Screenshot</th><th>Baseline</th><th>Actual</th><th>Diff</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>\n\n` +
    `${aiReadSection(screenshots)}\n\n` +
    `[Open the run's \`playwright-report\` artifact](${runUrl}#artifacts) for the side-by-side and ` +
    `slider views.\n\n` +
    `If this is the change you made, the repository owner — or a login listed in the ` +
    `\`VISUAL_APPROVERS\` repository variable — comments \`/approve-visuals\` to re-render the ` +
    `baselines and commit them onto this branch.`
  );
};

const upsertComment = async (body: string, createWhenMissing: boolean): Promise<void> => {
  const comments = await paginate(
    `/repos/${env.GITHUB_REPOSITORY}/issues/${env.PR_NUMBER}/comments`,
    {},
    commentSchema,
  );
  const existing = comments.find(
    (comment) => comment.user.type === 'Bot' && comment.body?.includes(marker),
  );
  if (existing) {
    await api(`/repos/${env.GITHUB_REPOSITORY}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    return;
  }
  if (!createWhenMissing) return;
  await api(`/repos/${env.GITHUB_REPOSITORY}/issues/${env.PR_NUMBER}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
};

const screenshots = screenshotsFrom(collectFiles(env.VISUAL_ARTIFACT_DIR));
await publish(screenshots);
await upsertComment(
  galleryBody(screenshots),
  screenshots.length > 0 || env.VISUAL_OUTCOME === 'failure',
);
