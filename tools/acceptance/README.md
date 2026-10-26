# Independent recovery fault checks

Run from the repository root with Node 24 and the frozen dependencies installed:

```sh
node --import tsx --test tools/acceptance/recovery-faults.test.ts
```

The four independently authored acceptance sequences use production repository, queue, export and host controllers with actual temporary Linux files and SQLite. They cover staging rename failure, queue reconstruction without relaunch, deliberate uncertain Photos reconciliation, and malformed-row repair while preserving completed acknowledgments and identities. Each test removes only its own temporary fixture.

The original reviewed harness had SHA-256 `018d7477795ebd95eb031d7307f87624ac38d0d5269dafdb955fb5cabe5abe9e`. Following the default change to four photos, its two session constructors explicitly request the historical five-photo mode; the fault actions and assertions remain unchanged. The [independent report](../../artifacts/test-results/fresh-reliability-acceptance.json) records the original 33-test execution: these four plus 29 existing targeted tests. Those 29 overlap the full suite and must not be counted twice. CI runs these four separately after the full suite.

Native File/SQLite APIs, Photos, camera, authentication, HTTP readiness and iPad interruption behavior are substituted boundaries. A Linux pass does not close the physical-device saving report.
