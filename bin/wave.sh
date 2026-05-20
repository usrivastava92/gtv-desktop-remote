#!/usr/bin/env bash
# bin/wave.sh — git-worktree orchestration for the GTV refactor.
#
# This script is intentionally thin: `git worktree` does the heavy lifting.
# It exists for the duration of the refactor described in REFACTOR_PLAN.md
# and MUST be deleted (along with any leftover worktrees and shadow
# branches) once Wave 6 (PR-10) is merged. See §7.5 of REFACTOR_PLAN.md.
#
# Usage:
#   bin/wave.sh start <wave-num> <branch-name>...
#       Creates one worktree per branch under ../gtv.<short>, symlinking
#       node_modules from the primary checkout and isolating .vite-cache.
#
#   bin/wave.sh rebase
#       For every active gtv.* worktree, fetches origin and rebases the
#       branch on origin/main. Halts on conflict so the operator can
#       resolve and `git rebase --continue`.
#
#   bin/wave.sh status
#       Prints active gtv.* worktrees with branch + ahead/behind + dirty
#       status.
#
#   bin/wave.sh end <branch-name>...
#       Removes the worktree(s) for the given branch(es) and deletes the
#       local branch (intended to be run AFTER the PR has merged to main).
#
# Conventions:
#   - The primary checkout (current repo root) stays on `main` and
#     must never have edits. All work happens in sibling worktrees.
#   - Worktree path: <repo-parent>/gtv.<short-id>
#     where <short-id> is the last path segment of the branch name with
#     any leading digits + dash stripped. Examples:
#       refactor/02-protocol     -> ../gtv.r02-protocol
#       refactor/qw3-factories   -> ../gtv.qw3-factories
#       refactor/05-services     -> ../gtv.r05-services
#   - Branches that start with "refactor/" are abbreviated with "r" prefix
#     for numeric ones and kept verbatim for qw* / shadow* / feature*.

set -Eeuo pipefail

# ─── Helpers ────────────────────────────────────────────────────────────────

err() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
note() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$*" >&2; }

repo_root() {
  git rev-parse --show-toplevel
}

parent_dir() {
  dirname "$(repo_root)"
}

# Derive the worktree short name from a branch name.
short_name_for() {
  local branch="$1"
  local tail="${branch##*/}"
  # If branch is refactor/NN-foo and tail starts with NN-, prepend "r".
  if [[ "$branch" == refactor/* && "$tail" =~ ^[0-9]+- ]]; then
    printf 'gtv.r%s\n' "$tail"
  else
    printf 'gtv.%s\n' "$tail"
  fi
}

require_clean_primary() {
  cd "$(repo_root)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "primary checkout has uncommitted changes — refusing to operate. Stash or commit first."
  fi
  local cur
  cur="$(git symbolic-ref --quiet --short HEAD || echo '')"
  if [[ "$cur" != "main" ]]; then
    warn "primary checkout is on '$cur', not 'main'. Switching."
    git switch main >/dev/null
  fi
}

# Returns 0 if the given path is already a registered worktree.
worktree_exists() {
  local path="$1"
  git worktree list --porcelain | awk '/^worktree / {print $2}' | grep -Fxq "$path"
}

# ─── Subcommands ────────────────────────────────────────────────────────────

cmd_start() {
  if [[ $# -lt 2 ]]; then
    err "usage: bin/wave.sh start <wave-num> <branch>..."
  fi
  local wave="$1"; shift
  require_clean_primary

  note "Wave $wave — fetching origin"
  git fetch origin --prune

  local pd; pd="$(parent_dir)"
  local primary_modules; primary_modules="$(repo_root)/node_modules"

  for branch in "$@"; do
    local short; short="$(short_name_for "$branch")"
    local wt_path="$pd/$short"

    if worktree_exists "$wt_path"; then
      warn "worktree already exists: $wt_path — skipping"
      continue
    fi

    note "Creating worktree for '$branch' at $wt_path"
    # Create branch from origin/main if it doesn't exist locally; otherwise reuse.
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      git worktree add "$wt_path" "$branch"
    else
      git worktree add -b "$branch" "$wt_path" origin/main
    fi

    # Symlink node_modules to avoid the per-worktree reinstall tax.
    if [[ -d "$primary_modules" ]]; then
      if [[ ! -e "$wt_path/node_modules" ]]; then
        ln -s "$primary_modules" "$wt_path/node_modules"
        note "  linked node_modules -> primary"
      fi
    else
      warn "  primary node_modules missing — run 'npm install' in the primary checkout first."
    fi

    # Isolate the Vite cache so concurrent dev servers don't collide.
    mkdir -p "$wt_path/.vite-cache"
  done

  note "Wave $wave started. Active worktrees:"
  cmd_status
}

cmd_rebase() {
  require_clean_primary
  git fetch origin --prune

  local pd; pd="$(parent_dir)"
  local any=0
  while IFS= read -r wt; do
    [[ -z "$wt" ]] && continue
    any=1
    local branch
    branch="$(git -C "$wt" symbolic-ref --quiet --short HEAD || echo 'DETACHED')"
    note "Rebasing $branch in $wt onto origin/main"
    if ! git -C "$wt" rebase origin/main; then
      warn "rebase halted in $wt — resolve conflicts then run 'git -C $wt rebase --continue'"
      return 1
    fi
  done < <(git worktree list --porcelain | awk '/^worktree / {print $2}' | grep "/gtv\\." || true)

  if [[ "$any" == 0 ]]; then
    note "No active gtv.* worktrees to rebase."
  fi
}

cmd_status() {
  local found=0
  printf '%-40s  %-30s  %-10s  %s\n' "WORKTREE" "BRANCH" "AHEAD/BEHIND" "DIRTY"
  while IFS= read -r wt; do
    [[ -z "$wt" ]] && continue
    found=1
    local branch
    branch="$(git -C "$wt" symbolic-ref --quiet --short HEAD || echo 'DETACHED')"
    local ahead_behind="-"
    if git -C "$wt" rev-parse --verify --quiet origin/main >/dev/null; then
      local a b
      a="$(git -C "$wt" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
      b="$(git -C "$wt" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
      ahead_behind="+${a}/-${b}"
    fi
    local dirty="clean"
    if ! git -C "$wt" diff --quiet || ! git -C "$wt" diff --cached --quiet; then
      dirty="DIRTY"
    fi
    printf '%-40s  %-30s  %-10s  %s\n' "$(basename "$wt")" "$branch" "$ahead_behind" "$dirty"
  done < <(git worktree list --porcelain | awk '/^worktree / {print $2}' | grep "/gtv\\." || true)
  if [[ "$found" == 0 ]]; then
    note "No active gtv.* worktrees."
  fi
}

cmd_end() {
  if [[ $# -lt 1 ]]; then
    err "usage: bin/wave.sh end <branch>..."
  fi
  require_clean_primary

  local pd; pd="$(parent_dir)"
  for branch in "$@"; do
    local short; short="$(short_name_for "$branch")"
    local wt_path="$pd/$short"

    if worktree_exists "$wt_path"; then
      note "Removing worktree $wt_path"
      # Remove the symlink first so worktree remove doesn't trip on it.
      [[ -L "$wt_path/node_modules" ]] && rm "$wt_path/node_modules"
      git worktree remove --force "$wt_path"
    else
      warn "no worktree at $wt_path — skipping removal"
    fi

    if git show-ref --verify --quiet "refs/heads/$branch"; then
      note "Deleting local branch $branch"
      git branch -D "$branch" || warn "branch $branch could not be deleted (unmerged?)"
    fi
  done

  git worktree prune
  note "End of wave cleanup complete. Active worktrees:"
  cmd_status
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  if [[ $# -lt 1 ]]; then
    err "usage: bin/wave.sh {start|rebase|status|end} [args...]"
  fi
  local sub="$1"; shift
  case "$sub" in
    start)  cmd_start  "$@" ;;
    rebase) cmd_rebase "$@" ;;
    status) cmd_status "$@" ;;
    end)    cmd_end    "$@" ;;
    -h|--help|help)
      sed -n '2,40p' "$0"
      ;;
    *) err "unknown subcommand: $sub" ;;
  esac
}

main "$@"
