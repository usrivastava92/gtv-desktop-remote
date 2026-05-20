# `updater/`

Three individually testable pieces split out of the 984-line
`src/main/updater.ts`:

- `UpdateChecker` — `IReleaseSource`-backed GitHub release lookup.
- `MacUpdateInstaller` — install + rollback via `IFileSystem` +
  `IShellRunner`.
- `UpdateStateMachine` — pure reducer over update events.

Dialogs go through `IDialogPresenter`; the Electron implementation lives
under `src/main/presenters/`.

PR-6 populates this folder.
