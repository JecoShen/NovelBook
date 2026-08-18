# Contributing to NeuroBook

[中文](CONTRIBUTING.md)

Thank you for improving NeuroBook. This guide covers the path from reporting a problem to submitting a pull request (PR). The repository is evolving quickly, so a clear scope, honest verification, and traceable decisions matter more than putting as many changes as possible into one contribution.

## Before You Start

Choose the path that matches the size of the change:

- Typo fixes, broken links, and small documentation corrections that do not change meaning may go directly to a PR.
- A small, well-defined bug fix should reference an existing issue. Use “Bug report” first if no issue exists.
- New features, cross-module changes, data-shape changes, runtime contract changes, and high-cost refactors require a “Feature request” first. Start implementation after a maintainer marks it `status: ready`.
- If you state in the form that you plan to implement and submit a PR, wait for maintainer authorization (the `status: claimed` label) before starting, to avoid duplicating work that is already claimed or in progress.
- Use “Prompts and built-in Agent assets” to improve or contribute Profiles, Skills, Workflows, and other prompts.
- Installation and usage questions belong in the “Usage and installation question” form and do not need to move to an external community.
- If none of the public categories fit, use the structured “Other issue” form. It is not a way to bypass private security reporting or required design discussion.
- Do not open a public issue or PR for a security vulnerability. Follow the [security policy](.github/SECURITY.md) and use GitHub private vulnerability reporting.

For niche or expensive requests, we will first discuss whether a smaller scope solves the real problem. Acceptance of an issue approves a direction, not a specific implementation or delivery date.

## Local Development

### Environment

- Git
- [Bun](https://bun.sh/)
- Operating-system tools required by the code you change; deployment work may also require Docker, Podman, or real hardware for the target platform

Install dependencies and start the development server:

```bash
bun install
bun run dev
```

Common verification commands:

```bash
# Run the tests closest to your change
bun run test -- path/to/relevant.test.ts

# TypeScript type checking
bun run typecheck

# Full test suite
bun run test

# Build the Chinese and English documentation site
bun run docs:build

# Build the application
bun run build
```

List the exact commands and outcomes in your PR. Mark checks you did not run as “not run.” Passing focused tests must not be presented as passing the full suite.

### Dependencies and Local Data

- Use Bun consistently. Check existing dependencies before adding one; when a new dependency is necessary, install its current latest version with Bun.
- Do not commit `.env`, `config.yaml`, Project Workspaces, manuscript content, API keys, sessions, traces, logs, databases, build caches, or raw machine-specific benchmark output.
- Do not run release commands, change the version, or create `chore(release)` commits.
- Do not contribute third-party novels, prompts, style samples, or any material you do not have the right to redistribute.

## Read the Project Context

Read the relevant sources before making changes:

| Document | Purpose |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Detailed rules for coding agents and implementation work |
| [`PROJECT-STATUS.md`](PROJECT-STATUS.md) | Current module state, risks, and long-term TODOs |
| [`docs/tasks/`](docs/tasks/README.md) | Goals, decisions, process, evidence, and deviations for major work |
| [`reference/`](reference/README.md) | Stable implementation contracts and domain terminology |
| [`docs/adr/`](docs/adr/) | Architecture decisions that must remain available long term |
| [`RELEASE.md`](RELEASE.md) | User-visible changes for the current release, maintained during the release process |

Search the related implementation, tests, tasks, and references first. Do not infer a full contract from an issue title or one local code path.

## Development Conventions

The rules below are the stable conventions most external contributions need. See [`AGENTS.md`](AGENTS.md) for detailed Vue, theme, notification, logging, Workspace path, Agent Runtime, and release rules.

### TypeScript and Design

- Use strict types and `nbook/*` absolute imports instead of cross-project relative imports.
- Avoid `any`, `unknown`, and `Record<string, unknown>`. When external input genuinely requires `unknown`, validate it at the boundary and explain why. Using `any` usually means the design needs discussion.
- Use 4-space indentation in JS and TS. Document the purpose of public interfaces, classes, and functions. Add comments to explain reasons or constraints, not obvious mechanics.
- Prefer classes for backend domain logic. Prefer functions, composables, and existing components in the frontend.
- Reuse existing libraries, components, and interfaces first. Do not create abstractions for a single call, or hide design problems with hacks, type escapes, or temporary compatibility layers.
- The project is in rapid development. Do not retain compatibility code for old data or interfaces unless the task explicitly requires it.

### Vue and User Experience

- Use existing theme variables for frontend colors. Do not add Tailwind palette classes or `dark:` variants.
- Reuse `resolveApiErrorMessage()`, `useNotification()`, and `useResizablePanel()` for API errors, global notifications, and resizable panels.
- Prefer modifying an existing component. Split it only when it approaches 800 lines or clearly combines separate responsibilities.
- User-facing copy is written for an ordinary author opening NeuroBook for the first time. Do not expose internal class names, file names, task numbers, or phase numbers.
- Explain desktop and narrow-screen impact for frontend changes, and provide screenshots, recordings, or browser verification when the feature can be run.

### Logging, Privacy, and Security

- Use structured logging. Do not log API keys, tokens, device codes, manuscript text, full prompts, session content, or unredacted request bodies.
- Issues and PRs are public. Redact logs, screenshots, and test data before uploading them.
- File and Project Workspace operations must pass through existing authorization, path normalization, and containment boundaries. Do not concatenate user paths to bypass those boundaries.

## Working with Coding Agents

In this section, a “coding agent” means Codex, Claude, Copilot, or another tool assisting repository development. A “NeuroBook Agent” means the product's own Agent Runtime. They are different systems.

- A coding agent must read `AGENTS.md` plus the relevant issue, task, reference, and tests before it starts.
- For bugs, errors, and performance regressions, reproduce the symptom, reduce the scope, and gather evidence before proposing or implementing a fix. Do not let an agent modify business logic based on a guess.
- Multiple agents may work in parallel only on independent research, review, testing, or clearly non-overlapping files. One integration owner must reconcile cross-module contracts, conflicts, documentation, and final verification.
- Agents must not overwrite existing workspace changes, bypass the type system, fabricate test results, or copy temporary requests from the current conversation into product prompts.
- The contributor must understand, review, and take responsibility for every agent-generated change. Naming the AI tool is optional; responsibility cannot be delegated to it.
- Agent conclusions and PR descriptions must be traceable to code, logs, traces, requests, or test evidence. Disclose every verification step that was not run.

## Issues, Tasks, and Architecture Records

Issues track public problems and requests. Task walkthroughs preserve the ongoing context for major implementation work. A task is not a copy of an issue.

### Maintainer Triage

The five issue forms automatically add one `type:*` label and `status: needs-triage`. The prompt form also adds `area: agent`. Maintainers use the following state contract when triaging:

- Every open issue keeps exactly one `type:*` and one `status:*`. Add zero or more `area:*` and `platform:*` labels according to the actual impact.
- `status: needs-triage` means the first review is pending. Move an issue to `status: needs-info` when information is missing, then triage it again after the reporter responds.
- Use `status: needs-design` while direction, scope, or contracts remain unsettled; implementation must not start in this state. Move it to `status: ready` after a maintainer accepts a clear scope.
- When a creator states in the form that they will implement and the scope is confirmed through discussion, move the issue to `status: claimed` as that creator's implementation authorization. `claimed` means a specific implementer is assigned; do not start a parallel implementation of the same issue.
- Use `status: blocked` when an external condition or prerequisite prevents progress. Return to the most accurate state after the blocker clears.
- Use `help wanted` and `good first issue` only with `status: ready`. A good first issue must also be small, self-contained, and have independently verifiable acceptance criteria.

`.github/labels.yml` is the source of truth for repository labels. Maintainers run `bun run github:labels -- check` for a read-only remote audit and `bun run github:labels -- apply --yes` to create or update labels. Extra remote labels are only reported by default; delete them only with `--delete-extra --yes`. Rename labels in place on GitHub first to preserve historical associations instead of creating a replacement and deleting the old label.

| Change | Issue | Task walkthrough | `PROJECT-STATUS.md` |
| --- | --- | --- | --- |
| Typo or small documentation fix | Optional | Not needed | Not needed |
| Localized bug or small feature | Required | Usually no new task; update an existing related task | Not needed if module state is unchanged |
| Medium feature or cross-component change | Required and accepted | Maintainer decides whether to reuse or create one | Update when status or long-term TODOs change |
| Cross-module, architectural, or long-running work | Required | Required | Required |
| Release, installation, migration, or data lifecycle | Required | Reuse the relevant task | Required |

- External contributors should not allocate task numbers by default. When a new task is needed, a maintainer checks `docs/tasks/` and confirms the next number to prevent concurrent collisions.
- Continue updating the original task for later changes to the same feature instead of creating fragmented tasks.
- A task records at least its goal, current state, key decisions, verification, implementation process, deviations, and follow-ups.
- Stable contracts belong in `reference/`. Important long-lived architecture decisions belong in an ADR. Exploration and implementation evidence remain in the task.
- External contributors do not update `RELEASE.md` by default. Maintainers turn merged changes into user-facing release notes during the release process.

## Git and Commits

- Create a topic branch from the latest `main`. Do not force-push maintainer branches or rewrite another contributor's commits.
- Keep one coherent problem per PR. Do not include opportunistic fixes, repository-wide formatting, dependency upgrades, upstream merges, or unrelated task documentation.
- Keep commits reviewable. Recommended Conventional Commit types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and `chore`.
- Do not bring merge commits from `main`, release commits, or generated artifacts into the PR when updating your branch. Rebase your own branch when necessary and resolve its conflicts yourself.

Examples:

```text
fix(agent): preserve session attachment ordering
docs(contributing): clarify task ownership
```

## Pull Request Requirements

Use the repository PR template and explain:

- Link the issue when this guide requires one; write “none” for a small documentation fix that may go directly to a PR.
- Confirm before starting that the issue is not claimed: do not submit a parallel implementation for an issue marked `status: claimed` or already assigned to someone else. Duplicate PRs may be closed or merged selectively.
- What is in scope and explicitly out of scope.
- User-visible behavior, implementation details, and affected contracts.
- Exact verification commands and results.
- Checks not run, known limitations, and follow-up work.
- Whether data shapes, configuration, installation, security, or privacy boundaries change.
- Screenshots, recordings, or an explicit note that browser verification was not run for frontend work.
- Required updates to user documentation, tasks, references, ADRs, or `PROJECT-STATUS.md`.

Maintainers may ask you to reduce the scope, add evidence, or discuss an interface again. A green CI run means the automated checks completed; it does not guarantee merge approval.

## Review and Merge

- Respond directly to behavioral issues, risks, and test gaps raised in review. Technical conclusions should be grounded in contracts and evidence.
- Maintainers own the final scope decision, task numbering, release notes, and merge method.
- A PR may close when direction changes, it remains inactive, its scope is too large, or it cannot be verified. Closing a PR is not a judgment on the contributor; a new contribution may start from a smaller, clearer scope.

## License

By submitting code, documentation, or other material, you confirm that you have the right to contribute it and agree that it will be released under the repository's [GNU Affero General Public License v3.0 only](LICENSE). The project does not require a CLA or DCO.
