# Independent recovery fault checks

Run from the repository root with Node 24 and the frozen dependencies installed:

```sh
node --import tsx --test tools/acceptance/recovery-faults.test.ts
```

The four independently authored acceptance sequences use production repository, queue, export and host controllers with actual temporary Linux files and SQLite. They cover staging rename failure, queue reconstruction without relaunch, deliberate uncertain Photos reconciliation, and malformed-row repair while preserving completed acknowledgments and identities. Each test removes only its own temporary fixture.

This is a byte-identical copy of the reviewed local harness (SHA-256 `018d7477795ebd95eb031d7307f87624ac38d0d5269dafdb955fb5cabe5abe9e`). It imports the same production modules from this equally deep directory. The [independent report](../../artifacts/test-results/fresh-reliability-acceptance.json) records the original 33-test execution: these four plus 29 existing targeted tests. The full app/core/API suite already includes those 29; do not count them twice. CI runs these four separately after the full suite.

Native File/SQLite APIs, Photos, camera, authentication, HTTP readiness and iPad interruption behavior are substituted boundaries. A Linux pass does not close the physical-device saving report.
