# Copilot instructions

Follow [`AGENTS.md`](../AGENTS.md) at the repository root. It is the single source of
instructions for every AI agent working here: layout, commands, rules and workflow.

Copilot code review may read only this file, so three rules from `AGENTS.md` are
repeated below. This is the one deliberate copy; if it ever disagrees with
`AGENTS.md`, `AGENTS.md` wins.

- **No symlinks anywhere in the repository.** `omarchy plugin add` clones this repo
  *as* the plugin folder, and `omarchy-plugin-validate` refuses any symlink inside
  one. That is why `CLAUDE.md` imports `AGENTS.md` instead of linking to it.
- **Every form field is allowlisted for where distrobox puts it.** `distrobox create`
  `eval`s the command it builds on the host, so a field that is "just one argv
  element" can still run code. `Model.validateForm` owns the rules; `createArgv`
  returns `null` unless every field passes.
- **Every distrobox argv starts with `env DBX_CONTAINER_MANAGER=<engine>`.** Without
  it, a docker user's stop or delete can hit a podman box of the same name.
