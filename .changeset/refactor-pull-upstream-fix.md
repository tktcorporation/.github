---
"@tktco/berm": patch
---

refactor(pull): upstream fixes — remove duplicate conflict logic and type workarounds

- Use `hasConflictMarkers()` from merge.ts in `runContinue` instead of raw `includes("<<<<<<<")`.
  Previously the check was incomplete (missing `=======` / `>>>>>>>` detection) and duplicated
  existing utility logic.
- Collapse the `base あり/なし` branch in Step 8 into a single code path using `""` as the
  default base. The only difference was the first argument to `threeWayMerge`; the conflict
  logging was identical copypaste.
- Extract `logMergeConflict()` helper so conflict reporting is defined once.
- Change `getInstalledModulePatterns` parameter type from `{ excludePatterns?: string[] }` to
  `DevEnvConfig`, removing the `config as any` cast.
- Remove unused `getPatternsByModuleIds` import.
