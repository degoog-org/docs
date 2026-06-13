# Degoog project context for Coderabbit

Degoog is a Bun and Hono TypeScript search aggregator created by fccview. It combines server-side search orchestration, a browser UI, extension registries, themes, admin settings, a plugin store, optional Valkey caching, Docker deployment, and tests.

## Before changing code

- Check `STANDARDS.md` in this same folder before making code changes.
- Preserve existing app behavior unless the user explicitly approves a behavior change.
- Preserve public API routes, response shapes, settings keys, environment variables, plugin APIs, extension IDs, theme behavior, and UI expectations.
- Prefer small, reviewable changes over rewrites unless asked.
- Add or update focused tests around behavior you touch.
- Do not make style-only churn across unrelated files.
- Style is in modularised scss files and built at runtime, ignore any .css file unless you are in a ./store folder.
- Follow existing styling patterns and the `degoog-*` class name convention.

## Architecture overview

- Server entrypoint and app boot live around `src/server/index.ts`.
- Hono routes live under `src/server/routes/`.
- Search logic lives around `src/server/search.ts` plus route-specific handlers under `src/server/routes/search/` and streaming search in `src/server/routes/search-stream.ts`.
- Extension registries live under `src/server/extensions/` and share registry behavior through `src/server/extensions/registry-factory.ts`.
- Extension store install, update, uninstall, and repo handling live under `src/server/extensions/store/`.
- Server settings, plugin settings, cache, rate limiting, proxy handling, auth helpers, and path helpers live under `src/server/utils/`.
- Client UI code lives under `src/client/`.
- Public templates and theme files live under `src/public/`.
- Tests live under `tests/`.

## Important project values

- The lead developer is a Front End tech lead, HE REALLY CARES about UI consistecy. No borders, no blur, no transparency, check the existing styling and follow suit for frontend changes.
- Don't write comments, only the human lead developer should ever manually add them.
- Readability and maintainability matter more than cleverness.
- Degoog should stay quirky and human, but understandable.
- Existing users should not have to change configuration, URLs, plugins, themes, or workflows because of cleanup work.
- Security fixes are welcome, but compatibility and migration impact must be considered.
- Treat installed plugins, themes, engines, and transports as a trusted extension system unless the user asks for a stricter trust model.

## Common cleanup themes

- Reduce duplicated logic between streaming and non-streaming search without changing response formats.
- Keep cache keys complete and behavior-specific.
- Keep extension IDs and settings IDs deterministic and backward compatible.
- Keep registry loading deterministic, especially for duplicate triggers, duplicate names, and skip behavior.
- Keep file writes atomic for persistent JSON settings or store metadata.
- Keep route JSON parsing, auth checks, and rate limiting consistent.
- Keep path handling safe for plugin, theme, proxy, and store assets.
- Keep large modules moving toward smaller responsibility-focused modules when they are already being touched.

## What not to do

- Do not rewrite the app.
- Do not replace Bun or Hono.
- Do not rename public routes or settings without compatibility.
- Do not break plugin, theme, engine, transport, or store compatibility.
- Do not redesign the UI as part of cleanup.
- Do not change production defaults without explicit approval.
