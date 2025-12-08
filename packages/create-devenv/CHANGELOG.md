# @tktco/create-devenv

## 0.1.1

### Patch Changes

- [`c3dcb7a`](https://github.com/tktcorporation/.github/commit/c3dcb7a158a4eedc331fef98433537ed9969c20d) Thanks [@tktcorporation](https://github.com/tktcorporation)! - fix: ignore "init" argument as directory name

  When running `npx create-devenv init`, the "init" was interpreted as the target directory.
  Now "init" is ignored and files are extracted to the current directory.
