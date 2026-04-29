## Summary

<!-- 1-3 bullet points describing what this PR does -->

## Test Checklist

- [ ] Which tests were added or extended? (list file paths)
- [ ] All existing tests still pass (`pnpm test` + `pnpm test:e2e:lifecycle`)
- [ ] Were any existing tests modified? If yes, explain why:
- [ ] Edge cases covered:
- [ ] Edge cases intentionally NOT covered (and why):

## Pre-merge Checks

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (unit tests)
- [ ] `pnpm build` passes
- [ ] `pnpm test:e2e:lifecycle` passes (E2E lifecycle)
- [ ] No `.skip`, `.only`, or commented-out tests
- [ ] No secrets in the diff (`git diff` checked for `ghp_`, `sk-`, `sb_secret_`, `password=`)
