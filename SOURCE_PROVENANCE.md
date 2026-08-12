# Android source provenance

The Android application is derived from the reviewed iOS source of truth, not
from the deleted Android draft.

- Source repository: `lrodeveloperr/Grocery-code-ios-test`
- Source branch: `main`
- Source commit: `03d1dd013f215938b82ca1601c88301c9d5ed518`
- Frozen source archive SHA-256:
  `23d938c18df0e185e54946759a3075ef42ce2a6cbc3a0bff99b3a085387e4fcd`
- Canonical shared runtime: `release-overlay/app.html`
- Canonical native-shell baseline: `release-overlay/App.tsx`
- Reviewed app icon and in-app logo SHA-256:
  `a2893e96e83fed237c7063747c1f41c10c30ea85e3911149c13b02bfa861f808`

The release overlay supersedes conflicting files in the frozen archive.
Android-specific changes are intentionally limited to the native wrapper,
Play Billing adapter, notification handling, Android configuration, generated
launcher assets, validation, and release automation. The business rules and UI
remain in the canonical embedded web application.

Production package identity, aligned to the existing Play Console app:
`com.lateefrazaqoyetola.snapebtwictracker`.

QA package identity:
`com.lateefrazaqoyetola.snapebtwictracker.qa`.
