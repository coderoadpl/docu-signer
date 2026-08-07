import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resource scaffolder — the mechanical form of the 8-step "adding a resource"
 * chain in demo/CLAUDE.md. It GENERATES the files a resource owns outright and
 * prints an ordered checklist for the shared files that must be EDITED by hand,
 * each with its anchor line and a ready-to-paste snippet. Generated edits to
 * shared files rot; the type system is left to enforce completion instead, so
 * `npm run check` stays RED until every checklist step is wired.
 */

export interface ResourceNames {
  singularKebab: string;
  pluralKebab: string;
  singularPascal: string;
  pluralPascal: string;
  singularCamel: string;
  pluralCamel: string;
  singularSnake: string;
  pluralSnake: string;
}

export class ResourceNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNameError';
  }
}

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Names that already exist in the reference tree or are otherwise reserved. */
const RESERVED = new Set(['todo', 'tenant', 'health', 'me', 'auth', 'member', 'identity']);

export const validateResourceName = (name: string): void => {
  if (name.length === 0) throw new ResourceNameError('Resource name is required.');
  if (!KEBAB.test(name)) {
    throw new ResourceNameError(
      `Invalid resource name "${name}": use a singular kebab-case name (e.g. "note", "blog-post").`,
    );
  }
};

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const pluralizeWord = (word: string): string => {
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
};

const toPascal = (words: readonly string[]): string => words.map(capitalize).join('');
const toCamel = (words: readonly string[]): string =>
  words.map((word, index) => (index === 0 ? word : capitalize(word))).join('');
const toSnake = (words: readonly string[]): string => words.join('_');

export const deriveNames = (name: string): ResourceNames => {
  validateResourceName(name);
  const singularWords = name.split('-');
  const last = singularWords[singularWords.length - 1] ?? name;
  const pluralWords = [...singularWords.slice(0, -1), pluralizeWord(last)];
  return {
    singularKebab: singularWords.join('-'),
    pluralKebab: pluralWords.join('-'),
    singularPascal: toPascal(singularWords),
    pluralPascal: toPascal(pluralWords),
    singularCamel: toCamel(singularWords),
    pluralCamel: toCamel(pluralWords),
    singularSnake: toSnake(singularWords),
    pluralSnake: toSnake(pluralWords),
  };
};

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

const TOKENS: readonly (keyof ResourceNames)[] = [
  'singularKebab',
  'pluralKebab',
  'singularPascal',
  'pluralPascal',
  'singularCamel',
  'pluralCamel',
  'singularSnake',
  'pluralSnake',
];

const TOKEN_PLACEHOLDER: Record<keyof ResourceNames, string> = {
  singularKebab: '__SINGULAR_KEBAB__',
  pluralKebab: '__PLURAL_KEBAB__',
  singularPascal: '__SINGULAR_PASCAL__',
  pluralPascal: '__PLURAL_PASCAL__',
  singularCamel: '__SINGULAR_CAMEL__',
  pluralCamel: '__PLURAL_CAMEL__',
  singularSnake: '__SINGULAR_SNAKE__',
  pluralSnake: '__PLURAL_SNAKE__',
};

const render = (template: string, names: ResourceNames): string => {
  let output = template;
  for (const token of TOKENS) {
    output = output.split(TOKEN_PLACEHOLDER[token]).join(names[token]);
  }
  return output;
};

export interface GeneratedFile {
  /** Path relative to the repo/output root. */
  path: string;
  contents: string;
}

const planFiles = (names: ResourceNames): GeneratedFile[] => {
  const fromTemplate = (templateFile: string, path: string): GeneratedFile => ({
    path,
    contents: render(readFileSync(join(TEMPLATES_DIR, templateFile), 'utf8'), names),
  });
  return [
    fromTemplate('domain.ts.tpl', `core/domain/${names.singularKebab}.ts`),
    fromTemplate('usecase.ts.tpl', `core/server/usecases/${names.pluralKebab}.ts`),
    fromTemplate('usecase.test.ts.tpl', `core/server/usecases/${names.pluralKebab}.test.ts`),
    fromTemplate('repository.ts.tpl', `adapters/db/${names.pluralKebab}-repository.ts`),
    fromTemplate(
      'page.tsx.tpl',
      `apps/web/src/features/${names.pluralKebab}/${names.pluralPascal}Page.tsx`,
    ),
    fromTemplate('route.tsx.tpl', `apps/web/src/routes/${names.pluralKebab}.tsx`),
  ];
};

export interface GenerateOptions {
  name: string;
  /** Base directory the generated files are written into. */
  outDir: string;
  /** Directory checked for collisions with an existing resource of this name. */
  repoRoot: string;
  /** When true, plan and return files without writing them. */
  dryRun?: boolean;
}

export interface GenerateResult {
  names: ResourceNames;
  files: GeneratedFile[];
  checklist: string;
}

export const generateResource = (options: GenerateOptions): GenerateResult => {
  const names = deriveNames(options.name);

  if (RESERVED.has(names.singularKebab)) {
    throw new ResourceNameError(`Resource "${names.singularKebab}" is reserved or already exists.`);
  }

  const files = planFiles(names);

  for (const file of files) {
    if (existsSync(join(options.repoRoot, file.path))) {
      throw new ResourceNameError(
        `Refusing to overwrite existing file: ${file.path}. Pick a different name.`,
      );
    }
  }

  if (!options.dryRun) {
    for (const file of files) {
      const target = join(options.outDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.contents);
    }
  }

  return { names, files, checklist: buildChecklist(names, files) };
};

const buildChecklist = (names: ResourceNames, files: GeneratedFile[]): string => {
  const n = names;
  const generated = files.map((file) => `  + ${file.path}`).join('\n');
  return `
Scaffolded resource "${n.singularKebab}". Generated files (owned by this resource):
${generated}

These GENERATED files already participate in typecheck and import symbols that do
not exist yet, so \`npm run check\` will stay RED until every step below is wired.
Work top to bottom — this is the 8-step chain from demo/CLAUDE.md:

1. DOMAIN — core/domain/index.ts
   anchor:  export * from './todo.js';
   add:     export * from './${n.singularKebab}.js';

2. CONTRACT — core/contract/routes.ts
   2a. anchor:  todoSchema,          (the '#core/domain/index.js' import block)
       add:     ${n.singularCamel}Schema,
                new${n.singularPascal}Schema,
   2b. anchor:  export const todoCreateOutputSchema = z.object({
       add (near the todo schemas):
         export const ${n.pluralCamel}ListOutputSchema = z.object({
           ${n.pluralCamel}: z.array(${n.singularCamel}Schema),
         });
         export const ${n.singularCamel}CreateInputSchema = new${n.singularPascal}Schema;
         export const ${n.singularCamel}CreateOutputSchema = z.object({
           ${n.singularCamel}: ${n.singularCamel}Schema,
         });
   2c. anchor:  todosCreate: { method: 'POST', path: '/api/todos' },
       add:     ${n.pluralCamel}: { method: 'GET', path: '/api/${n.pluralKebab}' },
                ${n.pluralCamel}Create: { method: 'POST', path: '/api/${n.pluralKebab}' },
   2d. anchor:  todos: API_ROUTES.todos.path,      (the API_PATHS block)
       add:     ${n.pluralCamel}: API_ROUTES.${n.pluralCamel}.path,

3. PORT — core/server/ports.ts
   3a. anchor:  import type { Member, Membership, StaffRole, Tenant, TenantDomain, Todo } from '#core/domain/index.js';
       add ${n.singularPascal} to the imported types.
   3b. anchor:  export interface TodoRepository {
       add above/below it:
         export interface ${n.singularPascal}Repository {
           listByTenant(tenantId: string): Promise<${n.singularPascal}[]>;
           create(${n.singularCamel}: ${n.singularPascal}): Promise<void>;
         }

4. USE-CASE INDEX — core/server/index.ts
   anchor:  export * from './usecases/todos.js';
   add:     export * from './usecases/${n.pluralKebab}.js';
   (The use-case + its test skeleton are already generated. Fill in the TODO
    cases in core/server/usecases/${n.pluralKebab}.test.ts before wiring the UI.)

5. ADAPTER SCHEMA — adapters/db/app-schema.ts
   anchor:  export const todos = pgTable(
   add a sibling table:
     export const ${n.pluralCamel} = pgTable(
       '${n.pluralSnake}',
       {
         id: text('id').primaryKey(),
         tenantId: text('tenant_id')
           .notNull()
           .references(() => tenants.id, { onDelete: 'cascade' }),
         title: text('title').notNull(),
         createdBy: text('created_by').notNull(),
         createdAt: text('created_at').notNull(),
       },
       (table) => [index('${n.pluralSnake}_tenantId_idx').on(table.tenantId)],
     );
   Then generate + apply the migration:
     npm run db:generate && npm run db:migrate
   (The generated adapter repository — adapters/db/${n.pluralKebab}-repository.ts —
    is already written; it imports this table from ./schema.js.)

6. COMPOSITION — apps/server/src/composition.ts
   6a. anchor:  createTodoRepository,        (the '#adapters/db/repositories.js' import)
       Instead import from the new module:
         import { create${n.singularPascal}Repository } from '#adapters/db/${n.pluralKebab}-repository.js';
   6b. anchor:  TodoRepository,              (the '#core/server/index.js' type import)
       add:     ${n.singularPascal}Repository,
   6c. anchor:  todos: TodoRepository;       (interface AppDeps)
       add:     ${n.pluralCamel}: ${n.singularPascal}Repository;
   6d. anchor:  todos: createTodoRepository(db),   (the returned deps object)
       add:     ${n.pluralCamel}: create${n.singularPascal}Repository(db),

7. SERVER ROUTES — apps/server/src/app.ts
   7a. anchor:  todoCreateInputSchema,       (the '#core/contract/index.js' import)
       add:     ${n.singularCamel}CreateInputSchema,
   7b. anchor:  addTodo,                     (the '#core/server/index.js' import)
       add:     add${n.singularPascal},
                list${n.pluralPascal},
   7c. anchor:  app.post(API_PATHS.todos, async (c) => {   (add after that handler)
       add:
         app.get(API_PATHS.${n.pluralCamel}, async (c) => {
           const result = await list${n.pluralPascal}({ identity: c.get('identity') }, deps);
           return respond(result.ok ? ok({ ${n.pluralCamel}: result.value }) : result);
         });

         app.post(API_PATHS.${n.pluralCamel}, async (c) => {
           const body: unknown = await c.req.json().catch(() => null);
           const parsed = ${n.singularCamel}CreateInputSchema.safeParse(body);
           if (!parsed.success) {
             return respond(err(validation('Invalid ${n.singularKebab} payload', parsed.error.flatten())));
           }
           const result = await add${n.singularPascal}({ identity: c.get('identity') }, parsed.data, deps);
           return respond(result.ok ? ok({ ${n.singularCamel}: result.value }) : result);
         });

8. CLIENT — core/client/http.ts
   8a. anchor:  todoListOutputSchema,        (the '#core/contract/index.js' import)
       add:     ${n.pluralCamel}ListOutputSchema,
                ${n.singularCamel}CreateOutputSchema,
   8b. anchor:  import { err, internal, ok, type AppError, type NewTodo, type Result } from '#core/domain/index.js';
       add New${n.singularPascal} to the imported types.
   8c. anchor:  addTodo: (input: NewTodo, signal?: AbortSignal) =>   (inside createApiClient)
       add two methods:
         list${n.pluralPascal}: (signal?: AbortSignal) =>
           request(options, API_ROUTES.${n.pluralCamel}.method, API_ROUTES.${n.pluralCamel}.path, ${n.pluralCamel}ListOutputSchema, undefined, signal),
         add${n.singularPascal}: (input: New${n.singularPascal}, signal?: AbortSignal) =>
           request(options, API_ROUTES.${n.pluralCamel}Create.method, API_ROUTES.${n.pluralCamel}Create.path, ${n.singularCamel}CreateOutputSchema, input, signal),

9. CLIENT QUERIES — core/client/queries.ts
   9a. anchor:  import type { NewTodo } from '#core/domain/index.js';
       add New${n.singularPascal} to the imported types.
   9b. anchor:  export const todosScopes = {
       add:
         export const ${n.pluralCamel}Scopes = {
           all: () => ['${n.pluralKebab}'] as const,
           lists: () => ['${n.pluralKebab}', 'list'] as const,
         };
   9c. anchor:  export const addTodoInvalidates = () => ({ queryKey: todosScopes.lists() });
       add:
         export const ${n.pluralCamel}Query = (api: ApiClient) =>
           defineQuery({
             queryKey: ${n.pluralCamel}Scopes.lists(),
             call: ({ signal }) => api.list${n.pluralPascal}(signal),
           });

         export const add${n.singularPascal}Mutation = (api: ApiClient) =>
           defineMutation({
             mutationKey: [...${n.pluralCamel}Scopes.all(), 'create'],
             call: (input: New${n.singularPascal}) => api.add${n.singularPascal}(input),
           });

         export const add${n.singularPascal}Invalidates = () => ({ queryKey: ${n.pluralCamel}Scopes.lists() });

10. CLI — apps/cli/src/main.ts
    anchor:  await program.parseAsync(process.argv);   (add the command group above it)
    add:
      const ${n.singularCamel} = program.command('${n.singularKebab}').description('${n.pluralPascal} in the active tenant');

      ${n.singularCamel}.command('list').description('List ${n.pluralKebab}').action(async () => {
        const ctx = cliCtx();
        emit(await ctx.api.list${n.pluralPascal}(), ctx.json, (data) =>
          data.${n.pluralCamel}.length === 0
            ? 'no ${n.pluralKebab}'
            : data.${n.pluralCamel}.map((row) => \`- \${row.title}  (\${row.id.slice(0, 8)})\`).join('\\n'),
        );
      });

      ${n.singularCamel}
        .command('add <title...>')
        .description('Add a ${n.singularKebab}')
        .action(async (titleWords: string[]) => {
          const ctx = cliCtx();
          emit(await ctx.api.add${n.singularPascal}({ title: titleWords.join(' ') }), ctx.json, (data) =>
            \`added: \${data.${n.singularCamel}.title} (\${data.${n.singularCamel}.id.slice(0, 8)})\`,
          );
        });

11. WEB BINDING — apps/web/src/api.ts
    11a. anchor:  todosQuery,        (the '#core/client/index.js' import)
         add:     ${n.pluralCamel}Query,
                  add${n.singularPascal}Mutation,
                  add${n.singularPascal}Invalidates,
    11b. anchor:  todos: todosQuery(apiClient),   (the actions object)
         add:     ${n.pluralCamel}: ${n.pluralCamel}Query(apiClient),
                  add${n.singularPascal}: add${n.singularPascal}Mutation(apiClient),
                  add${n.singularPascal}Invalidates,
    (The page — apps/web/src/features/${n.pluralKebab}/${n.pluralPascal}Page.tsx — and its
     route — apps/web/src/routes/${n.pluralKebab}.tsx — are already generated.)

12. WEB ROUTE — apps/web/src/main.tsx
    12a. anchor:  import { TodosRoute } from './routes/todos.js';
         add:     import { ${n.pluralPascal}Route } from './routes/${n.pluralKebab}.js';
    12b. anchor:  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute]) });
         add a route above it and register it:
           const ${n.pluralCamel}Route = createRoute({
             getParentRoute: () => rootRoute,
             path: '/${n.pluralKebab}',
             component: ${n.pluralPascal}Route,
           });
         then extend addChildren([indexRoute, loginRoute, ${n.pluralCamel}Route]).

Verify (write core tests before wiring the UI):
  npm run check && npm run smoke
`;
};

const runCli = (): void => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const name = args.find((arg) => !arg.startsWith('--'));
  if (name === undefined) {
    process.stderr.write('Usage: npm run new:resource -- <singular-name> [--dry-run]\n');
    process.exit(1);
  }
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = generateResource({ name, outDir: repoRoot, repoRoot, dryRun });
    process.stdout.write(result.checklist);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`new:resource failed: ${message}\n`);
    process.exit(1);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
