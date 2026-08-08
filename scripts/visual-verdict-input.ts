import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { collectFiles, kinds, publishedName, screenshotsFrom } from './visual-screenshots.js';

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_REPOSITORY: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  PR_NUMBER: z.coerce.number().int().positive(),
  VISUAL_ARTIFACT_DIR: z.string().min(1),
  VERDICT_DIR: z.string().min(1),
  GITHUB_OUTPUT: z.string().min(1),
});

const fileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});

type PullFile = z.infer<typeof fileSchema>;

const pageSize = 100;
const patchBudgetPerFile = 4_000;
const patchBudgetTotal = 60_000;

const env = envSchema.parse(process.env);

const api = async (path: string): Promise<unknown> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API GET ${path} returned ${response.status}.`);
  }
  return response.json();
};

const pullFiles = async (): Promise<PullFile[]> => {
  const files: PullFile[] = [];
  for (let page = 1; ; page += 1) {
    const search = new URLSearchParams({ per_page: String(pageSize), page: String(page) });
    const batch = z
      .array(fileSchema)
      .parse(
        await api(`/repos/${env.GITHUB_REPOSITORY}/pulls/${env.PR_NUMBER}/files?${search.toString()}`),
      );
    files.push(...batch);
    if (batch.length < pageSize) return files;
  }
};

const diffSection = (files: PullFile[]): string => {
  let spent = 0;
  return files
    .map((file) => {
      const head = `### ${file.filename} (${file.status}, +${file.additions} −${file.deletions})`;
      if (file.patch === undefined) return `${head}\n_(no text patch — binary or too large)_`;
      if (spent >= patchBudgetTotal) return `${head}\n_(patch omitted — total diff budget reached)_`;
      const clipped = file.patch.slice(0, patchBudgetPerFile);
      spent += clipped.length;
      const truncated = clipped.length < file.patch.length ? '\n_(patch truncated)_' : '';
      return `${head}\n\`\`\`diff\n${clipped}\n\`\`\`${truncated}`;
    })
    .join('\n\n');
};

const screenshots = screenshotsFrom(collectFiles(env.VISUAL_ARTIFACT_DIR));

if (screenshots.length > 0) {
  const imagesDir = join(env.VERDICT_DIR, 'images');
  mkdirSync(imagesDir, { recursive: true });

  const entries = screenshots.map((screenshot) => {
    const copies = kinds.map((kind) => {
      const target = join(imagesDir, `${screenshot.stem}-${publishedName(kind)}.png`);
      copyFileSync(screenshot.files[kind], target);
      return `- ${publishedName(kind)}: ${target}`;
    });
    return `### ${screenshot.stem}\n- pixels: ${screenshot.pixels}\n${copies.join('\n')}`;
  });

  const context =
    `# Advisory visual verdict input — PR #${env.PR_NUMBER}\n\n` +
    `## Changed screenshots\n\n${entries.join('\n\n')}\n\n` +
    `## Pull request file diff (names + patches, truncated to budgets)\n\n` +
    `${diffSection(await pullFiles())}\n`;
  writeFileSync(join(env.VERDICT_DIR, 'context.md'), context);
}

appendFileSync(env.GITHUB_OUTPUT, `screenshots=${screenshots.length}\n`);
