---
title: The Most Commonly Used Git Commands Every Developer Should Know
date: 2026-10-24
summary: A practical guide to everyday Git commands, explaining when to use each one with real examples, from setting up a repository to branching, merging, rebasing, and undoing mistakes.
tag: git, version-control, git-commands, developer-tools, command-line, github
draft: false
---

Git is the version control system almost every software team uses today. It records the history of your code, lets several people work on the same project without overwriting each other's changes, and makes it possible to try out ideas on a branch and throw them away if they don't work.

Git has well over a hundred commands, but day-to-day work relies on a much smaller set. This article walks through the commands you are most likely to use, grouped by the job they do. For each one you'll find what it is for, when to reach for it, and example commands you can run.

## A Quick Mental Model

Before looking at commands, it helps to know the three places your changes can live in a Git repository:

- **Working directory**: the files you see and edit on disk.
- **Staging area** (also called the **index**): a holding area for the changes you want to include in your next commit.
- **Repository**: the history of commits, stored in the hidden `.git` folder.

A typical change moves from the working directory to the staging area with `git add`, and from the staging area into the repository with `git commit`. When you work with a team, you also have a **remote** repository (for example on GitHub or GitLab), which you sync with using `git fetch`, `git pull`, and `git push`.

```
Working directory --git add--> Staging area --git commit--> Local repository --git push--> Remote
        ^                                                          |                        |
        +------------------------- git checkout / restore ---------+<------ git fetch/pull --+
```

## Setting Up Git

### git config

**Use case:** Tell Git who you are and how you like it to behave. Every commit records an author name and email, so this is the first thing to set on a new machine.

```bash
# Set your identity for every repository on this machine
git config --global user.name "Pratik Chaudhari"
git config --global user.email "pratik@example.com"

# Use "main" as the default branch name for new repositories
git config --global init.defaultBranch main

# Set your preferred editor for commit messages
git config --global core.editor "code --wait"

# Override the email for just the current repository
git config user.email "pratik@work-company.com"

# See all settings and where they come from
git config --list --show-origin
```

Settings saved with `--global` live in `~/.gitconfig` and apply everywhere. Settings without it are stored in the current repository's `.git/config` and take priority.

### git init

**Use case:** Turn an existing folder into a new Git repository. Use it when you start a project from scratch.

```bash
mkdir my-project && cd my-project
git init
# Initialized empty Git repository in /Users/pratik/my-project/.git/
```

`git init` creates the `.git` folder. Nothing is tracked until you add and commit files.

### git clone

**Use case:** Download a copy of an existing repository, including its full history, so you can work on it locally.

```bash
# Clone over HTTPS
git clone https://github.com/user/project.git

# Clone over SSH into a folder with a different name
git clone git@github.com:user/project.git my-project

# Clone only the latest snapshot of a large repository
git clone --depth 1 https://github.com/user/huge-project.git

# Clone and check out a specific branch
git clone --branch develop https://github.com/user/project.git
```

Cloning also sets up a remote called `origin` that points back to where you cloned from.

## Recording Changes

### git status

**Use case:** See what has changed. It shows which files are modified, which are staged for the next commit, and which are untracked. Run it often, especially before committing.

```bash
git status
# On branch main
# Changes to be committed:
#   modified:   src/app.js
# Changes not staged for commit:
#   modified:   README.md
# Untracked files:
#   notes.txt

# A compact, one-line-per-file view
git status -s
# M  src/app.js
#  M README.md
# ?? notes.txt
```

In the short format, the first column shows the staging area and the second shows the working directory. `??` means the file is untracked.

### git add

**Use case:** Choose which changes go into the next commit by moving them into the staging area.

```bash
# Stage one file
git add src/app.js

# Stage everything in the current directory and below
git add .

# Stage all changes in the repository, including deletions
git add -A

# Stage only parts of a file, choosing hunk by hunk
git add -p src/app.js
```

`git add -p` is especially useful when one file contains two unrelated changes and you want to commit them separately.

### git commit

**Use case:** Save a snapshot of the staged changes to the repository's history, with a message describing what changed and why.

```bash
# Commit with a short message
git commit -m "Add login form validation"

# Commit with a subject line and a longer body
git commit -m "Fix race condition in cache refresh" \
           -m "Two threads could refresh the same key at once. Use a lock per key."

# Stage all tracked, modified files and commit in one step
git commit -am "Update dependencies"

# Fix the last commit's message or add a forgotten file
git add forgotten-file.js
git commit --amend --no-edit
```

Note that `-a` does not include brand-new files; those still need `git add`. Only use `--amend` on commits you haven't pushed yet, because it rewrites history.

### git diff

**Use case:** See exactly what changed, line by line, before you stage or commit it.

```bash
# Changes in the working directory that are not staged yet
git diff

# Changes that are staged and will go into the next commit
git diff --staged

# Differences between two branches
git diff main..feature/login

# Only the names of changed files
git diff --name-only main..feature/login

# Changes to one file compared with the last commit
git diff HEAD -- src/app.js
```

### git rm and git mv

**Use case:** Delete or rename tracked files in a way that Git records immediately.

```bash
# Delete a file and stage the deletion
git rm old-script.sh

# Stop tracking a file but keep it on disk (for example, after adding it to .gitignore)
git rm --cached .env

# Rename or move a file
git mv utils.js helpers.js
```

### .gitignore

**Use case:** Not a command, but closely related. A `.gitignore` file lists files and folders Git should never track, such as build output, dependencies, and secrets.

```bash
cat > .gitignore <<'IGNORE'
node_modules/
dist/
.env
*.log
.DS_Store
IGNORE

git add .gitignore
git commit -m "Add .gitignore"
```

## Inspecting History

### git log

**Use case:** Browse the commit history to see who changed what and when.

```bash
# Full history of the current branch
git log

# One line per commit
git log --oneline

# A visual graph of all branches
git log --oneline --graph --all --decorate

# The last 5 commits
git log -5

# Commits by a particular author since a date
git log --author="Pratik" --since="2026-10-01"

# Commits whose message mentions a word
git log --grep="hotfix"

# History of a single file, including changes in each commit
git log -p -- src/app.js

# Commits that added or removed a particular string
git log -S "calculateTax"
```

### git show

**Use case:** Look at the details of a single commit, tag, or file at a point in time.

```bash
# The most recent commit and its changes
git show

# A specific commit
git show 543d131

# Only the list of files a commit touched
git show --stat 543d131

# A file as it was in an older commit
git show 543d131:src/app.js
```

### git blame

**Use case:** Find out who last changed each line of a file and in which commit. Handy when you need context for a confusing piece of code.

```bash
git blame src/app.js

# Only lines 40 to 60
git blame -L 40,60 src/app.js
```

## Working with Branches

Branches let you work on a feature or fix in isolation without affecting the main line of development.

### git branch

**Use case:** List, create, rename, and delete branches.

```bash
# List local branches (the current one is marked with *)
git branch

# List local and remote branches
git branch -a

# Create a branch without switching to it
git branch feature/payments

# Rename the current branch
git branch -m feature/checkout

# Delete a branch that has been merged
git branch -d feature/payments

# Force-delete a branch that hasn't been merged
git branch -D experiment

# Show branches already merged into main
git branch --merged main
```

### git switch

**Use case:** Move between branches. `git switch` was added in Git 2.23 as a clearer alternative to the branch-switching side of `git checkout`.

```bash
# Switch to an existing branch
git switch main

# Create a new branch and switch to it
git switch -c feature/search

# Go back to the previous branch
git switch -

# Create a local branch that tracks a remote one
git switch -c bugfix/123 origin/bugfix/123
```

### git checkout

**Use case:** The older, all-purpose command for switching branches and restoring files. You'll still see it everywhere in tutorials and scripts.

```bash
# Switch branches
git checkout main

# Create and switch to a new branch
git checkout -b feature/search

# Look at the project as it was at an old commit (a "detached HEAD")
git checkout 543d131

# Discard changes to a file in the working directory
git checkout -- src/app.js
```

### git restore

**Use case:** Undo changes to files. Like `git switch`, it splits a job out of `git checkout` into a clearer command.

```bash
# Discard uncommitted changes to a file
git restore src/app.js

# Unstage a file but keep its changes
git restore --staged src/app.js

# Restore a file to how it was in a specific commit
git restore --source=543d131 src/app.js
```

## Combining Work

### git merge

**Use case:** Bring the changes from one branch into another. This is the most common way to integrate a finished feature.

```bash
# Merge feature/search into main
git switch main
git merge feature/search

# Always create a merge commit, even when a fast-forward is possible
git merge --no-ff feature/search

# Combine all of a branch's commits into one staged change, then commit it yourself
git merge --squash feature/search
git commit -m "Add search feature"

# Give up on a merge that has conflicts
git merge --abort
```

If both branches changed the same lines, Git stops with a **merge conflict** and marks the file like this:

```
<<<<<<< HEAD
const timeout = 3000;
=======
const timeout = 5000;
>>>>>>> feature/search
```

Edit the file to keep the right version, remove the markers, then finish the merge:

```bash
git add src/config.js
git commit
```

### git rebase

**Use case:** Move your branch's commits so they sit on top of another branch, producing a straight, linear history instead of merge commits. Also used to clean up commits before sharing them.

```bash
# Replay feature/search on top of the latest main
git switch feature/search
git rebase main

# If a conflict happens, fix it, then continue
git add src/config.js
git rebase --continue

# Or give up and return to how things were
git rebase --abort

# Interactively squash, reorder, reword, or drop the last 4 commits
git rebase -i HEAD~4
```

In the interactive editor, change `pick` to `squash` (or `s`) to fold a commit into the one above it, `reword` (or `r`) to edit its message, or `drop` (or `d`) to remove it.

The golden rule: **don't rebase commits that others have already pulled**. Rebasing creates new commits with new IDs, which causes trouble for anyone who built on the old ones.

### git cherry-pick

**Use case:** Copy one or more specific commits from another branch onto your current branch, without merging the whole branch. Often used to bring a bug fix into a release branch.

```bash
git switch release/2.1
git cherry-pick a1b2c3d

# Pick several commits
git cherry-pick a1b2c3d e4f5g6h

# Apply the changes without committing, so you can adjust them first
git cherry-pick --no-commit a1b2c3d
```

## Working with Remotes

### git remote

**Use case:** Manage the list of remote repositories your local repository knows about.

```bash
# List remotes with their URLs
git remote -v

# Add a remote, for example the original repo you forked from
git remote add upstream https://github.com/original/project.git

# Change a remote's URL (for example, switching from HTTPS to SSH)
git remote set-url origin git@github.com:user/project.git

# Remove a remote
git remote remove upstream
```

### git fetch

**Use case:** Download new commits and branches from a remote without changing your working files or current branch. It's the safe way to see what others have pushed.

```bash
# Fetch from origin
git fetch origin

# Fetch from all remotes and remove branches deleted on the remote
git fetch --all --prune

# See what came in on main
git log --oneline main..origin/main
```

### git pull

**Use case:** Fetch from a remote and immediately integrate the changes into your current branch. It's essentially `git fetch` followed by `git merge` (or `git rebase`).

```bash
# Pull and merge
git pull

# Pull and rebase your local commits on top, avoiding a merge commit
git pull --rebase

# Make rebase the default for pulls
git config --global pull.rebase true

# Pull a specific branch from a specific remote
git pull upstream main
```

### git push

**Use case:** Upload your local commits to a remote repository so others can see them.

```bash
# Push the current branch
git push

# Push a new branch and set it to track the remote branch
git push -u origin feature/search

# Delete a branch on the remote
git push origin --delete feature/search

# Push tags
git push origin --tags

# Safely overwrite the remote branch after a rebase
git push --force-with-lease
```

Prefer `--force-with-lease` over `--force`. It refuses to overwrite the remote branch if someone else has pushed to it since you last fetched, so you don't wipe out a teammate's work.

## Saving Work in Progress

### git stash

**Use case:** Temporarily put aside uncommitted changes so you can switch branches or pull, then bring them back later.

```bash
# Stash tracked changes
git stash

# Stash with a description, including untracked files
git stash push -u -m "WIP: search filters"

# List stashes
git stash list
# stash@{0}: On feature/search: WIP: search filters

# Reapply the latest stash and remove it from the list
git stash pop

# Reapply a specific stash but keep it in the list
git stash apply stash@{1}

# See what's in a stash
git stash show -p stash@{0}

# Delete a stash
git stash drop stash@{0}
```

A typical use: you're halfway through a feature when an urgent bug comes in.

```bash
git stash push -m "WIP: feature"
git switch main
git switch -c hotfix/login-crash
# ...fix, commit, push...
git switch feature/search
git stash pop
```

## Undoing Things

### git reset

**Use case:** Move the current branch back to an earlier commit, optionally unstaging or discarding changes. Best used on commits you haven't pushed.

```bash
# Undo the last commit but keep its changes staged
git reset --soft HEAD~1

# Undo the last commit and unstage its changes, keeping them in your files (the default)
git reset HEAD~1

# Undo the last commit and throw away its changes completely
git reset --hard HEAD~1

# Unstage a single file
git reset src/app.js
```

`--hard` permanently discards uncommitted work, so double-check before running it.

### git revert

**Use case:** Undo a commit by creating a new commit that does the opposite. Unlike `reset`, it doesn't rewrite history, so it's the safe way to undo something that's already been pushed.

```bash
# Revert a specific commit
git revert a1b2c3d

# Revert without committing immediately, to combine several reverts
git revert --no-commit a1b2c3d e4f5g6h
git commit -m "Revert broken caching changes"

# Revert a merge commit, keeping the first parent's side
git revert -m 1 9f8e7d6
```

### git reflog

**Use case:** Recover "lost" work. The reflog records every place `HEAD` has pointed to recently, even after a bad reset or rebase.

```bash
git reflog
# 543d131 HEAD@{0}: reset: moving to HEAD~3
# 9a8b7c6 HEAD@{1}: commit: Add payment retry logic
# ...

# Bring the branch back to before the reset
git reset --hard HEAD@{1}

# Or rescue a commit onto a new branch
git switch -c rescue 9a8b7c6
```

### git clean

**Use case:** Delete untracked files and folders, such as build leftovers, from the working directory.

```bash
# Preview what would be deleted
git clean -n

# Delete untracked files
git clean -f

# Delete untracked files and directories
git clean -fd

# Also delete ignored files (like build output)
git clean -fdx
```

Always run `git clean -n` first, because deleted untracked files can't be recovered with Git.

## Tagging Releases

### git tag

**Use case:** Mark a specific commit as important, usually a release version.

```bash
# List tags
git tag

# Create an annotated tag (recommended for releases)
git tag -a v1.2.0 -m "Release 1.2.0"

# Tag an older commit
git tag -a v1.1.1 a1b2c3d -m "Patch release"

# Push a tag, or all tags
git push origin v1.2.0
git push origin --tags

# Delete a tag locally and on the remote
git tag -d v1.2.0
git push origin --delete v1.2.0
```

## Debugging with Git

### git bisect

**Use case:** Find the commit that introduced a bug by doing a binary search through history. Instead of checking hundreds of commits, Git narrows it down in a handful of steps.

```bash
git bisect start
git bisect bad                 # the current commit has the bug
git bisect good v1.1.0         # this release didn't

# Git checks out a commit in the middle; test it, then tell Git the result
git bisect good                # or: git bisect bad

# Repeat until Git reports "<commit> is the first bad commit", then finish
git bisect reset
```

If you have a script that exits with `0` when things work and non-zero when they don't, Git can do the whole search for you:

```bash
git bisect start HEAD v1.1.0
git bisect run npm test
```

## Handy Extras

### git worktree

**Use case:** Check out a second branch into a separate folder at the same time, without stashing or cloning again. Useful when reviewing a pull request while your own work is half-done.

```bash
# Check out hotfix/login-crash in a sibling folder
git worktree add ../project-hotfix hotfix/login-crash

# List worktrees
git worktree list

# Remove it when you're done
git worktree remove ../project-hotfix
```

### Aliases

**Use case:** Save typing on commands you use constantly.

```bash
git config --global alias.st "status -s"
git config --global alias.co checkout
git config --global alias.lg "log --oneline --graph --all --decorate"

git st
git lg
```

## A Typical Day with Git

Here is how many of these commands fit together in a normal feature workflow:

```bash
# 1. Start from an up-to-date main
git switch main
git pull --rebase

# 2. Create a feature branch
git switch -c feature/user-profile

# 3. Work, checking and staging changes as you go
git status
git diff
git add -p
git commit -m "Add user profile page"

# 4. Keep the branch current with main
git fetch origin
git rebase origin/main

# 5. Share the branch and open a pull request
git push -u origin feature/user-profile

# 6. After the pull request is merged, tidy up
git switch main
git pull
git branch -d feature/user-profile
git fetch --prune
```

## Quick Reference

| Command | What it's for |
| --- | --- |
| `git config` | Set your identity and preferences |
| `git init` | Create a new repository |
| `git clone` | Copy an existing repository |
| `git status` | See what has changed |
| `git add` | Stage changes for the next commit |
| `git commit` | Save staged changes to history |
| `git diff` | Show line-by-line changes |
| `git log` | Browse commit history |
| `git show` | Inspect one commit |
| `git blame` | See who last changed each line |
| `git branch` | List, create, rename, delete branches |
| `git switch` / `git checkout` | Move between branches |
| `git restore` | Discard or unstage file changes |
| `git merge` | Combine branches |
| `git rebase` | Replay commits onto another base |
| `git cherry-pick` | Copy specific commits |
| `git remote` | Manage remote repositories |
| `git fetch` | Download remote changes without merging |
| `git pull` | Download and integrate remote changes |
| `git push` | Upload local commits |
| `git stash` | Set aside work in progress |
| `git reset` | Move a branch back, unstage changes |
| `git revert` | Undo a commit safely with a new commit |
| `git reflog` | Recover lost commits |
| `git clean` | Remove untracked files |
| `git tag` | Mark releases |
| `git bisect` | Find the commit that introduced a bug |
| `git worktree` | Work on several branches at once |

Learning these commands well covers the vast majority of what you'll do with Git. The rest you can look up with `git help <command>` when you need it, and `git reflog` is there to rescue you when an experiment goes wrong.
