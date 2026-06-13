# Degoog Coding Standard

Degoog is a Bun + Hono TypeScript search aggregator with a client UI, server routes, streaming and non-streaming search, extension registries, plugin/theme/engine stores, optional Valkey-backed cache, settings/admin flows, Docker deployment, and tests. These standards are intended to make the project easier to maintain without forcing a rewrite or breaking public behavior.

This is an aspirational but pragmatic standard: apply it to new code first, then improve existing code when it is already being touched.

## 1. Core principles

### Standards

- Preserve existing APIs, UI contracts, config names, environment variables, plugin/theme/engine interfaces, store layout, and route behavior unless a migration explicitly documents compatibility.
- Prefer small, behavior-preserving changes over large style-only rewrites.
- Put tests around observable behavior before refactoring code that affects routes, search orchestration, persistence, extension loading, security gates, or user settings.
- Keep compatibility shims until the next intentional breaking release. Mark them with a clear `@deprecated` note and replacement path.
- Optimize for readability over cleverness. A future contributor should be able to understand route/search/registry behavior without tracing many hidden side effects.
- Treat installed extensions and themes as trusted code, but treat their inputs, paths, URLs, rendered HTML, and persisted metadata as untrusted.

### Rationale

Degoog already has users, extension compatibility, stored settings, and runtime data. The largest maintenance risk is not inconsistent formatting; it is accidental behavior drift across search modes, settings, extension IDs, stores, and streaming/non-streaming paths.

### Preferred pattern

```ts
// Good: a small helper captures current behavior and can be tested.
const parseSearchRequest = (url: URL): SearchParams => ({
  query: url.searchParams.get("q") ?? "",
  searchType: (url.searchParams.get("type") || "web") as SearchType,
  // Preserve current defaults here.
});
```

```ts
// Avoid: refactoring and changing defaults in the same patch.
const type = url.searchParams.get("kind") ?? "all";
```

### Migration strategy

- New code must follow this document.
- Existing code should be migrated only when that module is already changing for a feature, bug fix, security fix, or test addition.
- Prefer one module boundary at a time: route helpers, search orchestration, registry behavior, persistence, UI rendering, etc.
- Do not run mass formatting or rename-only changes unless they are isolated and reviewed separately.

## 2. TypeScript style and module boundaries

### Standards

- Keep strict DTO/shared types for data crossing boundaries:
  - client ↔ server request/response bodies,
  - route ↔ search orchestration,
  - registry ↔ extension modules,
  - persistence ↔ in-memory state,
  - store API ↔ UI.
- Avoid client/server type drift. If a shape is used on both sides, move the minimal shared type to `src/shared` or a deliberate server/client type package rather than duplicating it.
- Use explicit return types for exported functions, route helpers, registry helpers, persistence functions, and security-sensitive utilities.
- Keep inference for short local variables when it improves readability.
- Prefer `unknown` at external boundaries, then validate/narrow into typed DTOs.
- Naming:
  - Types/interfaces: `PascalCase` (`SearchResponse`, `PluginContext`).
  - Constants: `UPPER_SNAKE_CASE` for global/static config, `camelCase` for local immutable values.
  - Internal helpers may use a leading underscore only when this is already the local convention and the helper is file-private.
  - Route parser helpers should start with `parse`, validators with `is`/`assert`, mappers with `to`/`from`, and side-effect functions with verbs (`load`, `write`, `sync`, `reload`).
- Function size guidance:
  - Target under ~60 lines for ordinary helpers.
  - Route handlers and UI flows may be longer temporarily, but split obvious parse/auth/fetch/render/state chunks when touched.
  - Avoid functions doing all of parse + validation + persistence + rendering + logging.
- Module boundaries:
  - `src/server/routes/*`: HTTP shape, auth/rate limit placement, parsing, response mapping.
  - `src/server/search.ts` and `src/server/utils/search.ts`: search orchestration and shared query/cache/parsing behavior.
  - `src/server/extensions/*`: discovery, validation, ID mapping, lifecycle, extension metadata.
  - `src/server/utils/*`: reusable infrastructure such as cache, settings, outgoing fetch, paths, logging, tokens.
  - `src/client/modules/*`: UI flows and feature-level orchestration.
  - `src/client/utils/*`: transport, URL, parsing, DOM helpers, reusable client logic.

### Rationale

The project already has shared server types (`SearchResponse`, `SearchBody`, `ExtensionMeta`, extension contexts) and some shared client modules. Making DTOs explicit prevents silent route/client drift and makes regression tests simpler.

### Preferred pattern

```ts
interface SaveSettingsBody {
  customCss?: string;
  streamingEnabled?: string;
}

async function parseJsonBody<T extends object>(c: Context): Promise<T | null> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as T)
      : null;
  } catch {
    return null;
  }
}
```

### Migration strategy

- When touching a route, name the request and response DTOs first, even if validation remains minimal.
- When a client module casts response JSON, add or reuse a shared response type.
- Do not block bug fixes on full runtime validation; add narrow validation for fields the change depends on.
- Move shared types opportunistically. Keep re-export compatibility where imports are widespread.

## 3. Hono route standards

### Standards

Route files should follow this structure where practical:

1. Imports.
2. Constants and local DTOs.
3. Pure parse/validation helpers.
4. Auth/rate-limit helper calls.
5. Route registrations.
6. Export router.

For route handlers:

- Put rate limiting and auth at the top, before expensive work.
  - Search routes: rate limit first, then API-key guard, matching current behavior.
  - Settings/admin routes: settings guard before reading/writing sensitive state.
- Parse JSON with a small helper instead of repeating `try/catch` in every handler.
- Return consistent JSON error envelopes for JSON routes: `{ error: string }` and status code.
- For binary/text proxy routes, plain body errors are acceptable where clients already expect them; do not change those contracts casually.
- Keep route handlers focused on HTTP concerns. Delegate store mutations, search orchestration, extension reloads, and persistence to helpers.
- Avoid hidden behavior changes in parser refactors: preserve default values such as search type, page, language, image filters, and streaming settings.
- Route tests should cover auth/rate-limit ordering and compatibility-sensitive status codes.

### Rationale

Existing routes already use repeated patterns: `guardApiKey`, settings guards, JSON body parsing try/catch, and `{ error }` responses. Standardizing the pattern reduces accidental differences between routes.

### Preferred pattern

```ts
const invalidJson = (c: Context) => c.json({ error: "Invalid JSON" }, 400);

router.post("/api/example", async (c) => {
  const denied = await guardSettingsRoute(c, "POST /api/example");
  if (denied) return denied;

  const body = await readObjectBody<ExampleBody>(c);
  if (!body) return invalidJson(c);

  const result = await saveExample(body);
  return c.json({ ok: true, result });
});
```

### Migration strategy

- Start by extracting a JSON body parser and common route error helpers in a low-risk route.
- Update one route family at a time (`settings`, `extensions`, `store`, `search`).
- Do not convert proxy/body responses to JSON unless the caller contract is changed intentionally.
- Add tests for each migrated route’s old status codes and key error strings before refactoring.

## 4. Extension registry standards

### Standards

- Registry load order must be deterministic.
  - Directory entries should be sorted before import/initialization when changing registry discovery.
  - Duplicate ID resolution must be stable across restarts.
- Duplicate handling must be explicit:
  - canonical IDs are generated through `makeExtID`/`dedupeExtID` where applicable,
  - duplicate extension IDs should log a useful namespace/message,
  - duplicate settings IDs must not silently merge unrelated settings.
- `onLoad` semantics:
  - `match()` returning `null` means “not this registry”; do not log as an error.
  - `onLoad` failure means “skip this extension for this registry load” and log enough context to debug without leaking secrets.
  - Disabled extensions should still keep stable settings ID mapping when current behavior requires settings to remain visible/configurable.
- Stable IDs are part of the compatibility contract. Canonical extension IDs are generated by `makeExtID(folder, kind)` as a `<folder>-<kind>` suffix form: `-engine`, `-slot`, `-command`, `-middleware`, `-tab`, `-theme`, `-transport` (autocomplete uses the `autocomplete-<folder>` form). Do not rename built-in IDs, the canonical suffix scheme, or settings IDs without migration code. Note: commands historically used a `plugin-<folder>` prefix; this was standardized to `<folder>-command` with migration `2026-05-command-ids`.
- Settings ID mapping must remain stable for installed items and built-ins. Prefer explicit `settingsId` for extension types that expose settings.
- Registries should expose read-only copies (`items(): T[]`) or document mutation expectations. Avoid callers mutating registry-owned arrays.

### Rationale

Extension registries are core Degoog infrastructure. The current registry factory already centralizes discovery/import/match/onLoad behavior and canonical ID assignment. The main risks are nondeterminism, duplicate IDs, and accidental settings drift.

### Preferred pattern

```ts
const entries = (await readdir(dir)).sort((a, b) => a.localeCompare(b));

const settingsId = extension.settingsId ?? meta.canonicalId ?? makeExtID(meta.folderName, "command");
lockinSettingsId(meta.folderName, settingsId);
```

### Migration strategy

- First add tests around existing registry order, duplicate ID behavior, and disabled extension visibility.
- Sort load inputs only after tests confirm expected order or document the intended order change.
- When adding a new registry, use `createRegistry` rather than copying discovery logic.
- When changing ID rules, write a migration for stored settings and installed item records, then keep old aliases where possible.

## 5. Store and extension installation standards

### Standards

- Degoog’s store/extension model is trusted-code installation, not a sandbox. Be transparent in UI/docs when installing code from Git repositories.
- Dependency installation or update steps must be explicit and visible. Do not silently run package manager commands for extensions unless the feature is deliberately designed and documented.
- Repository operations must:
  - validate accepted URL schemes,
  - sanitize errors before exposing paths/tokens,
  - enforce timeouts for network/git operations,
  - avoid deleting outside the store directory,
  - preserve official repository protections.
- Persistence must be atomic for store metadata and installed-item records. Avoid direct overwrite of important JSON files without a temp-file + rename path when changing persistence code.
- Use lightweight per-file or per-resource locks for store writes, settings writes, and install/uninstall/update operations that could race.
- Path safety:
  - use resolved absolute paths for containment checks,
  - reject `..`, absolute child paths, symlink escapes, and unexpected file extensions where applicable,
  - never trust repository-provided filenames for writes outside the target install directory.
- Installed item IDs and `installedAs` names are compatibility-sensitive. Preserve existing values across refresh/update unless the user explicitly reinstalls/renames.

### Rationale

The store manages user-installed executable code and persistent metadata. Small races or path mistakes can corrupt installation state or expose files. The code already validates git URLs and sanitizes git errors; build on that pattern.

### Preferred pattern

```ts
const root = resolve(getStoreDir());
const target = resolve(root, repo.localPath);
if (!target.startsWith(root + sep)) {
  throw new Error("Invalid store path");
}
```

### Migration strategy

- Add atomic JSON write helpers before changing store persistence behavior.
- Wrap store mutations with a lock helper one operation family at a time.
- Add regression tests for duplicate repos, invalid URLs, path traversal, uninstall protections, and corrupted metadata recovery.
- Keep old metadata fields readable; add new fields as optional and backfill lazily.

## 6. Search standards

### Standards

- Keep a shared orchestration path for streaming and non-streaming search wherever possible.
  - Query parsing, engine selection, interceptors, image filters, domain rules, result scoring, related searches, thumbnail signing, and cache writes should not be duplicated.
- Interceptors return `{ query, overrides? }`. The `overrides` object is optional and may contain `searchType`, `lang`, and `timeFilter`. Both search paths must apply these overrides before cache key construction and engine selection. When multiple interceptors run, overrides are merged in order.
- Streaming and non-streaming parity is required unless explicitly documented:
  - same query normalization/intercepts,
  - same engines for a type,
  - same time/date/lang/image filters,
  - same cache key inputs,
  - same scoring/domain rules,
  - same result shape.
- Cache keys must include every input that can affect results: query after intercepts, engine config, search type, page, time filter, language, date range, image filters, and relevant future settings.
- Use timeout/cancellation consistently.
  - Engine fetches should receive `AbortSignal` where possible.
  - Streaming should stop work or stop emitting when the client disconnects.
  - Retry behavior should be bounded and observable.
- No duplicate search logic in route files. Routes should call shared search services and format the HTTP/SSE response.
- Engine timings should distinguish success, empty result, timeout, upstream error, and blocked/sentinel cases when available.
- Public behavior of `/api/search`, `/api/search/stream`, `/api/lucky`, and tab search routes is stable; preserve response fields and default values.

### Engine type model

- There are no hardcoded built-in engine types. All types (`web`, `images`, `videos`, `news`, and any custom string) are treated uniformly.
- `EngineSearchType` is `string`. Do not introduce a restrictive union; any engine can declare any type.
- `type` can be `string | string[]`. An array makes the engine participate in every listed tab simultaneously (e.g. `type = ["web", "karakeep"]`). Internally, `PluginEntry.searchTypes` is always `string[]`.
- Engine type resolution goes through `resolveTypes(baseTypes, override)` in `engines/registry.ts`. This is the single source of truth — do not duplicate this logic elsewhere.
  - `override` (from `searchTypeOverride` setting) wins when set; supports comma-separated values for multiple types.
- `selectActiveEngines` in `engine-selection.ts` has one unified path: `web` uses `getActiveWebEngines`, everything else uses `getEnginesForCustomType`. The `includeCustom` flag and separate `getEnginesForSearchType` no longer exist.
- `getEnginesForCustomType` accepts an optional `config` parameter. Pass it from search routes so user engine toggles are respected. Tab-specific search routes (`/api/tab-search`) do not pass config — that is intentional.
- `getCustomEngineTypes` returns all non-`web` types. Tabs for `images`, `videos`, `news` are now dynamic — they appear only when engines with those types are installed.
- The store reads engine `type` from the module file via a cached regex scan when the manifest does not declare it. Do not remove this fallback.

### Rationale

`search-stream.ts` currently contains a lot of orchestration that overlaps with non-streaming search. This is useful behavior, but it is easy for the two modes to drift. Shared orchestration lowers bug risk without mandating an immediate rewrite.

### Preferred pattern

```ts
interface SearchExecutionOptions {
  streaming?: boolean;
  signal?: AbortSignal;
  onEngineResult?: (event: EngineResultEvent) => Promise<void>;
}

const response = await executeSearch(params, {
  streaming: true,
  signal: c.req.raw.signal,
  onEngineResult: sendSseEvent,
});
```

### Migration strategy

- Add tests that compare streaming and non-streaming output for cache key inputs and result shape.
- Extract request parsing into a shared helper first.
- Extract engine selection next.
- Extract final scoring/domain/cache behavior last.
- Keep route responses byte-compatible enough for existing clients while internals move.

## 7. Client UI standards

### Standards

- Separate UI work into four layers where practical:
  1. parse inputs/URL/state,
  2. fetch or subscribe to server data,
  3. update application state,
  4. render DOM.
- Avoid giant client functions that do navigation, state reset, skeleton rendering, EventSource handling, result rendering, history updates, and side panel fetching all together. Split them when touched.
- Stable DOM IDs, classes, and `data-*` attributes are UI API. Preserve selectors used by themes, plugins, tests, and browser extensions.
- Prefer `data-action`, `data-id`, and event delegation for dynamic lists instead of rebinding many handlers after every render.
- Use `textContent` for plain text. Use `innerHTML` only with trusted templates, sanitized HTML, or existing trusted plugin/theme output.
- Rendering functions should accept typed data and return either DOM nodes or documented trusted HTML strings.
- Accessibility hints:
  - interactive elements should be buttons/links, not clickable divs,
  - add labels/`aria-label` for icon-only buttons,
  - preserve keyboard behavior for modals, dropdowns, pagination, and tabs,
  - keep loading state visible to assistive tech where feasible.
- Client fetch helpers should consistently handle auth params/nonces, JSON parsing, aborts, and error display.

### Rationale

The client has feature-rich flows, including streaming search and settings/store tabs. Some functions are necessarily complex today. Incremental separation makes behavior easier to test and keeps theme/plugin selectors stable.

### Preferred pattern

```ts
function parseSearchForm(form: HTMLFormElement): SearchFormState { /* pure */ }
async function fetchSearch(state: SearchFormState): Promise<SearchResponse> { /* network */ }
function applySearchState(response: SearchResponse): void { /* state */ }
function renderSearchResults(response: SearchResponse): void { /* DOM */ }
```

### Migration strategy

- When fixing a UI bug, extract only the affected parsing/rendering helper and add a focused test if practical.
- Do not rename selectors during logic refactors.
- Add `data-*` attributes alongside existing classes before switching code/tests to them.
- Keep existing HTML template/theme behavior; document trusted HTML assumptions rather than trying to sanitize all plugin/theme output in one pass.

## 8. Security standards

### Standards

- SSRF and outbound fetch gates:
  - Only allow `http:` and `https:` for proxied/fetched external URLs unless a transport explicitly supports more.
  - Re-check protocol and destination after redirects.
  - Use signed proxy URLs for images/assets exposed through Degoog.
  - Cap response size and timeout remote fetches.
  - Avoid fetching private/internal addresses for generic user-provided URLs if/when an SSRF guard is introduced; default deny should be preferred for new generic proxy features.
- Path containment:
  - Resolve and verify all extension/store paths before reads/writes/deletes.
  - Never join user/repo-provided paths and use them without containment checks.
- Token handling:
  - Settings/admin/search API tokens and nonces must not be logged.
  - Secret settings should be masked in unauthenticated extension metadata and UI responses.
  - Regenerating server keys/tokens should invalidate old access intentionally and document the effect.
- Trusted plugin/theme HTML:
  - Plugins/themes are trusted code once installed, but their HTML docs, README rendering, and user-entered Markdown/CSS should have explicit trust/sanitization boundaries.
  - Do not mix untrusted upstream search content into `innerHTML` without escaping/sanitizing.
- Proxy/header assumptions:
  - Do not trust `X-Forwarded-*` headers unless the deployment mode/proxy trust setting explicitly allows it.
  - Public/private instance mode, API key search settings, honeypot, and rate limits are security behavior; changes need tests.
- Error responses should be useful but not leak local paths, tokens, proxy credentials, repository internals, or stack traces.

### Rationale

Search aggregation, proxies, extension stores, and plugin HTML are high-risk areas. The current code already uses signed image proxy URLs, content type/size caps, settings auth guards, secret masking, and sanitized git errors. These patterns should become the default.

### Preferred pattern

```ts
function assertHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
```

### Migration strategy

- Add security regression tests for any fixed bug before changing implementation.
- Centralize URL validation and path containment helpers; migrate callers gradually.
- Keep legacy behavior behind explicit compatibility helpers when stricter validation could break extensions.
- Document trusted-code assumptions in extension developer docs and UI copy before enforcing stricter install warnings.

## 9. Persistence and cache standards

### Standards

- JSON persistence must be schema-compatible:
  - tolerate missing optional fields,
  - preserve unknown fields unless intentionally removing them,
  - recover safely from empty/corrupt files where current behavior allows,
  - write pretty JSON for user-editable files.
- Important writes should be atomic:
  - write to a temp file in the same directory,
  - fsync if appropriate for critical files,
  - rename over the old file.
- Use locks for read-modify-write flows that can overlap: settings, plugin settings, repos, installed items, tokens, migrations.
- Migrations must be idempotent and safe to re-run.
- Cache standards:
  - Valkey is optional; memory fallback must remain correct.
  - Cache APIs should be async for new code, using `useCache` rather than deprecated sync caches.
  - Namespaces must be stable and specific (`search`, `autocomplete`, `ext:<id>:<purpose>`).
  - Invalidation must clear local memory and Valkey-backed state where applicable.
  - TTLs should be configurable only through documented env/settings and have safe defaults.

### Rationale

Degoog runs locally, in Docker, and potentially in multiple replicas with Valkey. Atomic writes and async cache APIs protect both single-instance users and multi-instance deployments.

### Preferred pattern

```ts
const cache = useCache<MyDto>(`ext:${settingsId}:items`, 10 * 60_000);
await cache.set(cacheKey, value);
```

### Migration strategy

- Introduce one atomic write helper and migrate the highest-risk files first (`repos.json`, settings, plugin settings, tokens).
- Keep old file formats readable; add migrations only for real compatibility needs.
- Replace `createCache` with `useCache` when touching extension-facing APIs, but keep deprecated API until a planned breaking release.
- Add cache invalidation tests for settings/store operations that change search behavior.

## 10. Logging and observability standards

### Standards

- Use the central `logger` utility instead of raw `console.*` in server code, except during process startup failures where logger may not be initialized.
- Namespace logs by feature: `search`, `search-stream`, `store:repo`, `store:item`, `extensions`, `proxy`, `cache`, `settings`, `outgoing`, etc.
- Log meaningful timings and counts:
  - query length or redacted short query, not full sensitive payloads,
  - search type, page, enabled engine count,
  - result count, cache hit/miss, engine timings,
  - store operation duration and sanitized failure reason.
- Avoid logging secrets: tokens, Authorization headers, server keys, proxy credentials, password fields, secret settings.
- Prefer structured-compatible messages even in text mode: `key=value` pairs are easier to scan and can later be emitted as JSON.
- If structured logging is added, keep current text output as the default or provide an opt-in env var so local development remains friendly.

### Rationale

The existing logger supports levels, namespaces, translation logs, and repeated-line suppression. Consistent namespaces and redaction make it much more useful in Docker/CI/public instances.

### Preferred pattern

```ts
logger.debug(
  "search",
  `cache hit type=${searchType} page=${page} enginesOn=${enginesOn} results=${results.length}`,
);
```

### Migration strategy

- Replace raw server `console.*` calls only when touching nearby code.
- Add timings to slow/opaque operations first: engine fetches, store git operations, extension reloads, cache invalidation.
- Add structured logging as an optional logger mode, not as a project-wide rewrite.

## 11. Testing standards

### Standards

- Use `bun test` and keep tests focused on behavior and regressions.
- Every bug fix should include a regression test when the behavior can be exercised without excessive fragility.
- Prioritize tests for:
  - route status codes and response shapes,
  - auth/rate-limit/security guards,
  - search parsing, cache keys, engine selection, streaming/non-streaming parity,
  - extension registry duplicate/disabled/load-order behavior,
  - store install/uninstall/update safety,
  - persistence migration/idempotency,
  - client URL/state parsing and pure render helpers.
- Avoid overtesting one-time migrations unless they protect against a real past or likely future corruption path.
- Tests should isolate runtime data using env vars such as settings/data paths where available.
- Mock network/git sparingly; when mocking, assert the command/URL/options that matter for safety.
- Keep tests deterministic: sort inputs, control time where needed, avoid depending on external search providers.

### Rationale

The existing test suite already covers routes, units, stores, registries, cache, settings security, and public URL behavior. The next best investment is regression coverage around behavior that refactors might accidentally change.

### Preferred pattern

```ts
test("POST /api/settings/general rejects invalid JSON", async () => {
  const res = await router.request(new Request("http://localhost/api/settings/general", {
    method: "POST",
    body: "{",
  }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Invalid JSON" });
});
```

### Migration strategy

- Before refactoring a module, add a few high-value characterization tests for current behavior.
- Do not require exhaustive tests for pure style cleanup.
- When extracting helpers, test the helper if it contains meaningful branching; otherwise test the route/feature behavior.
- Keep fixtures small and local to the test unless shared fixtures clearly reduce duplication.

## 12. Duplication control standards

### Standards

- Duplication is acceptable temporarily when it preserves behavior during migration, but repeated logic should have an owner.
- Extract shared helpers for:
  - route JSON body parsing/errors,
  - search request parsing/cache key construction,
  - extension ID/settings ID mapping,
  - atomic JSON persistence,
  - path containment,
  - client auth fetch/JSON error handling,
  - trusted HTML/escaping utilities.
- Do not create generic abstraction before at least two real call sites prove the shape.
- Prefer small named helpers over large utility modules with unrelated functions.

### Rationale

Degoog has feature overlap across engines/plugins/slots/transports/autocomplete and across streaming/non-streaming search. The goal is controlled reuse, not abstraction for its own sake.

### Preferred pattern

```ts
// Good: exact shared behavior with a clear owner.
const params = parseSearchParams(c.req.url, { allowPostBody: false });
const key = buildSearchCacheKey(params);
```

### Migration strategy

- When you notice copy/paste during a bug fix, extract the minimum helper needed for the duplicated behavior.
- Keep the original public function names and re-export wrappers if other modules depend on them.
- Add tests to the helper only if behavior is non-trivial or compatibility-sensitive.

## 13. Per-module checklists

Use these checklists during code review. They are not gates for every small patch, but they help keep migrations consistent.

### Server route checklist

- Auth/rate-limit guard is first where appropriate.
- Request DTO is named or reused.
- JSON parse failure returns `{ error: "Invalid JSON" }` unless route has a legacy contract.
- Response shape and status codes are compatible.
- No local paths/secrets in errors/logs.
- Route tests cover changed behavior.

### Search checklist

- Streaming and non-streaming behavior still match.
- Cache key includes all behavior-affecting inputs.
- Engine selection is deterministic.
- Timeouts/cancellation are bounded.
- Domain rules, thumbnail signing, scoring, and related searches are applied consistently.
- Timings/errors are meaningful.

### Extension registry checklist

- Load order is deterministic or covered by tests.
- IDs/settings IDs are stable.
- Duplicate handling is explicit.
- Disabled/onLoad failure behavior is intentional.
- Extension metadata remains compatible with settings UI/store.

### Store/persistence checklist

- Paths are contained within expected directories.
- Writes are atomic or queued for atomic migration.
- Concurrent writes cannot corrupt JSON.
- Git/network operations have timeouts and sanitized errors.
- Old schema fields remain readable.

### Client UI checklist

- Selectors/classes/data attributes used externally are preserved.
- Plain text uses `textContent`; trusted HTML boundaries are clear.
- State changes and DOM rendering are separated where practical.
- Fetch abort/error handling is consistent.
- Accessibility of new controls is considered.

### Security checklist

- URL protocols and redirects are validated.
- Response sizes/timeouts are capped for proxies/fetches.
- Tokens/secrets are not logged or returned to unauthenticated clients.
- Public/private instance assumptions are preserved.
- Regression tests cover any fixed vulnerability.

## 14. Review rule of thumb

A change is aligned with this standard if it can answer “yes” to these questions:

- Does it preserve user-facing behavior unless the change explicitly says otherwise?
- Does it reduce future drift or make behavior easier to test?
- Are extension/plugin/theme/store compatibility risks considered?
- Are secrets, paths, URLs, and trusted HTML boundaries handled deliberately?
- Is the migration small enough to review safely?

If the answer is “no” for a necessary change, document why in the PR or commit notes and add tests around the intended new behavior.
